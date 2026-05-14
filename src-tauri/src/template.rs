use anyhow::{Context, Result};
use serde::Serialize;
use std::collections::{BTreeMap, BTreeSet};
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::{Arc, OnceLock, RwLock};
use tera::{Context as TeraContext, Tera};

static TEMPLATE_RUNTIME: OnceLock<Arc<RwLock<TemplateRuntime>>> = OnceLock::new();

#[derive(Debug, Clone, Copy, Serialize)]
pub struct TemplateParamMeta {
    pub name: &'static str,
    pub description: &'static str,
}

#[derive(Debug, Clone, Copy, Serialize)]
pub struct TemplateMeta {
    pub id: &'static str,
    pub group: &'static str,
    pub title: &'static str,
    pub relative_path: &'static str,
    pub purpose: &'static str,
    pub appear_in: &'static str,
    pub params: &'static [TemplateParamMeta],
}

#[derive(Debug, Clone, Serialize)]
pub struct TemplateDocument {
    pub meta: TemplateMeta,
    pub content: String,
    pub is_override: bool,
}

#[derive(Debug, Clone, Serialize)]
pub struct TemplateValidationError {
    pub message: String,
    pub line: Option<usize>,
    pub column: Option<usize>,
    pub raw_message: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(tag = "status", rename_all = "snake_case")]
pub enum TemplateSaveResult {
    Success { document: TemplateDocument },
    ValidationError { error: TemplateValidationError },
    RuntimeError { message: String },
}

#[derive(Debug)]
pub struct TemplateRuntime {
    builtin_dir: PathBuf,
    builtin_sources: BTreeMap<String, TemplateFile>,
    override_dir: PathBuf,
    engine: TemplateEngine,
}

#[derive(Debug)]
pub struct TemplateEngine {
    tera: Tera,
}

#[derive(Debug, Clone)]
struct TemplateFile {
    content: String,
}

#[derive(Debug)]
enum TemplateSaveFailure {
    Validation(TemplateValidationError),
    Runtime(anyhow::Error),
}

const EMBEDDED_TEMPLATE_SOURCES: &[(&str, &str)] = &[
    (
        "sense/app_system",
        include_str!("../resources/templates/sense/app_system.tera"),
    ),
    (
        "sense/character_system",
        include_str!("../resources/templates/sense/character_system.tera"),
    ),
    (
        "sense/contradiction_system",
        include_str!("../resources/templates/sense/contradiction_system.tera"),
    ),
    (
        "contradiction/detection_prompt",
        include_str!("../resources/templates/contradiction/detection_prompt.tera"),
    ),
    (
        "contradiction/summary_prompt",
        include_str!("../resources/templates/contradiction/summary_prompt.tera"),
    ),
    (
        "context/entry_snapshot",
        include_str!("../resources/templates/context/entry_snapshot.tera"),
    ),
    (
        "formats/categories",
        include_str!("../resources/templates/formats/categories.tera"),
    ),
    (
        "formats/categories_subtree",
        include_str!("../resources/templates/formats/categories_subtree.tera"),
    ),
    (
        "formats/entry_briefs",
        include_str!("../resources/templates/formats/entry_briefs.tera"),
    ),
    (
        "formats/entry_full",
        include_str!("../resources/templates/formats/entry_full.tera"),
    ),
    (
        "formats/entry_types",
        include_str!("../resources/templates/formats/entry_types.tera"),
    ),
    (
        "formats/projects",
        include_str!("../resources/templates/formats/projects.tera"),
    ),
    (
        "formats/project_summary",
        include_str!("../resources/templates/formats/project_summary.tera"),
    ),
    (
        "formats/relations",
        include_str!("../resources/templates/formats/relations.tera"),
    ),
    (
        "formats/tag_schemas",
        include_str!("../resources/templates/formats/tag_schemas.tera"),
    ),
];

const NO_PARAMS: &[TemplateParamMeta] = &[];

