# app_main — AGENTS.md

> 面向 AI 编码助手的开发约定；README 面向用户。

## 项目概览

`app_main` 是 FlowCloudAI 桌面主应用（Tauri 2 + React + Rust），负责项目/词条/关系图/地图/快照、AI 会话、插件市场与帮助中心的主业务。
前端通过 `src/api` 与 Rust 命令交互，不直接在 React 层调用 Tauri invoke。

## 构建 / 运行 / 测试 / lint

```bash
cd app_main
npm install
npm run lint
npm run build
npm run tauri -- dev
npm run tauri -- build

cd src-tauri
cargo test
```

`app_main/src-tauri/tauri.conf.json` 的 `devUrl` 目前是 `http://localhost:5175`，配套 `vite.config.ts` 也应保持一致。

## 代码风格与命名

- TypeScript/React 严格模式，ES Modules，避免引入 Redux / Zustand。
- Rust Edition 2024，类型 PascalCase，函数变量 snake_case。
- CSS 优先使用 `flowcloudai-ui` 设计 token，减少硬编码值。
- 前端改动优先检查 `docs/前端风格指南.md`。

## 目录结构与职责

```text
app_main/
├── src/
│   ├── api/                  # 前端 API 封装（唯一对接层）
│   ├── app/                  # 桌面端与移动端外壳
│   ├── features/             # 业务域（词条、图谱、地图、插件等）
│   ├── i18n/                 # 国际化
│   ├── pages/                # 页面级组件
│   ├── shared/               # 公共组件与工具
│   ├── App.css
│   └── main.tsx
├── src-tauri/
│   ├── src/
│   │   ├── apis/             # Tauri Command 分组
│   │   ├── ai_services/      # AI 上下文、事件与会话桥接
│   │   ├── layout/           # 布局与坐标服务
│   │   ├── map/              # 地图生成与持久化逻辑
│   │   ├── tools/            # 工具执行与注册
│   │   ├── reports/          # 报表相关逻辑
│   │   ├── senses/           # 感知相关模块
│   │   ├── state.rs
│   │   ├── settings.rs
│   │   ├── template.rs
│   │   ├── auto_backup.rs
│   │   ├── api_error.rs
│   │   ├── lib.rs
│   │   └── main.rs
│   ├── tauri.conf.json
│   ├── icons
│   └── resources
├── docs/                    # 设计文档
└── package.json
```

## 前后端与事件约定

- 命令新增时同步 `src-tauri/src/apis/*`、`src-tauri/src/lib.rs`、`src/api/*`。
- AI 会话建议订阅：`ai:ready`、`ai:delta`、`ai:reasoning`、`ai:tool_call`、`ai:tool_result`、`ai:turn_begin`、`ai:turn_end`、
  `ai:error`、`backend-ready`。

## 安全 / 禁止事项

- 不提交 API Key、对话历史明文、`settings.json` 中敏感配置。
- `fcimg://` 文件协议保持路径归一化与白名单校验。
- 不能放宽 WebView 安全策略或在仓库层取消发布端右键限制。
- 不提交 `dist/`、`target/`、`node_modules/`、本地测试数据库文件。

## 项目特有坑点

- 窗口是无边框透明窗口，`main.tsx` 与 `showWindow` 的顺序直接影响启动白屏体验。
- 触发插件卸载时需确认会话与插件引用状态已释放。
- 修改 `src-tauri` 时建议在 `backend-ready` 后再执行依赖 AI 状态的前端行为验证。

## 贡献方式

- 提交前优先执行：`npm run lint`、`npm run build`、`cd src-tauri && cargo test`。
- PR 说明写明：影响页面、命令、初始化链路、未覆盖风险。
