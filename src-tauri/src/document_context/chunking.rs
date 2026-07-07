use super::model::DocumentChunk;

const DEFAULT_CHUNK_CHARS: usize = 3_000;
const DEFAULT_CHUNK_OVERLAP_CHARS: usize = 300;

pub fn split_markdown_into_chunks(markdown: &str) -> Vec<DocumentChunk> {
    split_markdown_with_limit(markdown, DEFAULT_CHUNK_CHARS)
}

fn split_markdown_with_limit(markdown: &str, max_chars: usize) -> Vec<DocumentChunk> {
    let mut chunks = Vec::new();
    let mut current = String::new();
    let mut current_heading: Option<String> = None;
    let overlap_chars = DEFAULT_CHUNK_OVERLAP_CHARS.min(max_chars / 5);

    for line in markdown.lines() {
        let line_with_break = format!("{}\n", line);
        let line_heading = parse_heading(line);
        let should_flush_for_heading = line_heading.is_some() && !current.trim().is_empty();
        let should_flush_for_size = current.chars().count() + line_with_break.chars().count()
            > max_chars
            && !current.trim().is_empty();

        if should_flush_for_heading {
            push_chunk(&mut chunks, &mut current, current_heading.clone());
        } else if should_flush_for_size {
            push_chunk_with_overlap(
                &mut chunks,
                &mut current,
                current_heading.clone(),
                overlap_chars,
            );
        }

        if let Some(heading) = line_heading {
            current_heading = Some(heading);
        }
        current.push_str(&line_with_break);
    }

    if !current.trim().is_empty() {
        push_chunk(&mut chunks, &mut current, current_heading);
    }

    chunks
}

fn parse_heading(line: &str) -> Option<String> {
    let trimmed = line.trim_start();
    let level = trimmed.chars().take_while(|ch| *ch == '#').count();
    if level == 0 || level > 6 {
        return None;
    }
    let rest = trimmed[level..].trim();
    if rest.is_empty() {
        None
    } else {
        Some(rest.to_string())
    }
}

fn push_chunk(chunks: &mut Vec<DocumentChunk>, current: &mut String, heading: Option<String>) {
    let markdown = current.trim().to_string();
    if markdown.is_empty() {
        current.clear();
        return;
    }

    let index = chunks.len() + 1;
    let char_count = markdown.chars().count();
    chunks.push(DocumentChunk {
        id: format!("chunk_{}", index),
        heading,
        source_ref: Some(format!("片段 {}", index)),
        markdown,
        char_count,
    });
    current.clear();
}

fn push_chunk_with_overlap(
    chunks: &mut Vec<DocumentChunk>,
    current: &mut String,
    heading: Option<String>,
    overlap_chars: usize,
) {
    let overlap = trailing_chars(current, overlap_chars);
    push_chunk(chunks, current, heading);
    if !overlap.is_empty() {
        current.push_str(&overlap);
        if !current.ends_with('\n') {
            current.push('\n');
        }
    }
}

fn trailing_chars(value: &str, max_chars: usize) -> String {
    if max_chars == 0 {
        return String::new();
    }
    let trimmed = value.trim();
    let mut chars = trimmed.chars().rev().take(max_chars).collect::<Vec<_>>();
    chars.reverse();
    chars.into_iter().collect()
}

#[cfg(test)]
mod tests {
    use super::split_markdown_with_limit;

    #[test]
    fn split_by_heading_and_size() {
        let chunks = split_markdown_with_limit("# 标题\n正文\n## 二级\n内容", 100);
        assert_eq!(chunks.len(), 2);
        assert_eq!(chunks[0].heading.as_deref(), Some("标题"));
        assert_eq!(chunks[1].heading.as_deref(), Some("二级"));
    }

    #[test]
    fn adds_overlap_when_split_by_size() {
        let markdown = format!("# 标题\n{}\n{}\n", "甲".repeat(80), "乙".repeat(80));
        let chunks = split_markdown_with_limit(&markdown, 100);
        assert_eq!(chunks.len(), 2);
        assert!(chunks[1].markdown.contains("甲甲甲"));
        assert!(chunks[1].markdown.contains("乙乙乙"));
    }
}
