# 流云AI 桌面端（app_main）

`app_main` 是桌面端主入口，用于世界观项目管理、词条关系编辑、地图与快照展示，以及 AI 会话与插件功能的统一入口。  
前端（React）和 Rust 后端在同仓内联调，形成从建模、调用到反馈的单一桌面工作流。

## 快速开始

### 安装与启动

```bash
cd app_main
npm install
npm run tauri -- dev
```

### 开发校验

```bash
cd app_main
npm run lint
npm run build
cd src-tauri
cargo test
```

### 最小示例

1. 按安装与启动命令启动桌面端。
2. 创建一个世界观项目并新增词条。
3. 打开关系图并检查节点和边变化。
4. 发起一次 AI 会话，确认 `AI` 消息和会话状态可回写界面。

## 主要功能 / 使用方式

- 世界观项目管理与词条关系图。
- 地图与快照管理。
- AI 对话、工具调用与状态回写。
- 插件加载与会话生命周期管理。
- 会话导出与反馈入口。

## 技术栈

- 前端：React、TypeScript、Vite、`flowcloudai-ui`。
- 桌面：Tauri 2、Rust 2024。
- 后端依赖：Tokio、数据库与插件消息通道。

## 目录结构（仅顶层）

```text
app_main/
├── src/
├── src-tauri/
└── docs/
```

## 许可证与贡献方式

许可证信息以子仓库声明为准。  
提交前补充 lint/build/test 结果，并注明是否触发后端初始化顺序或 AI 事件链变更。
