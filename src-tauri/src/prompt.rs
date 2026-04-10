use quick_xml::Writer;
use quick_xml::events::{BytesEnd, BytesStart, BytesText, Event};
use serde::{Deserialize, Serialize};
use std::io::Cursor;

// ============ 顶层结构 ============

/// XML 提示词完整结构
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct XmlPrompt {
    pub task: TaskBlock,
    pub subject: Option<EntryBlock>,
    pub entries: Vec<EntryBlock>,
    pub context: Vec<ContextEntryBlock>,
    pub inspiration: Option<InspirationBlock>,
    pub project: Option<ProjectBlock>,
    pub style_config: Option<StyleConfigBlock>,
    pub image_backend: Option<ImageBackendBlock>,
}

impl XmlPrompt {
    /// 序列化为 XML 字符串
    pub fn to_xml(&self) -> Result<String, String> {
        let mut writer = Writer::new_with_indent(Cursor::new(Vec::new()), b' ', 2);

        // <prompt>
        writer
            .write_event(Event::Start(BytesStart::new("prompt")))
            .map_err(|e| e.to_string())?;

        // <task>
        self.write_task(&mut writer)?;

        // <subject>
        if let Some(subject) = &self.subject {
            self.write_entry_block(&mut writer, subject, "subject")?;
        }

        // <entries>
        if !self.entries.is_empty() {
            writer
                .write_event(Event::Start(BytesStart::new("entries")))
                .map_err(|e| e.to_string())?;
            for entry in &self.entries {
                self.write_entry_block(&mut writer, entry, "entry")?;
            }
            writer
                .write_event(Event::End(BytesEnd::new("entries")))
                .map_err(|e| e.to_string())?;
        }

        // <context>
        if !self.context.is_empty() {
            writer
                .write_event(Event::Start(BytesStart::new("context")))
                .map_err(|e| e.to_string())?;
            for ctx in &self.context {
                self.write_context_entry(&mut writer, ctx)?;
            }
            writer
                .write_event(Event::End(BytesEnd::new("context")))
                .map_err(|e| e.to_string())?;
        }

        // <inspiration>
        if let Some(insp) = &self.inspiration {
            self.write_inspiration(&mut writer, insp)?;
        }

        // <project>
        if let Some(proj) = &self.project {
            self.write_project(&mut writer, proj)?;
        }

        // <style_config>
        if let Some(style) = &self.style_config {
            self.write_style_config(&mut writer, style)?;
        }

        // <image_backend>
        if let Some(backend) = &self.image_backend {
            self.write_image_backend(&mut writer, backend)?;
        }

        // </prompt>
        writer
            .write_event(Event::End(BytesEnd::new("prompt")))
            .map_err(|e| e.to_string())?;

        let result = writer.into_inner().into_inner();
        String::from_utf8(result).map_err(|e| e.to_string())
    }