const CHARACTER_SYSTEM_PARAMS: &[TemplateParamMeta] = &[
    TemplateParamMeta {
        name: "character_name",
        description: "当前进入角色扮演模式的角色名称。",
    },
    TemplateParamMeta {
        name: "project_name",
        description: "当前项目名称。",
    },
    TemplateParamMeta {
        name: "project_description",
        description: "项目描述，缺省时会回填为“无”。",
    },
    TemplateParamMeta {
        name: "target_title",
        description: "目标角色词条标题。",
    },
    TemplateParamMeta {
        name: "target_entry_type",
        description: "目标角色词条类型，缺省时会回填为“未设置”。",
    },
    TemplateParamMeta {
        name: "target_category_path",
        description: "目标角色所在分类路径。",
    },
    TemplateParamMeta {
        name: "target_summary",
        description: "目标角色摘要，缺省时会回填为“无”。",
    },
    TemplateParamMeta {
        name: "target_content",
        description: "目标角色正文，缺省时会回填为“无”。",
    },
    TemplateParamMeta {
        name: "target_tags",
        description: "目标角色标签文本，多个标签以中文分号连接。",
    },
    TemplateParamMeta {
        name: "related_relations",
        description: "与目标角色直接相关的关系描述列表。",
    },
    TemplateParamMeta {
        name: "category_lines",
        description: "项目内分类路径列表。",
    },
    TemplateParamMeta {
        name: "schema_lines",
        description: "项目标签定义列表。",
    },
    TemplateParamMeta {
        name: "world_entry_lines",
        description: "项目中可供角色参考的世界设定词条摘要列表。",
    },
];

const DETECTION_PROMPT_PARAMS: &[TemplateParamMeta] = &[
    TemplateParamMeta {
        name: "project_name",
        description: "当前被检测项目的名称。",
    },
    TemplateParamMeta {
        name: "scope_summary",
        description: "本轮矛盾检测的范围说明。",
    },
    TemplateParamMeta {
        name: "truncated",
        description: "资料是否经过裁剪；为 true 时应提醒证据可能不足。",
    },
    TemplateParamMeta {
        name: "entry_blocks",
        description: "参与检测的词条资料块列表。",
    },
];

const SUMMARY_PROMPT_PARAMS: &[TemplateParamMeta] = &[
    TemplateParamMeta {
        name: "project_name",
        description: "当前项目名称。",
    },
    TemplateParamMeta {
        name: "focus",
        description: "可选的总结重点。",
    },
    TemplateParamMeta {
        name: "entry_blocks",
        description: "用于生成总结的词条资料块列表。",
    },
    TemplateParamMeta {
        name: "is_entry_field_mode",
        description: "是否为词条摘要字段生成模式；为 true 时应输出 JSON 摘要对象。",
    },
];

const ENTRY_SNAPSHOT_PARAMS: &[TemplateParamMeta] = &[
    TemplateParamMeta {
        name: "entry_id",
        description: "词条 ID。",
    },
    TemplateParamMeta {
        name: "title",
        description: "词条标题。",
    },
    TemplateParamMeta {
        name: "entry_type",
        description: "可选的词条类型。",
    },
    TemplateParamMeta {
        name: "summary",
        description: "可选的词条摘要。",
    },
    TemplateParamMeta {
        name: "tag_text",
        description: "将结构化标签拼接后的展示文本。",
    },
    TemplateParamMeta {
        name: "content",
        description: "正文内容；过长时会在进入模板前先裁剪。",
    },
];

const LIST_ITEMS_PARAMS: &[TemplateParamMeta] = &[TemplateParamMeta {
    name: "items",
    description: "已预格式化好的文本条目列表。",
}];

const LINES_PARAMS: &[TemplateParamMeta] = &[TemplateParamMeta {
    name: "lines",
    description: "按行组织的文本列表，可直接循环输出。",
}];

const PROJECT_SUMMARY_PARAMS: &[TemplateParamMeta] = &[
    TemplateParamMeta {
        name: "name",
        description: "项目名称。",
    },
    TemplateParamMeta {
        name: "description",
        description: "可选的项目描述。",
    },
    TemplateParamMeta {
        name: "count_lines",
        description: "各类词条统计行列表。",
    },
    TemplateParamMeta {
        name: "created_at",
        description: "项目创建时间字符串。",
    },
    TemplateParamMeta {
        name: "updated_at",
        description: "项目最后更新时间字符串。",
    },
];

const RELATIONS_PARAMS: &[TemplateParamMeta] = &[
    TemplateParamMeta {
        name: "current_name",
        description: "当前关系查询所围绕的词条名称。",
    },
    TemplateParamMeta {
        name: "items",
        description: "已预格式化好的关系条目列表。",
    },
];

const CATEGORIES_SUBTREE_PARAMS: &[TemplateParamMeta] = &[
    TemplateParamMeta {
        name: "header",
        description: "分类子树区域的标题文本。",
    },
    TemplateParamMeta {
        name: "lines",
        description: "分类子树逐行文本列表。",
    },
];

