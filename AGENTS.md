# app_main — AGENTS.md

## 项目概览

`app_main` 是 FlowCloudAI 的 Tauri + React（TypeScript）主应用，同时承载 Windows、Linux、macOS、Android 与 iOS 外壳，提供世界观建模、关系图编辑、地图展示与插件入口。

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
```

```bash
cd src-tauri
cargo check
cargo test
```

`app_main` 的前端命令以 `app_main/package.json` 为准，Rust 命令以 `app_main/src-tauri/Cargo.toml` 为准。

## macOS 调试与打包（仅 macOS）

macOS 完整操作手册是 [`docs/tauri_macos_debug_and_release.md`](docs/tauri_macos_debug_and_release.md)。修改 Mac 窗口或发布链路前先读该文档。

### 文件职责与平台边界

- `src-tauri/tauri.macos.conf.json` 是 macOS 自动合并的平台配置；保留 `decorations: true`、`titleBarStyle: Overlay` 和不透明窗口，只把标题栏、交通灯与系统菜单交给 AppKit。当前不固化 `trafficLightPosition`，使用系统默认坐标；后续调整时必须同步检查 `src/App.css` 中 Logo/Tab 的左侧避让，并在不同缩放与内外接屏幕上验证，未经验收不要提交坐标值。
- `scripts/macos-workflow.mjs` 统一执行环境检查、dev、本地 Release 和正式 Universal 发布。Mac 专属行为优先收口在平台配置、OS class 或 target 条件代码中，不能为了 macOS 复制一套 `MacApp.tsx`、React 业务状态或 SwiftUI 业务界面。
- `--app-drag-handle-width` 同时控制桌面 shell 留白、Dock 面板间距和侧栏拖拽手柄，macOS 下也必须保留；原生窗口边框负责缩放不等于可以把该变量设为 `0`。
- `src-tauri/tauri.conf.json` 的 CSP 必须允许 `connect-src 'self' ipc: http://ipc.localhost`，否则打包后的 WebKit 会持续报告 Tauri IPC 违规。启用 `zoomHotkeysEnabled` 时，桌面 capability 必须包含 `core:webview:allow-set-webview-zoom`。修改共享 CSP/capability 后要回归 Windows、Linux 与移动端，不能把它们当成纯 Mac 配置。

### 日常调试与窗口启动

- `npm run macos:dev` 只构建当前 Mac 架构并在当前终端持续输出 Vite、Rust、WebKit 与前端转发日志。React/TypeScript/CSS 保存后走 Vite HMR；Rust 自动重编译；`tauri.macos.conf.json` 等原生窗口配置会触发应用重建/重启，不能靠 HMR 验证。
- 主窗口初始为 `visible: false`，前端后端状态变为 ready/failed 后直接调用 `showWindow()`。禁止重新把显示操作包进 `requestAnimationFrame`：macOS 可能暂停隐藏 WKWebView 的帧回调，形成“窗口不显示就没有下一帧”的启动死锁。正常启动日志必须出现 `主窗口显示完成 platform=macos ... visible_after=true`。
- React StrictMode/HMR 可能让 Tauri 原生监听器先于 React cleanup 被释放；事件清理统一经过 `src/api/events.ts` 的安全释放逻辑，窗口 resize/close 监听也不能直接调用异步 unlisten 而留下未处理拒绝。
- 同时只运行一个 macOS dev/Release 实例与一套 Vite 服务。程序坞有图标但没有窗口时，先检查端口和旧进程，再看窗口显示日志，不要先归因于前端白屏。

### Release 与签名边界