    fn write_task<W: std::io::Write>(&self, writer: &mut Writer<W>) -> Result<(), String> {
        let mut task_start = BytesStart::new("task");
        task_start.push_attribute(("type", self.task.task_type.as_str()));
        writer
            .write_event(Event::Start(task_start))
            .map_err(|e| e.to_string())?;

        // <instruction>
        writer
            .write_event(Event::Start(BytesStart::new("instruction")))
            .map_err(|e| e.to_string())?;
        writer
            .write_event(Event::Text(BytesText::new(&self.task.instruction)))
            .map_err(|e| e.to_string())?;
        writer
            .write_event(Event::End(BytesEnd::new("instruction")))
            .map_err(|e| e.to_string())?;

        // <output_format>
        writer
            .write_event(Event::Start(BytesStart::new("output_format")))
            .map_err(|e| e.to_string())?;
        writer
            .write_event(Event::Text(BytesText::new(
                self.task.output_format.as_str(),
            )))
            .map_err(|e| e.to_string())?;
        writer
            .write_event(Event::End(BytesEnd::new("output_format")))
            .map_err(|e| e.to_string())?;

        // <language>
        if let Some(lang) = &self.task.language {
            writer
                .write_event(Event::Start(BytesStart::new("language")))
                .map_err(|e| e.to_string())?;
            writer
                .write_event(Event::Text(BytesText::new(lang)))
                .map_err(|e| e.to_string())?;
            writer
                .write_event(Event::End(BytesEnd::new("language")))
                .map_err(|e| e.to_string())?;
        }

        // <constraints>
        if !self.task.constraints.is_empty() {
            writer
                .write_event(Event::Start(BytesStart::new("constraints")))
                .map_err(|e| e.to_string())?;
            for (key, value) in &self.task.constraints {
                let mut item = BytesStart::new("item");
                item.push_attribute(("key", key.as_str()));
                item.push_attribute(("value", value.as_str()));
                writer
                    .write_event(Event::Empty(item))
                    .map_err(|e| e.to_string())?;
            }
            writer
                .write_event(Event::End(BytesEnd::new("constraints")))
                .map_err(|e| e.to_string())?;
        }

        writer
            .write_event(Event::End(BytesEnd::new("task")))
            .map_err(|e| e.to_string())?;
        Ok(())
    }

    fn write_entry_block<W: std::io::Write>(
        &self,
        writer: &mut Writer<W>,
        entry: &EntryBlock,
        tag_name: &str,
    ) -> Result<(), String> {
        let mut start = BytesStart::new(tag_name);
        if tag_name == "subject" || tag_name == "entry" {
            start.push_attribute(("level", entry.level.as_str()));
        }
        if tag_name == "entry" && !entry.id.is_empty() {
            start.push_attribute(("id", entry.id.as_str()));
        }
        writer
            .write_event(Event::Start(start))
            .map_err(|e| e.to_string())?;

        // <title>
        writer
            .write_event(Event::Start(BytesStart::new("title")))
            .map_err(|e| e.to_string())?;
        writer
            .write_event(Event::Text(BytesText::new(&entry.title)))
            .map_err(|e| e.to_string())?;
        writer
            .write_event(Event::End(BytesEnd::new("title")))
            .map_err(|e| e.to_string())?;

        // <type>
        if let Some(entry_type) = &entry.entry_type {
            writer
                .write_event(Event::Start(BytesStart::new("type")))
                .map_err(|e| e.to_string())?;
            writer
                .write_event(Event::Text(BytesText::new(entry_type)))
                .map_err(|e| e.to_string())?;
            writer
                .write_event(Event::End(BytesEnd::new("type")))
                .map_err(|e| e.to_string())?;
        }

        // <summary>
        if let Some(summary) = &entry.summary {
            writer
                .write_event(Event::Start(BytesStart::new("summary")))
                .map_err(|e| e.to_string())?;
            writer
                .write_event(Event::Text(BytesText::new(summary)))
                .map_err(|e| e.to_string())?;
            writer
                .write_event(Event::End(BytesEnd::new("summary")))
                .map_err(|e| e.to_string())?;
        }

        // <content>
        if let Some(content) = &entry.content {
            writer
                .write_event(Event::Start(BytesStart::new("content")))
                .map_err(|e| e.to_string())?;
            writer
                .write_event(Event::Text(BytesText::new(content)))
                .map_err(|e| e.to_string())?;
            writer
                .write_event(Event::End(BytesEnd::new("content")))
                .map_err(|e| e.to_string())?;
        }

        // <tags>
        if !entry.tags.is_empty() {
            writer
                .write_event(Event::Start(BytesStart::new("tags")))
                .map_err(|e| e.to_string())?;
            for tag in &entry.tags {
                let mut tag_elem = BytesStart::new("tag");
                tag_elem.push_attribute(("name", tag.name.as_str()));
                tag_elem.push_attribute(("value", tag.value.as_str()));
                writer
                    .write_event(Event::Empty(tag_elem))
                    .map_err(|e| e.to_string())?;
            }
            writer
                .write_event(Event::End(BytesEnd::new("tags")))
                .map_err(|e| e.to_string())?;
        }

        writer
            .write_event(Event::End(BytesEnd::new(tag_name)))
            .map_err(|e| e.to_string())?;
        Ok(())
    }

