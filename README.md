# 流云AI 桌面端（app_main）

`app_main` 是 FlowCloudAI 的主桌面应用，提供世界观项目、关系图、AI 会话与插件生命周期的统一入口。  
前后端（React + Rust）在同仓库协同，兼顾启动时序与主窗口交互稳定性。

## 项目简介

该仓库负责编排桌面端核心体验：项目创建、关系与世界观编辑、地图/快照呈现，以及与插件与 AI 后端事件的交互桥接。

## 快速开始

### 安装与启动

```bash
cd app_main
npm install
npm run tauri -- dev
```

### 最小示例

1. 运行桌面端并完成一个本地登录/初始化流程。  
2. 创建世界观项目与至少两个实体关系。  
3. 发起一次 AI 对话并确认会话状态回写到界面。  

## 主要功能 / 使用方式

- 世界观项目与关系图管理。  
- 地图与快照查看。  
- AI 会话与工具调用。  
- 插件加载与生命周期管理。  
- `backend-ready` 触发下的初始化顺序校验。  

## 技术栈

- React 19、TypeScript、Vite。  
- Tauri 2、Rust 2024、`flowcloudai-ui`。  

## 目录结构（仅顶层）

```text
app_main/
├── src/
├── src-tauri/
└── scripts/
```

## 许可证与贡献方式

- 许可证与依赖声明按子仓库约定。  
- 贡献前需补充 `npm run lint`、`npm run build`、`cd src-tauri && cargo test`（必要时含 `cargo check`）结果。  
- PR 说明需明确 AI 事件链与启动时序影响。  

文档同步时间：2026-06-03 16:28:02 +08:00
