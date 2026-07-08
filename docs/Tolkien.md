# 托尔金风格地图渲染 · 视觉优化分析

> 范围：`app_main` 世界地图「Pixi 风格化」中的托尔金（羊皮纸）预设。
> 目的：记录当前实现的视觉短板与优化方向，供后续迭代落地。
> 相关性能修复已完成（见文末「与性能修复的关系」），本文只谈**视觉**。

## 1. 当前实现（文件地图）

| 职责 | 位置 |
| --- | --- |
| 风格配置（配色 / 边界 / 海岸线 / 图标 / 标签 / 效果栈） | `src/features/maps/styles/pixi/presets/tolkien.ts` |
| 羊皮纸底纹生成 | `src/features/maps/styles/common/textures.ts` → `createParchmentTexture` |
| 叠加层（效果 / 海岸线 / 罗盘 画到画布再转纹理） | `src/features/maps/styles/pixi/overlays.tsx` → `createOverlayDataUrl` |
| 效果笔刷（做旧 / 描边 / 罗盘 / 图标 SVG） | `src/features/maps/styles/pixi/assets/index.ts` |
| 陆地填充与描边绘制 | `src/features/maps/components/MapShapeEditor/MapPixiPreview.tsx` → `compilePixiShape` / `drawShapeFill` |

当前托尔金栈：羊皮纸径向渐变底 + 四角老化 + 纸纤维；陆地纯色半透明填充（`#ead8ac` @0.72）+ 暖褐描边；两层抖动折线海岸线；`chromatic-ageing / edge-darken / paper-grain / vignette` 四个做旧效果；罗盘；城堡/塔/村落/遗迹 SVG 图标；衬线标签带浅色 halo。

## 2. 客观短板：清晰度（放大即糊）

**这是唯一不主观的问题，应最先解决。**

`createParchmentTexture(width, height)` 与 `createOverlayDataUrl` 都按**场景画布尺寸**画一张 PNG（`overlays.tsx` 里 `canvas.width = context.scene.canvas.width`），再作为一张 Sprite 按视口 transform 拉伸显示。后果：

- 放大（scale > 1）时整张纸纹、颗粒、海岸线抖动被同步放大 → 发虚发软、颗粒变成大色块。
- 细节分辨率被"场景逻辑尺寸"锁死，与实际显示像素无关。

## 3. 优化清单（按「视觉收益 / 工作量」）

| 编号 | 项 | 现状 | 技术方向 | 收益 | 工作量 |
| --- | --- | --- | --- | --- | --- |
| **A** | **清晰度（最高优先，不主观）** | 场景分辨率单张位图，放大糊 | 纸底改**小块高清纹理平铺**（tile + UV wrap，任意缩放锐利、省内存）；全屏做旧效果（`paper-grain`/`vignette`/`chromatic-ageing`）改 **Pixi 屏幕空间滤镜/shader**，按屏幕分辨率算，又快又清晰 | 全图立刻变锐利 | 中 |
| **B** | **海岸线晕线 hatching（最出彩）** | 仅两层抖动折线（`drawCoastlineLayer`） | 在 overlay 里对海岸线**向海侧偏移描边 N 次、逐次变淡**（或短垂线晕线），复刻古地图标志性的"海里一圈圈线" | 奇幻手绘味立到位 | 中 |
| **C** | **陆地纵深** | 纯色半透明填充，像剪纸（`tolkien.ts` `regions.fill`） | 加一层**从海岸向内的渐变阴影**（近岸略深、内陆略亮），或极淡内部纹理 | 高差/纵深感 | 中 |
| **D** | **海洋质感** | 纯色海面 | 近岸**水波线**或极淡海面渐变 | 中 | 中 |
| **E** | **地形符号：山脉 / 森林 / 丘陵** | 陆地内只有点状图标，无山林 | **程序化山脉/森林笔触**（放置算法 + 绘制）撑起画面 | 视觉提升最大 | 大（独立功能） |

## 4. 推荐落地顺序

1. **先做 A（清晰度）**——解决客观短板，是后续一切细节的地基（否则加了细节放大照样糊）。
2. **再做 B（海岸线晕线）**——最大的风格化提升，改动集中在 overlay。
3. A+B 出效果后，视审美决定是否上 **C/D**（纵深/海洋），最后再评估 **E（山脉森林）**这个大工程。

> 判断留给使用者：A 是技术性的（"放大糊"客观成立）；B~E 是审美取向，需要结合参考图（更"托尔金插画"还是"清爽干净"）决定强度。

## 5. 与性能修复的关系

- 叠加层此前**每帧重建**（`createOverlayDataUrl` 的 `useMemo` 误依赖每帧变化的 `context`），已修复为按 `[scene.shapes, 画布尺寸, style]` 记忆化（见 `overlays.tsx` 与 commit `perf: 修复风格化地图 overlay 每帧重建…`）。因此 **A 里"把做旧效果搬到 GPU shader"不仅更清晰，也延续了这次性能整改的方向**：能上 shader 的效果就别再走"Canvas2D 画位图再上传"。
- 另有一处已修复的崩溃：纹理生命周期（加载 effect 的 cleanup 同步 `destroy` 导致渲染已销毁纹理），见 commit `fix: 修复非默认地图风格保存时渲染已销毁纹理崩溃`。给 A 换纹理方案时注意沿用"替换后再销毁"的模式。

---
文档创建：2026-07-08