    fn write_context_entry<W: std::io::Write>(
        &self,
        writer: &mut Writer<W>,
        ctx: &ContextEntryBlock,
    ) -> Result<(), String> {
        let mut entry_start = BytesStart::new("entry");
        entry_start.push_attribute(("id", ctx.entry.id.as_str()));
        entry_start.push_attribute(("level", ctx.entry.level.as_str()));
        if let Some(relation) = &ctx.relation {
            entry_start.push_attribute(("relation", relation.as_str()));
        }
        writer
            .write_event(Event::Start(entry_start))
            .map_err(|e| e.to_string())?;

        // <title>
        writer
            .write_event(Event::Start(BytesStart::new("title")))
            .map_err(|e| e.to_string())?;
        writer
            .write_event(Event::Text(BytesText::new(&ctx.entry.title)))
            .map_err(|e| e.to_string())?;
        writer
            .write_event(Event::End(BytesEnd::new("title")))
            .map_err(|e| e.to_string())?;

        // <summary>
        if let Some(summary) = &ctx.entry.summary {
            writer
                .write_event(Event::Start(BytesStart::new("summary")))
                .map_err(|e| e.to_string())?;
            writer
                .write_event(Event::Text(BytesText::new(summary)))
                .map_err(|e| e.to_string())?;
            writer
                .write_event(Event::End(BytesEnd::new("summary")))
                .map_err(|e| e.to_string())?;
        }

        writer
            .write_event(Event::End(BytesEnd::new("entry")))
            .map_err(|e| e.to_string())?;
        Ok(())
    }

    fn write_inspiration<W: std::io::Write>(
        &self,
        writer: &mut Writer<W>,
        insp: &InspirationBlock,
    ) -> Result<(), String> {
        writer
            .write_event(Event::Start(BytesStart::new("inspiration")))
            .map_err(|e| e.to_string())?;

        // <note>
        writer
            .write_event(Event::Start(BytesStart::new("note")))
            .map_err(|e| e.to_string())?;
        writer
            .write_event(Event::Text(BytesText::new(&insp.note)))
            .map_err(|e| e.to_string())?;
        writer
            .write_event(Event::End(BytesEnd::new("note")))
            .map_err(|e| e.to_string())?;

        // <keywords>
        if !insp.keywords.is_empty() {
            writer
                .write_event(Event::Start(BytesStart::new("keywords")))
                .map_err(|e| e.to_string())?;
            for keyword in &insp.keywords {
                writer
                    .write_event(Event::Start(BytesStart::new("keyword")))
                    .map_err(|e| e.to_string())?;
                writer
                    .write_event(Event::Text(BytesText::new(keyword)))
                    .map_err(|e| e.to_string())?;
                writer
                    .write_event(Event::End(BytesEnd::new("keyword")))
                    .map_err(|e| e.to_string())?;
            }
            writer
                .write_event(Event::End(BytesEnd::new("keywords")))
                .map_err(|e| e.to_string())?;
        }

        // <category_hint>
        if let Some(hint) = &insp.category_hint {
            writer
                .write_event(Event::Start(BytesStart::new("category_hint")))
                .map_err(|e| e.to_string())?;
            writer
                .write_event(Event::Text(BytesText::new(hint)))
                .map_err(|e| e.to_string())?;
            writer
                .write_event(Event::End(BytesEnd::new("category_hint")))
                .map_err(|e| e.to_string())?;
        }

        writer
            .write_event(Event::End(BytesEnd::new("inspiration")))
            .map_err(|e| e.to_string())?;
        Ok(())
    }

