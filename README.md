# 流云AI（FlowCloudAI）

> 一款基于 Tauri v2 的桌面端创意写作与知识管理应用。

## 简介

流云AI 是面向创作者与知识工作者的桌面端工具，集项目管理、词条知识库、AI 对话助手与可视化分析于一体。前端采用 React +
TypeScript + Vite，后端由 Rust 驱动，通过 Tauri 实现高性能的跨平台桌面体验。

### 核心功能

- **项目管理** —— 创建、编辑、分类管理创作项目。
- **词条系统** —— 富文本词条、标签体系（Tag Schema）、词条类型自定义、词条关系（单向/双向）与内链。
- **AI 助手** —— 基于插件化架构的 LLM 对话，支持流式输出、推理过程展示、工具调用、分支回溯；同时支持文生图、图编辑、语音合成（TTS）。
- **可视化** —— 词条关系图（Rust 后端确定性力导向布局引擎）、时间线、地图形状编辑器。
- **插件市场** —— 支持本地 `.fcplug` 插件安装与远程插件市场交互。

---

## 技术栈

| 层级     | 技术                                                           |
|--------|--------------------------------------------------------------|
| 前端框架   | React 19 + TypeScript 5.9                                    |
| 构建工具   | Vite 6                                                       |
| UI 组件库 | `flowcloudai-ui`（内部私有包）                                      |
| 国际化    | `i18next` + `react-i18next`，支持 `zh-CN` / `en-US`             |
| 后端框架   | Tauri 2 + Rust (Edition 2024)                                |
| 异步运行时  | `tokio` (full features)                                      |
| 数据库    | `SQLite`，通过 `worldflow_core` crate 封装访问                      |
| AI 客户端 | `flowcloudai_client` crate，支持 WASM 插件                        |
| 状态管理   | React Hooks（无 Redux / Zustand）                               |
| 代码检查   | ESLint 9 + `typescript-eslint` + `eslint-plugin-react-hooks` |

---

## 快速开始

### 环境要求

- [Node.js](https://nodejs.org/)
- [Rust 工具链](https://www.rust-lang.org/tools/install)
- 确保网络可访问 GitHub 以拉取 `worldflow_core` 与 `flowcloudai_client` 依赖

### 安装与运行

```bash
# 安装前端依赖
npm install

# 启动 Tauri 开发模式（同时拉起前端 dev server）
npm run tauri dev

# 仅启动前端开发服务器
npm run dev
```

### 构建

```bash
# 仅构建前端（输出到 dist/）
npm run build

# 构建完整的桌面应用安装包（Windows NSIS / Linux deb & AppImage）
npm run tauri build

# 以 Release 模式启动 Tauri 开发服务器
npm run tauri:release

# 预览生产构建
npm run preview
```

### 代码检查

```bash
npm run lint
```

### 运行 Rust 单元测试

```bash
cd src-tauri
cargo test
```

---

## 项目结构

```
flowcloudai_app/
├── src/                      # 前端源码
│   ├── api/                  # Tauri invoke 封装（与后端 apis 模块一一对应）
│   ├── features/             # 按功能域组织的 React 组件
│   │   ├── ai-chat/          # AI 对话助手
│   │   ├── entries/          # 词条系统（编辑、标签、关系、图片）
│   │   ├── maps/             # 地图与形状编辑器
│   │   ├── plugins/          # 插件管理
│   │   ├── project-editor/   # 项目编辑器（概览、时间线、矛盾检测）
│   │   ├── projects/         # 项目列表与创建
│   │   ├── relation-graph/   # 词条关系图
│   │   └── snapshots/        # 快照面板
│   ├── i18n/                 # 国际化配置与语言包
│   ├── pages/                # 页面级组件
│   ├── shared/               # 共享组件与 Hooks
│   ├── App.tsx               # 根组件（含标签页、侧边栏、窗口控制）
│   └── main.tsx              # 应用入口
├── src-tauri/                # Tauri / Rust 后端
│   ├── src/
│   │   ├── apis/             # Tauri Commands（暴露给前端的 API）
│   │   │   ├── ai_client/    # AI 会话、媒体、工具调用
│   │   │   ├── plugins/      # 本地/远程插件与市场
│   │   │   └── worldflow/    # 项目、词条、标签、关系等数据操作
│   │   ├── ai_services/      # AI 服务：Artifact 解析、上下文构建、矛盾检测
│   │   ├── layout/           # 确定性图布局引擎
│   │   ├── map/              # 地图生成服务
│   │   ├── tools/            # AI 工具注册中心与 Worldflow 工具实现
│   │   ├── senses/           # Sense（模式预设）实现
│   │   ├── reports/          # 报告生成（矛盾报告、摘要结果）
│   │   ├── lib.rs            # Tauri Builder 配置与状态初始化
│   │   ├── main.rs           # 程序入口
│   │   ├── prompt.rs         # Prompt 模板
│   │   ├── settings.rs       # 应用设置与密钥存取
│   │   └── state.rs          # 全局状态定义（AiState、AppState 等）
│   ├── capabilities/         # Tauri 权限配置
│   └── icons/                # 应用图标
├── docs/                     # 设计文档（插件系统、布局引擎、地图生成等）
├── public/                   # 静态资源
├── package.json
├── vite.config.ts
├── tsconfig.app.json
├── tsconfig.node.json
└── eslint.config.js
```

---

## 安全与隐私

- **API 密钥存储**：所有插件的 API Key 均通过系统密钥链（`keyring` crate）保存，**绝不写入 `settings.json` 文件**。
- **图片访问控制**：应用注册了自定义 URI Scheme `fcimg`，仅允许访问数据库同级目录 `images/` 下的文件，防止路径遍历。
- **CSP 与权限**：`tauri.conf.json` 中配置了 Content-Security-Policy；`capabilities/default.json` 中仅授予必要的窗口操作与文件打开权限。
- **设置文件**：`settings.json` 存储在系统应用配置目录（`app_config_dir`），不含敏感信息。

---

## 相关文档

项目 `docs/` 目录下包含更详细的设计文档：

- [`docs/plugin_system_guide.md`](docs/plugin_system_guide.md) —— 插件系统架构与 `.fcplug` 包格式
- [`docs/tauri_deterministic_layout_engine.md`](docs/tauri_deterministic_layout_engine.md) —— 关系图布局引擎算法与协议
- [`docs/semantic_map_generation_design.md`](docs/semantic_map_generation_design.md) —— 语义地图生成设计
- [`docs/map_shape_editor_backend_mvp.md`](docs/map_shape_editor_backend_mvp.md) —— 地图形状编辑器后端 MVP
- [`docs/prompt_README.md`](docs/prompt_README.md) —— Prompt 模板与 AI Tools 模块说明
- [`docs/ui_style_unification_plan.md`](docs/ui_style_unification_plan.md) —— UI 视觉统一化方案

---

## 许可证

MIT License
