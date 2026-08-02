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
├── designs/           # 正式界面修改前的单文件 HTML 设计稿
├── src/               # 页面、路由、编辑器与状态层
├── src-tauri/         # Tauri 命令、窗口、文件、插件桥接
├── public/            # 前端静态资源
├── scripts/           # 构建与联调脚本
└── dist/              # 前端产物（不提交）
```

## 界面设计稿约定

当界面改动需要先确定布局、信息层级、响应式行为或交互入口时，正式修改 React / CSS 前先制作可审计的 HTML 设计稿；用户明确要求直接实现或仅做局部样式修正时可跳过。

- 用户提出“视觉规划 / 设计稿 / 界面方案”时，默认交付物就是 `designs/` 下的 HTML，而不是聊天中的图片生成结果、文字描述或临时原型；只有用户明确要求图片方案时才使用图片稿。
- 不默认使用 Figma 或其他外部设计工具。除非用户明确指定，否则设计稿统一保存到 `app_main/designs/<主题名>.html`，不得放在临时目录或 `.codex/visualizations/`。
- 每份设计稿必须是易于直接编辑和通过 `file://` 打开的单文件 HTML：CSS 与必要的少量 JavaScript 全部内联，不依赖构建步骤、包管理器、CDN、网络资源或额外素材文件。
- 设计稿用于确认最终布局与交互，不是一次性线框图。应表达真实的信息层级、主要组件、宽屏与窄屏状态及关键交互；内容可以精简，但不能省略影响设计判断的区域。
- 设计前先核对真实入口、所属 Tab、触发动作和背后页面；不同 Tab、不同业务板块或不会同时出现的状态必须拆成独立设计稿，禁止为了展示方便拼成同一界面。浮层稿必须使用它实际出现时的页面作为背景上下文。
- 同一方案的后续反馈应原地修改同一个 HTML 文件；除非用户要求对比多个方向，否则不要为每轮反馈复制新文件。
- 优先用 CSS 自定义属性模拟 `--fc-*` 语义令牌，保持与应用主题、圆角、间距和控件密度一致；不在设计稿中复制生产组件实现或业务逻辑。
- 交付设计稿时提供文件路径并列出需要用户确认的关键点。用户确认后再按该文件实现正式界面；实现过程中若必须偏离已确认设计，应先说明原因和影响。

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

文档同步时间：2026-08-02 14:16:58 +08:00