    fn write_project<W: std::io::Write>(
        &self,
        writer: &mut Writer<W>,
        proj: &ProjectBlock,
    ) -> Result<(), String> {
        writer
            .write_event(Event::Start(BytesStart::new("project")))
            .map_err(|e| e.to_string())?;

        // <project_id>
        writer
            .write_event(Event::Start(BytesStart::new("project_id")))
            .map_err(|e| e.to_string())?;
        writer
            .write_event(Event::Text(BytesText::new(&proj.project_id)))
            .map_err(|e| e.to_string())?;
        writer
            .write_event(Event::End(BytesEnd::new("project_id")))
            .map_err(|e| e.to_string())?;

        // <project_name>
        if let Some(name) = &proj.project_name {
            writer
                .write_event(Event::Start(BytesStart::new("project_name")))
                .map_err(|e| e.to_string())?;
            writer
                .write_event(Event::Text(BytesText::new(name)))
                .map_err(|e| e.to_string())?;
            writer
                .write_event(Event::End(BytesEnd::new("project_name")))
                .map_err(|e| e.to_string())?;
        }

        // <genre>
        if let Some(genre) = &proj.genre {
            writer
                .write_event(Event::Start(BytesStart::new("genre")))
                .map_err(|e| e.to_string())?;
            writer
                .write_event(Event::Text(BytesText::new(genre)))
                .map_err(|e| e.to_string())?;
            writer
                .write_event(Event::End(BytesEnd::new("genre")))
                .map_err(|e| e.to_string())?;
        }

        // <entry_types>
        if !proj.entry_types.is_empty() {
            writer
                .write_event(Event::Start(BytesStart::new("entry_types")))
                .map_err(|e| e.to_string())?;
            for etype in &proj.entry_types {
                writer
                    .write_event(Event::Start(BytesStart::new("type")))
                    .map_err(|e| e.to_string())?;
                writer
                    .write_event(Event::Text(BytesText::new(etype)))
                    .map_err(|e| e.to_string())?;
                writer
                    .write_event(Event::End(BytesEnd::new("type")))
                    .map_err(|e| e.to_string())?;
            }
            writer
                .write_event(Event::End(BytesEnd::new("entry_types")))
                .map_err(|e| e.to_string())?;
        }

        // <extra>
        if !proj.extra.is_empty() {
            writer
                .write_event(Event::Start(BytesStart::new("extra")))
                .map_err(|e| e.to_string())?;
            for (key, value) in &proj.extra {
                let mut item = BytesStart::new("item");
                item.push_attribute(("key", key.as_str()));
                item.push_attribute(("value", value.as_str()));
                writer
                    .write_event(Event::Empty(item))
                    .map_err(|e| e.to_string())?;
            }
            writer
                .write_event(Event::End(BytesEnd::new("extra")))
                .map_err(|e| e.to_string())?;
        }

        writer
            .write_event(Event::End(BytesEnd::new("project")))
            .map_err(|e| e.to_string())?;
        Ok(())
    }