const TEMPLATE_REGISTRY: &[TemplateMeta] = &[
    TemplateMeta {
        id: "sense/app_system",
        group: "sense",
        title: "应用系统模板",
        relative_path: "sense/app_system.tera",
        purpose: "定义通用 AI 助手的系统提示词。",
        appear_in: "用于普通 AI 会话的系统消息，在创建通用助手会话时装载。",
        params: NO_PARAMS,
    },
    TemplateMeta {
        id: "sense/character_system",
        group: "sense",
        title: "角色系统模板",
        relative_path: "sense/character_system.tera",
        purpose: "定义角色扮演模式下的系统提示词。",
        appear_in: "用于角色会话，在角色专属 AI 助手创建系统消息时装载。",
        params: CHARACTER_SYSTEM_PARAMS,
    },
    TemplateMeta {
        id: "sense/contradiction_system",
        group: "sense",
        title: "矛盾检测系统模板",
        relative_path: "sense/contradiction_system.tera",
        purpose: "定义矛盾检测助手的系统提示词。",
        appear_in: "用于矛盾检测 AI 会话，在创建检测会话时装载。",
        params: NO_PARAMS,
    },
    TemplateMeta {
        id: "contradiction/detection_prompt",
        group: "contradiction",
        title: "矛盾检测提示词",
        relative_path: "contradiction/detection_prompt.tera",
        purpose: "生成矛盾扫描阶段的主提示词。",
        appear_in: "用于矛盾检测流程，在正式调用模型分析项目资料前生成检测提示词。",
        params: DETECTION_PROMPT_PARAMS,
    },
    TemplateMeta {
        id: "contradiction/summary_prompt",
        group: "contradiction",
        title: "矛盾总结提示词",
        relative_path: "contradiction/summary_prompt.tera",
        purpose: "生成总结或摘要阶段的提示词。",
        appear_in: "用于摘要生成和矛盾总结流程，在请求模型生成汇总结果前生成提示词。",
        params: SUMMARY_PROMPT_PARAMS,
    },
    TemplateMeta {
        id: "context/entry_snapshot",
        group: "context",
        title: "词条快照模板",
        relative_path: "context/entry_snapshot.tera",
        purpose: "把单个词条压缩为稳定的上下文片段。",
        appear_in: "用于构建 AI 上下文，在词条被拼装进摘要、检测或其它提示词前生成文本快照。",
        params: ENTRY_SNAPSHOT_PARAMS,
    },
    TemplateMeta {
        id: "formats/categories",
        group: "formats",
        title: "分类列表模板",
        relative_path: "formats/categories.tera",
        purpose: "格式化分类列表查询结果。",
        appear_in: "用于 Worldflow 工具返回值，在列出项目分类时生成最终文本。",
        params: LINES_PARAMS,
    },
    TemplateMeta {
        id: "formats/categories_subtree",
        group: "formats",
        title: "分类子树模板",
        relative_path: "formats/categories_subtree.tera",
        purpose: "格式化分类树或子树查询结果。",
        appear_in: "用于 Worldflow 工具返回值，在查询某分类下的子树结构时生成最终文本。",
        params: CATEGORIES_SUBTREE_PARAMS,
    },
    TemplateMeta {
        id: "formats/entry_briefs",
        group: "formats",
        title: "词条摘要列表模板",
        relative_path: "formats/entry_briefs.tera",
        purpose: "格式化词条摘要列表结果。",
        appear_in: "用于 Worldflow 工具返回值，在搜索词条等批量结果场景中生成最终文本。",
        params: LIST_ITEMS_PARAMS,
    },
    TemplateMeta {
        id: "formats/entry_full",
        group: "formats",
        title: "词条详情模板",
        relative_path: "formats/entry_full.tera",
        purpose: "格式化单个词条详情。",
        appear_in: "用于 Worldflow 工具返回值，在获取完整词条内容时生成最终文本。",
        params: &[
            TemplateParamMeta {
                name: "title",
                description: "词条标题。",
            },
            TemplateParamMeta {
                name: "summary",
                description: "可选的词条摘要。",
            },
            TemplateParamMeta {
                name: "entry_type",
                description: "可选的词条类型。",
            },
            TemplateParamMeta {
                name: "content",
                description: "可选的词条正文。",
            },
            TemplateParamMeta {
                name: "tags",
                description: "已格式化好的标签文本列表。",
            },
        ],
    },
    TemplateMeta {
        id: "formats/entry_types",
        group: "formats",
        title: "词条类型模板",
        relative_path: "formats/entry_types.tera",
        purpose: "格式化词条类型列表。",
        appear_in: "用于 Worldflow 工具返回值，在列出可用词条类型时生成最终文本。",
        params: LINES_PARAMS,
    },
    TemplateMeta {
        id: "formats/projects",
        group: "formats",
        title: "项目列表模板",
        relative_path: "formats/projects.tera",
        purpose: "格式化项目列表查询结果。",
        appear_in: "用于 Worldflow 工具返回值，在列出全部项目时生成最终文本。",
        params: LIST_ITEMS_PARAMS,
    },
    TemplateMeta {
        id: "formats/project_summary",
        group: "formats",
        title: "项目摘要模板",
        relative_path: "formats/project_summary.tera",
        purpose: "格式化单个项目摘要与统计信息。",
        appear_in: "用于 Worldflow 工具返回值，在获取项目概览时生成最终文本。",
        params: PROJECT_SUMMARY_PARAMS,
    },
    TemplateMeta {
        id: "formats/relations",
        group: "formats",
        title: "关系模板",
        relative_path: "formats/relations.tera",
        purpose: "格式化词条关系查询结果。",
        appear_in: "用于 Worldflow 工具返回值，在查询词条关系网络时生成最终文本。",
        params: RELATIONS_PARAMS,
    },
    TemplateMeta {
        id: "formats/tag_schemas",
        group: "formats",
        title: "标签架构模板",
        relative_path: "formats/tag_schemas.tera",
        purpose: "格式化标签定义列表。",
        appear_in: "用于 Worldflow 工具返回值，在列出项目标签定义时生成最终文本。",
        params: LIST_ITEMS_PARAMS,
    },
];

