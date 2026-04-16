# FlowCloudAI 项目指南

> 本文档面向 AI 编程助手。项目主要注释和文档使用中文，本指南也以中文撰写。

---

## 项目概览

**FlowCloudAI（流云AI）** 是一款基于 Tauri v2 的桌面端创意写作与知识管理应用。它采用 **React + TypeScript + Vite** 构建前端，
**Rust** 构建后端，通过 Tauri 的 Invoke 机制进行通信。

核心功能包括：

- **项目管理**：创建、编辑、分类管理创作项目。
- **词条系统**：支持富文本词条、标签体系（Tag Schema）、词条类型自定义、词条关系（单向/双向）与内链。
- **AI 助手**：基于插件化架构的 LLM 对话（支持流式输出、推理过程、工具调用、分支回溯）、文生图、图编辑、语音合成（TTS）。
- **可视化**：词条关系图（基于 Rust 后端确定性力导向布局引擎）、时间线、地图形状编辑器。
- **插件市场**：支持本地 `.fcplug` 插件安装与远程插件市场交互。

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
| 数据库    | `SQLite`，通过 `worldflow_core`  crate 封装访问                     |
| AI 客户端 | `flowcloudai_client` crate，支持 WASM 插件                        |
| 状态管理   | React Hooks（无 Redux / Zustand）                               |
| 代码检查   | ESLint 9 + `typescript-eslint` + `eslint-plugin-react-hooks` |

### 关键外部依赖

- **前端**：`@tauri-apps/api`、`@tauri-apps/plugin-*`、`@uiw/react-md-editor`、`@deck.gl/widgets`、`react-window`
- **后端**：`tauri`、`tokio`、`serde`、`anyhow`、`reqwest`、`keyring`、`uuid`、`zip`、`scraper`、`quick-xml`
- **私有 Git 依赖**：
    - `worldflow_core`：`ssh://git@github.com/FlowCloudAI/Worldflow_Core`
    - `flowcloudai_client`：`ssh://git@github.com/FlowCloudAI/AI_Client_Core`

---

## 目录结构

```
flowcloudai_app/
├── src/                      # 前端源码
│   ├── api/                  # Tauri invoke 封装（与后端 apis 模块一一对应）
│   ├── components/           # React 组件
│   │   ├── project-editor/   # 项目编辑器子组件
│   │   └── hooks/            # 组件级自定义 Hooks
│   ├── hooks/                # 全局自定义 Hooks
│   ├── i18n/                 # 国际化配置与语言包
│   ├── pages/                # 页面级组件
│   ├── App.tsx               # 根组件（含标签页、侧边栏、窗口控制）
│   └── main.tsx              # 应用入口（主题预加载后挂载 React）
├── src-tauri/                # Tauri / Rust 后端
│   ├── src/
│   │   ├── apis/             # Tauri Commands（暴露给前端的 API）
│   │   ├── layout/           # 确定性图布局引擎
│   │   ├── map/              # 地图生成服务
│   │   ├── tools/            # AI 工具注册中心与 Worldflow 工具实现
│   │   ├── lib.rs            # Tauri Builder 配置与状态初始化
│   │   ├── main.rs           # 程序入口
│   │   ├── settings.rs       # 应用设置与密钥存取
│   │   └── state.rs          # 全局状态定义（AiState、AppState 等）
│   ├── capabilities/         # Tauri 权限配置
│   ├── icons/                # 应用图标
│   └── Cargo.toml
├── docs/                     # 设计文档（插件系统、布局引擎、地图生成等）
├── public/                   # 静态资源
├── package.json
├── vite.config.ts
├── tsconfig.app.json
├── tsconfig.node.json
└── eslint.config.js
```

---

## 构建与运行

> 需要预先安装 Node.js 和 Rust 工具链。

### 常用命令

```bash
# 安装前端依赖
npm install

# 启动前端开发服务器（Vite）
npm run dev

# 启动 Tauri 开发模式（会同时拉起前端 dev server）
npm run tauri dev

# 生产构建（前端 + Rust）
npm run build          # 仅构建前端
npm run tauri build    # 构建完整的桌面应用安装包

# 代码检查
npm run lint
```

### Tauri 构建说明

- `tauri.conf.json` 中配置的包目标为 `nsis`（Windows 安装程序）。
- 应用窗口为无边框（`decorations: false`）、透明背景（`transparent: true`），最小化 / 最大化 / 关闭按钮由前端 `App.tsx` 自行实现。
- 发布模式（release）下会自动禁用 WebView 右键菜单。
- 程序强制单实例运行，重复启动会退出。

---

## 前后端通信约定

### 前端调用后端

所有前端 API 封装位于 `src/api/`，统一通过 `src/api/base.ts` 中的 `command` 函数调用 Tauri Invoke：

```ts
import {invoke} from '@tauri-apps/api/core'

export const command = <T>(name: string, args?: Record<string, unknown>) =>
    invoke<T>(name, args)
```