    fn write_style_config<W: std::io::Write>(
        &self,
        writer: &mut Writer<W>,
        style: &StyleConfigBlock,
    ) -> Result<(), String> {
        writer
            .write_event(Event::Start(BytesStart::new("style_config")))
            .map_err(|e| e.to_string())?;

        // <art_style>
        if let Some(art_style) = &style.art_style {
            writer
                .write_event(Event::Start(BytesStart::new("art_style")))
                .map_err(|e| e.to_string())?;
            writer
                .write_event(Event::Text(BytesText::new(art_style)))
                .map_err(|e| e.to_string())?;
            writer
                .write_event(Event::End(BytesEnd::new("art_style")))
                .map_err(|e| e.to_string())?;
        }

        // <character_tags>
        if !style.character_tags.is_empty() {
            writer
                .write_event(Event::Start(BytesStart::new("character_tags")))
                .map_err(|e| e.to_string())?;
            for tag in &style.character_tags {
                writer
                    .write_event(Event::Start(BytesStart::new("tag")))
                    .map_err(|e| e.to_string())?;
                writer
                    .write_event(Event::Text(BytesText::new(tag)))
                    .map_err(|e| e.to_string())?;
                writer
                    .write_event(Event::End(BytesEnd::new("tag")))
                    .map_err(|e| e.to_string())?;
            }
            writer
                .write_event(Event::End(BytesEnd::new("character_tags")))
                .map_err(|e| e.to_string())?;
        }

        // <style_tags>
        if !style.style_tags.is_empty() {
            writer
                .write_event(Event::Start(BytesStart::new("style_tags")))
                .map_err(|e| e.to_string())?;
            for tag in &style.style_tags {
                writer
                    .write_event(Event::Start(BytesStart::new("tag")))
                    .map_err(|e| e.to_string())?;
                writer
                    .write_event(Event::Text(BytesText::new(tag)))
                    .map_err(|e| e.to_string())?;
                writer
                    .write_event(Event::End(BytesEnd::new("tag")))
                    .map_err(|e| e.to_string())?;
            }
            writer
                .write_event(Event::End(BytesEnd::new("style_tags")))
                .map_err(|e| e.to_string())?;
        }

        // <quality_tags>
        if !style.quality_tags.is_empty() {
            writer
                .write_event(Event::Start(BytesStart::new("quality_tags")))
                .map_err(|e| e.to_string())?;
            for tag in &style.quality_tags {
                writer
                    .write_event(Event::Start(BytesStart::new("tag")))
                    .map_err(|e| e.to_string())?;
                writer
                    .write_event(Event::Text(BytesText::new(tag)))
                    .map_err(|e| e.to_string())?;
                writer
                    .write_event(Event::End(BytesEnd::new("tag")))
                    .map_err(|e| e.to_string())?;
            }
            writer
                .write_event(Event::End(BytesEnd::new("quality_tags")))
                .map_err(|e| e.to_string())?;
        }

        // <banned_elements>
        if !style.banned_elements.is_empty() {
            writer
                .write_event(Event::Start(BytesStart::new("banned_elements")))
                .map_err(|e| e.to_string())?;
            for elem in &style.banned_elements {
                writer
                    .write_event(Event::Start(BytesStart::new("element")))
                    .map_err(|e| e.to_string())?;
                writer
                    .write_event(Event::Text(BytesText::new(elem)))
                    .map_err(|e| e.to_string())?;
                writer
                    .write_event(Event::End(BytesEnd::new("element")))
                    .map_err(|e| e.to_string())?;
            }
            writer
                .write_event(Event::End(BytesEnd::new("banned_elements")))
                .map_err(|e| e.to_string())?;
        }

        writer
            .write_event(Event::End(BytesEnd::new("style_config")))
            .map_err(|e| e.to_string())?;
        Ok(())
    }

