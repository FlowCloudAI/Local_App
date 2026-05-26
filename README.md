# 流云 AI 桌面端（app_main）

`app_main` 是 FlowCloudAI 的 Tauri 桌面应用主入口，聚焦世界观创作与 AI 协作流程。  
应用内整合项目管理、词条关系、时间线/地图、快照和插件生命周期。

## 项目简介（1-3 句）

该应用将创作流程从“项目建立”到“词条编辑/关系维护/地图校验/AI 对话”统一到同一窗口。  
后端 Rust 提供 `flowcloudai_client` 与 `core_world_data` 能力，前端通过 `src/api` 消费命令与事件。

## 快速开始

### 安装与启动

```bash
cd app_main
npm install
npm run tauri -- dev
```

### 开发验证

```bash
cd app_main
npm run lint
npm run build
cd src-tauri
cargo test
```

### 前端资源单独调试（仅资源验证）

```bash
cd app_main
npm run dev
```

## 主要功能 / 使用方式

- 项目管理：创建/编辑项目、版本化词条与关系。  
- 关系图与地图：图谱布局与地图编辑，支持导出与恢复。  
- AI 会话：支持多模型会话、工具调用、流式事件与状态面板。  
- 插件市场与安全策略：插件安装、更新、签名与引用校验。  
- 反馈与快照：本地快照、恢复与导出回放。  

## 技术栈

- 前端：TypeScript 5.9、React 19、Vite 6、React Router、`flowcloudai-ui`。  
- 桌面：Tauri 2、Rust 2024。  
- 数据与服务：本地 `SQLite`（Rust side）与 `core_world_data`、`core_ai_client`。

## 目录结构（顶层）

```text
app_main/
├── src/
│   ├── api/                  # Tauri API 封装
│   ├── app/                  # 壳层与页面路由
│   ├── features/             # 各业务模块
│   ├── i18n/                 # 国际化
│   ├── pages/                # 页面级组件
│   ├── shared/               # 共享组件与工具
│   ├── App.css
│   └── main.tsx
└── src-tauri/
    ├── src/
    │   ├── apis/
    │   ├── ai_services/
    │   ├── layout/
    │   ├── map/
    │   ├── senses/
    │   ├── tools/
    │   ├── reports/
    │   ├── auto_backup.rs
    │   ├── state.rs
    │   ├── settings.rs
    │   ├── template.rs
    │   ├── lib.rs
    │   ├── api_error.rs
    │   └── main.rs
    └── tauri.conf.json
```

## 许可证

本目录未单独声明完整 LICENSE，按仓库主策略执行。

## 贡献方式

- 修改前先阅读本仓库与模块 `AGENTS.md`。  
- AI 功能或启动流程变更需补充重现步骤与 `backend-ready` 验证。  
- 提交前执行至少一次 `npm run lint`、`npm run build`、`cd src-tauri && cargo test`。
