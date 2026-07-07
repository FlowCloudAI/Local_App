use std::cmp::Ordering;
use std::collections::{HashMap, HashSet};
use std::fs::{self, File};
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::sync::{Mutex, MutexGuard};

use anyhow::{Context, Result, anyhow};
use chrono::Utc;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use uuid::Uuid;

use crate::PathsState;

use super::model::{
    DocumentChunk, DocumentContextBuildResult, DocumentContextItem, DocumentContextSource,
    DocumentContextStatus, ParsedDocument,
};
use super::parser::default_parser_registry;

const INDEX_FILE: &str = "index.json";
const DEFAULT_CONTEXT_CHAR_BUDGET: usize = 24_000;
const MAX_DOCUMENT_SOURCE_BYTES: u64 = 50 * 1024 * 1024;

static INDEX_LOCK: Mutex<()> = Mutex::new(());

#[derive(Debug, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct DocumentContextIndex {
    items: Vec<DocumentContextItem>,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ParseOutputMeta {
    parser_id: String,
    format: String,
    title: Option<String>,
    warnings: Vec<String>,
}

#[derive(Debug, Deserialize)]
struct ChatConversationAttachmentScan {
    #[serde(default)]
    messages: Vec<ChatMessageAttachmentScan>,
}

#[derive(Debug, Deserialize)]
struct ChatMessageAttachmentScan {
    #[serde(default)]
    attachments: Vec<ChatAttachmentScan>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ChatAttachmentScan {
    #[serde(default)]
    sha256: String,
}

#[derive(Debug, Clone)]
struct ChunkCandidate {
    item_id: String,
    file_name: String,
    parser_id: Option<String>,
    extension: String,
    chunk: DocumentChunk,
    order: usize,
    score: f64,
}

pub fn context_root_dir(paths: &PathsState) -> Result<PathBuf> {
    let db_dir = paths
        .db_path
        .parent()
        .ok_or_else(|| anyhow!("无法解析数据库目录: {:?}", paths.db_path))?;
    Ok(db_dir.join("document_context"))
}

pub fn create_pending_items(
    paths: &PathsState,
    conversation_id: Option<String>,
    file_paths: Vec<String>,
) -> Result<Vec<DocumentContextItem>> {
    let root = context_root_dir(paths)?;
    fs::create_dir_all(files_dir(&root))?;
    let supported_extensions = default_parser_registry().supported_extensions();
    let mut created = Vec::new();

    for raw_path in file_paths {
        let source_path = PathBuf::from(&raw_path);
        if !source_path.is_file() {
            return Err(anyhow!("文件不存在或不可读取：{}", raw_path));
        }

        let file_name = source_path
            .file_name()
            .and_then(|value| value.to_str())
            .ok_or_else(|| anyhow!("文件名包含非法字符：{}", raw_path))?
            .to_string();
        let extension = source_path
            .extension()
            .and_then(|value| value.to_str())
            .unwrap_or_default()
            .to_ascii_lowercase();
        if !supported_extensions
            .iter()
            .any(|supported| supported.eq_ignore_ascii_case(&extension))
        {
            let extension_label = if extension.is_empty() {
                "无扩展名".to_string()
            } else {
                format!(".{}", extension)
            };
            return Err(anyhow!("当前不支持解析 {} 文件", extension_label));
        }
        ensure_source_size_allowed(&source_path)?;
        let sha256 = sha256_file(&source_path)?;
        let archived_source_path = archive_source_file(&root, &source_path, &sha256, &extension)?;
        let now = Utc::now().to_rfc3339();
        let cached = read_cached_parse_output(&root, &sha256).ok();
        let item = DocumentContextItem {
            id: Uuid::new_v4().to_string(),
            conversation_id: conversation_id.clone(),
            file_name,
            source_path: archived_source_path.to_string_lossy().to_string(),
            sha256,
            extension,
            parser_id: cached.as_ref().map(|cache| cache.meta.parser_id.clone()),
            status: if cached.is_some() {
                DocumentContextStatus::Ready
            } else {
                DocumentContextStatus::Pending
            },
            markdown_path: cached
                .as_ref()
                .map(|cache| cache.markdown_path.to_string_lossy().to_string()),
            text_path: cached
                .as_ref()
                .map(|cache| cache.text_path.to_string_lossy().to_string()),
            chunks_path: cached
                .as_ref()
                .map(|cache| cache.chunks_path.to_string_lossy().to_string()),
            created_at: now.clone(),
            updated_at: now,
            error: None,
        };
        created.push(item);
    }

    let _guard = lock_index()?;
    let mut index = read_index(&root)?;
    index.items.extend(created.iter().cloned());
    write_index(&root, &index)?;
    Ok(created)
}

fn ensure_source_size_allowed(source_path: &Path) -> Result<()> {
    let metadata = fs::metadata(source_path)
        .with_context(|| format!("读取文件信息失败：{}", source_path.display()))?;
    if metadata.len() > MAX_DOCUMENT_SOURCE_BYTES {
        return Err(anyhow!(
            "文件超过大小限制：{} MB",
            MAX_DOCUMENT_SOURCE_BYTES / 1024 / 1024
        ));
    }
    Ok(())
}

fn archive_source_file(
    root: &Path,
    source_path: &Path,
    sha256: &str,
    extension: &str,
) -> Result<PathBuf> {
    let item_dir = files_dir(root).join(sha256);
    fs::create_dir_all(&item_dir)
        .with_context(|| format!("创建文档归档目录失败：{}", item_dir.display()))?;
    let target_path = item_dir.join(source_archive_file_name(extension));
    if target_path.is_file() {
        return Ok(target_path);
    }

    let temp_path = item_dir.join(format!("source.{}.tmp", Uuid::new_v4()));
    fs::copy(source_path, &temp_path).with_context(|| {
        format!(
            "归档源文件失败：{} -> {}",
            source_path.display(),
            temp_path.display()
        )
    })?;

    if let Err(error) = fs::rename(&temp_path, &target_path) {
        if target_path.is_file() {
            let _ = fs::remove_file(&temp_path);
        } else {
            return Err(error)
                .with_context(|| format!("保存归档源文件失败：{}", target_path.display()));
        }
    }

    Ok(target_path)
}

fn source_archive_file_name(extension: &str) -> String {
    if extension.is_empty() {
        "source".to_string()
    } else {
        format!("source.{}", extension)
    }
}

struct CachedParseOutput {
    meta: ParseOutputMeta,
    markdown_path: PathBuf,
    text_path: PathBuf,
    chunks_path: PathBuf,
}

fn read_cached_parse_output(root: &Path, sha256: &str) -> Result<CachedParseOutput> {
    let item_dir = files_dir(root).join(sha256);
    let markdown_path = item_dir.join("content.md");
    let text_path = item_dir.join("text.txt");
    let chunks_path = item_dir.join("chunks.json");
    let meta_path = item_dir.join("meta.json");

    if !markdown_path.is_file()
        || !text_path.is_file()
        || !chunks_path.is_file()
        || !meta_path.is_file()
    {
        return Err(anyhow!("解析缓存不完整：{}", item_dir.display()));
    }

    let meta: ParseOutputMeta = read_json_file(&meta_path)?;
    let _: Vec<DocumentChunk> = read_json_file(&chunks_path)?;
    Ok(CachedParseOutput {
        meta,
        markdown_path,
        text_path,
        chunks_path,
    })
}

pub fn list_items(
    paths: &PathsState,
    conversation_id: Option<&str>,
) -> Result<Vec<DocumentContextItem>> {
    let root = context_root_dir(paths)?;
    let _guard = lock_index()?;
    let mut items = read_index(&root)?.items;
    if let Some(conversation_id) = conversation_id {
        items.retain(|item| item.conversation_id.as_deref() == Some(conversation_id));
    }
    items.sort_by(|a, b| b.updated_at.cmp(&a.updated_at));
    Ok(items)
}

pub fn get_item(paths: &PathsState, item_id: &str) -> Result<DocumentContextItem> {
    let root = context_root_dir(paths)?;
    let _guard = lock_index()?;
    read_index(&root)?
        .items
        .into_iter()
        .find(|item| item.id == item_id)
        .ok_or_else(|| anyhow!("未找到文档上下文：{}", item_id))
}

pub fn mark_item_parsing(paths: &PathsState, item_id: &str) -> Result<DocumentContextItem> {
    update_item(paths, item_id, |item| {
        item.status = DocumentContextStatus::Parsing;
        item.updated_at = Utc::now().to_rfc3339();
        item.error = None;
    })
}

pub fn save_parse_success(
    paths: &PathsState,
    item_id: &str,
    parsed: &ParsedDocument,
) -> Result<DocumentContextItem> {
    let root = context_root_dir(paths)?;
    let item = get_item(paths, item_id)?;
    let item_dir = files_dir(&root).join(&item.sha256);
    fs::create_dir_all(&item_dir)?;

    let markdown_path = item_dir.join("content.md");
    let text_path = item_dir.join("text.txt");
    let chunks_path = item_dir.join("chunks.json");
    let meta_path = item_dir.join("meta.json");

    fs::write(&markdown_path, &parsed.markdown)
        .with_context(|| format!("写入 Markdown 缓存失败：{}", markdown_path.display()))?;
    fs::write(&text_path, &parsed.plain_text)
        .with_context(|| format!("写入纯文本缓存失败：{}", text_path.display()))?;
    write_json_file(&chunks_path, &parsed.chunks)?;
    write_json_file(
        &meta_path,
        &ParseOutputMeta {
            parser_id: parsed.parser_id.clone(),
            format: parsed.format.clone(),
            title: parsed.title.clone(),
            warnings: parsed.warnings.clone(),
        },
    )?;

    update_item(paths, item_id, |item| {
        item.parser_id = Some(parsed.parser_id.clone());
        item.status = DocumentContextStatus::Ready;
        item.markdown_path = Some(markdown_path.to_string_lossy().to_string());
        item.text_path = Some(text_path.to_string_lossy().to_string());
        item.chunks_path = Some(chunks_path.to_string_lossy().to_string());
        item.updated_at = Utc::now().to_rfc3339();
        item.error = None;
    })
}

pub fn save_parse_failure(
    paths: &PathsState,
    item_id: &str,
    error: impl ToString,
) -> Result<DocumentContextItem> {
    update_item(paths, item_id, |item| {
        item.status = DocumentContextStatus::Failed;
        item.updated_at = Utc::now().to_rfc3339();
        item.error = Some(error.to_string());
    })
}

pub fn remove_item(paths: &PathsState, item_id: &str) -> Result<()> {
    let root = context_root_dir(paths)?;
    {
        let _guard = lock_index()?;
        let mut index = read_index(&root)?;
        let before = index.items.len();
        index.items.retain(|item| item.id != item_id);
        if index.items.len() == before {
            return Err(anyhow!("未找到文档上下文：{}", item_id));
        }
        write_index(&root, &index)?;
    }
    garbage_collect_orphan_files(paths, &root);
    Ok(())
}

pub fn remove_items_for_conversation(
    paths: &PathsState,
    conversation_id: &str,
) -> Result<Vec<DocumentContextItem>> {
    let root = context_root_dir(paths)?;
    let removed = {
        let _guard = lock_index()?;
        let mut index = read_index(&root)?;
        let mut removed = Vec::new();
        index.items.retain(|item| {
            let should_remove = item.conversation_id.as_deref() == Some(conversation_id);
            if should_remove {
                removed.push(item.clone());
            }
            !should_remove
        });
        if !removed.is_empty() {
            write_index(&root, &index)?;
        }
        removed
    };
    if !removed.is_empty() {
        garbage_collect_orphan_files(paths, &root);
    }
    Ok(removed)
}

pub fn reassign_conversation(
    paths: &PathsState,
    from_conversation_id: &str,
    to_conversation_id: &str,
) -> Result<Vec<DocumentContextItem>> {
    let root = context_root_dir(paths)?;
    let _guard = lock_index()?;
    let mut index = read_index(&root)?;
    let now = Utc::now().to_rfc3339();
    let mut updated = Vec::new();

    for item in &mut index.items {
        if item.conversation_id.as_deref() != Some(from_conversation_id) {
            continue;
        }
        item.conversation_id = Some(to_conversation_id.to_string());
        item.updated_at = now.clone();
        updated.push(item.clone());
    }

    if updated.is_empty() {
        return Ok(updated);
    }

    write_index(&root, &index)?;
    Ok(updated)
}

pub fn build_context_markdown(
    paths: &PathsState,
    conversation_id: &str,
    item_ids: &[String],
    max_chars: Option<usize>,
    query: Option<&str>,
) -> Result<DocumentContextBuildResult> {
    let root = context_root_dir(paths)?;
    let items = {
        let _guard = lock_index()?;
        read_index(&root)?.items
    };
    let selected: HashSet<&str> = item_ids.iter().map(String::as_str).collect();
    let budget = max_chars.unwrap_or(DEFAULT_CONTEXT_CHAR_BUDGET);
    let query_terms = query
        .map(extract_query_terms)
        .filter(|terms| !terms.is_empty())
        .unwrap_or_default();
    if !query_terms.is_empty() {
        let candidates = collect_chunk_candidates(items, conversation_id, &selected)?;
        return Ok(build_ranked_context_markdown(
            rank_chunk_candidates(candidates, &query_terms),
            budget,
        ));
    }

    let mut remaining = budget;
    let mut markdown = String::new();
    let mut sources = Vec::new();
    let mut truncated = false;

    markdown.push_str("[用户附件上下文]\n以下内容来自用户添加的本地文件，仅作为回答参考。不要编造文件中没有的内容。\n\n");

    for item in items {
        if item.conversation_id.as_deref() != Some(conversation_id) {
            continue;
        }
        if !selected.is_empty() && !selected.contains(item.id.as_str()) {
            continue;
        }
        if item.status != DocumentContextStatus::Ready {
            continue;
        }

        let chunks_path = item
            .chunks_path
            .as_deref()
            .ok_or_else(|| anyhow!("文档上下文缺少分块缓存：{}", item.id))?;
        let chunks: Vec<DocumentChunk> = read_json_file(Path::new(chunks_path))?;
        let file_header = format!(
            "## 文件：{}\n格式：.{}\n解析器：{}\n\n",
            item.file_name,
            item.extension,
            item.parser_id.as_deref().unwrap_or("unknown")
        );
        if !append_with_budget(&mut markdown, &file_header, &mut remaining) {
            truncated = true;
            break;
        }

        let mut included_chunks = 0;
        let mut included_chars = 0;
        for chunk in chunks {
            let heading = chunk
                .heading
                .as_deref()
                .or(chunk.source_ref.as_deref())
                .unwrap_or(chunk.id.as_str());
            let block = format!("### {}\n{}\n\n", heading, chunk.markdown);
            if !append_with_budget(&mut markdown, &block, &mut remaining) {
                truncated = true;
                break;
            }
            included_chunks += 1;
            included_chars += chunk.char_count;
        }

        sources.push(DocumentContextSource {
            item_id: item.id,
            file_name: item.file_name,
            parser_id: item.parser_id,
            format: Some(item.extension),
            included_chunks,
            included_chars,
        });

        if truncated {
            break;
        }
    }

    if truncated {
        markdown.push_str("\n（附件内容过长，已按当前上下文预算截断。）\n");
    }

    Ok(DocumentContextBuildResult {
        markdown,
        sources,
        truncated,
    })
}

fn collect_chunk_candidates(
    items: Vec<DocumentContextItem>,
    conversation_id: &str,
    selected: &HashSet<&str>,
) -> Result<Vec<ChunkCandidate>> {
    let mut candidates = Vec::new();
    for item in items {
        if item.conversation_id.as_deref() != Some(conversation_id) {
            continue;
        }
        if !selected.is_empty() && !selected.contains(item.id.as_str()) {
            continue;
        }
        if item.status != DocumentContextStatus::Ready {
            continue;
        }

        let chunks_path = item
            .chunks_path
            .as_deref()
            .ok_or_else(|| anyhow!("文档上下文缺少分块缓存：{}", item.id))?;
        let chunks: Vec<DocumentChunk> = read_json_file(Path::new(chunks_path))?;
        for chunk in chunks {
            candidates.push(ChunkCandidate {
                item_id: item.id.clone(),
                file_name: item.file_name.clone(),
                parser_id: item.parser_id.clone(),
                extension: item.extension.clone(),
                chunk,
                order: candidates.len(),
                score: 0.0,
            });
        }
    }
    Ok(candidates)
}

fn rank_chunk_candidates(
    mut candidates: Vec<ChunkCandidate>,
    query_terms: &HashSet<String>,
) -> Vec<ChunkCandidate> {
    let mut document_frequencies: HashMap<String, usize> = HashMap::new();
    let term_counts = candidates
        .iter()
        .map(|candidate| {
            let text = format!(
                "{} {} {}",
                candidate.file_name,
                candidate.chunk.heading.as_deref().unwrap_or_default(),
                candidate.chunk.markdown
            );
            let counts = term_counts(&text);
            for term in query_terms {
                if counts.contains_key(term) {
                    *document_frequencies.entry(term.clone()).or_insert(0) += 1;
                }
            }
            counts
        })
        .collect::<Vec<_>>();
    let document_count = candidates.len().max(1) as f64;

    for (index, candidate) in candidates.iter_mut().enumerate() {
        let counts = &term_counts[index];
        let total_terms = counts.values().sum::<usize>().max(1) as f64;
        candidate.score = query_terms
            .iter()
            .map(|term| {
                let tf = *counts.get(term).unwrap_or(&0) as f64;
                if tf == 0.0 {
                    return 0.0;
                }
                let df = *document_frequencies.get(term).unwrap_or(&0) as f64;
                let idf = ((document_count + 1.0) / (df + 1.0)).ln() + 1.0;
                (tf / total_terms.sqrt()) * idf
            })
            .sum();
    }

    candidates.sort_by(|a, b| {
        b.score
            .partial_cmp(&a.score)
            .unwrap_or(Ordering::Equal)
            .then_with(|| a.order.cmp(&b.order))
    });
    candidates
}

fn build_ranked_context_markdown(
    candidates: Vec<ChunkCandidate>,
    budget: usize,
) -> DocumentContextBuildResult {
    let mut remaining = budget;
    let mut markdown = String::new();
    let mut sources = Vec::new();
    let mut truncated = false;

    markdown.push_str("[用户附件上下文]\n以下内容来自用户添加的本地文件，仅作为回答参考。不要编造文件中没有的内容。\n\n");

    for candidate in candidates {
        let heading = candidate
            .chunk
            .heading
            .as_deref()
            .or(candidate.chunk.source_ref.as_deref())
            .unwrap_or(candidate.chunk.id.as_str());
        let block = format!(
            "## 文件：{}\n格式：.{}\n解析器：{}\n### {}\n{}\n\n",
            candidate.file_name,
            candidate.extension,
            candidate.parser_id.as_deref().unwrap_or("unknown"),
            heading,
            candidate.chunk.markdown
        );
        let before_remaining = remaining;
        if !append_with_budget(&mut markdown, &block, &mut remaining) {
            truncated = true;
        }
        if remaining < before_remaining {
            record_ranked_source(&mut sources, &candidate, before_remaining - remaining);
        }
        if truncated {
            break;
        }
    }

    if truncated {
        markdown.push_str("\n（附件内容过长，已按当前上下文预算截断。）\n");
    }

    DocumentContextBuildResult {
        markdown,
        sources,
        truncated,
    }
}

fn record_ranked_source(
    sources: &mut Vec<DocumentContextSource>,
    candidate: &ChunkCandidate,
    included_chars: usize,
) {
    if let Some(source) = sources
        .iter_mut()
        .find(|source| source.item_id == candidate.item_id)
    {
        source.included_chunks += 1;
        source.included_chars += included_chars.min(candidate.chunk.char_count);
        return;
    }

    sources.push(DocumentContextSource {
        item_id: candidate.item_id.clone(),
        file_name: candidate.file_name.clone(),
        parser_id: candidate.parser_id.clone(),
        format: Some(candidate.extension.clone()),
        included_chunks: 1,
        included_chars: included_chars.min(candidate.chunk.char_count),
    });
}

fn extract_query_terms(query: &str) -> HashSet<String> {
    extract_terms(query).into_iter().collect()
}

fn term_counts(text: &str) -> HashMap<String, usize> {
    let mut counts = HashMap::new();
    for term in extract_terms(text) {
        *counts.entry(term).or_insert(0) += 1;
    }
    counts
}

fn extract_terms(text: &str) -> Vec<String> {
    let mut terms = Vec::new();
    let mut ascii = String::new();
    let mut cjk = Vec::new();

    for ch in text.chars() {
        if ch.is_ascii_alphanumeric() {
            flush_cjk_terms(&mut cjk, &mut terms);
            ascii.push(ch.to_ascii_lowercase());
        } else {
            flush_ascii_term(&mut ascii, &mut terms);
            if is_cjk(ch) {
                cjk.push(ch);
            } else {
                flush_cjk_terms(&mut cjk, &mut terms);
            }
        }
    }
    flush_ascii_term(&mut ascii, &mut terms);
    flush_cjk_terms(&mut cjk, &mut terms);
    terms
}

fn flush_ascii_term(value: &mut String, terms: &mut Vec<String>) {
    if value.len() >= 2 {
        terms.push(std::mem::take(value));
    } else {
        value.clear();
    }
}

fn flush_cjk_terms(chars: &mut Vec<char>, terms: &mut Vec<String>) {
    match chars.len() {
        0 => {}
        1 => terms.push(chars[0].to_string()),
        _ => {
            for pair in chars.windows(2) {
                terms.push(pair.iter().collect());
            }
        }
    }
    chars.clear();
}

fn is_cjk(ch: char) -> bool {
    matches!(
        ch,
        '\u{3400}'..='\u{4dbf}'
            | '\u{4e00}'..='\u{9fff}'
            | '\u{f900}'..='\u{faff}'
            | '\u{20000}'..='\u{2a6df}'
            | '\u{2a700}'..='\u{2b73f}'
            | '\u{2b740}'..='\u{2b81f}'
            | '\u{2b820}'..='\u{2ceaf}'
    )
}

fn append_with_budget(target: &mut String, value: &str, remaining: &mut usize) -> bool {
    let value_chars = value.chars().count();
    if value_chars <= *remaining {
        target.push_str(value);
        *remaining -= value_chars;
        return true;
    }
    if *remaining == 0 {
        return false;
    }
    let partial: String = value.chars().take(*remaining).collect();
    target.push_str(&partial);
    *remaining = 0;
    false
}

fn files_dir(root: &Path) -> PathBuf {
    root.join("files")
}

fn chats_dir(paths: &PathsState) -> Result<PathBuf> {
    let db_dir = paths
        .db_path
        .parent()
        .ok_or_else(|| anyhow!("无法解析数据库目录: {:?}", paths.db_path))?;
    Ok(db_dir.join("chats"))
}

fn index_path(root: &Path) -> PathBuf {
    root.join(INDEX_FILE)
}

fn lock_index() -> Result<MutexGuard<'static, ()>> {
    INDEX_LOCK
        .lock()
        .map_err(|_| anyhow!("文档上下文索引锁已损坏"))
}