    fn write_image_backend<W: std::io::Write>(
        &self,
        writer: &mut Writer<W>,
        backend: &ImageBackendBlock,
    ) -> Result<(), String> {
        writer
            .write_event(Event::Start(BytesStart::new("image_backend")))
            .map_err(|e| e.to_string())?;

        // <supports_negative_prompt>
        writer
            .write_event(Event::Start(BytesStart::new("supports_negative_prompt")))
            .map_err(|e| e.to_string())?;
        writer
            .write_event(Event::Text(BytesText::new(
                if backend.supports_negative_prompt {
                    "true"
                } else {
                    "false"
                },
            )))
            .map_err(|e| e.to_string())?;
        writer
            .write_event(Event::End(BytesEnd::new("supports_negative_prompt")))
            .map_err(|e| e.to_string())?;

        // <supports_image_to_image>
        writer
            .write_event(Event::Start(BytesStart::new("supports_image_to_image")))
            .map_err(|e| e.to_string())?;
        writer
            .write_event(Event::Text(BytesText::new(
                if backend.supports_image_to_image {
                    "true"
                } else {
                    "false"
                },
            )))
            .map_err(|e| e.to_string())?;
        writer
            .write_event(Event::End(BytesEnd::new("supports_image_to_image")))
            .map_err(|e| e.to_string())?;

        // <max_prompt_length>
        if let Some(max_len) = backend.max_prompt_length {
            writer
                .write_event(Event::Start(BytesStart::new("max_prompt_length")))
                .map_err(|e| e.to_string())?;
            writer
                .write_event(Event::Text(BytesText::new(&max_len.to_string())))
                .map_err(|e| e.to_string())?;
            writer
                .write_event(Event::End(BytesEnd::new("max_prompt_length")))
                .map_err(|e| e.to_string())?;
        }

        // <style_format>
        writer
            .write_event(Event::Start(BytesStart::new("style_format")))
            .map_err(|e| e.to_string())?;
        writer
            .write_event(Event::Text(BytesText::new(backend.style_format.as_str())))
            .map_err(|e| e.to_string())?;
        writer
            .write_event(Event::End(BytesEnd::new("style_format")))
            .map_err(|e| e.to_string())?;

        // <supported_sizes>
        if !backend.supported_sizes.is_empty() {
            writer
                .write_event(Event::Start(BytesStart::new("supported_sizes")))
                .map_err(|e| e.to_string())?;
            for size in &backend.supported_sizes {
                writer
                    .write_event(Event::Start(BytesStart::new("size")))
                    .map_err(|e| e.to_string())?;
                writer
                    .write_event(Event::Text(BytesText::new(size)))
                    .map_err(|e| e.to_string())?;
                writer
                    .write_event(Event::End(BytesEnd::new("size")))
                    .map_err(|e| e.to_string())?;
            }
            writer
                .write_event(Event::End(BytesEnd::new("supported_sizes")))
                .map_err(|e| e.to_string())?;
        }

        writer
            .write_event(Event::End(BytesEnd::new("image_backend")))
            .map_err(|e| e.to_string())?;
        Ok(())
    }
}

// ============ 子结构定义 ============

/// 任务声明块
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TaskBlock {
    pub task_type: TaskType,
    pub instruction: String,
    pub language: Option<String>,
    pub output_format: OutputFormat,
    pub constraints: Vec<(String, String)>,
}

/// 任务类型枚举
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum TaskType {
    Enrich,              // 设定补全
    ConsistencyCheck,    // 一致性检测
    ExpandInspiration,   // 灵感便签扩展
    GenerateImagePrompt, // 图像提示词生成
}

impl TaskType {
    pub fn as_str(&self) -> &str {
        match self {
            TaskType::Enrich => "enrich",
            TaskType::ConsistencyCheck => "consistency_check",
            TaskType::ExpandInspiration => "expand_inspiration",
            TaskType::GenerateImagePrompt => "generate_image_prompt",
        }
    }
}

/// 输出格式枚举
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum OutputFormat {
    PlainText,
    Markdown,
    Json,
}

impl OutputFormat {
    pub fn as_str(&self) -> &str {
        match self {
            OutputFormat::PlainText => "plaintext",
            OutputFormat::Markdown => "markdown",
            OutputFormat::Json => "json",
        }
    }
}

/// 词条数据块
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EntryBlock {
    pub id: String,
    pub title: String,
    pub entry_type: Option<String>,
    pub summary: Option<String>,
    pub content: Option<String>,
    pub tags: Vec<TagItem>,
    pub level: InclusionLevel,
}

/// 包含级别枚举
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "PascalCase")]
pub enum InclusionLevel {
    Full,      // title + summary + content + tags
    Brief,     // title + summary + tags
    TitleOnly, // 只有 title
}

