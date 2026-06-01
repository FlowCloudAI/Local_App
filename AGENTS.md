# app_main — AGENTS.md

## 项目概览

`app_main` 是 FlowCloudAI 桌面主应用，基于 Tauri 2 + React + Rust，承载世界观创作主流程与 AI 插件会话联动。  
本仓库的目标是统一前端状态、Rust 命令层和持久化/插件能力的启动时序与生命周期。

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
cargo test
```

`app_main` 的 `vite` 前端调试命令可用于页面级验证，但不应替代完整 Tauri 调试链路。  
`app_main/src-tauri/tauri.conf.json` 与 `app_main/vite.config.ts` 的端口（`5175`）应保持一致。

## 代码风格与命名约定

- TypeScript/React 使用 ESM 与严格模式，状态管理优先靠 hook 组织，避免引入额外全局状态框架。
- Rust 遵循 Edition 2024 风格，类型 `PascalCase`，函数与变量 `snake_case`。
- `flowcloudai-ui` 尽量通过 package 名消费，避免源码级跨包引用导致运行时上下文冲突。
- 禁止在代码层绕过 `cargo fmt` 的约束。

## 目录结构与模块职责

```text
app_main/
├── src/                 # 前端页面、状态与调用入口
├── src-tauri/           # Tauri 命令、后端服务、文件与插件桥
│   ├── src/apis         # API command 分组
│   ├── src/ai_services  # AI 事件转换与流式输出
│   ├── src/tools        # 工具执行与超时治理
│   ├── src/layout       # 视图结构与主题
│   └── src/lib.rs       # 命令注入入口
└── docs/                # 说明、约定与记录
```

## 前后端与 AI 事件约定

- 修改前端 `src/api/*` 或后端 `src-tauri/src/apis/*` 时，同时确认事件通道与调用时序。
- AI 会话关键事件链包含：`ai:ready`、`ai:delta`、`ai:reasoning`、`ai:tool_call`、`ai:tool_result`、`ai:turn_begin`、
  `ai:turn_end`、`ai:error`、`ai:debug_raw_response`、`ai:contradiction_progress`。
- `backend-ready` 未就绪前不得触发会话创建与数据库写入类动作。

## 安全 / 禁止事项

- 不提交真实 API Key、第三方服务密钥、`settings.json` 中敏感字段。
- 不提交 `node_modules`、`dist`、`target`、`.log`、凭据模板。
- 文件路径（如 `fcimg` 等）保持白名单与目录规范化校验，避免路径穿越。
- 未经许可不要长期使用 `npm run dev` 替代完整桌面联调。

## 贡献方式与 PR 规范

- 提交前至少提供：`npm run lint`、`npm run build`、`cd src-tauri && cargo test`。
- PR 说明要包含变更范围、事件链影响、后端初始化顺序验证、未覆盖风险。
- 提交信息默认中文，单一变更目标一条提交。

## 文档同步依据（本次核对）

  - 同步时间：2026-06-01 17:06:05 +08:00  
- 依据文件：`app_main/package.json`、`app_main/vite.config.ts`、`app_main/src-tauri/Cargo.toml`、
  `app_main/src-tauri/tauri.conf.json`