impl TemplateEngine {
    fn from_sources(sources: &BTreeMap<String, TemplateFile>) -> Result<Self> {
        let mut tera = Tera::default();
        tera.autoescape_on(Vec::new());

        for (name, file) in sources {
            tera.add_raw_template(name, &file.content)?;
        }

        Ok(Self { tera })
    }

    pub fn render(&self, name: &str, ctx: &impl Serialize) -> Result<String> {
        let tera_ctx = TeraContext::from_serialize(ctx)?;
        self.render_with_tera_ctx(name, &tera_ctx)
    }

    pub fn render_with_tera_ctx(&self, name: &str, ctx: &TeraContext) -> Result<String> {
        Ok(self.tera.render(name, ctx)?)
    }
}

impl TemplateRuntime {
    fn new(builtin_dir: PathBuf, override_dir: PathBuf) -> Result<Self> {
        let builtin_sources = load_builtin_template_sources(&builtin_dir)?;
        let sources = match load_merged_template_sources(&builtin_sources, &override_dir) {
            Ok(sources) => sources,
            Err(error) => {
                log::warn!("模板覆盖目录读取失败，将仅使用内置模板初始化：{}", error);
                builtin_sources.clone()
            }
        };
        let engine = match TemplateEngine::from_sources(&sources) {
            Ok(engine) => engine,
            Err(error) => {
                log::warn!("模板覆盖内容校验失败，将仅使用内置模板初始化：{}", error);
                TemplateEngine::from_sources(&builtin_sources)?
            }
        };
        Ok(Self {
            builtin_dir,
            builtin_sources,
            override_dir,
            engine,
        })
    }
}

pub fn install_global_template_runtime(builtin_dir: PathBuf, override_dir: PathBuf) -> Result<()> {
    let runtime = TemplateRuntime::new(builtin_dir, override_dir)?;
    TEMPLATE_RUNTIME
        .set(Arc::new(RwLock::new(runtime)))
        .map_err(|_| anyhow::anyhow!("模板运行时已初始化"))?;
    Ok(())
}

pub fn list_template_meta() -> Result<Vec<TemplateMeta>> {
    let runtime = global_template_runtime()?;
    let runtime = runtime
        .read()
        .map_err(|_| anyhow::anyhow!("模板运行时读取失败"))?;
    fs::create_dir_all(&runtime.override_dir)
        .with_context(|| format!("创建模板目录失败：{}", runtime.override_dir.display()))?;
    Ok(TEMPLATE_REGISTRY.to_vec())
}

pub fn get_template_document(id: &str) -> Result<TemplateDocument> {
    let meta = find_template_meta(id).ok_or_else(|| anyhow::anyhow!("模板不存在：{}", id))?;
    let runtime = global_template_runtime()?;
    let runtime = runtime
        .read()
        .map_err(|_| anyhow::anyhow!("模板运行时读取失败"))?;
    build_template_document(&runtime, meta)
}

pub fn get_default_template_content(id: &str) -> Result<String> {
    let runtime = global_template_runtime()?;
    let runtime = runtime
        .read()
        .map_err(|_| anyhow::anyhow!("模板运行时读取失败"))?;
    Ok(builtin_template_content(&runtime, id)?.to_string())
}