impl InclusionLevel {
    pub fn as_str(&self) -> &str {
        match self {
            InclusionLevel::Full => "full",
            InclusionLevel::Brief => "brief",
            InclusionLevel::TitleOnly => "title_only",
        }
    }
}

/// 标签项
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TagItem {
    pub name: String,
    pub value: String,
}

/// 上下文参考词条
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ContextEntryBlock {
    pub entry: EntryBlock,
    pub relation: Option<String>,
}

/// 灵感便签
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct InspirationBlock {
    pub note: String,
    pub keywords: Vec<String>,
    pub category_hint: Option<String>,
}

/// 项目背景
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProjectBlock {
    pub project_id: String,
    pub project_name: Option<String>,
    pub genre: Option<String>,
    pub entry_types: Vec<String>,
    pub extra: Vec<(String, String)>,
}

/// 图像风格配置
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StyleConfigBlock {
    pub art_style: Option<String>,
    pub character_tags: Vec<String>,
    pub style_tags: Vec<String>,
    pub quality_tags: Vec<String>,
    pub banned_elements: Vec<String>,
}

/// 图像插件能力描述
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ImageBackendBlock {
    pub supports_negative_prompt: bool,
    pub supports_image_to_image: bool,
    pub max_prompt_length: Option<u64>,
    pub style_format: StyleFormat,
    pub supported_sizes: Vec<String>,
}

/// 风格格式枚举
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "PascalCase")]
pub enum StyleFormat {
    DanbooruTags,
    NaturalLanguage,
    Mixed,
}

impl StyleFormat {
    pub fn as_str(&self) -> &str {
        match self {
            StyleFormat::DanbooruTags => "danbooru_tags",
            StyleFormat::NaturalLanguage => "natural_language",
            StyleFormat::Mixed => "mixed",
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_xml_serialization() {
        let prompt = XmlPrompt {
            task: TaskBlock {
                task_type: TaskType::Enrich,
                instruction: "测试指令".to_string(),
                language: Some("zh-CN".to_string()),
                output_format: OutputFormat::Markdown,
                constraints: vec![("tone".to_string(), "epic".to_string())],
            },
            subject: Some(EntryBlock {
                id: "e001".to_string(),
                title: "古剑·寒霜".to_string(),
                entry_type: Some("item".to_string()),
                summary: Some("封印了冰霜之神意志的上古宝剑".to_string()),
                content: None,
                tags: vec![
                    TagItem {
                        name: "品级".to_string(),
                        value: "神器".to_string(),
                    },
                    TagItem {
                        name: "属性".to_string(),
                        value: "冰".to_string(),
                    },
                ],
                level: InclusionLevel::Full,
            }),
            entries: vec![],
            context: vec![ContextEntryBlock {
                entry: EntryBlock {
                    id: "e002".to_string(),
                    title: "冰霜之神·莫尔".to_string(),
                    entry_type: None,
                    summary: Some("上古神明，被封印于器物之中".to_string()),
                    content: None,
                    tags: vec![],
                    level: InclusionLevel::Brief,
                },
                relation: Some("referenced".to_string()),
            }],
            inspiration: None,
            project: Some(ProjectBlock {
                project_id: "proj_001".to_string(),
                project_name: Some("奇幻世界".to_string()),
                genre: Some("dark_fantasy".to_string()),
                entry_types: vec!["character".to_string(), "item".to_string()],
                extra: vec![],
            }),
            style_config: None,
            image_backend: None,
        };

        let xml = prompt.to_xml().unwrap();
        println!("{}", xml);

        // 验证关键标签存在
        assert!(xml.contains("<prompt>"));
        assert!(xml.contains("task type=\"enrich\""));
        assert!(xml.contains("<title>古剑·寒霜</title>"));
        assert!(xml.contains("level=\"full\""));
        assert!(xml.contains("level=\"brief\""));
        assert!(xml.contains("relation=\"referenced\""));
    }
}
