# 提示词模板目录

本目录存放 FlowCloudAI 的提示词（prompt）和 AI 返回格式模板。所有模板使用 [Tera](https://tera.netlify.app/docs/) 模板引擎渲染，语法类 Jinja2 / Django。

## 修改前必读

**每个子目录下有 `README.md`，列出了该目录下所有模板的输入参数和复制来源。修改模板前请务必先阅读对应子目录的 README，确保了解每个变量的含义以及模板渲染失败时的硬编码回退逻辑。**

## 目录结构

```
templates/
├── sense/             # AI 系统提示词（角色扮演、矛盾检测、通用助手）
├── context/           # 上下文注入模板（词条快照等）
├── formats/           # 工具返回格式模板（词条列表、标签定义、关系网络等）
├── contradiction/     # 矛盾检测专用模板（检测提示、摘要生成）
└── README.md          # 本文件
```

## 各目录作用

| 目录               | 作用                      | 调用方                                             |
|------------------|-------------------------|-------------------------------------------------|
| `sense/`         | 定义 AI 的基础人设、回答规则、可用工具范围 | `src-tauri/src/senses/`                         |
| `context/`       | 控制每轮对话向 AI 注入的上下文格式     | `src-tauri/src/ai_services/context_builders.rs` |
| `formats/`       | 控制工具（读操作）返回给 AI 的结果格式   | `src-tauri/src/tools/mod.rs` 的 `format` 模块      |
| `contradiction/` | 矛盾检测和摘要生成的任务提示          | `src-tauri/src/ai_services/context_builders.rs` |

## 生效方式

- **开发环境**：修改模板文件 → 重启 App → 生效
- **发布环境**：模板随安装包复制到安装目录，替换对应文件后重启生效

## 回退机制

所有模板都有硬编码回退：如果模板文件缺失或渲染失败，系统会自动使用原始 Rust 硬编码文案，功能不会退化。日志中会输出 `模板渲染失败` 警告。

## Tera 语法速览

### 输出变量

```tera
{{ variable_name }}
```

### 条件判断

```tera
{% if variable %}
  变量有值时输出
{% else %}
  变量为空时输出
{% endif %}
```

### 判断变量是否有值（非空、非零、非空数组）

```tera
{% if variable %}        {# 变量存在且非空 #}
{% if variable | length > 0 %}  {# 显式检查长度 #}
```

### 循环

```tera
{% for item in items %}
{{ item }}
{% endfor %}
```

### 循环内变量

```tera
{% if not loop.last %}    {# 不是最后一项 #}
{% if loop.first %}       {# 是第一项 #}
{{ loop.index }}          {# 从 1 开始计数 #}
```

### 空白控制

```tera
{% if foo -%}             {# -%} 消除标签后的换行 #}
{%- if foo %}             {# {%- 消除标签前的换行 #}
{%- if foo -%}            {# 同时消除前后换行 #}
```

### 常用过滤器

```tera
{{ value | length }}      {# 数组/字符串长度 #}
{{ value | default("默认值") }}  {# 空值时用默认值 #}
{{ "text" | upper }}      {# 转大写 #}
```

### 注释

```tera
{# 这是注释，不会输出 #}
```
