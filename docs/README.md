# app_main 文档索引

> 更新日期：2026-08-19
>
> 本索引覆盖 `app_main` 全部项目文档：`docs/`、`plans/`、`designs/`。
> 平台构建手册（iOS / macOS / Android）是 `AGENTS.md` 明确要求先读的前置文档，见 §1。

## 状态含义

| 状态 | 含义 |
| --- | --- |
| `现行` | 当前有效，可直接作为判断依据 |
| `排障` | 问题复盘纪要。根因与结论可参考，但不随代码更新，引用前核对现状 |
| `归档` | 已完成工作的过程记录，只用于追溯 |
| `结论记录` | 设计 QA，但视觉证据已丢失，只剩当时的判断 |

## 1. 平台构建、调试与发布（改构建链路前必读）

| 文档 | 状态 | 日期 | 说明 |
| --- | --- | --- | --- |
| [tauri_macos_debug_and_release.md](tauri_macos_debug_and_release.md) | 现行 | 2026-08-17 | macOS 原生窗口、调试、DMG、Developer ID 签名与公证边界。`AGENTS.md` 指定的 macOS 权威手册 |
| [tauri_ios_debug_and_release.md](tauri_ios_debug_and_release.md) | 现行 | 2026-08-17 | iOS 环境自检、真机调试、Archive 与 IPA 导出。`AGENTS.md` 指定的 iOS 权威手册。最低支持 iOS 16.2 |
| [Android.md](Android.md) | 现行 | 2026-05-07 | Android 测试流程与 ADB 约定，包名 `cn.flowcloudai.www` |
| [tauri_android_dev_debugging.md](tauri_android_dev_debugging.md) | 排障 | 2026-08-16 | `tauri android dev` 下模拟器 WebView 无法加载 Vite 的原因与固定启动方式。日常统一用 `npm run android:dev` |
| [publish.md](publish.md) | 现行 | 2026-05-27 | 桌面端 Windows 发布与 Tauri updater 签名、上传流程 |

## 2. 架构决策与开发规范

| 文档 | 状态 | 日期 | 说明 |
| --- | --- | --- | --- |
| [adr/0001-frontend-feature-modular-monolith.md](adr/0001-frontend-feature-modular-monolith.md) | 现行 | 2026-07-21 | ADR：前端功能模块化单体。`app` / `features` / `api` / `shared` 的边界与禁止跨模块复用界面内部实现 |
| [dock_panel_child_page_guide.md](dock_panel_child_page_guide.md) | 现行 | 2026-05-20 | 新增 `DockableSidePanel` 子页面的结构、样式与验证约定 |
| [ui_style_unification_plan.md](ui_style_unification_plan.md) | 现行 | 2026-05-20 | 长期视觉统一改造计划，基于 UI 库语义令牌建立统一视觉语言 |
| [plugin_system_guide.md](plugin_system_guide.md) | 现行 | 2026-05-07 | 插件系统两层架构与联调指南 |
| [prompt_README.md](prompt_README.md) | 现行 | 2026-05-07 | Prompt & Tools 模块结构：`context_builders` / Tera 模板 / `senses` |
| [agent-runtime-hardening.md](agent-runtime-hardening.md) | 现行 | 2026-08-01 | AI Agent 运行时加固：自动精简对话记忆，阈值 75% → 65% |

## 3. 地图与渲染

| 文档 | 状态 | 日期 | 说明 |
| --- | --- | --- | --- |
| [map_shader_pipeline.md](map_shader_pipeline.md) | 现行 | 2026-07-09 | **地图 Shader 渲染管线**：迁移动机、插件化双实现架构、10 个插件、水墨核心 GLSL、推荐配置与未完成项。由 `plans/` 下 12 篇同日文档合并。**注意 §6：所有加速倍数均为预估，基准测试从未执行** |
| [semantic_map_generation_design.md](semantic_map_generation_design.md) | 现行 | 2026-08-04 | 「用户调结果，后端管公式」的语义化控制与确定性渲染引擎设计。含 4 处未落地项 |
| [map_shape_editor_backend_mvp.md](map_shape_editor_backend_mvp.md) | 现行 | 2026-08-04 | MapShapeEditor Rust 后端 MVP。**顶部明确标注 3 个特性仍在设计阶段、MVP 未实现** |
| [coastline_algorithm_redesign.md](coastline_algorithm_redesign.md) | 现行 | 2026-06-13 | 海岸线自然化算法重构。方案 A 已落地为独立模块 `coastline_v2.rs`，v1 仍是默认 |
| [tauri_deterministic_layout_engine.md](tauri_deterministic_layout_engine.md) | 现行 | 2026-05-07 | 词条关系图确定性布局引擎的输入协议与算法 |
| [Ink.md](Ink.md) | 现行 | 2026-07-08 | 水墨（宣纸）预设的视觉优化分析。只谈视觉 |
| [Tolkien.md](Tolkien.md) | 现行 | 2026-07-08 | 托尔金（羊皮纸）预设的视觉优化分析。只谈视觉 |
| [Map_LOD.md](Map_LOD.md) | 归档 | 2026-05-26 | 地图 Pixi LOD 实现报告，降低大规模多边形预览的绘制压力 |

