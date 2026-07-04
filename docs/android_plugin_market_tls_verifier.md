# Android 插件库 TLS 校验问题记录

## 现象

Android release APK 中打开移动端设置页，插件库加载失败：

```text
{"code":"CORE_CLIENT_INTERNAL_ERROR","message":"error sending request for url (https://www.flowcloudai.cn/api/plugins)"}
```

后端日志中能看到实际错误：

```text
certificate was revoked: java.security.cert.CertPathValidatorException: Certificate does not specify OCSP responder
failed to verify TLS certificate: invalid peer certificate: Revoked
```

同时有几个反证：

- Android dev 包正常。
- 设备浏览器能打开 `https://www.flowcloudai.cn/api/plugins`。
- Manifest 已包含网络权限。
- 关闭 release minify/R8 后仍失败。

## 根因

这不是插件市场接口、网络权限或 R8 混淆问题，而是 Android release 包里 Rust HTTP 客户端的 TLS 校验路径问题。

`NetworkState` 里的共享 `reqwest::Client` 默认使用 `reqwest` 的 rustls 后端。`reqwest 0.13` 在 Android 上会通过 `rustls-platform-verifier` 调用平台证书校验器。本次服务端证书在 Android 平台 verifier 路径下被误判为 revoked，原因是平台侧吊销检查遇到 `Certificate does not specify OCSP responder`。

浏览器能正常打开同一 URL，说明 WebView/Chrome 的证书处理路径接受该证书；失败只发生在 Rust `reqwest` 的 Android 平台 verifier 路径。

能推翻这个判断的证据：同一 release 包中，改用平台 verifier 以外的合法 TLS 根证书链后仍报相同 revoked 错误。

## 修复方案

Android 目标下为全局 HTTP 客户端显式构造 rustls 配置：

- 使用 `webpki-roots::TLS_SERVER_ROOTS` 作为根证书集。
- 通过 `reqwest::ClientBuilder::tls_backend_preconfigured` 注入 `rustls::ClientConfig`。
- 非 Android 目标保持 `reqwest::Client::new()`。

这不是关闭证书校验：域名、证书链和 WebPKI 根信任仍然会校验。变化只是 Android 端不再走 `rustls-platform-verifier` 的平台吊销检查分支。

## 影响范围

受影响的是 `NetworkState.client`，当前插件市场列表、下载、上传、更新、删除都会复用它。

取舍：Android 端这个 Rust HTTP 客户端不再信任用户在系统中额外安装的企业 CA 或自签根证书。当前插件市场是固定公网 HTTPS，这个取舍比关闭 TLS 校验更安全。

## 验证

- `cargo check` 通过。
- `npm run android:build:debug:x86_64` 通过。
- 真机安装后，移动端插件库加载恢复正常。
