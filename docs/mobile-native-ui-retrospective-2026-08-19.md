# 移动端原生交互与 AI 界面问题复盘（2026-08-19）

## 1. 文档目的

本文记录 2026-08-19 在 Android 真机接入、移动端返回手势、AI 会话界面、底部浮层和
iOS/Android 键盘布局中发现的问题、根因、曾经失败的方案、最终解决方式及验证边界。

这不是提交日志的逐条转写。问题按共同根因归组，方便以后遇到相同现象时先判断“谁拥有
布局变化”，再决定修改原生壳层、共享移动壳、业务页面还是 Portal 浮层。

## 2. 当天形成的关键约束

1. **焦点不等于键盘可见。** 输入框可以保留焦点而系统键盘已经收起，外接键盘也可以让
   输入框获得焦点但没有屏幕遮挡。
2. **一段键盘遮挡只能有一个布局所有者。** 原生窗口、WebView、Web 根、业务页面和 Portal
   浮层不得同时消费同一份高度。
3. **键盘动画不应逐帧跨原生/JavaScript 边界驱动布局。** 系统动画中间帧、最终 insets 和
   WebView 自身补偿会以不同时间到达，容易形成反复重排和抖动。
4. **页面外壳固定，业务区声明唯一滚动者。** AI 页只压缩 Messages；灵感页只滚动正文输入区；
   不允许浏览器通过滚动整页把焦点元素强行搬到键盘上方。
5. **视觉尺寸与触摸尺寸分离。** 48px 命中基线不等于所有图标和胶囊都必须画成 48px。
6. **Portal 是独立布局表面。** Portal 不继承 `.mobile-app` 的 CSS 变量；前景浮层含输入控件时，
   必须显式接管键盘空间并冻结背景布局。
7. **共享代码覆盖不等于双端验收。** Android APK/ADB、iOS Simulator 和 iPhone 真机证据必须
   分开记录。

## 3. Android 工程入口与文件关联

### 3.1 真机开发和打包命令缺少稳定入口

**现象**

- 本机已有 Android SDK、NDK、JDK 和真机，但普通命令不能稳定区分模拟器与物理设备。
- SDK/NDK 环境变量没有进入新终端时，构建脚本会在真正编译前失败。
- 直接运行 Gradle 会绕过 Tauri 的 Rust 构建与通信入口。

**根因**

Android 开发流程此前依赖调用者临时拼接设备选择、NDK 编译器和 Tauri 参数；这些约束没有
收口到项目脚本，因此 IDE、终端和自动化使用的是不同流程。

**解决方案**

- 增加 `android:dev` 与 `android:dev:device`，后者只接受物理设备。
- 增加 `android:build:dev` 与 `android:build:release`，由脚本发现 NDK 并配置四种 Rust Android
  target 的 Clang、AR、Ranlib 和 linker。
- 保持 Tauri CLI 为构建入口，不直接把 Gradle `assemble*` 当成完整构建。
- 本机 `.idea` 运行配置复用上述命令，供 IDE 与终端走同一流程；`.idea` 按仓库忽略规则
  不进入对应提交。

对应提交：`2cccf03`。

### 3.2 Android 安装包没有同步 `.fcplug` / `.fcworld` 文件关联

**现象**

Android 安装后无法从系统分享或文件打开入口把 `.fcplug`、`.fcworld` 交给应用。

**根因**

Tauri 配置中的文件关联没有出现在实际参与 APK 构建的生成版 `AndroidManifest.xml` 中。
只检查上层配置会误以为能力已经存在。

**解决方案**

在当前 Gradle 工程的 Activity 上同步 `SEND`、`SEND_MULTIPLE`、`VIEW`、`DEFAULT`、
`BROWSABLE` 以及两种 MIME/pathPattern 声明，并以最终 APK Manifest 为验证对象。

对应提交：`8686482`。

## 4. Android 输入态和返回手势

### 4.1 `adjust-pan` 下键盘已经出现，但输入态被误判为未出现

**现象**

Android 文本框获得焦点后，系统通过平移 visual viewport 露出焦点控件；底部 Tab 仍显示并
占据空间，输入态恢复也不可靠。

**根因**

旧公式使用：

