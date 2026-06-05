# app_main — AGENTS.md

## 项目概览

`app_main` 是 FlowCloudAI 的桌面端主应用（Tauri + React），承担世界观编辑、关系图、地图与快照、插件加载等核心交互入口。  
前端与 `src-tauri` 通过事件与命令边界联动，目标是保持启动、插件加载和会话回写行为稳定。

## 构建 / 运行 / 测试 / lint

```bash
cd app_main
npm install
npm run lint
npm run build
npm run tauri -- dev
npm run tauri -- build
npm run tauri:build:windows
npm run tauri:build:linux
npm run android:dev
npm run android:build:apk
npm run android:build:debug:x86_64

cd src-tauri
cargo build
cargo check
cargo test
```

## 代码风格与命名约定

- TypeScript/React 使用 ESM 严格模式，优先按 hook 与 UI 状态分层组织。  
- Rust 使用 Rust 2024，类型 `PascalCase`，函数/变量 `snake_case`，常量 `SCREAMING_SNAKE_CASE`。  
- 样式优先复用 `flowcloudai-ui` 的 `--fc-*` token，减少硬编码颜色、尺寸与阴影。  
- 不在前端层直接改持久化和权限判定逻辑，统一经由 `src-tauri` 命令交互。  

## 目录结构与模块职责

```text
app_main/
├── src/               # 页面、状态、路由与交互逻辑
├── src-tauri/         # Tauri 命令、窗口、文件与插件桥接
├── public/            # 前端静态资源
├── scripts/           # 构建与联调脚本
├── docs/              # 仓库级文档
└── todo/              # 待办与草稿
```

## 安全 / 禁止事项

- 不提交真实 API Key、模型密钥、数据库连接串、签名私钥和用户隐私数据。  
- 不提交 `node_modules/`、`dist/`、`target/`、日志与临时产物。  
- 不在模板中硬编码生产域名、鉴权参数或密钥。  
- 更新签名与私钥由环境变量注入，不写死在源码。  

## 提交与 PR 规范

- 提交信息默认中文，单次 PR 聚焦单一问题域。  
- PR 说明需包含 `npm run lint`、`npm run build`、`cd src-tauri && cargo test` 的执行结论。  
- 涉及启动链路变更需额外说明窗口初始化、后端就绪与插件加载顺序。  

## 项目特有坑点

- `src-tauri/tauri.conf.json` 的 `devUrl:5175` 与 `vite.config.ts` 的 `port:5175`、HMR `port:1421` 必须匹配。  
- 无边框透明窗口对启动顺序非常敏感，常见白屏/闪烁。  
- 插件 manifest 字段与能力映射不一致时易导致加载失败。  
- `fcplug` 与 `fcworld` 文件关联与 updater 行为强相关，发布前需联调验证。  

文档同步时间：2026-06-05 12:44:21 +08:00
