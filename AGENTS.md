# app_main — AGENTS.md

## 项目概览

`app_main` 是 FlowCloudAI 的桌面端主应用，基于 Tauri + React（TypeScript）提供世界观建模、关系图编辑、地图展示与插件入口。

## 构建 / 运行 / 测试 / lint

```bash
cd app_main
npm install
npm run lint
npm run build
npm run tauri -- dev
```

```bash
npm run tauri:build:windows
npm run tauri:build:windows:signed
npm run tauri:build:linux
npm run android:dev
npm run android:build:apk
npm run android:build:debug:x86_64
```

```bash
cd src-tauri
cargo check
cargo test
```

`app_main` 的前端命令以 `app_main/package.json` 为准，Rust 命令以 `app_main/src-tauri/Cargo.toml` 为准。

## 代码风格与命名约定

- 前端采用 ESM 严格模式与 React hook 优先结构。  
- Rust 使用 2024 Edition，类型名 `PascalCase`，函数与变量 `snake_case`，常量 `SCREAMING_SNAKE_CASE`。  
- 样式优先使用 `flowcloudai-ui` 的 `--fc-*` 设计 token，避免硬编码颜色、间距、阴影。  
- 前端逻辑仅通过 `src-tauri` 对外能力进行文件与系统边界访问。  

## 目录结构与模块职责

```text
app_main/
├── src/               # 页面、路由、编辑器与状态层
├── src-tauri/         # Tauri 命令、窗口、文件、插件桥接
├── public/            # 前端静态资源
├── scripts/           # 构建与联调脚本
└── dist/              # 前端产物（不提交）
```

## 安全 / 禁止事项

- 不提交真实 API Key、模型密钥、数据库连接串、签名私钥、用户隐私。  
- 不提交 `node_modules/`、`dist/`、`target/`、日志等可再生产物。  
- 不在前端模板中硬编码生产域名、鉴权参数或凭证。  

## 提交与 PR 规范

- 提交信息默认中文。  
- PR 说明需包含：`npm run lint`、`npm run build`、`cd src-tauri && cargo test` 结果与关键风险。  
- 涉及启动链路须补充白屏、窗口初始化和插件加载顺序核验。  

## 项目特有坑点

- `app_main/src-tauri/tauri.conf.json` 的 `devUrl` 与 `app_main/vite.config.ts` 的 `server.port` 必须对齐（`5175`），HMR 端口需对齐 `1421`。  
- 无边框透明窗口对初始化顺序敏感，常见白屏问题通常来自启动顺序和窗口可见性设置。  
- 不能混用大小写错误的插件目录名与 manifest，加载失败会表现为插件不可见。  

文档同步时间：2026-06-08 13:20:10 +08:00
