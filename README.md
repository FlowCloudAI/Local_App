# 流云AI（FlowCloudAI）

流云AI 是面向创作工作流的本地优先桌面应用，整合了项目管理、词条体系、关系图、地图、快照和 AI 会话能力，目标是把文本创作到 AI
辅助的关键步骤放在一个入口内完成。  
应用基于本地 SQLite 与 Tauri 沙箱模型运行，插件化 AI 通过 `.fcplug` 扩展。

## 项目简介（1-3 句）

`app_main` 以 `projects -> entries -> relations -> timeline/map -> ai-chat -> snapshots` 的链路组织创作流程。  
桌面端前端由 React 提供交互层，核心事件通过 Rust 后端封装为稳定命令与事件流。

## 快速开始

### 安装与运行

```bash
cd app_main
npm install
npm run tauri -- dev
```

### 前端单独调试（仅资源验证）

```bash
cd app_main
npm run dev
```

### 仅构建

```bash
cd app_main
npm run build
```

### 最小验证示例

1. 启动应用后创建一个新项目；
2. 在项目内新增一个词条并建立一条关系；
3. 打开快照并确认可恢复回退。

## 主要功能 / 使用方式

- 项目与词条：分类、标签、类型、关系与批量编辑。
- 可视化：关系图、时间线、地图与快照回溯。
- AI 协作：LLM 对话、工具调用、推理片段与会话分支。
- 插件能力：本地 `.fcplug` 管理、安装卸载、引用计数保护。
- 数据导出与恢复：本地会话与数据可回退。

## 技术栈

- 前端：TypeScript 5.9、React 19、Vite 6
- 桌面：Tauri 2、Rust 2024、Tokio
- 数据：SQLite（本地）
- UI：`flowcloudai-ui`
- AI 与插件：`flowcloudai_client`、`.fcplug`

## 目录结构（顶层）

```text
app_main/
├── src/
│   ├── api/                 # API 封装
│   ├── app/                 # 桌面与移动外壳
│   ├── features/            # 业务域
│   ├── i18n/                # 国际化资源
│   ├── pages/               # 页面级组件
│   ├── shared/              # 公共组件与 hooks
│   ├── App.css
│   └── main.tsx
├── src-tauri/               # Rust 后端与命令
└── package.json
```

## 许可证

仓库未在根级给出独立 LICENSE，当前以子项目/仓库声明为准。

## 贡献方式

- 修改前阅读 `docs/前端风格指南.md`。
- 常用检查：`npm run lint`、`npm run build`、`cd src-tauri && cargo test`。
- PR 说明中写明影响页面、命令链路与未覆盖场景。