fn read_index(root: &Path) -> Result<DocumentContextIndex> {
    let path = index_path(root);
    if !path.exists() {
        return Ok(DocumentContextIndex::default());
    }
    read_json_file(&path)
}

fn write_index(root: &Path, index: &DocumentContextIndex) -> Result<()> {
    fs::create_dir_all(root)?;
    write_json_file(&index_path(root), index)
}

fn garbage_collect_orphan_files(paths: &PathsState, root: &Path) {
    let referenced_sha256s = match collect_referenced_sha256s(paths, root) {
        Ok(value) => value,
        Err(error) => {
            log::warn!("[docctx] 跳过文档缓存清理：{}", error);
            return;
        }
    };
    let files_dir = files_dir(root);
    let Ok(entries) = fs::read_dir(&files_dir) else {
        return;
    };

    for entry in entries.flatten() {
        let path = entry.path();
        if !path.is_dir() {
            continue;
        }
        let Some(name) = path.file_name().and_then(|value| value.to_str()) else {
            continue;
        };
        if !is_sha256_dir_name(name) || referenced_sha256s.contains(name) {
            continue;
        }
        if let Err(error) = fs::remove_dir_all(&path) {
            log::warn!(
                "[docctx] 清理无引用文档缓存失败 path={} error={}",
                path.display(),
                error
            );
        }
    }
}

