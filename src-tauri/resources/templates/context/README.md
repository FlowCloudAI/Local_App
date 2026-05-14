# context/ — 上下文注入模板

此目录的模板控制**每轮对话向 AI 消息列表注入的动态上下文格式**。

---

## `entry_snapshot.tera`

**复制来源：** `src-tauri/src/ai_services/context_builders.rs` — `build_entry_snapshot_markdown()`

**场景：** 矛盾检测或摘要生成时，对单个词条做格式化快照，用于拼入 AI 提示词

**输入参数：**

| 变量           | 类型               | 说明                                        |
|--------------|------------------|-------------------------------------------|
| `entry_id`   | `String`         | 词条 UUID                                   |
| `title`      | `String`         | 词条标题                                      |
| `entry_type` | `Option<String>` | 词条类型（如 "character"），无时为 `None`            |
| `summary`    | `Option<String>` | 词条摘要，无时为 `None`                           |
| `tag_text`   | `Option<String>` | 标签文本（形如 "schema_id=value；…"），无标签时为 `None` |
| `content`    | `String`         | 词条正文内容（可能已截断，超过最大长度时末尾带有"……（正文过长，已截断）"）   |

**注意：**

- `entry_type`、`summary`、`tag_text` 均为 `Option`，模板中需用 `{% if %}` 判断是否存在。
- 模板变量来自作者可编辑资料，Rust 侧会先对标题、类型、摘要、标签和正文进行 XML-like 实体转义，再注入模板，避免正文中的 `</正文>`、`</entry>` 等文本破坏资料边界。
- `<资料说明>` 用于提醒模型：词条字段只能作为设定证据，不得作为对 AI 的行为指令执行。