命名约定：

- **前端封装函数**：使用 `snake_case`，与后端 Command 名称保持一致（如 `db_create_project`、`ai_send_message`）。
- **类型定义**：前端 TS 类型使用 PascalCase；参数对象使用 CamelCase 字段名，在调用时直接透传给 Rust。

### 后端事件推送

AI 会话采用**后端事件流**推送到前端。Rust 通过 `app.emit(event, payload)` 发送事件，前端通过 `listen` 订阅。事件名包括：

| 事件名                             | 说明          |
|---------------------------------|-------------|
| `ai:ready`                      | 会话就绪，等待用户输入 |
| `ai:delta`                      | AI 生成内容片段   |
| `ai:reasoning`                  | AI 思考过程片段   |
| `ai:tool_call`                  | AI 发起工具调用   |
| `ai:tool_result`                | 工具调用结果      |
| `ai:turn_begin` / `ai:turn_end` | 对话轮次开始/结束   |
| `ai:error`                      | 会话错误        |
| `entry:edit-request`            | AI 工具请求编辑确认 |
| `backend-ready`                 | 后端初始化完成     |

---

## 代码风格指南

### TypeScript / React 前端

- **严格模式开启**：`tsconfig.app.json` 中 `strict: true`，并启用了 `noUnusedLocals`、`noUnusedParameters`、
  `noFallthroughCasesInSwitch`。
- **模块类型**：ES Modules（`"type": "module"`），使用 `import` / `export`。
- **JSX 转换**：`"jsx": "react-jsx"`。
- **CSS**：各组件通常配有同名的 `.css` 文件，使用原生 CSS 变量（由 `flowcloudai-ui` 提供设计 token）。
- **注释**：以中文为主。
- **未使用的导入/变量**：TypeScript 会报错，需保持代码整洁。

### Rust 后端

- 使用 Rust Edition 2024。
- 错误处理以 `anyhow::Result` 为主，Tauri Commands 返回 `Result<T, String>` 以便前端捕获错误信息。
- 大量使用 `tokio::sync::Mutex` 对共享状态进行保护。
- 注释以中文为主，常用 `// ── 标题 ──` 风格的分隔线。

---

## 测试说明

- **前端**：当前未配置任何测试框架（无 Jest / Vitest / Playwright）。
- **后端**：`src-tauri/src/layout/` 和 `src-tauri/src/map/` 等模块中包含部分 Rust 单元测试（`#[test]` / `#[cfg(test)]`）。
- **CI/CD**：仓库中未检测到 GitHub Actions 或其他持续集成配置。

如需运行 Rust 单元测试：

```bash
cd src-tauri
cargo test
```

---

## 安全与隐私

- **API 密钥存储**：所有插件的 API Key 均通过系统密钥链（`keyring` crate）保存，**绝不写入 `settings.json` 文件**。
- **图片访问控制**：应用注册了自定义 URI Scheme `fcimg`，仅允许访问数据库同级目录 `images/` 下的文件，防止路径遍历。
- **CSP 与权限**：`tauri.conf.json` 中配置了 Content-Security-Policy；`capabilities/default.json` 中仅授予必要的窗口操作与文件打开权限。
- **设置文件**：`settings.json` 存储在系统应用配置目录（`app_config_dir`），不含敏感信息。

---

## 关键开发注意事项

1. **不要改动 `vite.config.ts` 中的 `envPrefix`**：前缀 `VITE_` 和 `TAURI_ENV_*` 是 Tauri 与 Vite 集成的必要约定。
2. **新增 Tauri Command 需同步**：
    - 在 `src-tauri/src/apis/xxx.rs` 中添加 `#[tauri::command]` 函数。
    - 在 `src-tauri/src/lib.rs` 的 `invoke_handler` 列表中注册。
    - 在 `src/api/xxx.ts` 中添加对应的前端封装函数。
3. **AI 插件热插拔限制**：当前 `install` / `uninstall` 接口因 Rust 所有权限制尚未完全实现运行时热插拔，修改插件后可能需要重启应用生效。
4. **数据库初始化顺序**：`lib.rs` 的 `setup` 中会异步初始化 SQLite，完成后才注入 `AppState` 并初始化 `AiState`。前端应在收到
   `backend-ready` 事件后再执行依赖后端的操作。
5. **窗口显示时机**：`main.tsx` 中会在解析主题后通过 `requestAnimationFrame` 调用 `showWindow()`，以确保首屏不出现白闪。

---

## 相关文档

项目 `docs/` 目录下包含更详细的设计文档，修改对应模块前建议阅读：

- `docs/plugin_system_guide.md` —— 插件系统架构与 `.fcplug` 包格式
- `docs/tauri_deterministic_layout_engine.md` —— 关系图布局引擎算法与协议
- `docs/semantic_map_generation_design.md` —— 语义地图生成设计
- `docs/map_shape_editor_backend_mvp.md` —— 地图形状编辑器后端 MVP
