# app_main — AGENTS.md

> 本文档面向 AI 编码助手。`README.md` 面向使用者。

## 项目概览

`app_main` 是 FlowCloudAI 的桌面端主应用（Tauri 2 + React + Rust），覆盖词条/关系图/地图编辑、快照、AI 对话、插件管理与反馈。
应用前端与 `src-tauri` 后端通过 `invoke` 封装分层交互，不允许业务代码直接在前端直接调用 `@tauri-apps/api`。

## 构建 / 运行 / 测试 / lint

```bash
cd app_main
npm install

# 运行
npm run dev
npm run tauri -- dev

# 构建
npm run build
npm run tauri -- build

# 可选：平台构建与 Android
npm run tauri:build:windows
npm run tauri:build:linux
npm run android:dev
npm run android:build:apk

# 检查
npm run lint
cd src-tauri
cargo test
```

`app_main/src-tauri/tauri.conf.json` 的 `devUrl` 为 `http://localhost:5175`，与 `vite.config.ts` 的 dev 端口一致。

## 代码风格与命名

- React + TypeScript：严格模式（`tsconfig.app.json`），ES Modules，组件与 hooks 命名可读，避免 `any` 扩散。
- Rust：Edition 2024；类型 PascalCase、函数 `snake_case`，公共函数优先返回 `Result`。
- CSS：优先使用 `flowcloudai-ui` 的 CSS token，不以像素级硬编码为主。
- `docs/前端风格指南.md` 的前端红线优先级高于仓库局部规范。

## 目录结构与职责

```text
app_main/
├── src/
│   ├── api/                  # API 封装：只允许这里访问 Tauri 命令
│   ├── app/                  # 应用外壳（desktop / index / mobile）
│   ├── features/             # 业务域模块
│   ├── i18n/                 # 国际化资源与初始化
│   ├── pages/                # 页面级组件
│   ├── shared/               # 公共 UI / 工具 / hooks
│   ├── main.tsx
│   └── App.css
├── src-tauri/
│   ├── src/apis/             # Tauri Command 分组
│   ├── src/ai_services        # AI 上下文、Artifact 与矛盾检测
│   ├── src/layout/           # 关系图布局服务
│   ├── src/map/              # 地图生成与持久化
│   ├── src/tools/            # AI 工具注册
│   └── tauri.conf.json
├── docs/                     # 设计文档
└── package.json
```

## 前后端约定

- 前端仅通过 `src/api` 与后端交互；新增后端命令必须：
  - 在 `src-tauri/src/apis/*` 中实现命令；
  - 在 `src-tauri/src/lib.rs` 注册；
  - 在 `src/api/*` 添加对应封装。
- AI 会话事件建议保留订阅：`ai:ready`、`ai:delta`、`ai:reasoning`、`ai:tool_call`、`ai:tool_result`、`ai:turn_begin`、`ai:turn_end`、`ai:error`、`backend-ready`。

## 安全 / 禁止事项

- 不提交真实 API Key；`settings.json` 不应存储密钥。
- `fcimg://` 访问协议要保留路径白名单与归一化校验。
- 后端发布默认禁用 WebView 右键菜单，不得在仓库层面解除。
- 不提交 `target/`、`dist/`、`node_modules/`、本地 `data.db` 等运行产物。

## 项目特有坑点

- `tauri.conf.json` 中窗口透明 + 无边框设置与启动时 `showWindow` 时序相关，改 UI 显示顺序前先确认 `main.tsx` 初始化链路。
- 修改 `app/src-tauri/` 中插件安装/卸载逻辑时，须确认关闭活跃 AI 会话后再执行。
- `main.tsx` 与 `src-tauri/capabilities` 组合决定安全行为，新增能力需同步后端配置。

## 贡献方式

- 提交前至少执行：
  - `npm run lint`
  - `npm run build` 或 `npm run tauri -- build`
  - `cd src-tauri && cargo test`
- PR 说明需写明受影响页面、命令、测试与未覆盖风险。
