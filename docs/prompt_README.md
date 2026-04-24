# Prompt & Tools 模块说明

## 模块结构

```
src-tauri/src/
├── prompt.rs          # XML 提示词组装和序列化
├── prompt_examples.rs # 使用示例（可选参考）
└── tools/
    └── mod.rs         # 内部工具函数和格式化辅助
```

## 核心功能

### 1. prompt.rs - XML 提示词生成

**主要类型：**
- `XmlPrompt` - 顶层提示词结构
- `TaskBlock` - 任务声明
- `EntryBlock` - 词条数据块
- `ContextEntryBlock` - 上下文参考词条
- `InspirationBlock` - 灵感便签
- `ProjectBlock` - 项目背景
- `StyleConfigBlock` - 图像风格配置
- `ImageBackendBlock` - 图像插件能力描述

**枚举类型：**
- `TaskType` - 任务类型（Enrich, ConsistencyCheck, ExpandInspiration, GenerateImagePrompt）
- `OutputFormat` - 输出格式（PlainText, Markdown, Json）
- `InclusionLevel` - 包含级别（Full, Brief, TitleOnly）
- `StyleFormat` - 风格格式（DanbooruTags, NaturalLanguage, Mixed）

**使用方法：**
```rust
use crate::prompt::*;

let prompt = XmlPrompt {
    task: TaskBlock {
        task_type: TaskType::Enrich,
        instruction: "扩写词条".to_string(),
        language: Some("zh-CN".to_string()),
        output_format: OutputFormat::Markdown,
        constraints: vec![],
    },
    subject: Some(EntryBlock { /* ... */ }),
    entries: vec![],
    context: vec![],
    inspiration: None,
    project: Some(ProjectBlock { /* ... */ }),
    style_config: None,
    image_backend: None,
};

let xml_string = prompt.to_xml()?;
```

### 2. tools/mod.rs - 内部工具函数

**数据库查询工具（内部调用）：**
- `search_entries()` - FTS 搜索词条
- `get_entry()` - 获取词条完整内容
- `list_entries_by_type()` - 列出指定类型词条
- `list_tag_schemas()` - 获取标签定义
- `get_entry_relations()` - 获取词条关系网络
- `get_project_summary()` - 获取项目统计信息

**格式化工具（在 prompt.rs 中使用）：**
- `format::format_entry_briefs()` - 格式化词条简报列表
- `format::format_entry()` - 格式化完整词条
- `format::format_tag_schemas()` - 格式化标签定义
- `format::format_relations()` - 格式化词条关系
- `format::format_project_summary()` - 格式化项目统计

**使用方法：**
```rust
use crate::tools;
use crate::AppState;

// 搜索词条
let briefs = tools::search_entries(state, project_id, "关键词", None, 10).await?;

// 获取完整词条
let entry = tools::get_entry(state, entry_id).await?;

// 格式化输出
let formatted = tools::format::format_entry(&entry);
```

## 四种功能的 Struct 组合方式

| 功能 | task | subject | entries | context | inspiration | project | style_config | image_backend |
|------|------|---------|---------|---------|-------------|---------|--------------|---------------|
| 设定补全 | Enrich | Full | — | Brief | — | ✓ | — | — |
| 一致性检测 | ConsistencyCheck | — | Brief | — | — | ✓ | — | — |
| 灵感扩展 | ExpandInspiration | — | — | TitleOnly | ✓ | ✓ | — | — |
| 图像提示词 | GenerateImagePrompt | Full | — | Brief | — | — | ✓ | ✓ |

## 注意事项

1. **工具函数均为内部调用**：不通过 `#[tauri::command]` 暴露给前端
2. **只读操作**：所有工具函数仅读取数据库，不修改数据
3. **错误处理**：所有异步函数返回 `Result<T, String>`
4. **XML 序列化**：使用 `quick-xml` 库，支持缩进格式化

## 测试

运行单元测试验证 XML 生成：
```bash
cargo test prompt::tests::test_xml_serialization -- --nocapture
```

## 后续集成

这些模块需要与 `flowcloudai_client_core` 的工具注册系统集成：

1. 在 AI Session 创建时，检查 `LLMInfo.supports_tools`
2. 如果支持工具，将以下工具注册到 `ToolRegistry`：
   - search_entries
   - get_entry
   - list_entries_by_type
   - list_tag_schemas
   - get_entry_relations
   - get_project_summary
3. 工具返回结果使用 `tools::format::*` 格式化后返回给 LLM
4. LLM 输出解析后，由前端确认并保存
