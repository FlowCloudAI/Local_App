# app_main — AGENTS.md

## 项目概览

`app_main` 是 FlowCloudAI 的桌面主应用仓库（Tauri + React），负责统一承载世界观编辑、关系图、地图与快照工作台，并协调 AI 会话、插件生命周期与桌面端运行时行为。  
主要职责是保证前后端协同稳定、启动序列可复现，并将核心能力链路正确回写到界面。

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

可选（移动端验证）：

```bash
cd app_main
npm run android:dev
npm run android:build:apk
npm run android:build:debug:x86_64
```

## 代码风格与命名约定

- TypeScript/React 使用 ESM + TypeScript 严格模式，优先按 hook 与视图层职责分离。  
- Rust 遵循 Rust 2024，类型名 `PascalCase`，函数/变量 `snake_case`，常量 `SCREAMING_SNAKE_CASE`。  
- 样式优先复用 `flowcloudai-ui` 的 `--fc-*` token，避免新增硬编码色值、间距和阴影。  
- 前端与 `src-tauri` 按事件边界通信，不在前端层直接复写持久化或权限逻辑。  

## 目录结构与模块职责

```text
app_main/
├── src/                  # 前端页面、状态、路由与工具入口
├── src-tauri/            # Tauri 后端桥接、命令与持久化模块
├── public/               # 前端静态资源
├── scripts/              # 构建与联调脚本
├── docs/                 # 仓库文档
└── todo/                 # 任务草稿与待办清单
```

## 安全 / 禁止事项

- 不提交真实 API Key、模型密钥、数据库连接串、签名私钥与用户敏感数据。  
- 不提交 `node_modules/`、`dist/`、`target/`、日志文件与临时产物。  
- 禁止在前端模板硬编码生产域名、密钥或鉴权 token。  
- 环境变量优先从运行环境注入，禁止写死在源码。  

## 提交与 PR 规范

- 提交信息默认中文，单次 PR 聚焦单一问题域。  
- PR 说明需附 `npm run lint`、`npm run build`、`cd src-tauri && cargo test` 的执行结论。  
- 涉及启动链路修改需额外说明 `backend-ready`、窗口初始化、插件加载顺序与回归步骤。  
- 避免把构建系统重构与核心行为改动放入同一 PR。  

## 项目特有坑点

- `app_main/src-tauri/tauri.conf.json` 与 `app_main/vite.config.ts` 的端口与 HMR 约束需一致（`5175` 与 `1421`）。  
- 无边框透明窗口对启动顺序非常敏感，初始化失败会出现白屏或闪烁。  
- Android/iOS 运行时需核验 `TAURI_DEV_HOST` 与 HMR 配置是否匹配。  
- 插件相关问题常见于 manifest 字段和能力映射不一致，需同步核对。  

## 文档同步依据（本次核对）

- 同步时间：2026-06-04 17:03:10 +08:00
- 依据文件：`app_main/package.json`、`app_main/vite.config.ts`、`app_main/src-tauri/Cargo.toml`、`app_main/src-tauri/tauri.conf.json`、`app_main/src`、`app_main/src-tauri/src`