```text
keyboardInset = layoutHeight - visualViewport.height - visualViewport.offsetTop
```

`offsetTop` 在 `adjust-pan` 下本身就是系统为露出焦点控件而产生的平移量。再次从高度差中扣除
它，会把真实键盘高度抵消掉。

**阶段性修复与最终归宿**

- 阶段性修复改为只计算完整视口与可视高度差，不再扣 `offsetTop`（`d005f15`）。
- 最终架构不再用 visual viewport 决定原生键盘布局；它只在原生桥不可用时作为输入态兜底
  （`534088c`）。

### 4.2 Android 所有边缘返回手势都不触发

**现象**

三键导航设备从左边缘慢拖或快速右甩都没有页面返回；系统手势导航设备又不能同时启用第二套
Web 指针手势，否则一次操作可能触发两次返回。

**根因**

Android 只有系统手势导航模式会产生原生预测式返回进度；三键/两键导航不会从屏幕边缘产生
该事件。原实现又把 Web 指针边缘手势限定为 iOS，因此三键导航落入了能力空档。

**解决方案**

- Android 原生桥读取 `config_navBarInteractionMode`，归一化为 `buttons`、`gesture`、`unknown`。
- `gesture` 继续使用 Android 原生预测式返回。
- `buttons` 才启用与 iOS 共用的 Web 指针边缘返回。
- `unknown` 不同时启用两套实现，避免重复提交页面栈。

对应提交：`31caa7f`。

## 5. AI 会话界面的视觉与交互问题

### 5.1 输入区底部控件过胖，缩放 SVG 后线条又变细

**现象**

- 思考、模式、更多、发送按钮共同撑高了输入区。
- 胶囊的横纵 padding 比例不统一。
- 直接缩小发送箭头 SVG 会连描边一起缩细。
- 视觉按钮缩小后，若同步缩小 DOM 盒子，又会损失触摸面积。

**根因**

全局 48px 移动触摸基线直接作用在了视觉按钮本体；视觉尺寸、命中区和 SVG 描边没有分层。

**解决方案**

- 在 AI composer 这个明确的紧凑工具栏中局部解除控件视觉最小值。
- 胶囊使用“横向 padding = 纵向 padding 的两倍”。
- 通过透明 `::after` 命中层保留约 44～48px 的可点击区域。
- 更多按钮使用 outline，外框与加号使用一致颜色和线宽。
- 发送箭头使用 `vector-effect: non-scaling-stroke`，只改几何尺寸，不随缩放改变描边粗细。
- 按钮间距收口到 16px 语义 gap；输入区增高后由 textarea 填充剩余高度，底部操作栏自动贴底。

对应提交：`52f1785`。

### 5.2 模型按钮、勾选符号、操作图标和空消息列表不一致

**现象与根因**

- 模型选择按钮比同排顶栏控件高：它继承了通用触摸最小高度，而不是顶栏视觉表面高度。
- 模型名称居中且偏小：复用了 meta 文字和居中布局。
- 菜单用字符 `✓`：字形、基线和粗细随系统字体变化。
- 插件切换、思考、三种模式图标缺少统一的 SVG 轮廓语言。
- 空消息列表仍能小幅上下滚动：空状态和末尾零高度滚动锚点之间的 flex gap 制造了额外高度。

**解决方案**

- 模型按钮视觉高度改用 `--mobile-top-surface-size`，透明层继续补足触摸高度。
- 模型名称左对齐并使用移动正文小号语义字号。
- 抽出 `MobileCheckIcon` SVG，替代字体字符。
- 将审计通过的插件、闪电和三种模式 SVG 落到代码；按使用场景单独控制描边。
- 空消息态增加专用 class，把 Messages 的 gap 置零。

对应提交：`e2606c0`；设计证据位于
`designs/audits/mobile-ai-svg-icons-2026-08-19/`。

### 5.3 模式选择菜单视觉权重过大

**现象**

菜单过宽，图标和整行选中色块同时抢占注意力；选中对钩距离标题太远，作家模式说明又拉宽容器。

**根因**

旧菜单把“模式说明”“图标”“整行状态背景”都作为强层级，没有明确唯一的选中信号。

**解决方案**