pub fn get_template_local_root_dir() -> Result<String> {
    let runtime = global_template_runtime()?;
    let runtime = runtime
        .read()
        .map_err(|_| anyhow::anyhow!("模板运行时读取失败"))?;

    if runtime
        .builtin_dir
        .join("sense")
        .join("app_system.tera")
        .is_file()
    {
        return Ok(runtime.builtin_dir.to_string_lossy().into_owned());
    }

    Err(anyhow::anyhow!(
        "当前模板源目录不存在，实际路径：{}",
        runtime.builtin_dir.display()
    ))
}

pub fn get_template_effective_path(id: &str) -> Result<String> {
    let meta = find_template_meta(id).ok_or_else(|| anyhow::anyhow!("模板不存在：{}", id))?;
    let runtime = global_template_runtime()?;
    let runtime = runtime
        .read()
        .map_err(|_| anyhow::anyhow!("模板运行时读取失败"))?;

    let override_path = path_for_template_id(&runtime.override_dir, meta.id);
    if override_path.exists() {
        return Ok(override_path.to_string_lossy().into_owned());
    }

    let builtin_path = path_for_template_id(&runtime.builtin_dir, meta.id);
    if builtin_path.exists() {
        return Ok(builtin_path.to_string_lossy().into_owned());
    }

    if runtime.builtin_sources.contains_key(meta.id) {
        return Err(anyhow::anyhow!(
            "内置模板随应用内嵌，当前平台没有可直接打开的本地文件：{}",
            meta.id
        ));
    }

    Err(anyhow::anyhow!("模板文件不存在：{}", meta.id))
}

pub fn save_template_content(id: &str, content: String) -> TemplateSaveResult {
    match save_template_content_impl(id, content) {
        Ok(document) => TemplateSaveResult::Success { document },
        Err(TemplateSaveFailure::Validation(error)) => {
            TemplateSaveResult::ValidationError { error }
        }
        Err(TemplateSaveFailure::Runtime(error)) => TemplateSaveResult::RuntimeError {
            message: error.to_string(),
        },
    }
}

pub fn render_global_template(name: &str, ctx: &impl Serialize) -> Option<String> {
    let runtime = global_template_runtime().ok()?;
    let runtime = runtime.read().ok()?;

    match runtime.engine.render(name, ctx) {
        Ok(rendered) => Some(rendered),
        Err(error) => {
            log::warn!("模板渲染失败 {}: {}", name, error);
            None
        }
    }
}

fn save_template_content_impl(
    id: &str,
    content: String,
) -> std::result::Result<TemplateDocument, TemplateSaveFailure> {
    let meta = find_template_meta(id)
        .ok_or_else(|| TemplateSaveFailure::Runtime(anyhow::anyhow!("模板不存在：{}", id)))?;
    let runtime = global_template_runtime().map_err(TemplateSaveFailure::Runtime)?;
    let mut runtime = runtime
        .write()
        .map_err(|_| TemplateSaveFailure::Runtime(anyhow::anyhow!("模板运行时写入失败")))?;

    save_template_with_runtime(&mut runtime, meta, content)
}

fn save_template_with_runtime(
    runtime: &mut TemplateRuntime,
    meta: TemplateMeta,
    content: String,
) -> std::result::Result<TemplateDocument, TemplateSaveFailure> {
    validate_template_params(meta, &content).map_err(TemplateSaveFailure::Validation)?;

    let mut sources = load_merged_template_sources(&runtime.builtin_sources, &runtime.override_dir)
        .map_err(TemplateSaveFailure::Runtime)?;
    sources.insert(
        meta.id.to_string(),
        TemplateFile {
            content: content.clone(),
        },
    );

    let next_engine = TemplateEngine::from_sources(&sources)
        .map_err(|error| TemplateSaveFailure::Validation(to_validation_error(error)))?;

    let override_path = path_for_template_id(&runtime.override_dir, meta.id);
    let default_content =
        builtin_template_content(runtime, meta.id).map_err(TemplateSaveFailure::Runtime)?;
    let is_override = content != default_content;

    if is_override {
        if let Some(parent) = override_path.parent() {
            fs::create_dir_all(parent)
                .with_context(|| format!("创建模板目录失败：{}", parent.display()))
                .map_err(TemplateSaveFailure::Runtime)?;
        }
        fs::write(&override_path, content.as_bytes())
            .with_context(|| format!("写入模板失败：{}", override_path.display()))
            .map_err(TemplateSaveFailure::Runtime)?;
    } else if override_path.exists() {
        fs::remove_file(&override_path)
            .with_context(|| format!("删除覆盖模板失败：{}", override_path.display()))
            .map_err(TemplateSaveFailure::Runtime)?;
    }

    runtime.engine = next_engine;

    Ok(TemplateDocument {
        meta,
        content,
        is_override,
    })
}