fn collect_referenced_sha256s(paths: &PathsState, root: &Path) -> Result<HashSet<String>> {
    let mut referenced = {
        let _guard = lock_index()?;
        read_index(root)?
            .items
            .into_iter()
            .filter_map(|item| (!item.sha256.is_empty()).then_some(item.sha256))
            .collect::<HashSet<_>>()
    };
    referenced.extend(collect_chat_attachment_sha256s(paths)?);
    Ok(referenced)
}

fn collect_chat_attachment_sha256s(paths: &PathsState) -> Result<HashSet<String>> {
    let mut referenced = HashSet::new();
    let chats_dir = chats_dir(paths)?;
    let Ok(entries) = fs::read_dir(&chats_dir) else {
        return Ok(referenced);
    };

    for entry in entries {
        let path = entry?.path();
        if path.extension().and_then(|value| value.to_str()) != Some("json") {
            continue;
        }
        let conversation: ChatConversationAttachmentScan = read_json_file(&path)?;
        for message in conversation.messages {
            for attachment in message.attachments {
                if !attachment.sha256.is_empty() {
                    referenced.insert(attachment.sha256);
                }
            }
        }
    }

    Ok(referenced)
}

fn is_sha256_dir_name(value: &str) -> bool {
    value.len() == 64 && value.bytes().all(|byte| byte.is_ascii_hexdigit())
}

