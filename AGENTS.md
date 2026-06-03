# app_main — AGENTS.md

## 项目概览

`app_main` 是 FlowCloudAI 的桌面主应用仓库（Tauri + React）。  
该仓库承载世界观项目、关系图、地图与快照的入口逻辑，以及后端事件与插件生命周期协同。

## 构建 / 运行 / 测试 / lint

```bash
cd app_main
npm install
npm run lint
npm run build
npm run tauri -- dev
npm run tauri -- build

cd src-tauri
cargo build
cargo check
cargo test
```

## 代码风格与命名约定

- TypeScript/React 使用 ESM 严格模式，优先拆分 hook 与渲染逻辑。  
- Rust 遵循 Edition 2024，类型名 `PascalCase`，函数变量 `snake_case`，常量 `SCREAMING_SNAKE_CASE`。  
- 样式优先使用 `flowcloudai-ui` 的 `--fc-*` Token，避免新增硬编码样式值。  

## 目录结构与模块职责

```text
app_main/
├── src/
│   ├── api/          # API 与事件桥接
│   ├── app/          # 应用入口与状态组织
│   ├── features/     # 功能域模块
│   ├── i18n/         # 国际化
│   ├── pages/        # 页面/路由
│   └── shared/       # 通用逻辑与工具
├── src-tauri/
│   ├── src/apis
│   ├── src/ai_services
│   ├── src/document_context
│   ├── src/layout
│   ├── src/map
│   ├── src/reports
│   ├── src/senses
│   ├── src/tools
│   └── tauri.conf.json
└── scripts/
```

## 安全 / 禁止事项

- 不提交真实 API Key、模型密钥、数据库账号与敏感配置。  
- 不提交 `node_modules/`、`dist/`、`target/`、日志文件。  
- 严格控制 `backend-ready` 前的副作用（如会话初始化与本地写库）。  

## 提交与 PR 规范

- 提交信息默认中文，单次变更聚焦单一目标。  
- PR 说明应写清：
  - 初始化时序影响（`backend-ready`、AI 事件链）
  - `npm run lint`、`npm run build`、`cd src-tauri && cargo test` 结果
  - 回归场景与风险边界  
- 避免一次 PR 覆盖构建系统与业务逻辑双重重构。  

## 项目特有坑点

- `app_main/src-tauri/tauri.conf.json` 与 `app_main/vite.config.ts` 的 `5175`/`1421` 需一致。  
- 窗口为无边框透明模式，启动顺序错误会出现白屏或闪烁。  
- Android/iOS 开发需同时核验 `TAURI_DEV_HOST` 与 HMR 路由。  

## 文档同步依据（本次核对）

- 同步时间：2026-06-03 16:28:02 +08:00
- 依据文件：`app_main/package.json`、`app_main/vite.config.ts`、`app_main/src-tauri/Cargo.toml`、`app_main/src-tauri/tauri.conf.json`、`app_main/src`、`app_main/src-tauri/src`