- 采用审计选择的 marker-only 方案：选中态只保留左侧 2px 标记、主色图标/标题和标题后的普通对钩。
- 图标经真机反馈调整为 22px、1.7px 描边。
- 缩短作家模式说明为“写入免确认”，容器宽度收紧到 9.75rem。
- 保留 `menuitemradio`、`aria-checked`，状态不只依赖颜色。

对应提交：`4640cd0`、`fd0b9b5`；设计与 Android 实机对比位于
`designs/audits/mobile-ai-mode-menu-redesign-2026-08-19/`。

## 6. 公共底部浮层动画不完整

**现象**

更多菜单关闭时动画会被截断；打开时则直接出现在最终展开位置，没有从屏幕底部升起。

**根因**

Overlay 在同一个 React 更新/浏览器绘制周期内完成“挂载”和“切换为 open”。单个
`requestAnimationFrame` 仍可能被 React 与移动 WebView 合并到同一帧，浏览器没有机会绘制
`translateY(100%)` 的初始状态。关闭时，过渡时间一到就卸载，也可能没有完整绘制最终 closed 帧。

**解决方案**

- Sheet 先挂载为 closed，连续跨过两个绘制帧后才设为 open。
- 关闭时先切 closed，等待 transition duration，再保留两个 closed 绘制帧后卸载。
- 只改变 sheet 时序，floating 桌面弹窗沿用原节奏。

对应提交：`d6c4c3d`。

## 7. 双端键盘布局抖动：失败方案与最终架构

### 7.1 需求模型

- AI 页外壳不动，键盘只把 composer 顶到上方，同时压缩 Messages 的高度。
- 灵感页外壳不动，正文输入区内部滚动，不把占据大半屏的编辑器整体顶出页面。
- 停靠键盘出现时 Tab 隐藏且不可交互；浮动键盘、外接键盘不隐藏。

### 7.2 为什么早期方案严重抖动

早期方案先后尝试过 `adjustResize`、物理缩短 Android WebView、动画修改 iOS
`WKWebView.frame`、Web 根高度补偿、visual viewport 推断和带过渡的 Tab 压缩。

这些机制不是同一个时钟：

1. Android edge-to-edge/MIUI 可能把 `adjustResize` 退化为只平移 visual viewport。
2. WindowInsets 动画会给出中间帧，最终 insets 又会通过另一路径到达。
3. WebView 自己可能执行焦点滚动或视口补偿。
4. 每一帧再跨 JNI/JavaScript 修改 DOM，会触发 React/CSS 重排。
5. 原生层与 Web 层都缩短高度时，同一键盘被消费两次。
6. Tab 的 `max-height`、padding、transform 动画又增加第三套持续变化的几何量。

因此看到的不是单纯“动画不顺”，而是多个布局所有者互相覆盖：页面在键盘升降途中反复变高、
变矮和滚动。

### 7.3 最终方案

#### 原生指标契约

共享 store 只接收归一化指标：

```text
source
visible
docked
viewportAdjusted
occludedBottom
frame
animationDurationMs
animationCurve
```

其中 `visible` 不代表必须预留底部高度；只有停靠并与屏幕底边相接的键盘才是 `docked`。
若原生已调整视口，`viewportAdjusted=true`，Web 不得再次消费 `occludedBottom`。

#### Android

- Activity 使用 `adjustNothing`，WebView 保持固定。
- 从 `WindowInsets.Type.ime()` 计算最终遮挡。
- `WindowInsetsAnimationCompat.onProgress` 不改 WebView 高度、不执行 JavaScript。
- 只在稳定边界发布指标。

#### iOS

- WKWebView 保持父视图尺寸，不动画或改写 `frame`。
- 监听 `UIKeyboardWillChangeFrameNotification`，把屏幕坐标换算到 WKWebView 坐标。
- 根据相交宽度和是否贴底区分停靠键盘与浮动键盘。

#### Web 壳与业务页

- `.mobile-app` 固定为原生 WebView 的 `100%` 高度。
- Web 根仅在 `docked && !viewportAdjusted` 时预留一次 `occludedBottom`。
- Tab 只服从原生停靠键盘指标，使用一次性 `display: none`，同时设置 `aria-hidden` 和 `inert`。
- `visualViewport` 只在原生桥不可用时用于输入态判断，不回写根高度。
- AI 页使用 `auto minmax(0, 1fr) auto`，只有 Messages 纵向滚动。
- 灵感页使用固定外壳，只有正文 textarea 内部滚动。