fn update_item(
    paths: &PathsState,
    item_id: &str,
    update: impl FnOnce(&mut DocumentContextItem),
) -> Result<DocumentContextItem> {
    let root = context_root_dir(paths)?;
    let _guard = lock_index()?;
    let mut index = read_index(&root)?;
    let item = index
        .items
        .iter_mut()
        .find(|item| item.id == item_id)
        .ok_or_else(|| anyhow!("未找到文档上下文：{}", item_id))?;
    update(item);
    let updated = item.clone();
    write_index(&root, &index)?;
    Ok(updated)
}

fn sha256_file(path: &Path) -> Result<String> {
    let mut file = File::open(path).with_context(|| format!("打开文件失败：{}", path.display()))?;
    let mut hasher = Sha256::new();
    let mut buffer = [0_u8; 64 * 1024];
    loop {
        let read = file
            .read(&mut buffer)
            .with_context(|| format!("读取文件失败：{}", path.display()))?;
        if read == 0 {
            break;
        }
        hasher.update(&buffer[..read]);
    }
    Ok(format!("{:x}", hasher.finalize()))
}

fn read_json_file<T: for<'de> Deserialize<'de>>(path: &Path) -> Result<T> {
    let content = fs::read_to_string(path)
        .with_context(|| format!("读取 JSON 文件失败：{}", path.display()))?;
    serde_json::from_str(&content)
        .with_context(|| format!("解析 JSON 文件失败：{}", path.display()))
}