- `npm run macos:build:local` 生成当前架构、优化后的 `.app`/`.dmg`，使用 ad-hoc 签名，只适合本机安装与功能验收；它不是可公开分发的已公证包。
- `MACOS_BUILD_NUMBER=... npm run macos:build:release` 默认构建 Apple Silicon + Intel Universal 包，并强制检查 `APPLE_SIGNING_IDENTITY`、Apple 公证凭据和 `TAURI_SIGNING_PRIVATE_KEY`。这些材料只放本机钥匙串、环境变量或 CI secrets，禁止提交；Personal Team 不能替代 Developer ID Application 站外签名。
- 当前发行边界是官网 DMG，不是 Mac App Store。启用 App Sandbox 前必须专项验证自定义数据目录、插件、文件导入、Keychain 与网络能力，不能直接复用站外包配置。
- `target/release/bundle/` 是可再生产物，不提交。前端或 Tauri 配置变化会重新嵌入资源并触发 Release 链接，本项目在 Apple Silicon 开发机上可能耗时数分钟，这不是默认的全平台编译。
- 构建成功不等于适配完成：必须实际运行最终 `.app`，检查模板/数据库/插件初始化、窗口显示、CSP 与未处理拒绝日志，并验证原生交通灯、拖拽/全屏/关闭拦截、Command 快捷键、项目与聊天恢复、插件/文件访问、Keychain、自定义数据目录。DMG 还要做完整性校验；Gatekeeper 与公证状态只能用正式 Developer ID 包验收。

## iOS 调试与打包（仅 macOS）

iOS 的完整操作手册是 [`docs/tauri_ios_debug_and_release.md`](docs/tauri_ios_debug_and_release.md)。修改 iOS 构建链路前先读该文档；以下内容用于说明仓库内各文件的职责与常用入口。

### 仓库内文件与生成目录

- `scripts/ios-workflow.mjs`：统一执行环境自检、工程初始化、真机调试、Archive 与 IPA 导出，并检查构建锁、版本号和产物 SHA-256。
- `src-tauri/icons/ios/`：受 Git 跟踪的 iOS AppIcon 唯一来源；`ios:init`、`ios:dev`、`ios:run` 与打包命令会同步到生成的 `Assets.xcassets`。若只在 Xcode 中操作，先执行 `npm run ios:sync-icons`；禁止把 Tauri 默认图标留在 `src-tauri/gen/apple` 后直接打包。
- `scripts/ios-xcode-build.sh`：Xcode Build Phase 到 Node、Cargo 与本地 Tauri CLI 的桥接脚本；重新生成 Xcode 工程后不应再手工补 PATH。
- `src-tauri/ios/project.yml`：受 Git 跟踪的 XcodeGen 模板，是 iOS 原生工程配置的长期来源。
- `src-tauri/gen/apple/`：Tauri/Xcode 生成目录，已忽略且可随时重建。禁止把长期修改只写在这里，否则 `ios:init` 后会丢失。
- `artifacts/ios/`：工作流整理出的 IPA 与 `.sha256` 文件，已忽略，不提交 Git。

### 首次准备与日常调试

Team ID 只放在本机环境，不写入仓库：

```zsh
export APPLE_DEVELOPMENT_TEAM="你的 Team ID"
npm run ios:doctor
npm run ios:init
```

`ios:init` 只在生成工程不存在，或 `src-tauri/ios/project.yml`、原生配置发生变化后执行。日常调试使用：

```zsh
npm run ios:dev -- "Xcode 中显示的设备名称"
npm run ios:dev -- "Xcode 中显示的设备名称" --open
npm run ios:run -- "Xcode 中显示的设备名称"
npm run ios:build:sim:debug
```

- `ios:dev` 使用 Vite 热更新，iPhone 需要与 Mac 同网并允许 App 访问本地网络；`--open` 用 Xcode 打开生成工程，适合看完整设备日志。
- `ios:run` 使用打包后的前端，不依赖 Vite，更接近 Release 行为；功能回归优先用它。
- `ios:build:sim:debug` 只适合基础界面检查，不能替代真机权限、沙箱、签名和 WebView 手势验证。

### IPA 与发布边界

```zsh
npm run ios:build:debug
IOS_BUILD_NUMBER=42 npm run ios:build:release-test
IOS_BUILD_NUMBER=42 npm run ios:build:appstore
IOS_BUILD_NUMBER=42 npm run ios:archive
```

- 正式构建必须显式设置递增的 `IOS_BUILD_NUMBER`；不要直接给底层 Tauri 追加 `--build-number`，统一脚本会把该值准确写入 `CFBundleVersion`。
- `ios:build:release-test` 是注册设备测试包，不是 TestFlight；TestFlight 与 App Store 使用 `ios:build:appstore`，脚本只导出、不上传。
- Personal Team 可做本人真机开发，但 TestFlight/App Store 分发需要 Apple Developer Program、有效分发证书与 App Store Connect 应用记录。
- `APPLE_DEVELOPMENT_TEAM`、Apple ID、设备 ID、证书、描述文件和签名材料均属于本机/发布环境，禁止提交。
- iOS 编译成功不等于可用：至少用真机验证启动、项目/聊天数据恢复、文件访问、Rust/前端日志和双指缩放。同一时间只运行一个 `ios:dev`、Xcode 调试或打包任务，避免 Rust 输出目录锁互相等待。

