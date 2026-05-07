# sense/ — AI 系统提示词

此目录的模板定义了 AI 的**基础人设**和**回答规则**，在创建会话时一次性加载，贯穿整个会话生命周期。

---

## `app_system.tera`

**复制来源：** `src-tauri/src/senses/app_sense.rs` — `AppSense::prompts()`

**场景：** 通用 AI 助手会话

**输入参数：** 无

**说明：** 定义通用创作助手的基础行为准则：优先基于项目资料回答、保持设定一致性等。

---

## `character_system.tera`

**复制来源：** `src-tauri/src/senses/character_sense.rs` — `CharacterSense::prompts()`

**场景：** 角色扮演会话（用户对某个角色词条发起聊天）

**输入参数：**

| 变量                     | 类型            | 说明                                       |
|------------------------|---------------|------------------------------------------|
| `character_name`       | `String`      | 角色名称（即词条标题）                              |
| `project_name`         | `String`      | 所属项目名称                                   |
| `project_description`  | `String`      | 项目描述（无描述时显示"无"）                          |
| `target_title`         | `String`      | 角色词条标题                                   |
| `target_entry_type`    | `String`      | 词条类型（未设置时显示"未设置"）                        |
| `target_category_path` | `String`      | 分类路径（形如 "角色 / 主角"，未分类时显示"未分类"）           |
| `target_summary`       | `String`      | 词条摘要（无摘要时显示"无"）                          |
| `target_content`       | `String`      | 词条正文（无内容时显示"无"）                          |
| `target_tags`          | `String`      | 标签列表（形如 "性别=男；年龄=25"，无标签时显示"无"）          |
| `related_relations`    | `Vec<String>` | 与该角色直接相关的关系行列表，每行格式：`- A -> B [关系类型] 描述` |
| `category_lines`       | `Vec<String>` | 项目分类树行列表，每行格式：`- 分类名 (ID)`               |
| `schema_lines`         | `Vec<String>` | 标签体系行列表，每行格式：`- 标签名 [类型] 目标=XX 说明=XX`    |
| `world_entry_lines`    | `Vec<String>` | 项目所有世界设定词条的摘要行列表，含有标题、类型、路径、摘要、正文、标签     |

**说明：** 角色扮演模板包含四个区块：角色身份约束 → 回答规则 → 当前项目信息 → 角色详细设定。后续区块（关系、标签字典、分类结构、世界设定摘录）在对应数据非空时才出现。

---

## `contradiction_system.tera`

**复制来源：** `src-tauri/src/senses/contradiction_sense.rs` — `ContradictionSense::prompts()`

**场景：** 矛盾检测会话

**输入参数：** 无

**说明：** 定义矛盾检测助手的行为准则：优先基于原文证据、证据不足时放入未解决问题、首轮输出 JSON、阶段完成后报告进度。
