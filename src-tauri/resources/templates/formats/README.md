# formats/ — 工具返回格式模板

此目录的模板控制 **AI 可调用的读操作工具返回给 AI 的结果格式**。这些模板被 `src-tauri/src/tools/mod.rs` 的 `format` 模块调用。

**重要：** 这些模板接收的 `items`/`lines` 已经是预格式化的字符串，模板只控制**整体布局**（标题、分隔符、条件渲染）。单条 item 的格式（如词条标题加粗、ID 括号展示）仍在 Rust 侧决定，修改需要在代码中调整。

---

## `entry_briefs.tera`

**工具：** `search_entries`、`list_all_entries`、`list_entries_by_type`

**输入：** `{ items: Vec<String> }` — 每条 item 格式：`N. **标题** [类型] (ID: xxx)\n   摘要：...`

**模板控制：** 空结果提示（"未找到相关词条" / "找到以下词条："）。Rust 当前会在空数组时提前返回同一文案，模板仍保留空分支以保证独立可读。

---

## `entry_full.tera`

**工具：** `get_entry`

**输入参数：**

| 变量           | 类型               | 说明                                 |
|--------------|------------------|------------------------------------|
| `title`      | `String`         | 词条标题                               |
| `summary`    | `Option<String>` | 词条摘要                               |
| `entry_type` | `Option<String>` | 词条类型                               |
| `content`    | `Option<String>` | 词条正文（有内容时为 `Some(...)`，空时为 `None`） |
| `tags`       | `Vec<String>`    | 标签行列表，每行格式：`schema_id : value`     |

---

## `tag_schemas.tera`

**工具：** `list_tag_schemas`

**输入：** `{ items: Vec<String> }` — 每条 item 格式：`- **名称** (schema_id: xxx, 类型: ..., 目标: ...)`

**模板控制：** 空结果提示（"该项目未定义任何标签" / "项目标签定义："）

---

## `relations.tera`

**工具：** `get_entry_relations`

**输入参数：**

| 变量 | 类型 | 说明 |
|------|------|------|
| `current_name` | `String` | 当前词条名称 |
| `items` | `Vec<String>` | 预格式化的关系行，每条格式：`- **词条A** ↔/→ **词条B**（双向/单向）\n  描述：...\n  关系ID：...` |

**模板控制：** 空结果提示（"该词条没有任何关系"）+ 标题（"「XX」的关系网络："）

---

## `project_summary.tera`

**工具：** `get_project_summary`

**输入参数：**

| 变量 | 类型 | 说明 |
|------|------|------|
| `name` | `String` | 项目名称 |
| `description` | `Option<String>` | 项目描述 |
| `count_lines` | `Vec<String>` | 词条统计行，每条格式：`- 类型名 : N 个` |
| `created_at` | `String` | 创建时间（ISO 格式） |
| `updated_at` | `String` | 更新时间（ISO 格式） |

**模板控制：** 空统计提示（"暂无词条"）

---

## `projects.tera`

**工具：** `list_projects`

**输入：** `{ items: Vec<String> }` — 每条 item 格式：`N. **项目名** (ID: xxx)\n   描述：...`

**模板控制：** 空结果提示（"暂无任何项目" / "项目列表："）

---

## `categories.tera`

**工具：** `list_categories`

**输入：** `{ lines: Vec<String> }` — 每条 line 格式：`- **分类名** (ID: xxx)`，已按树层级缩进

**模板控制：** 空结果提示（"该项目暂无分类" / "分类列表："）

---

## `categories_subtree.tera`

**工具：** `query_categories`

**输入参数：**

| 变量 | 类型 | 说明 |
|------|------|------|
| `header` | `String` | 标题行（"根目录下的分类：" 或 "分类「XX」（ID: xxx）的子分类："） |
| `lines` | `Vec<String>` | 已按树层级缩进的分类行 |

**模板控制：** 标题行 + 空结果提示（"暂无子分类"）/ 子分类列表。

---

## `entry_types.tera`

**工具：** `list_entry_types`

**输入：** `{ lines: Vec<String> }` — 每条 line 格式：`- **名称** (key: xxx, 内置)` 或 `- **名称** (id: xxx, 自定义)`

**模板控制：** 空结果提示（"该项目未定义任何词条类型" / "可用词条类型："）
