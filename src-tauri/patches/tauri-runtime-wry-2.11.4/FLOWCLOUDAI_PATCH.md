# FlowCloudAI iOS 补丁

基线：`tauri-runtime-wry 2.11.4`。

在 iOS 26.5 模拟器中，运行时初始化调用 `wry::webview_version()` 后，
`NSBundle::bundleWithIdentifier("com.apple.WebKit")` 会在 Foundation/CoreFoundation 内触发
`EXC_BREAKPOINT (SIGTRAP)`。iOS 系统始终提供 WKWebView，因此本地补丁只在 iOS 将
`webview_runtime_installed` 直接设为 `true`；其他平台保持上游逻辑不变。

升级 Tauri/Wry 时应先在 iOS 模拟器复测启动；若上游不再调用该探测，可删除整个补丁目录和
根 `Cargo.toml` 的 `[patch.crates-io]` 配置。
