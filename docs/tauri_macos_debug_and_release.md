# macOS 调试与发布流程

本文记录 `app_main` 的 macOS 原生窗口、调试、打包、签名与公证边界。所有命令都在 Mac 的 `app_main` 根目录执行。

## 1. 当前架构

- macOS 与 Windows/Linux 共用 React 桌面业务壳、Rust 后端、数据库与插件能力，不维护一份 SwiftUI 业务副本。
- `src-tauri/tauri.macos.conf.json` 只在 macOS 构建时覆盖窗口与安装包配置，不影响 Windows、Linux、Android 或 iOS。
- macOS 使用 AppKit 原生标题栏、交通灯和系统菜单。Windows/Linux 继续使用应用内的自绘窗口按钮。
- macOS 明确关闭透明窗口私有 API，避免给签名、公证和未来发行留下阻碍；界面内部的毛玻璃 CSS 仍可使用。
- 当前正式发行目标是官网直接下载的已签名、公证 DMG。Mac App Store 需要 App Sandbox，而现有自定义数据目录、插件和通用文件访问必须先完成单独的沙箱兼容评估。

## 2. 首次环境检查

```zsh
npm install
npm run macos:doctor
```

`macos:doctor` 会检查 Xcode、macOS SDK、Apple Silicon/Intel 两个 Rust target、本地 Tauri CLI、平台配置和图标。Developer ID 与公证凭据只影响正式站外发行，不阻止本机调试。

## 3. 日常调试

```zsh
npm run macos:dev
```

该命令等价于在当前 Mac 上启动 Tauri 开发模式，终端会持续显示前端、Rust 与 WebView 相关日志。开发模式只编译当前机器架构，不会额外编译 iOS、Windows、Android 或 Intel 版本。

首轮至少验证：

1. 左上角显示原生红黄绿交通灯，顶部没有重复的 Windows 风格按钮。
2. 拖动顶栏、最小化、全屏、关闭窗口和未保存内容拦截均正常。
3. `Command+C/V/A/Q`、系统菜单与文本输入正常。
4. 项目、词条、聊天、插件、图片/文件导入和日志读取能够工作。
5. API Key 重启后仍可从 Keychain 读取。
6. 默认数据目录和桌面端自定义数据目录都能重启恢复；iOS 的移动沙箱路径策略不会覆盖 macOS 设置。

## 4. 本地安装包

```zsh
npm run macos:build:debug
npm run macos:build:local
```

- `macos:build:debug` 生成当前架构的未签名 Debug `.app`，用于快速验证打包资源。
- `macos:build:local` 生成当前架构的 Release `.app` 与 `.dmg`，使用 ad-hoc 签名，只适合本机/内部验证，其他用户打开时仍可能看到 Gatekeeper 提示。
- 产物位于 `src-tauri/target/<profile>/bundle/macos/` 与 `src-tauri/target/<profile>/bundle/dmg/`，不提交 Git。

## 5. 正式站外发行

正式发行需要付费 Apple Developer Program 中的 `Developer ID Application` 证书、公证凭据，以及与现有 updater 公钥匹配的 Tauri 更新签名私钥。敏感值只放本机环境或 CI Secret：

```zsh
export APPLE_SIGNING_IDENTITY="Developer ID Application: 你的名称 (TEAMID)"
export APPLE_API_ISSUER="App Store Connect Issuer ID"
export APPLE_API_KEY="Key ID"
export APPLE_API_KEY_PATH="/绝对路径/AuthKey_XXXXXX.p8"
export TAURI_SIGNING_PRIVATE_KEY="/绝对路径/tauri-updater.key"
export TAURI_SIGNING_PRIVATE_KEY_PASSWORD="更新签名密钥密码"
export MACOS_BUILD_NUMBER="42"

npm run macos:build:release
```

也可使用 `APPLE_ID`、`APPLE_PASSWORD`、`APPLE_TEAM_ID` 代替 API Key 三件套。`APPLE_PASSWORD` 应使用 App 专用密码或钥匙串引用，不要写入脚本。

正式命令默认构建 `universal-apple-darwin`，同时支持 Apple Silicon 与 Intel，因此编译时间和产物大小都会高于日常单架构构建。若明确只发行 Apple Silicon，可临时设置：

```zsh
MACOS_TARGET=aarch64-apple-darwin MACOS_BUILD_NUMBER=42 npm run macos:build:release
```

每次发布必须递增 `MACOS_BUILD_NUMBER`。构建完成后还要在另一台 Mac 或全新用户账户验证 DMG 挂载、拖入 Applications、首次启动、Gatekeeper、公证状态、自动更新和数据恢复。

参考：[Tauri macOS 签名与公证](https://v2.tauri.app/distribute/sign/macos/)、[Tauri DMG](https://v2.tauri.app/distribute/dmg/)。

## 6. 不可提交内容

- Developer ID/Distribution 证书、`.p12`、`.p8`、描述文件和钥匙串导出。
- Apple ID、App 专用密码、Team ID、API Key、Issuer ID。
- Tauri updater 私钥及密码。
- `src-tauri/target/`、`.app`、`.dmg`、公证日志和本机数据目录。
