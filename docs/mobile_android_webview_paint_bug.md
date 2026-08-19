# 移动端标题/搜索被纵向压扁排查纪要（Android WebView 光栅化 bug → 独立合成层规避）

> 范围：`app_main` 移动端（Android）多个页面——词条列表页顶部标题/搜索、AI 对话页底部输入区，首屏渲染时被纵向压扁。
> 排查日期：2026-06-12。
> 环境：emulator-5554 / Android WebView Chromium **148.0.7778.215** / DPR **2.625** / CSS 视口 411×914。
> 性质：**渲染器内部光栅化 bug**（非布局 bug、非 flex 问题）根因定位 + 已落地一行 CSS 规避（lint/build 通过、模拟器 CDP 实证）+ 真机验收与上游上报遗留。含 CDP 实验链证据，便于复核。

---

## 0. 现象

- 词条列表/分类视图：顶部「N 个词条 / 全部词条」标题与搜索框被压得很扁、字形糊成一团，像垂直高度被错误裁切；下方词条网格正常。
- AI 对话页：底部输入区与 Tab 栏附近被压缩或位置异常。
- **桌面浏览器预览不稳定复现，Android WebView 上明显**；同一页面相邻两次进入有时正常、有时破损（DOM 与 CSS 完全相同）。

破损形态的量化特征：标题宽度正常，但被**按约 1/DPR（1/2.625 ≈ 0.38）纵向压扁**，字号 `clamp(2rem, 9vw, 2.65rem)` 渲染得远小于 2rem 下限。

---

## 1. 关键反证：布局语义上不可能，必是渲染层

用户最初在 DevTools 里发现：取消 `.mobile-entry-list__filters { display: flex }` 后，**它前面的**标题/搜索恢复正常。这条现象是整个排查的突破口——

`.mobile-entry-list__filters` 在 DOM 中位于标题/搜索**之后**，且其父 `.mobile-entry-list` 是 `display:block` 的滚动容器（非 flex）。在 block 流里，**后面的兄弟节点无论怎么改 `display`，都不可能改变前面兄弟的布局**——这不是「不太可能」，是 CSS 规范层面的不可能。

所以"取消 filters 的 `display:flex` 修好了上面的标题"只剩一种解释：**问题不在布局计算，而在 paint/光栅化。** 在 DevTools 改任意属性都会强制 style recalc + relayout + 重新光栅化，看到的"治愈"是渲染结果被刷新，不代表被改的属性是病因。

---

## 2. 实验链（CDP over WebView，每步有截图存证）

通过 `adb forward` 把 WebView 的 `@webview_devtools_remote_<pid>` 暴露到本地 9222，用 CDP（Chrome DevTools Protocol）做受控实验。两类截图对照：`adb screencap`（屏幕实际像素）与 CDP `Page.captureScreenshot`（**渲染器内部**输出）。

| # | 操作 | 结果 | 推断 |
|---|---|---|---|
| 1 | 复现破损态，读 `getBoundingClientRect` / computed style | 标题 `y=132.3, h=36.3`、字号 `37.03px`，**全部正常** | 布局树是对的，画出来的像素是错的 |
| 2 | CDP `Page.captureScreenshot`（渲染器内部截图） | **同样压扁** | 坏在 Chromium 渲染管线内部，非 Android 显示链路 |
| 3 | 对标题加无害 `outline` / `translateZ` 层切换 / 滚走再滚回 | **都修不掉**；对滚动容器加 outline 只修好搜索框，标题留**重影** | 元素级失效触达不到，坏瓦片被缓存锁死 |
| 4 | 复刻用户操作：filters 改 `display:block` | 瞬间痊愈 | —— |
| 5 | 接 #4：filters 改回 `display:flex` | **瞬间复发** | 开关在 toggle 动作本身，不在 flex |
| 6 | filters 改 `display:grid` / `block`+`overflow:auto` | **照样破损** | 与 display 类型完全无关 |
| 7 | filters `overflow-x:visible`（挂载即生效） | **干净**（但丢失横向滚动） | 开关是"**是不是滚动容器**" |
| 8 | 注入 CSS 去掉 surface 的 `will-change`/`transform`、去掉 topbar `sticky`，重新导航 | **仍破损** | sticky / 常驻合成层都不是必要条件 |
| 9 | 冷启动（force-stop 后首次进入，无任何缓存） | **破损，3/3** | 用户每次都会遇到，非长会话特例 |
| 10 | filters 加 `transform: translateZ(0)`，重新导航 | **干净，2/2**，横滑功能完好 | 自带合成层可绕过 |

**结论**：触发条件是「**页面首次光栅化时存在嵌套的滚动容器**」，受害者是该滚动容器**前方**的同层内容。`display` 是 flex/grid/block 无关紧要；`overflow-x:auto`（构成滚动容器）才是因果链上的那一环。本质是 Chromium 较新版本（148）的一个 paint/合成回归——把滚动容器前方内容的瓦片以错误的缩放光栅化，并被瓦片缓存固化，直到 paint 配置重建才刷新。

