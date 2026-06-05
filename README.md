# 流云AI 桌面端（app_main）

`app_main` 是 FlowCloudAI 的桌面端主仓库（Tauri + React），提供世界观编辑、关系图、地图快照和插件协作的统一界面，连接 AI 客户端与本地持久化层。

## 项目简介

仓库由前端（`src`）与桌面后端（`src-tauri`）组成，适合从世界观编辑到桌面发布的一体化工作流。  
在改动启动链路或插件加载入口时，优先验证透明窗口初始化与状态回写路径，避免首屏异常。

## 快速开始

### 安装与启动

```bash
cd app_main
npm install
npm run tauri -- dev
```

### 基础校验

```bash
npm run lint
npm run build
cd src-tauri
cargo check
cargo test
```

### 最小示例

1. 启动桌面端后创建一个世界观项目。  
2. 添加 2 个实体和一条关系。  
3. 发起一次 AI 会话并确认事件回写到前端状态。  

## 主要功能 / 使用方式

- 世界观项目与实体关系编辑。  
- 地图、快照与关系可视化。  
- AI 会话状态、插件能力与运行时桥接。  
- 构建桌面版本并支持自动更新流程。  

## 技术栈

- React 19 + TypeScript + Vite  
- Tauri 2 + Rust 2024  
- `flowcloudai-ui` 与 `deck.gl` / `pixi.js`  

## 目录结构（仅顶层）

```text
app_main/
├── src/
├── src-tauri/
├── public/
├── scripts/
├── docs/
└── todo/
```

## 许可证与贡献方式

- 许可证：本仓库未发现独立 `LICENSE`，按仓库当前授权策略执行。  
- PR 建议提交：`npm run lint`、`npm run build` 与关键手工复现步骤。  
- 提交信息默认中文，说明启动顺序、异常复现场景与回退方案。  

文档同步时间：2026-06-05 12:44:21 +08:00