## 4. 移动端

| 文档 | 状态 | 日期 | 说明 |
| --- | --- | --- | --- |
| [Mobile_world.md](Mobile_world.md) | 现行 | 2026-08-02 | 移动端世界观/词条能力缺口与方案。§7 持续记录实现进展，含 10 处未完成项。总计划见 `../plans/ANDROID-01.md` |
| [mobile-native-ui-retrospective-2026-08-19.md](mobile-native-ui-retrospective-2026-08-19.md) | 排障 | 2026-08-19 | Android 真机接入、返回手势、AI 会话界面、底部浮层、iOS/Android 键盘布局的问题、根因、失败方案与验证边界。**当前最新的移动端问题总账** |
| [mobile_android_webview_paint_bug.md](mobile_android_webview_paint_bug.md) | 排障 | 2026-06-28 | Android WebView 光栅化 bug 导致标题/搜索被纵向压扁。**文中的 `translateZ(0)` 规避已于 2026-07-13 暂停，现状以根 `AGENTS.md` §5.1 为准** |
| [android_adaptive_icon_safe_zone_fix.md](android_adaptive_icon_safe_zone_fix.md) | 排障 | 2026-07-18 | Android 自适应图标安全区导致桌面图标过度放大 |
| [android_plugin_market_tls_verifier.md](android_plugin_market_tls_verifier.md) | 排障 | 2026-07-04 | Android release APK 插件库 TLS 校验失败 |
| [mobile_markdown_cursor_offset_fix.md](mobile_markdown_cursor_offset_fix.md) | 排障 | 2026-06-20 | 移动端 Markdown 编辑镜像层与 textarea 的光标偏移 |

## 5. 桌面端排障

| 文档 | 状态 | 日期 | 说明 |
| --- | --- | --- | --- |
| [test_issue.md](test_issue.md) | 排障 | 2026-06-03 | `cargo test` 的 `STATUS_ENTRYPOINT_NOT_FOUND` 根因：测试 exe 清单/链接问题，`cargo clean` 无效。结论已写入根 `AGENTS.md` §6 |
| [Map-Resize.md](Map-Resize.md) | 排障 | 2026-05-27 | 地图预览展示区宽高变化后被拉伸的复盘 |
| [ColorThemeRisk.md](ColorThemeRisk.md) | 排障 | 2026-05-26 | 动态 `<style>` 注入颜色主题在 Release CSP 下被拦截的风险与短期修复 |
| [Settings保存重绘.md](Settings保存重绘.md) | 排障 | 2026-05-20 | Settings 自动保存提示触发额外重绘并重新调度保存 |
| [主窗口亚克力毛玻璃实现纪要.md](主窗口亚克力毛玻璃实现纪要.md) | 归档 | 2026-05-31 | 桌面端主窗口毛玻璃效果的讨论与落地记录 |

## 6. 归档

| 文档 | 状态 | 日期 | 说明 |
| --- | --- | --- | --- |
| [app_main_fcui_token_audit_memory.md](app_main_fcui_token_audit_memory.md) | 归档 | 2026-06-01 | `--fc-*` 语义令牌审计结论固化，防止口径漂移。组件复用现行口径见根 `AGENTS.md` §5.2 |
| [0.2.3_change.md](0.2.3_change.md) | 归档 | 2026-05-14 | 0.2.3 改动的按文件影响排查清单 |
| [windows_font_package_size_comparison.md](windows_font_package_size_comparison.md) | 归档 | 2026-08-08 | 加入字体前后 Windows 安装包体积对比：10.7 MiB → 59.2 MiB |

## 7. 待办与计划（`../plans/`）

`plans/` 只放开放中的计划。完成后的过程记录应合并进 `docs/` 或删除，不要在此堆积。

| 文档 | 状态 | 日期 | 说明 |
| --- | --- | --- | --- |
| [../plans/ANDROID-01.md](../plans/ANDROID-01.md) | 现行 | 2026-08-02 | **Android 端唯一权威计划**，自述取代原 `MOBILE-01.md`。核心闭环 + 安装升级构建链路 |
| [../plans/UI-01.md](../plans/UI-01.md) | 现行 | 2026-05-11 | 桌面端工作台交互问题核对：位置感、编辑对象、保存态、AI 引用对象 |
| [../plans/ENTRY-RELATION-WORKBENCH.md](../plans/ENTRY-RELATION-WORKBENCH.md) | 现行 | 2026-07-31 | 词条关系工作台布局。**自述「暂缓实现，日后重新评审」**，两栏方案前提已被宽度验证否决 |