对应提交：`780b16b`、`770a68b`、`3a976cd`、`9a2b1c1`、`b621c9f`、`4b746f0`、
`2ea58f8`、`16053ff`、`52148fc`、`534088c`、`fbd25ca`。

## 8. Portal 更多菜单没有随键盘升起

**现象**

AI 更多菜单中的数值输入框聚焦后，菜单仍停在屏幕底部并被键盘遮挡；反而背后的 AI 页面向上
缩短。

**根因**

键盘 CSS 变量挂在 `.mobile-app` 上，而公共 Overlay 使用 `createPortal(..., document.body)`。
Portal 不是 `.mobile-app` 的后代，无法继承变量；背景页面却仍然消费了 inset。此前只有“页面根”
和“业务页”两级所有权，没有表达“前景浮层优先于背景页面”。

**解决方案**

- `MobileBottomSheet` 增加显式 `keyboardAware` 能力，只有确实含输入控件的 Sheet 开启。
- 页面根与 Sheet 复用 `getMobileReservedKeyboardInset`，保证使用同一套
  `docked && !viewportAdjusted` 判断。
- Overlay 增加仅供变体传递布局变量的 `layerStyle`。
- keyboard-aware Sheet 直接消费键盘 inset，并按剩余可用高度限制自身最大高度。
- 该 Portal 存在期间，背景 `.mobile-app` 的键盘 padding 归零；背景 Tab 保留原布局高度但继续
  `aria-hidden/inert`，避免背板下方发生重排。
- 所有权通过 Portal 挂载状态持续到退场动画真正卸载，避免关闭途中背景先跳动。

对应提交：`9e12fd3`。

## 9. 验证记录与边界

### 9.1 已完成

- `npm run lint`：通过。
- `npm run build`：通过，保留项目既有大 chunk 警告。
- 新增的键盘所有权专项测试：通过。
- Android ARM64 dev APK：构建成功。
- Android 真机 `24129RT7CC`：通过 `adb install -r` 保留数据覆盖安装。
- Android 真机 AI 更多菜单：验证输入框聚焦后 Sheet 上移并压缩到键盘上方；背景页不再消费
  inset；系统返回只收起键盘，Sheet 正常回落且保持打开。
- Android 三键导航边缘返回、AI 模式菜单视觉与交互均有当天真机验证记录。

### 9.2 未覆盖或仍需处理

- 最终固定 WebView 键盘架构尚未完成 iPhone 真机全场景验收；共享实现不能替代 iOS 运行证据。
- iOS/Android 横屏、iPad 浮动键盘和外接键盘仍需专项复验。
- `npm run test:mobile-shell` 当前为 47/48：新增键盘所有权用例通过；唯一失败来自当天模式菜单
  的 `--mobile-ai-tool-mode-title-size` 与 `--mobile-ai-tool-mode-description-size`，它们被移动 UI
  基线识别为五档语义字号之外的局部字号。视觉稿和 Android 实机已通过，但 token 收口尚未完成，
  不应把整套移动壳测试描述为全绿。

## 10. 后续排查顺序

再次遇到“键盘后页面跳动、空白、遮挡或背景移动”时，按以下顺序检查：

1. 确认目标是真机/模拟器还是浏览器预览，是否能获得真实 Tauri 数据。
2. 同时记录原生 `visible/docked/viewportAdjusted/occludedBottom` 和 Web 的
   `innerHeight/visualViewport.height/offsetTop`，不要只看焦点。
3. 列出当前消费键盘高度的所有层：原生窗口、WebView、`.mobile-app`、业务页、Portal。
4. 只保留一个布局所有者；其他层只观察状态，不修改几何尺寸。
5. 确认业务页只有一个纵向滚动区，背景页在 Overlay 期间不可滚动且不重排。
6. Android 分开测试三键导航与系统手势导航。
7. 用键盘展开、系统按钮收起、重新展开、切换输入框、关闭浮层的完整循环验证；构建成功不能
   替代这组行为测试。
