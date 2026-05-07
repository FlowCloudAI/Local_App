# Prompt & Tools 模块说明

## 模块结构

```
src-tauri/src/
├── ai_services/
│   └── context_builders.rs   # 构建 AI 任务上下文和 prompt 数据（Tera 模板）
├── template.rs               # Tera 模板引擎，渲染 prompt 模板
├── senses/                   # AI "感知"模块（矛盾检测、角色一致性等）
└── tools/
    ├── mod.rs                # 数据库查询工具 + 格式化输出
    ├── format                # 格式化辅助（词条简报、完整词条、标签、关系等，内联模块于 mod.rs）
    ├── entry_tools.rs        # 词条 CRUD Tauri 命令
    ├── category_tools.rs     # 分类 CRUD Tauri 命令
    ├── project_tools.rs      # 项目相关 Tauri 命令
    ├── edit_tools.rs         # 批量编辑 Tauri 命令
    ├── confirm.rs            # 确认对话框 Tauri 命令
    ├── registry.rs           # 工具注册系统（向 LLM 暴露工具）
    ├── state.rs              # 工具状态管理
    └── web_tools.rs          # Web 搜索工具
```

> **注**：旧版 XML 提示词生成（`XmlPrompt`、`TaskBlock` 等结构体）已被 **Tera 模板引擎** 替代。当前所有 AI Prompt 均通过 `template.rs` 加载 `.tera` 模板文件渲染生成，模板目录位于 `src-tauri/templates/`。以下类型说明保留作为参考，不再与代码直接对应。

## 核心功能

### 1. template.rs - Tera 模板引擎

**主要类型：**
- `TemplateEngine` - 模板引擎，从 `templates/` 目录加载 `.tera` 文件

**使用方式：**
```rust
use crate::template::render_global_template;
use serde::Serialize;

#[derive(Serialize)]
struct MyContext {
    title: String,
    content: String,
}

let rendered = render_global_template("prompts/my_template", &MyContext {
    title: "Hello".into(),
    content: "World".into(),
});
```

### 2. ai_services/context_builders.rs - 上下文构建

为 AI 任务构建上下文数据：

- `build_task_context()` - 构建统一 `TaskContext`
- `build_entry_markdown()` - 将词条格式化为 Markdown
- `build_summary_prompt()` - 构建摘要/扩写 prompt
- `build_contradiction_prompt()` - 构建矛盾检测 prompt

### 3. tools/mod.rs - 数据库工具函数

**数据库查询工具（内部调用，通过 Tauri State 访问）：**
- `search_entries()` - FTS 搜索词条
- `get_entry()` - 获取词条完整内容
- `list_entries_by_type()` - 列出指定类型词条
- `list_tag_schemas()` - 获取标签定义
- `get_entry_relations()` - 获取词条关系网络
- `get_project_summary()` - 获取项目统计信息
- `list_projects()` - 列出所有项目
- `list_categories()` - 列出项目分类
- `create_entry()` / `update_entry_fields()` / `delete_entry()` - 词条 CRUD
- `create_category()` / `cascade_delete_category()` - 分类管理

以上工具函数**不通过 `#[tauri::command]` 暴露给前端**，而是通过 `tools/registry.rs` 注册为 LLM 可调用工具。

**格式化辅助（tools::format）：**
- `format_entry_briefs()` - 格式化词条简报列表
- `format_entry()` - 格式化完整词条
- `format_tag_schemas()` - 格式化标签定义
- `format_relations()` - 格式化词条关系
- `format_project_summary()` - 格式化项目统计
- `format_projects()` - 格式化项目列表
- `format_categories()` - 格式化分类列表

## 四种 LLM 任务类型

| 功能 | 说明 |
|------|------|
| 设定补全 (Enrich) | 基于已有词条和项目背景，扩写/补全内容 |
| 一致性检测 (ConsistencyCheck) | 检测词条间矛盾 |
| 灵感扩展 (ExpandInspiration) | 基于灵感便签扩展 |
| 图像提示词 (GenerateImagePrompt) | 生成图像生成提示词 |

## 注意事项

1. **工具函数均为内部调用**：不通过 `#[tauri::command]` 暴露给前端
2. **只读操作**：大部分工具函数仅读取数据库，不修改数据；写操作通过明确的 CRUD 函数进行
3. **错误处理**：所有异步函数返回 `Result<T, String>`
4. **模板渲染**：使用 `tera` 库，模板位于 `src-tauri/templates/`

## 测试

运行模板渲染测试：
```bash
cargo test
```

## 后续集成

这些模块已与 `flowcloudai_client_core` 的工具注册系统集成：

1. 在 AI Session 创建时，检查 `LLMInfo.supports_tools`
2. 如果支持工具，通过 `tools/registry.rs` 注册工具到 `ToolRegistry`：
   - search_entries
   - get_entry
   - list_entries_by_type
   - list_tag_schemas
   - get_entry_relations
   - get_project_summary
3. 工具返回结果使用 `tools::format::*` 格式化后返回给 LLM
4. LLM 输出解析后，由前端确认并保存
