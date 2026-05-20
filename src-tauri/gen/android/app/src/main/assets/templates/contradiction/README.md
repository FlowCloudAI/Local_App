# contradiction/ — 矛盾检测专用模板

此目录的模板用于**矛盾检测**和**摘要生成**任务的提示词构建。

---

## `detection_prompt.tera`

**复制来源：** `src-tauri/src/ai_services/context_builders.rs` — `build_contradiction_prompt()`

**场景：** 矛盾检测会话的第一条消息——将项目资料和检测规则组装成完整提示

**输入参数：**

| 变量              | 类型            | 说明                                                 |
|-----------------|---------------|----------------------------------------------------|
| `project_name`  | `String`      | 项目名称                                               |
| `scope_summary` | `String`      | 检测范围摘要（如 "搜索词"xx""、 "分类 XX"、 "显式指定词条集合" 等）         |
| `truncated`     | `bool`        | 本轮资料是否经过裁剪（为 `true` 时追加截断提示）                       |
| `entry_blocks`  | `Vec<String>` | 词条快照块列表，每个块是 `build_entry_snapshot_markdown()` 的输出 |

**说明：** 这是整个模板系统中最复杂的模板（原始硬编码约 1575 字符），包含以下区块：

1. 任务说明 + 检测范围
2. 数据格式说明（类型/标签名不是矛盾依据，标签值可作为设定证据）
3. 判断标准（5 条，明确什么不算矛盾）
4. 6 个检测维度（timeline / relationship / geography / ability / faction / other）
5. relationship 证据补充规则（资料不足时优先补查关系或词条，不因缺失直接判定）
6. 输出要求（9 条 JSON 格式规范）
7. 资料正文（`entry_blocks` 循环拼接）
8. JSON priming 尾部（引导模型直接输出 JSON）

**注意：** 模板末尾的 `"overview": "` 是有意保留的——这引导 LLM 直接续写 JSON 而非输出解释性文字。不要删除或修改此尾部。

---

## `summary_prompt.tera`

**复制来源：** `src-tauri/src/ai_services/context_builders.rs` — `build_summary_prompt()`

**场景：** AI 自动生成词条摘要或项目总结

**输入参数：**

| 变量                    | 类型               | 说明                                                                    |
|-----------------------|------------------|-----------------------------------------------------------------------|
| `project_name`        | `String`         | 项目名称                                                                  |
| `focus`               | `Option<String>` | 总结重点（可选，有值时追加 "总结重点：XX"）                                              |
| `entry_blocks`        | `Vec<String>`    | 词条快照块列表                                                               |
| `is_entry_field_mode` | `bool`           | `true` = 生成词条摘要（JSON 格式输出，用于填入"摘要"字段）；`false` = 生成项目总结（Markdown 格式输出） |

**说明：** 根据 `is_entry_field_mode` 切换两套输出规则：
- **entry_field 模式**：要求输出 `{"summary": "..."}` JSON，30-120 字中文
- **非 entry_field 模式**：要求输出 Markdown，包含总览和 3-6 条关键信息
