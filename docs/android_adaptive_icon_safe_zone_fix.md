# Android 自适应图标过度放大问题记录

## 现象

设计稿和 SVG 四周存在留白，但应用安装到 Android 真机后，桌面图标中的彩色标志仍显得过大、拥挤，几乎贴近白色圆角蒙版边缘。

问题可在 Redmi `24129RT7CC`、Android 16 的系统桌面稳定观察到。它与此前 Chromium 模拟器的光栅化问题无关。

## 根因

问题由 Android 自适应图标规则和资源生成流程共同造成。

### 1. 普通图标留白不等于自适应图标安全区

Android 自适应图标由独立的前景层和背景层组成。系统桌面会按设备主题对图层进行蒙版、缩放或动画处理，因此不能把已经带有白色圆角背景的完整图标直接当作前景层。

自适应图层的基准尺寸为 `108 × 108dp`，主要内容应控制在中央约 `66 × 66dp` 的安全区内。原 `xxxhdpi` 前景资源的彩色标志宽度约为 `330px`，换算为 `82.5dp`，明显超过安全区。设计稿外围虽然有空白，但不足以抵消系统桌面的二次处理。

### 2. `android_fg_scale` 没有缩放自适应前景资源

实测当前 Tauri 图标生成器中的 `android_fg_scale` 会影响传统的合成图标，但不会改变 `ic_launcher_foreground.png` 的主体尺寸。仅调整该参数后，自适应前景仍保持约 `330px` 宽，所以真机视觉没有变化。

### 3. 新源文件没有自动进入实际构建资源

创建并规范化 `src-tauri/android-icon-foreground.svg` 后，Tauri Android 构建不会自动重新生成已有图标，也不会把临时生成结果同步到 Gradle 资源目录。

当时以下两个位置仍是旧的 `330px` 前景资源，因此重新安装后看起来完全没有变化：

- `src-tauri/icons/android/`
- `src-tauri/gen/android/app/src/main/res/`

能推翻上述判断的证据：安装包中实际打包的 `ic_launcher_foreground.png` 已经是 `66dp` 安全区版本，包更新时间也已变化，但清除桌面缓存或更换启动器后仍然显示过度放大。

## 修复方案

### 1. 建立独立的透明前景源

新增 `src-tauri/android-icon-foreground.svg`：

- 画布规范化为正方形 `512 × 512`。
- 只保留彩色标志，不包含白色圆角底板。
- 在 SVG 内对标志执行 `0.8` 倍缩放并居中，避免依赖不影响自适应前景的生成参数。

新增 `src-tauri/icon-manifest.json`，明确指定：

- 默认图标源。
- Android 白色背景。
- Android 独立前景源。
- 传统合成图标保持 `100%` 生成比例，避免重复缩小。

### 2. 生成并同步 Android 资源

使用清单生成图标：

```powershell
npm run tauri -- icon src-tauri/icon-manifest.json -o <临时输出目录>
```

确认生成结果后，将临时目录中的 `android` 资源同步到以下两个位置：

```text
src-tauri/icons/android/
src-tauri/gen/android/app/src/main/res/
```

两处都要同步：前者是项目保留的 Android 图标源，后者是当前 Gradle 工程实际参与 APK 构建的资源。

修复后的 `xxxhdpi/ic_launcher_foreground.png` 画布为 `432 × 432px`，彩色主体宽度为 `264px`，即 `66dp`，符合安全区目标。

### 3. 使用 Tauri 入口构建

真机构建使用：

```powershell
npm run tauri -- android build --debug --apk --target aarch64
```

不要在停止 `tauri android dev` 后直接执行 Gradle 的 `assembleUniversalDebug`。该项目的 `rustBuildArm64Debug` 会调用 `tauri android android-studio-script`，直接运行 Gradle 时缺少 Tauri CLI WebSocket 通道，会报连接被拒绝。

## 验证

- Tauri 图标生成成功。
- `xxxhdpi` 自适应前景主体由 `330px / 82.5dp` 缩小到 `264px / 66dp`。
- Tauri Android ARM64 Debug 构建通过。
- 通过 `adb install -r` 覆盖安装成功，包更新时间更新为 `2026-07-18 11:23:30`。
- ADB 真机桌面截图确认：彩色主体完整位于白色蒙版内，四周留白明显，与系统图标的内部视觉尺寸更协调。

对应修复提交：`95c9264 修正 Android 自适应图标安全区`。

## 后续维护

以后替换启动图标时，不要只运行默认 Tauri 图标命令后查看桌面端产物。至少需要检查：

1. Android 前景源是否透明且不包含最终蒙版背景。
2. `xxxhdpi/ic_launcher_foreground.png` 的主要内容是否位于中央 `264 × 264px` 安全区。
3. 图标是否同时同步到保留资源目录和 Gradle `res` 目录。
4. 是否通过覆盖安装后的真机桌面截图验证，而不是只看 SVG 或模拟器预览。
