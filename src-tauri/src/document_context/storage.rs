use std::collections::HashSet;
use std::fs::{self, File};
use std::io::{Read, Write};
use std::path::{Path, PathBuf};

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
    let mut index = read_index(&root)?;
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
        let sha256 = sha256_file(&source_path)?;
        let now = Utc::now().to_rfc3339();
        let cached = read_cached_parse_output(&root, &sha256).ok();
        let item = DocumentContextItem {
            id: Uuid::new_v4().to_string(),
            conversation_id: conversation_id.clone(),
            file_name,
            source_path: raw_path,
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
        index.items.push(item.clone());
        created.push(item);
    }

    write_index(&root, &index)?;
    Ok(created)
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
    let mut items = read_index(&root)?.items;
    if let Some(conversation_id) = conversation_id {
        items.retain(|item| item.conversation_id.as_deref() == Some(conversation_id));
    }
    items.sort_by(|a, b| b.updated_at.cmp(&a.updated_at));
    Ok(items)
}

pub fn get_item(paths: &PathsState, item_id: &str) -> Result<DocumentContextItem> {
    let root = context_root_dir(paths)?;
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
    let item = read_index(&root)?
        .items
        .into_iter()
        .find(|item| item.id == item_id)
        .ok_or_else(|| anyhow!("未找到文档上下文：{}", item_id))?;
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
    let mut index = read_index(&root)?;
    let before = index.items.len();
    index.items.retain(|item| item.id != item_id);
    if index.items.len() == before {
        return Err(anyhow!("未找到文档上下文：{}", item_id));
    }
    write_index(&root, &index)
}

pub fn reassign_conversation(
    paths: &PathsState,
    from_conversation_id: &str,
    to_conversation_id: &str,
) -> Result<Vec<DocumentContextItem>> {
    let root = context_root_dir(paths)?;
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
) -> Result<DocumentContextBuildResult> {
    let root = context_root_dir(paths)?;
    let index = read_index(&root)?;
    let selected: HashSet<&str> = item_ids.iter().map(String::as_str).collect();
    let budget = max_chars.unwrap_or(DEFAULT_CONTEXT_CHAR_BUDGET);
    let mut remaining = budget;
    let mut markdown = String::new();
    let mut sources = Vec::new();
    let mut truncated = false;

    markdown.push_str("[用户附件上下文]\n以下内容来自用户添加的本地文件，仅作为回答参考。不要编造文件中没有的内容。\n\n");

    for item in index.items {
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

fn index_path(root: &Path) -> PathBuf {
    root.join(INDEX_FILE)
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

fn update_item(
    paths: &PathsState,
    item_id: &str,
    update: impl FnOnce(&mut DocumentContextItem),
) -> Result<DocumentContextItem> {
    let root = context_root_dir(paths)?;
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
