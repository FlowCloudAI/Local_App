# 流云AI 桌面端（app_main）

`app_main` 是 FlowCloudAI 的桌面端主仓库（Tauri + React），为世界观编辑、关系图、地图与快照、插件加载和 AI 会话提供统一交互入口。前端和 Rust 后端共存于同一工程，支持从本地工作流到桌面打包发布的完整链路。

## 项目简介

仓库按“界面层 + 桌面桥接层”职责切分。`src` 承担页面、状态与交互逻辑，`src-tauri` 承载窗口、文件、外部服务与插件运行时交互。更新需重点关注启动时序，避免透明窗口白屏。

## 快速开始

### 安装与启动（最小路径）

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
cargo build
cargo test
```

### 最小示例

1. 完成世界观初始化后，创建 2 个实体并连线。  
2. 启动一次 AI 会话并确认状态回写。  
3. 使用插件加载/卸载验证 `src-tauri` 与前端事件链一致。  

## 主要功能 / 使用方式

- 世界观项目、实体与关系图编辑。  
- 地图与快照展示与复原流程。  
- AI 会话、工具调用与会话状态同步。  
- 插件安装、配置与生命周期联动。  
- 无边框透明窗口场景下的启动与初始化管理。  

## 技术栈

- React 19 + TypeScript + Vite  
- Tauri 2 + Rust 2024  
- `flowcloudai-ui`、`@deck.gl`、`pixi.js`  

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

- 许可证：当前仓库未发现独立 `LICENSE` 文件（TODO：确认统一授权策略）。  
- 贡献前需补充 `npm run lint`、`npm run build`、`cd src-tauri && cargo test` 与最小回归结果。  
- PR 建议说明：启动序列影响、异常复现场景、兼容性边界与风险。  

文档同步时间：2026-06-03 21:04:46 +08:00
