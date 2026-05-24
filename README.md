# 流云AI（FlowCloudAI）

流云AI 是一款本地优先的创作工作台，面向小说、剧本、游戏设定等长期文本型创作，核心价值是把词条系统、关系图、地图编辑、AI 辅助与插件模型接入放到同一个桌面应用里，减少跨工具切换和上下文丢失。

## 简介（1-3 句）

应用使用 Tauri 2 + React + TypeScript + Rust，数据默认落到本地 SQLite，插件化 AI 能力来自 `.fcplug`。
它的交互围绕“项目-词条-关系-地图-会话”组织，支持从文本创作到插件管理再到图像与音频生成的一体化流程。

## 快速开始

### 环境要求

- Node.js（建议与仓库一致的 LTS）
- Rust stable（用于 Tauri 后端编译）

### 安装与运行

```bash
cd app_main
npm install
npm run tauri -- dev
```

### 前端单独运行

```bash
cd app_main
npm run dev
```

### 仅构建

```bash
cd app_main
npm run build
```

### 最小示例（快速验证）

1. 启动后创建一个新项目。
2. 在项目内新增一个词条并建立关系。
3. 打开快照并确认可生成并恢复版本。

## 主要功能 / 使用方式

- **项目与词条管理**：多项目切换、词条分类、标签、类型与版本化关系。
- **关系图与可视化**：词条关系图、时间线、地图形状编辑、快照回溯。
- **AI 协作**：LLM 对话、工具调用、推理片段、会话分支回溯。
- **插件市场与模型管理**：本地安装 `.fcplug`、远程插件市场同步、引用计数保护。
- **多媒体能力**：文生图、图像编辑与语音合成（由插件提供）。

## 技术栈

- TypeScript 5.9 + React 19 + Vite 6
- Tauri 2 + Rust Edition 2024
- 后端：`flowcloudai_client` 与 `worldflow_core`
- 组件与样式：`flowcloudai-ui`
- 数据库：SQLite（本地）
- AI 接口：WASM 插件（`.fcplug`）

## 目录结构（顶层）

```text
app_main/
├── src/                 # 前端源码
│   ├── api/             # API 封装
│   ├── app/             # 桌面/移动外壳
│   ├── features/        # 业务模块
│   ├── i18n/            # 国际化
│   └── shared/          # 公共组件与工具
├── src-tauri/           # Rust 后端、命令、数据库与权限
├── docs/                # 内部设计文档
└── package.json
```

## 许可证

MIT License（详见仓库声明）。

## 贡献方式

- 变更前先阅读 [`docs/前端风格指南.md`](docs/前端风格指南.md)。
- 常用检查：
  - `npm run lint`
  - `npm run build` 或 `npm run tauri -- build`
  - `cd src-tauri && cargo test`
- PR 中说明你影响的命令、AI 流程和未覆盖场景。