## Android 调试与打包（主要在 Windows）

Android 当前的固定入口是 `package.json` 中的脚本；[`docs/tauri_android_dev_debugging.md`](docs/tauri_android_dev_debugging.md) 记录模拟器网络故障的原因与排查方式。Android Studio/SDK、Platform Tools、NDK、Rust Android targets 与至少一个 AVD 应先准备好。

### 调试入口

```powershell
npm run android:dev
```

`scripts/android-dev.cjs` 会自动完成以下工作：

- 从 `ANDROID_HOME` / `ANDROID_SDK_ROOT` / `ANDROID_NDK_HOME` 等环境变量查找 SDK、ADB、Emulator 与 NDK，并配置四个 Rust Android target 的编译器。
- 优先使用已连接且启动完成的设备；没有设备时自动启动第一个 AVD。可在 PowerShell 中用 `$env:ANDROID_AVD_NAME="AVD 名称"` 指定模拟器。
- 等待 `sys.boot_completed=1`，清理 Android 开发端口占用，并为 `5176`（Vite）和 `1422`（HMR）设置 `adb reverse`。
- 最终以 `tauri android dev --host 127.0.0.1` 启动，避免依赖模拟器访问 Windows 局域网地址和防火墙入站规则。

若更改端口，必须同时更新 `vite.config.ts`、`src-tauri/tauri.android.conf.json` 与 `scripts/android-dev.cjs`。桌面/iOS 默认使用 `5175/1421`，Android 使用 `5176/1422`，不要混写。

### APK 构建与签名

```powershell
npm run android:build:debug:x86_64
npm run android:build:apk
npm run android:sign:apk
npm run android:build:signed:apk
```

- `android:build:debug:x86_64` 使用 Windows `set` 语法，仅用于 x86_64 模拟器 Debug APK。
- `android:build:apk` 生成待签名的通用 Release APK；`android:sign:apk` 只签名已有 APK；`android:build:signed:apk` 先构建再签名。
- `scripts/sign-android-apk.ps1` 是 Windows PowerShell 脚本，默认 keystore 路径、别名和输出文件名带本机/版本假设。正式发布前必须核对这些值，不能把示例路径直接当作通用发布配置。
- Android 已发布版本必须永久复用同一把 release keystore。签名脚本在默认 keystore 不存在时会创建新密钥和密码文件，这只适合首次建钥；执行前先确认目标路径，建成后离线备份，禁止提交 keystore 或密码文件，也不能因换电脑随意重建。
- APK 构建成功后仍需用 debug APK + ADB 或签名 Release APK 在目标设备上验证；浏览器/Vite 空壳不能替代 Tauri 后端、数据库、权限与文件访问测试。

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

- `app_main/src-tauri/tauri.conf.json` 的桌面/iOS `devUrl` 与 `app_main/vite.config.ts` 必须对齐（`5175`，HMR `1421`）；Android 覆盖为 `5176`/`1422`，三处同步规则见 Android 章节。
- Windows 无边框透明窗口与 macOS 隐藏 Overlay 窗口都对初始化顺序敏感；macOS 禁止在隐藏 WKWebView 的 `requestAnimationFrame` 中显示窗口。
- 不能混用大小写错误的插件目录名与 manifest，加载失败会表现为插件不可见。  
- macOS 的 `icon.icns` 正常不代表 iOS AppIcon 正常：`src-tauri/gen/apple` 可能独立残留 Tauri 默认图标。iOS 图标以 `src-tauri/icons/ios/` 为唯一来源，提交前执行 `npm run ios:doctor`，并以 Xcode Asset Catalog 成功编译及真机主屏幕显示为最终验收；不要提交生成目录来掩盖同步问题。
- iOS 每次安装可能获得不同的沙箱容器 UUID，移动端不得持久化系统默认数据目录的绝对路径；必须在每次启动时从当前沙箱解析。桌面端自定义数据目录策略不受此限制。

文档同步时间：2026-08-16 23:33:51 +08:00