## 8. 设计基线与设计稿（`../designs/`）

`AGENTS.md` 规定：界面改动需先出可审计的单文件 HTML 设计稿，统一存 `designs/<主题名>.html`。当前有 7 份 HTML 设计稿。

| 文档 | 状态 | 日期 | 说明 |
| --- | --- | --- | --- |
| [../designs/apple-ios-ui-ux-design-guidelines.md](../designs/apple-ios-ui-ux-design-guidelines.md) | 现行 | 2026-08-17 | 项目级 iOS/iPadOS 设计基线与验收清单。官方资料核验于 2026-08-17，对标 iOS 27，项目最低 iOS 16.2 |
| [../designs/mobile-ui-baseline.md](../designs/mobile-ui-baseline.md) | 现行 | 2026-08-19 | 移动端 UI 基线规范 v1。**只管「尺度与结构」，不管视觉风格**。iOS 与 Android 共用 |
| [../designs/ios-mobile-hig-gap-audit.md](../designs/ios-mobile-hig-gap-audit.md) | 现行 | 2026-08-19 | 移动端对 iOS 规范的差距审计。证据为模拟器截图 + 源码核查 + 多线程交叉复核 |
| [../designs/mobile-ui-baseline-implementation.md](../designs/mobile-ui-baseline-implementation.md) | 现行 | 2026-08-18 | 基线落地记录。作用域 `data-fc-density="touch"`，桌面 `comfortable` 不消费本批覆盖 |
| [../designs/mobile-entry-editor-design-qa.md](../designs/mobile-entry-editor-design-qa.md) | 结论记录 | 2026-08-03 | 移动端词条编辑设计 QA。视觉证据已丢失 |
| [../designs/mobile-entry-editor-ai-review-design-qa.md](../designs/mobile-entry-editor-ai-review-design-qa.md) | 结论记录 | 2026-08-02 | 移动端词条编辑与 AI 差异审阅 QA |
| [../designs/mobile-world-check-design-qa.md](../designs/mobile-world-check-design-qa.md) | 结论记录 | 2026-08-06 | 移动端设定检测设计 QA。视觉证据已丢失 |
| [../designs/mobile-world-check-implementation-qa.md](../designs/mobile-world-check-implementation-qa.md) | 结论记录 | 2026-08-06 | 移动端设定检测实现 QA。视觉证据已丢失 |
| [../designs/entry-default-cover-design-qa.md](../designs/entry-default-cover-design-qa.md) | 结论记录 | 2026-08-08 | 词条默认封面层级调整 QA。视觉证据已丢失 |

### 审计包（`../designs/audits/`）

**这是正确的证据留存方式**——截图与矢量源文件都提交进仓库，结论可复核。新增设计 QA 一律照此办理。

下表按审计包索引，包内的实现 QA、交付清单等附属文档以各包 `README.md` 为入口。

| 审计包 | 日期 | 结论 |
| --- | --- | --- |
| [mobile-ai-mode-menu-redesign-2026-08-19](../designs/audits/mobile-ai-mode-menu-redesign-2026-08-19/README.md) | 2026-08-19 | AI 模式菜单轻量化，选定 Marker-Only 方案。含实现 QA 与交付清单，Android 真机核对通过 |
| [mobile-ai-svg-icons-2026-08-19](../designs/audits/mobile-ai-svg-icons-2026-08-19/README.md) | 2026-08-19 | 五枚 AI 操作图标。审计通过，已接入代码并完成 Android 真机视觉核对 |
| [ios-input-viewport-2026-08-18](../designs/audits/ios-input-viewport-2026-08-18/README.md) | 2026-08-18 | iOS 输入视口回归验证，iPhone 17 Pro / iOS 26.5 模拟器，8 张过程截图 |
| [mobile-entry-immersive-keyboard-2026-08-18](../designs/audits/mobile-entry-immersive-keyboard-2026-08-18/README.md) | 2026-08-18 | 沉浸编辑键盘上方窄缝透出下层页面的修复，前后对比截图 |
| [mobile-platform-contract-2026-08-18](../designs/audits/mobile-platform-contract-2026-08-18/README.md) | 2026-08-18 | 主题与系统栏同步。**iOS 已验证；Android 仅代码实现，缺 debug APK + ADB 运行证据** |

## 9. 相关的跨仓文档（在根 `docs/`）

- `docs/mobile_plugin_pulley_issue.md` — 移动端插件 `SIGABRT` 根因在 `core_ai_client`。**结论是硬约束：移动端必须用 Pulley 解释器**
- `docs/前端风格指南.md` — 前端硬红线与 review 检查表，适用范围含 `app_main/src/`
- `docs/VVD_FlowCloudAI_Worldbuilding_UX_Analysis.md` — 与 vvd 的创作体验对照，待产品决策
- `docs/archive/architecture-2026-05/` — 2026-05/06 架构评审战役，含桌面 UI 与双端 UI 审计