fn write_json_file<T: Serialize>(path: &Path, value: &T) -> Result<()> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)
            .with_context(|| format!("创建目录失败：{}", parent.display()))?;
    }
    let json = serde_json::to_string_pretty(value)?;
    let temp_path = path.with_extension("tmp");
    {
        let mut file = File::create(&temp_path)
            .with_context(|| format!("创建临时文件失败：{}", temp_path.display()))?;
        file.write_all(json.as_bytes())
            .with_context(|| format!("写入临时文件失败：{}", temp_path.display()))?;
        file.flush()
            .with_context(|| format!("刷新临时文件失败：{}", temp_path.display()))?;
    }
    if path.exists() {
        fs::remove_file(path).with_context(|| format!("删除旧文件失败：{}", path.display()))?;
    }
    fs::rename(&temp_path, path)
        .with_context(|| format!("保存 JSON 文件失败：{}", path.display()))?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use std::fs::{self, File};

    use tempfile::TempDir;

    use crate::PathsState;
    use crate::document_context::model::DocumentChunk;
    use crate::document_context::{DocumentContextStatus, ParsedDocument};

    use super::{
        MAX_DOCUMENT_SOURCE_BYTES, build_context_markdown, context_root_dir, create_pending_items,
        list_items, mark_item_parsing, remove_item, remove_items_for_conversation,
        save_parse_success,
    };

    fn test_paths(temp_dir: &TempDir) -> PathsState {
        PathsState {
            db_path: temp_dir.path().join("flowcloudai.db"),
            plugins_path: temp_dir.path().join("plugins"),
        }
    }

    #[test]
    fn create_pending_items_archives_source_file() {
        let temp_dir = TempDir::new().unwrap();
        let paths = test_paths(&temp_dir);
        let source_path = temp_dir.path().join("source.txt");
        fs::write(&source_path, "alpha").unwrap();

        let items = create_pending_items(
            &paths,
            Some("conv_a".to_string()),
            vec![source_path.to_string_lossy().to_string()],
        )
        .unwrap();

        let item = items.into_iter().next().unwrap();
        assert_ne!(item.source_path, source_path.to_string_lossy());
        assert!(item.source_path.ends_with("source.txt"));
        fs::remove_file(&source_path).unwrap();
        assert_eq!(fs::read_to_string(&item.source_path).unwrap(), "alpha");
    }

    #[test]
    fn create_pending_items_rejects_oversized_source_file() {
        let temp_dir = TempDir::new().unwrap();
        let paths = test_paths(&temp_dir);
        let source_path = temp_dir.path().join("large.txt");
        File::create(&source_path)
            .unwrap()
            .set_len(MAX_DOCUMENT_SOURCE_BYTES + 1)
            .unwrap();

        let error = create_pending_items(
            &paths,
            Some("conv_a".to_string()),
            vec![source_path.to_string_lossy().to_string()],
        )
        .unwrap_err();

        assert!(error.to_string().contains("大小限制"));
    }

    #[test]
    fn concurrent_index_updates_keep_all_items() {
        let temp_dir = TempDir::new().unwrap();
        let paths = test_paths(&temp_dir);
        let first_path = temp_dir.path().join("first.txt");
        let second_path = temp_dir.path().join("second.txt");
        fs::write(&first_path, "first").unwrap();
        fs::write(&second_path, "second").unwrap();
        let items = create_pending_items(
            &paths,
            Some("conv_a".to_string()),
            vec![
                first_path.to_string_lossy().to_string(),
                second_path.to_string_lossy().to_string(),
            ],
        )
        .unwrap();

        let handles = items
            .iter()
            .map(|item| {
                let paths = paths.clone();
                let item_id = item.id.clone();
                std::thread::spawn(move || mark_item_parsing(&paths, &item_id).unwrap())
            })
            .collect::<Vec<_>>();

        for handle in handles {
            handle.join().unwrap();
        }

        let items = list_items(&paths, Some("conv_a")).unwrap();
        assert_eq!(items.len(), 2);
        assert!(
            items
                .iter()
                .all(|item| item.status == DocumentContextStatus::Parsing)
        );
    }

    #[test]
    fn remove_item_deletes_unreferenced_cache_dir() {
        let temp_dir = TempDir::new().unwrap();
        let paths = test_paths(&temp_dir);
        let source_path = temp_dir.path().join("source.txt");
        fs::write(&source_path, "alpha").unwrap();
        let item = create_pending_items(
            &paths,
            Some("conv_a".to_string()),
            vec![source_path.to_string_lossy().to_string()],
        )
        .unwrap()
        .into_iter()
        .next()
        .unwrap();
        let cache_dir = context_root_dir(&paths)
            .unwrap()
            .join("files")
            .join(&item.sha256);
        assert!(cache_dir.is_dir());

        remove_item(&paths, &item.id).unwrap();

        assert!(!cache_dir.exists());
    }

    #[test]
    fn remove_item_keeps_message_referenced_cache_dir() {
        let temp_dir = TempDir::new().unwrap();
        let paths = test_paths(&temp_dir);
        let source_path = temp_dir.path().join("source.txt");
        fs::write(&source_path, "alpha").unwrap();
        let item = create_pending_items(
            &paths,
            Some("conv_a".to_string()),
            vec![source_path.to_string_lossy().to_string()],
        )
        .unwrap()
        .into_iter()
        .next()
        .unwrap();
        let chats_dir = temp_dir.path().join("chats");
        fs::create_dir_all(&chats_dir).unwrap();
        fs::write(
            chats_dir.join("conv_a.json"),
            format!(
                r#"{{"messages":[{{"attachments":[{{"sha256":"{}"}}]}}]}}"#,
                item.sha256
            ),
        )
        .unwrap();
        let cache_dir = context_root_dir(&paths)
            .unwrap()
            .join("files")
            .join(&item.sha256);

        remove_item(&paths, &item.id).unwrap();

        assert!(cache_dir.is_dir());
    }

    #[test]
    fn remove_items_for_conversation_only_removes_matching_conversation() {
        let temp_dir = TempDir::new().unwrap();
        let paths = test_paths(&temp_dir);
        let first_path = temp_dir.path().join("first.txt");
        let second_path = temp_dir.path().join("second.txt");
        fs::write(&first_path, "first").unwrap();
        fs::write(&second_path, "second").unwrap();
        let first = create_pending_items(
            &paths,
            Some("conv_a".to_string()),
            vec![first_path.to_string_lossy().to_string()],
        )
        .unwrap()
        .into_iter()
        .next()
        .unwrap();
        let second = create_pending_items(
            &paths,
            Some("conv_b".to_string()),
            vec![second_path.to_string_lossy().to_string()],
        )
        .unwrap()
        .into_iter()
        .next()
        .unwrap();
        let root = context_root_dir(&paths).unwrap();
        let first_cache_dir = root.join("files").join(&first.sha256);
        let second_cache_dir = root.join("files").join(&second.sha256);

        let removed = remove_items_for_conversation(&paths, "conv_a").unwrap();

        assert_eq!(removed.len(), 1);
        assert!(list_items(&paths, Some("conv_a")).unwrap().is_empty());
        assert_eq!(list_items(&paths, Some("conv_b")).unwrap().len(), 1);
        assert!(!first_cache_dir.exists());
        assert!(second_cache_dir.is_dir());
    }

    #[test]
    fn build_context_ranks_chunks_by_query_terms() {
        let temp_dir = TempDir::new().unwrap();
        let paths = test_paths(&temp_dir);
        let source_path = temp_dir.path().join("source.txt");
        fs::write(&source_path, "alpha").unwrap();
        let item = create_pending_items(
            &paths,
            Some("conv_a".to_string()),
            vec![source_path.to_string_lossy().to_string()],
        )
        .unwrap()
        .into_iter()
        .next()
        .unwrap();
        let parsed = ParsedDocument {
            parser_id: "test".to_string(),
            format: "txt".to_string(),
            title: Some("source.txt".to_string()),
            markdown: "苹果种植说明\n火星基地设定".to_string(),
            plain_text: "苹果种植说明\n火星基地设定".to_string(),
            chunks: vec![
                DocumentChunk {
                    id: "chunk_1".to_string(),
                    heading: Some("苹果".to_string()),
                    source_ref: None,
                    markdown: "苹果种植说明，包含土壤和灌溉。".to_string(),
                    char_count: 16,
                },
                DocumentChunk {
                    id: "chunk_2".to_string(),
                    heading: Some("火星".to_string()),
                    source_ref: None,
                    markdown: "火星基地设定，包含穹顶和供氧。".to_string(),
                    char_count: 16,
                },
            ],
            warnings: Vec::new(),
        };
        save_parse_success(&paths, &item.id, &parsed).unwrap();

        let result = build_context_markdown(
            &paths,
            "conv_a",
            &[item.id],
            Some(10_000),
            Some("火星基地如何供氧"),
        )
        .unwrap();

        let mars_index = result.markdown.find("火星基地").unwrap();
        let apple_index = result.markdown.find("苹果种植").unwrap();
        assert!(mars_index < apple_index);
    }
}