---

## 3. 被排除的误判

- **不是布局 bug**：gBCR 与 computed style 全程正确（§2 #1）。
- **不是 flex 的锅**：grid、block 同样触发（§2 #6）。"禁止滚动容器 `display:flex`"是错误的规则方向。
- **不是 nested flex + min-height:0 链路**：这是业界标准聊天布局，且词条页根本不是 flex 滚动容器却有同症状。
- **不是 viewport 太小**：`--mobile-entry-drawer-width: 357px`（= `100vw - 3.5rem`）反推 CSS 视口宽 ≈ 413px，正常。
- **不是 sticky / `will-change` / `translate3d` 常驻合成层**：去掉后仍复现（§2 #8）。
- **元素级失效救不了**：outline、`translateZ` toggle、滚动离开返回都修不掉（§2 #3）——印证是被缓存的坏瓦片，而非可被任意 invalidation 刷新的状态。

---

## 4. 已落地方案（2026-06-12）

**给横向滚动容器强制独立合成层，绕过 paint 配置重建后的错误光栅化。** 项目已有现成挂点 `data-mobile-horizontal-scroll="true"`（原用于侧边抽屉手势豁免横滑，详见 `useMobileSideDrawerGesture.ts`），一条属性选择器即可全覆盖现有与未来所有横滑区。

| 文件 | 改动 |
|---|---|
| `app_main/src/app/mobile/MobileApp.css` | 新增 `[data-mobile-horizontal-scroll="true"] { transform: translateZ(0); }`，附 bug 背景注释 |
| `app_main/src/app/mobile/pages/MobileAiChat.css` | `.mobile-ai-chat__messages` 加 `transform: translateZ(0)`（纵向滚动区，防御性处理，见 §6） |
| `AGENTS.md` §5.1 | 红线更新：`data-mobile-horizontal-scroll` 双职责（手势豁免 + 合成层规避），并注明"与 flex/grid/block 无关" |

核心规则（`MobileApp.css`）：

```css
/*
 * Android WebView(Chromium 148 实测)光栅化 bug:页面首次渲染时若存在嵌套滚动容器,
 * 其前方同层内容会被按 1/DPR 纵向压扁,且与滚动容器的 display(flex/grid/block)无关。
 * 强制横滑区独立合成层可绕过。新增横滑区必须挂 data-mobile-horizontal-scroll(见 AGENTS.md 5.1)。
 */
[data-mobile-horizontal-scroll="true"] {
    transform: translateZ(0);
}
```

覆盖范围：`MobileEntryList.tsx` 的 `.mobile-entry-list__filters`、`MobileProjectHome.tsx` 的 `.mobile-project-home__next-steps`（两处均已带该标记）。

### 4.1 为什么不做大重构

排查前曾考虑"改稳定布局范式"（根层固定分区、滚动区只用 block/grid、横滑外层 block + 内层 flex、底部 Tab 改 fixed）。**实验直接否定了这条路**：

- §2 #6 证明 block 滚动容器**挂载时照样触发**——"外层 block 滚动 + 内层 flex"的 wrap 模式修不了。
- 底部 Tab 改 fixed、滚动区改 block 都与病因（滚动容器光栅化）无关，是白付成本，还会引入键盘遮挡 / 内容 padding 管理的新坑（Tauri WebView 无 URL bar 收缩问题，column flex 本就更稳）。

### 4.2 验证

```bash
cd app_main
npm run lint    # 0 error（唯一 warning 在无关的 maps 文件）
npm run build   # 通过（chunk 体积警告为存量问题）
```

模拟器实证：把最终形态规则经 CDP 注入运行中的 app，重新导航进词条列表——**挂载即正常**。结合 §2 #9/#10，修复后 3/3 干净（含冷启动），不修 3/3 必坏。AI 页 composer 与底部 Tab 位置正常，无回归。

> 注意：模拟器当前跑的仍是旧打包资产，上述验证靠 CDP 注入模拟真实 CSS 生效后的效果。

---

## 5. 真机验收与上游上报（遗留）

- **重新出安卓包后真机验收**：冷启动 → 项目主页 → 全部词条，标题/搜索一次到位不压扁；反复进出多次稳定；AI 对话页键盘开合后底部输入区与 Tab 正常。
- **本方案是 workaround，根因在 Chromium**。建议做一个最小 HTML 复现页（一个 `overflow-x:auto` 滚动容器 + 其前方一段文本，高 DPR 下首屏渲染）报 crbug。日后某次 WebView 升级若想确认是否还需这层规避：删规则 → 冷启动进一次词条列表即可验证。
- **AI 对话页变体未实证**：`.mobile-ai-chat__messages` 是 flex + `overflow-y` 滚动容器同体，用户报告 toggle 其 display 可愈（符合瓦片缓存模型），但 2026-06-12 用键盘开合**未复现**。已先做防御性层促升，真机按实际操作路径再验一次。