fn build_template_document(
    runtime: &TemplateRuntime,
    meta: TemplateMeta,
) -> Result<TemplateDocument> {
    let override_path = path_for_template_id(&runtime.override_dir, meta.id);
    if override_path.exists() {
        return Ok(TemplateDocument {
            meta,
            content: read_required_text(&override_path)?,
            is_override: true,
        });
    }

    Ok(TemplateDocument {
        meta,
        content: builtin_template_content(runtime, meta.id)?.to_string(),
        is_override: false,
    })
}

fn global_template_runtime() -> Result<Arc<RwLock<TemplateRuntime>>> {
    TEMPLATE_RUNTIME
        .get()
        .cloned()
        .ok_or_else(|| anyhow::anyhow!("模板运行时尚未初始化"))
}

fn find_template_meta(id: &str) -> Option<TemplateMeta> {
    TEMPLATE_REGISTRY.iter().copied().find(|meta| meta.id == id)
}

fn load_builtin_template_sources(builtin_dir: &Path) -> Result<BTreeMap<String, TemplateFile>> {
    let mut output = load_embedded_template_sources()?;
    if builtin_dir.exists() {
        let disk_sources = load_template_sources_from_dir(builtin_dir)?;
        output.extend(disk_sources);
    }
    Ok(output)
}

fn load_embedded_template_sources() -> Result<BTreeMap<String, TemplateFile>> {
    let mut output = BTreeMap::new();
    for (id, content) in EMBEDDED_TEMPLATE_SOURCES {
        output.insert(
            (*id).to_string(),
            TemplateFile {
                content: (*content).to_string(),
            },
        );
    }

    for meta in TEMPLATE_REGISTRY {
        if !output.contains_key(meta.id) {
            return Err(anyhow::anyhow!("内嵌模板缺失：{}", meta.id));
        }
    }

    Ok(output)
}

fn load_template_sources_from_dir(root_dir: &Path) -> Result<BTreeMap<String, TemplateFile>> {
    let mut output = BTreeMap::new();
    collect_template_files(root_dir, root_dir, &mut output)?;
    Ok(output)
}

fn load_merged_template_sources(
    builtin_sources: &BTreeMap<String, TemplateFile>,
    override_dir: &Path,
) -> Result<BTreeMap<String, TemplateFile>> {
    let mut output = builtin_sources.clone();
    if override_dir.exists() {
        collect_template_files(override_dir, override_dir, &mut output)?;
    }
    Ok(output)
}

fn collect_template_files(
    root_dir: &Path,
    dir: &Path,
    output: &mut BTreeMap<String, TemplateFile>,
) -> Result<()> {
    for entry in
        fs::read_dir(dir).with_context(|| format!("读取模板目录失败：{}", dir.display()))?
    {
        let entry = entry?;
        let path = entry.path();
        if path.is_dir() {
            collect_template_files(root_dir, &path, output)?;
            continue;
        }
        if path.extension().and_then(|ext| ext.to_str()) != Some("tera") {
            continue;
        }

        let relative = path
            .strip_prefix(root_dir)
            .map_err(|e| anyhow::anyhow!("模板路径解析失败: {}", e))?;
        let relative = normalize_relative_path(relative);
        let id = relative
            .strip_suffix(".tera")
            .unwrap_or(relative.as_str())
            .to_string();

        output.insert(
            id,
            TemplateFile {
                content: read_required_text(&path)?,
            },
        );
    }
    Ok(())
}

fn builtin_template_content<'a>(runtime: &'a TemplateRuntime, id: &str) -> Result<&'a str> {
    runtime
        .builtin_sources
        .get(id)
        .map(|file| file.content.as_str())
        .ok_or_else(|| anyhow::anyhow!("内置模板不存在：{}", id))
}

fn path_for_template_id(root: &Path, id: &str) -> PathBuf {
    let mut path = root.to_path_buf();
    for segment in id.split('/') {
        path.push(segment);
    }
    path.set_extension("tera");
    path
}

fn normalize_relative_path(path: &Path) -> String {
    path.to_string_lossy().replace('\\', "/")
}

fn validate_template_params(
    meta: TemplateMeta,
    content: &str,
) -> std::result::Result<(), TemplateValidationError> {
    if meta.params.is_empty() {
        return Ok(());
    }

    let referenced = collect_template_identifiers(content);
    let missing = meta
        .params
        .iter()
        .filter(|param| !referenced.contains(param.name))
        .map(|param| param.name)
        .collect::<Vec<_>>();

    if missing.is_empty() {
        return Ok(());
    }

    Err(TemplateValidationError {
        message: "参数检查失败".to_string(),
        line: None,
        column: None,
        raw_message: format!(
            "以下参数尚未在内容中使用：{}。请先补全这些参数引用后再保存。",
            missing.join("、")
        ),
    })
}

