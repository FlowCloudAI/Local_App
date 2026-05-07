# Tauri Android 开发调试排障记录

本文记录 FlowCloudAI 在 Windows + Android Emulator 下运行 `tauri android dev` 时，移动端 WebView 无法加载 Vite
开发服务器的问题、原因与固定启动方式。

## 现象

模拟器内应用启动后显示空白或错误页，日志中出现类似信息：

```text
Failed to request http://10.101.19.191:5175/: error sending request for url (http://10.101.19.191:5175/)
Failed to request http://10.101.19.191:5175/favicon.ico: error sending request for url (http://10.101.19.191:5175/favicon.ico)
```

Tauri CLI 同时会打印：

```text
Info Using 10.101.19.191 to access the development server.
Info Replacing devUrl host with 10.101.19.191.
VITE ... Network: http://10.101.19.191:5175/
```

这说明 Android WebView 正在尝试访问宿主机的局域网地址 `10.101.19.191:5175`。

## 根因

本次问题不是移动端前端页面代码导致的，而是开发服务器访问链路不通。

在 Windows 上运行 `tauri android dev` 时，Tauri CLI 默认会选择一个公网/局域网地址作为移动端访问 Vite 的地址。当前环境中它选择了
WLAN 地址：

```text
10.101.19.191
```

但模拟器网络状态异常，设备侧路由为空，虚拟网卡未正常联网：

```text
ip route
# 无输出

eth0: state DOWN
wlan0: NO-CARRIER
ping 8.8.8.8
# Network is unreachable
```

因此模拟器无法访问 `http://10.101.19.191:5175/`，WebView 加载失败。

另外，单独设置 PowerShell 环境变量并不足够：

```powershell
$env:TAURI_DEV_HOST="127.0.0.1"
```

实际日志仍可能显示：

```text
Info Using 10.101.19.191 to access the development server.
```

原因是 `tauri android dev` 自身会根据 `--host` 参数或默认策略重写移动端 devUrl。要强制走本机回环地址，需要显式传递：

```powershell
tauri android dev --host 127.0.0.1
```

## 推荐方案

对 Android 模拟器调试，推荐使用 `adb reverse`：

```text
Android WebView 127.0.0.1:5175
  -> adb reverse
  -> Windows 宿主机 127.0.0.1:5175
  -> Vite dev server
```

这样不依赖模拟器访问宿主机 WLAN IP，也不需要配置 Windows 防火墙入站规则。

项目已在 `package.json` 中提供脚本：

```json
{
  "android:dev": "tauri android dev",
  "android:dev:emu": "npm run android:reverse && tauri android dev --host 127.0.0.1",
  "android:dev:emu:start": "start \"\" emulator -avd Pixel_8 && npm run android:reverse && tauri android dev --host 127.0.0.1",
  "android:reverse": "adb wait-for-device && adb reverse --remove-all && adb reverse tcp:5175 tcp:5175 && adb reverse tcp:1421 tcp:1421"
}
```

### 模拟器已启动

```powershell
npm run android:dev:emu
```

### 模拟器未启动

```powershell
npm run android:dev:emu:start
```

该脚本会启动 `Pixel_8`，等待 adb 设备在线，配置端口转发，然后用 `127.0.0.1` 启动 Tauri Android dev。

## 正常日志

成功时应看到类似日志：

```text
Info Using 127.0.0.1 to access the development server.
VITE ... Local: http://127.0.0.1:5175/
```

并且端口转发应存在：

```powershell
adb reverse --list
```

正常输出应包含：

```text
tcp:5175 tcp:5175
tcp:1421 tcp:1421
```

## 常见误区

### 先执行 adb reverse，再让 Tauri 启动模拟器

如果模拟器尚未启动，直接执行：

```powershell
adb reverse tcp:5175 tcp:5175
```

会失败：

```text
adb.exe: no devices/emulators found
```

需要先让设备在线，或使用项目脚本中的 `adb wait-for-device`。

### 只设置 TAURI_DEV_HOST

只设置：

```powershell
$env:TAURI_DEV_HOST="127.0.0.1"
```

不一定能覆盖 Tauri CLI 的 Android host 选择。应使用：

```powershell
tauri android dev --host 127.0.0.1
```

或项目脚本：

```powershell
npm run android:dev:emu
```

### 通过防火墙规则解决模拟器问题

如果继续走 `10.101.19.191:5175`，确实可能需要管理员权限添加 Windows 防火墙入站规则：

```powershell
netsh advfirewall firewall add rule name="Tauri Dev 5175" protocol=TCP dir=in localport=5175 action=allow
netsh advfirewall firewall add rule name="Tauri Dev HMR 1421" protocol=TCP dir=in localport=1421 action=allow
```

但 `adb reverse + 127.0.0.1` 不依赖这条路径，通常更适合模拟器开发。

## 快速检查命令

检查设备是否在线：

```powershell
adb devices
```

检查端口转发：

```powershell
adb reverse --list
```

检查 Vite 端口监听：

```powershell
Get-NetTCPConnection -State Listen -LocalPort 5175,1421 -ErrorAction SilentlyContinue
```

检查模拟器网络状态：

```powershell
adb shell ip route
adb shell ip addr show
adb shell ping -c 1 8.8.8.8
```

如果模拟器网络本身异常，可在 Android Studio Device Manager 中对对应 AVD 执行 `Cold Boot Now`，必要时执行 `Wipe Data`
。不过模拟器调试仍优先使用 `adb reverse`。