---

## 6. 2026-06-22 表单控件 focus 变体补充

### 6.1 新现象

复现路径：项目总览 → 「类型管理」或「标签管理」→ 右上角「+」→ 新建类型/标签弹窗。

现象与 §0 的滚动容器压扁不是同一个触发点：输入框聚焦后，输入框自身尺寸、蓝色 focus ring、弹窗布局位置都正常，但输入框里的 placeholder/文本字形会被压扁或低清栅格化；取消/创建等按钮也可能被同一轮错误绘制影响。`getBoundingClientRect` 仍然正常，因此仍属于 **paint/raster/compositing**，不是 layout。

### 6.2 已验证无效或不稳定的方向

- `interactive-widget=overlays-content` 运行时替换：未解决 focused input 内部字形错误。
- `android:windowSoftInputMode="adjustNothing"`：可减少部分 viewport 调整变量，但没有解决该弹窗输入框的 placeholder 栅格化；实验改动已回退，不能作为最终方案。
- 去掉弹窗背景模糊 / 改黑色半透明遮罩：不足以修复输入框内部文字。
- 对 input/button 加 `transform: translateZ(0)`、`will-change: transform`、`contain: paint`、`backface-visibility: hidden`：未修复，且会引入新的合成层变量。
- 把 placeholder 改成额外 DOM/伪元素绘制：只是绕过原生 placeholder 路径，实测不应作为通用修复。
- `WebSettings.LayoutAlgorithm.NORMAL`：没有证据表明它能控制软键盘或 WebView viewport resize；不要作为优先项。

### 6.3 新的强信号

用户通过 DOM 试验确认：**取消文本框及其 focus/outline 相关显式样式后，输入框文字恢复正常**，但会露出 Chromium/Android 原生橙色 focus 边框。

这说明该变体的最小触发点更可能是：

```text
Android WebView + focused form control + 自定义 outline/border/box-shadow focus 样式
```

而不是单纯的软键盘 viewport resize，也不是弹窗 blur 本身。`font-family` 会改变错误程度，说明它确实经过字体 glyph raster 路径，但「Texture Atlas 碎片化 / Glyph Cache 旧 UV」目前只能作为推测，不能写成已证实根因，除非有 Chromium trace 或 issue 支撑。

### 6.4 后续修复原则

对表单控件变体，不要照搬 §4 的「给滚动容器加独立合成层」规则。当前更稳的方向是：

1. input/textarea 本体尽量少接管 focus 绘制路径。
2. 逐项回加验证：`outline: none`、`:focus border-color`、`:focus box-shadow`，找出最小触发属性。
3. 如果确认自定义 focus 样式触发，把视觉焦点移到外层 wrapper，用 `:focus-within` 画边框/阴影；input 本体保留更接近原生的绘制路径。
4. 不要为了消灭橙色原生 focus ring 直接堆 `translateZ(0)` 或 WebView 原生配置；先用单属性往返试验确认。

判别口诀补充：**布局数据正确、只有 focused input 内部字形坏，且取消自定义 focus 样式后恢复 → 优先怀疑 form control 的原生绘制路径被 CSS focus 样式触发了 WebView raster bug。**

---

## 7. 定位手法备忘

- **WebView 远程调试**：`adb -s <dev> shell "cat /proc/net/unix | grep webview_devtools"` 找到 `@webview_devtools_remote_<pid>`（冷启动后 pid 变，需重新发现）→ `adb forward tcp:9222 localabstract:<sock>` → `curl http://127.0.0.1:9222/json` 取 `webSocketDebuggerUrl`，之后用 CDP `Runtime.evaluate` / `Page.captureScreenshot` 受控实验。脚本见排查时的 `.tmp-cdp/`（未跟踪，可删）。
- **判别"布局坏"还是"渲染坏"**：读 `getBoundingClientRect` + computed style，若数值正确而屏幕错位，就是 paint/光栅化层；再用 CDP `Page.captureScreenshot`（渲染器内部）和 `adb screencap`（屏幕）对照，二者都坏 → 排除显示链路，锁定 Chromium 渲染管线。
- **当心 DevTools 的"治愈假象"**：改任意属性都强制 recalc/relayout/repaint。要判断某属性是不是真病因，必须做**往返试验**（改 → 复发？）和**无害对照**（加 `outline:transparent` 能不能也"修好"？）。本案正是靠 #4↔#5 往返 + #6 多 display 对照，把锅从 `display:flex` 摘掉、扣到"是不是滚动容器"上。
- **冷启动复现**：`adb shell am force-stop <pkg>` 后重新走导航路径，排除"长会话/缓存特例"的干扰，确认是否每个用户首屏都中招。
- **判别口诀**：**桌面正常、只有移动端 WebView 坏，且布局数据正确 → 先怀疑该 WebView 版本的 paint/合成实现，用独立合成层（`translateZ(0)`）试探，别在布局结构里翻。**