fn collect_template_identifiers(content: &str) -> BTreeSet<String> {
    let mut identifiers = BTreeSet::new();
    let bytes = content.as_bytes();
    let mut index = 0usize;

    while index + 1 < bytes.len() {
        if bytes[index] == b'{' && (bytes[index + 1] == b'{' || bytes[index + 1] == b'%') {
            let close = if bytes[index + 1] == b'{' { "}}" } else { "%}" };
            let start = index + 2;
            if let Some(end_offset) = content[start..].find(close) {
                let segment = &content[start..(start + end_offset)];
                extract_identifiers(segment, &mut identifiers);
                index = start + end_offset + 2;
                continue;
            }
        }

        index += 1;
    }

    identifiers
}

fn extract_identifiers(segment: &str, output: &mut BTreeSet<String>) {
    let chars = segment.chars().collect::<Vec<_>>();
    let mut index = 0usize;

    while index < chars.len() {
        let ch = chars[index];
        if ch.is_ascii_alphabetic() || ch == '_' {
            let start = index;
            index += 1;
            while index < chars.len()
                && (chars[index].is_ascii_alphanumeric() || chars[index] == '_')
            {
                index += 1;
            }
            output.insert(chars[start..index].iter().collect());
            continue;
        }

        index += 1;
    }
}

fn read_required_text(path: &Path) -> Result<String> {
    fs::read_to_string(path).with_context(|| format!("读取模板失败：{}", path.display()))
}

fn to_validation_error(error: anyhow::Error) -> TemplateValidationError {
    let raw_message = error.to_string();
    let (line, column) = extract_line_column(&raw_message);
    TemplateValidationError {
        message: "模板语法校验失败".to_string(),
        line,
        column,
        raw_message,
    }
}

fn extract_line_column(message: &str) -> (Option<usize>, Option<usize>) {
    if let Some(index) = message.find(" at line ") {
        let line_text = &message[(index + " at line ".len())..];
        let line = parse_leading_usize(line_text);
        let column = line_text.find(", column ").and_then(|column_index| {
            parse_leading_usize(&line_text[(column_index + ", column ".len())..])
        });
        if line.is_some() {
            return (line, column);
        }
    }

    for line in message.lines() {
        if let Some(index) = line.find("-->") {
            let rest = line[(index + 3)..].trim();
            let segments = rest.rsplit(':').take(2).collect::<Vec<_>>();
            if segments.len() == 2 {
                let column = segments[0].trim().parse::<usize>().ok();
                let line_num = segments[1].trim().parse::<usize>().ok();
                if line_num.is_some() {
                    return (line_num, column);
                }
            }
        }
    }

    (None, None)
}

