# app_main — AGENTS.md

> 面向 AI 编码助手的开发约定；README 面向用户。

## 项目概览

`app_main` 是 FlowCloudAI 的桌面主应用（Tauri 2 + React + Rust）。  
前端通过 `src/api` 与 Rust Command 交互，承载项目管理、词条关系图、地图、快照、AI 会话、插件与反馈主流程。

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

`npm run dev` 仅用于前端资源验证，不替代完整桌面端联调。  
`app_main/src-tauri/tauri.conf.json` 的 `build.devUrl` 为 `http://localhost:5175`，需与 `vite.config.ts` 端口一致。

## 代码风格与命名

- TypeScript/React 优先走 `strict` 配置，避免 Redux / Zustand；统一通过 `src/api` 与后端交互。  
- Rust Edition 2024，类型 `PascalCase`，函数与变量 `snake_case`。  
- 样式优先使用 `flowcloudai-ui` 体系 token，避免硬编码数值和颜色。  
- 前端变更优先对齐仓库内既定组件与演示约束，避免引入外部不一致规范。

## 目录结构与职责

```text
app_main/
├── src/
│   ├── api/                  # API 封装（唯一 Tauri 对接层）
│   ├── app/                  # 桌面壳层与移动端外壳
│   ├── features/             # 业务域（项目、词条、关系图、地图、AI 等）
│   ├── i18n/                 # 国际化资源
│   ├── pages/                # 页面级组件
│   ├── shared/               # 共享组件与工具
│   ├── App.css
│   └── main.tsx
├── src-tauri/
│   ├── src/
│   │   ├── apis/             # Tauri Command 分组
│   │   ├── ai_services/      # AI 事件与上下文
│   │   ├── layout/           # 布局与坐标服务
│   │   ├── map/              # 地图生成与持久化
│   │   ├── senses/           # 三类 Sense 实现
│   │   ├── tools/            # AI 工具执行
│   │   ├── reports/          # 报表相关逻辑
│   │   ├── state.rs
│   │   ├── settings.rs
│   │   ├── template.rs
│   │   ├── auto_backup.rs
│   │   ├── api_error.rs
│   │   ├── lib.rs
│   │   └── main.rs
│   ├── tauri.conf.json
│   └── resources
└── docs/                    # 说明文档
```

## 前后端与事件约定

- 新增后端 Command 时同步更新：`src-tauri/src/apis/*`、`src-tauri/src/lib.rs`、`src/api/*`。  
- AI 会话相关事件以 `backend-ready` 为前置门槛，涉及数据库/会话状态的前端行为必须等待该事件后再执行。
- 常见事件：`ai:ready`、`ai:delta`、`ai:reasoning`、`ai:tool_call`、`ai:tool_result`、`ai:turn_begin`、`ai:turn_end`、`ai:error`。

## 安全 / 禁止事项

- 不提交真实 API Key、`settings.json` 中敏感字段、`data.db`、`target`、`dist`、`node_modules`。  
- 不放宽 WebView 安全策略，不在仓库层取消右键/上下文菜单约束。  
- `fcimg://` 文件协议必须保留白名单与路径归一化校验，防止目录穿越。

## 项目特有坑点

- 无边框透明窗口下，`main.tsx` 与 `show_window` 时序会直接影响启动白屏。  
- 卸载插件前需确认会话引用与事件订阅已退出，避免悬挂调用。  
- 修改 `src-tauri` 后优先跑 `backend-ready` 场景，再验证 AI 会话链路。

## 贡献方式

- 提交前至少执行：`npm run lint`、`npm run build`、`cd src-tauri && cargo test`。  
- PR 说明写明：影响页面、命令链路、初始化顺序、未覆盖风险。

## 文档同步依据（本次自动核对）

- 同步时间：2026-05-26 17:02:35 +08:00
- 依据文件：app_main/package.json, app_main/vite.config.ts, app_main/src-tauri/Cargo.toml, app_main/src-tauri/tauri.conf.json