fn parse_leading_usize(text: &str) -> Option<usize> {
    let digits = text
        .chars()
        .take_while(|ch| ch.is_ascii_digit())
        .collect::<String>();
    if digits.is_empty() {
        None
    } else {
        digits.parse::<usize>().ok()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::BTreeMap;
    use std::time::{SystemTime, UNIX_EPOCH};

    struct TestDirs {
        root: PathBuf,
        builtin_dir: PathBuf,
        override_dir: PathBuf,
    }

    impl TestDirs {
        fn new() -> Self {
            let stamp = SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap()
                .as_nanos();
            let root = std::env::temp_dir().join(format!("flowcloudai-template-test-{}", stamp));
            let builtin_dir = root.join("builtin");
            let override_dir = root.join("override");
            fs::create_dir_all(&builtin_dir).unwrap();
            fs::create_dir_all(&override_dir).unwrap();

            for meta in TEMPLATE_REGISTRY {
                let path = path_for_template_id(&builtin_dir, meta.id);
                if let Some(parent) = path.parent() {
                    fs::create_dir_all(parent).unwrap();
                }
                let content = if meta.id == "sense/app_system" {
                    "默认系统提示".to_string()
                } else {
                    format!("模板 {} 默认内容", meta.id)
                };
                fs::write(path, content.as_bytes()).unwrap();
            }

            Self {
                root,
                builtin_dir,
                override_dir,
            }
        }
    }

    impl Drop for TestDirs {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.root);
        }
    }

    #[test]
    fn override_template_has_higher_priority() {
        let dirs = TestDirs::new();
        let override_path = path_for_template_id(&dirs.override_dir, "sense/app_system");
        if let Some(parent) = override_path.parent() {
            fs::create_dir_all(parent).unwrap();
        }
        fs::write(&override_path, "覆盖后的系统提示".as_bytes()).unwrap();

        let runtime =
            TemplateRuntime::new(dirs.builtin_dir.clone(), dirs.override_dir.clone()).unwrap();
        let document =
            build_template_document(&runtime, find_template_meta("sense/app_system").unwrap())
                .unwrap();

        assert!(document.is_override);
        assert_eq!(document.content, "覆盖后的系统提示");
    }

    #[test]
    fn embedded_templates_can_be_parsed() {
        let sources = load_embedded_template_sources().unwrap();
        TemplateEngine::from_sources(&sources).unwrap();
    }

    #[test]
    fn invalid_template_save_returns_validation_error() {
        let dirs = TestDirs::new();
        let mut runtime =
            TemplateRuntime::new(dirs.builtin_dir.clone(), dirs.override_dir.clone()).unwrap();

        let result = save_template_with_runtime(
            &mut runtime,
            find_template_meta("sense/app_system").unwrap(),
            "{{ invalid ".to_string(),
        );

        assert!(matches!(result, Err(TemplateSaveFailure::Validation(_))));
        assert!(!path_for_template_id(&dirs.override_dir, "sense/app_system").exists());
    }

    #[test]
    fn missing_template_params_returns_validation_error() {
        let dirs = TestDirs::new();
        let mut runtime =
            TemplateRuntime::new(dirs.builtin_dir.clone(), dirs.override_dir.clone()).unwrap();

        let result = save_template_with_runtime(
            &mut runtime,
            find_template_meta("formats/entry_full").unwrap(),
            "{{ title }}".to_string(),
        );

        match result {
            Err(TemplateSaveFailure::Validation(error)) => {
                assert_eq!(error.message, "参数检查失败");
                assert!(error.raw_message.contains("summary"));
                assert!(error.raw_message.contains("entry_type"));
            }
            other => panic!("expected validation error, got {:?}", other),
        }
    }

    #[test]
    fn valid_template_save_updates_runtime_immediately() {
        let dirs = TestDirs::new();
        let mut runtime =
            TemplateRuntime::new(dirs.builtin_dir.clone(), dirs.override_dir.clone()).unwrap();

        let document = save_template_with_runtime(
            &mut runtime,
            find_template_meta("sense/app_system").unwrap(),
            "新的系统提示".to_string(),
        )
        .unwrap();

        let rendered = runtime
            .engine
            .render("sense/app_system", &BTreeMap::<String, String>::new())
            .unwrap();

        assert!(document.is_override);
        assert_eq!(rendered, "新的系统提示");
    }

    #[test]
    fn get_default_content_is_not_affected_by_override() {
        let dirs = TestDirs::new();
        let override_path = path_for_template_id(&dirs.override_dir, "sense/app_system");
        if let Some(parent) = override_path.parent() {
            fs::create_dir_all(parent).unwrap();
        }
        fs::write(&override_path, "覆盖内容".as_bytes()).unwrap();

        let default_content =
            read_required_text(&path_for_template_id(&dirs.builtin_dir, "sense/app_system"))
                .unwrap();

        assert_eq!(default_content, "默认系统提示");
    }

    #[test]
    fn saving_default_content_removes_override_file() {
        let dirs = TestDirs::new();
        let mut runtime =
            TemplateRuntime::new(dirs.builtin_dir.clone(), dirs.override_dir.clone()).unwrap();
        let override_path = path_for_template_id(&dirs.override_dir, "sense/app_system");
        if let Some(parent) = override_path.parent() {
            fs::create_dir_all(parent).unwrap();
        }
        fs::write(&override_path, "旧覆盖内容".as_bytes()).unwrap();

        let document = save_template_with_runtime(
            &mut runtime,
            find_template_meta("sense/app_system").unwrap(),
            "默认系统提示".to_string(),
        )
        .unwrap();

        assert!(!document.is_override);
        assert!(!override_path.exists());
    }

    #[test]
    fn load_merged_sources_preserves_extra_override_templates() {
        let dirs = TestDirs::new();
        let extra_path = dirs.override_dir.join("extra").join("note.tera");
        fs::create_dir_all(extra_path.parent().unwrap()).unwrap();
        fs::write(&extra_path, "额外模板".as_bytes()).unwrap();

        let builtin_sources = load_builtin_template_sources(&dirs.builtin_dir).unwrap();
        let sources = load_merged_template_sources(&builtin_sources, &dirs.override_dir).unwrap();

        assert!(sources.values().any(|item| item.content == "额外模板"));
    }
}
