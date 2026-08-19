# 地图预览 Resize 问题复盘

## 背景

地图编辑页在引入可配置地图尺寸、矩形展示区和 PixiJS 主预览引擎后，需要满足两个条件：

- 展示区宽高变化时，地图保持自身世界坐标比例，不被拉伸。
- 编辑层、预览层和鼠标交互坐标在同一个 `contain` 变换模型下对齐。

这次问题出现在 PixiJS 预览层：切换编辑或重新生成预览后比例正常，但拖动调整展示区宽度后，地图再次被横向或纵向拉伸。

## 问题现象

实际表现是：

- 初次进入或点击“预览草图”后，地图比例正确。
- 调整展示区宽度后，Pixi 画面被拉伸。
- 切换到编辑态后，SVG 编辑层比例恢复正常。
- 再切回预览或重新预览后，Pixi 比例又恢复。
- 继续调整展示区宽度，拉伸问题再次出现。

这说明地图世界坐标、SVG 编辑层和初始 Pixi 布局本身不是根因；问题更可能发生在展示区 resize 后的 Pixi 渲染链路。

## 分析与试错

### 1. 先排查外层 DOM 比例约束

早期怀疑点是外层 viewport 仍带有固定 `aspect-ratio`，导致矩形地图被强行放进正方形容器。

因此做过如下调整：

- 移除 `MapShapeViewport` 外层的固定 `aspectRatio`。
- 让 viewport 使用 `width: 100%`、`height: 100%`、`minHeight: 0`。
- 移除预览层和 SVG 层的圆角，避免视觉上误判边界。

这些改动解决了外层展示区可以变成矩形的问题，但没有彻底解决 Pixi 画面随容器宽度变化后被拉伸的问题。

### 2. 再排查坐标换算模型

随后检查 Pixi 的坐标换算逻辑，重点是是否仍按“填满容器”处理，而不是按“等比 contain”处理。

相关逻辑已调整为：

- `toViewBoxPoint` 使用 `scale = min(rect.width / viewBox.width, rect.height / viewBox.height)`。
- 鼠标坐标减去 `offsetX / offsetY` 后再换算到 viewBox。
- `buildViewportTransform` 使用同样的 `contain` 变换。
- `createInitialMapPreviewViewBox(canvas, size)` 根据容器尺寸生成等比 viewBox。
- `clampMapPreviewViewBox(currentViewBox, scene, size)` 也接收容器尺寸，避免按固定正方形边界 clamp。

这些改动解决了编辑层错位和鼠标交互换算问题，但仍没有解释“调整容器宽度后才拉伸，重新预览后恢复”的现象。

### 3. 排查 Pixi 世界容器缩放

另一个怀疑点是 Pixi 容器的 `scale` 属性在 `@pixi/react` 中可能被解释成单轴或非预期格式。

因此将：

```tsx
<pixiContainer scale={transform.scale}>
```

改为：

```tsx
<pixiContainer scale={{x: transform.scale, y: transform.scale}}>
```

这个改动更明确，也避免了 React/Pixi 适配层对标量 `scale` 的歧义，但实际问题仍然存在。

### 4. 加日志定位 resize 链路

最终通过日志确认 resize 链路中哪一段没有同步。

新增的关键日志包括：

- `resize-observer`：DOM 容器实际尺寸。
- `commit-size`：React state 中提交后的尺寸。
- `preview-state`：Pixi 预览使用的 `size`、`pixiRenderWidth`、`pixiRenderHeight`、`transform`。
- `app-size`：Pixi canvas 和 renderer 的实际尺寸。

典型异常日志如下：

```txt
expectedWidth: 635
expectedHeight: 805
canvasWidth: 1703
canvasHeight: 1208
canvasClientWidth: 635
canvasClientHeight: 805
```

这个结果非常关键：

- `ResizeObserver` 正常触发。
- React `size` 正常更新。
- Pixi 预览传入的 `width / height` 正常变化。
- DOM canvas 的 `clientWidth / clientHeight` 正常跟随容器。
- 但 canvas 的真实绘图缓冲 `canvas.width / canvas.height` 没有变化。

所以真实问题不是坐标模型，也不是地图数据比例，而是 Pixi renderer 的内部渲染缓冲没有随容器 resize 更新。CSS 把旧缓冲画面拉伸到了新 DOM 尺寸，于是用户看到地图变形。

## 最终解决方案

在 `MapPixiApplicationGuard` 中显式同步 Pixi renderer 尺寸。

核心修复：

```ts
useLayoutEffect(() => {
    if (!app?.renderer?.resize || size.width <= 0 || size.height <= 0) {
        return;
    }

    app.renderer.resize(size.width, size.height);
}, [app, size.height, size.width]);
```

同时补充 `resize-applied` 调试日志，用来确认修复后的实际状态：

```txt
expectedWidth / expectedHeight
canvasWidth / canvasHeight
canvasClientWidth / canvasClientHeight
rendererScreenWidth / rendererScreenHeight
rendererResolution
```

修复后，容器尺寸变化时不再只改变 canvas 的 CSS 尺寸，而是同步更新 Pixi renderer 的真实缓冲尺寸。这样 DOM 显示尺寸、renderer screen、canvas buffer 和 Pixi transform 使用的容器尺寸保持一致，画面不再被拉伸。

## 为什么最终方案有效

PixiJS 实际渲染依赖的是 renderer 内部的 screen 和 canvas 绘图缓冲，而不是单纯的 DOM 元素 CSS 尺寸。

之前虽然 `<Application>` 已经传入了：

```tsx
resizeTo={elementRef}
width={pixiRenderWidth}
height={pixiRenderHeight}
autoDensity
resolution={pixiResolution}
```

但在当前 `@pixi/react` 使用方式下，分栏拖动造成的尺寸变化没有稳定同步到底层 renderer buffer。结果就是：

```txt
DOM 容器变了
canvas clientWidth/clientHeight 变了
Pixi renderer buffer 没变
旧画面被 CSS 拉伸
```

显式调用 `app.renderer.resize(width, height)` 后，链路变为：

```txt
DOM 容器变化
ResizeObserver 捕获尺寸
React size 更新
Pixi renderer.resize 同步 buffer
Pixi transform 按新 size 重新计算
画面按 contain 等比显示
```

这正好补上了 resize 链路中缺失的一环。

## 验证方式

验证时开启 Pixi 性能 / resize 日志：

```js
localStorage.setItem('fc:pixiPerf', '1');
```

然后执行以下操作：

1. 打开地图编辑页。
2. 切换编辑 / 预览，确认初始比例正确。
3. 拖动左右面板或改变展示区宽度。
4. 观察地图是否保持比例。
5. 查看日志中 `resize-applied` 和 `app-size`。

修复后的关键判断：

```txt
canvasClientWidth/clientHeight 跟随容器变化
canvasWidth/canvasHeight 跟随 expectedWidth/expectedHeight 与 resolution 同步变化
rendererScreenWidth/rendererScreenHeight 与 expectedWidth/expectedHeight 一致
```

## 经验结论

这次问题容易被误判为地图坐标换算错误，因为它的视觉表现是“地图变形”。但日志证明，坐标换算和 transform 基本正确，真正的问题是渲染缓冲没有 resize。

后续遇到 canvas / WebGL 画面变形，应优先同时检查三组尺寸：

```txt
容器尺寸：ResizeObserver / getBoundingClientRect
CSS 尺寸：canvas.clientWidth / canvas.clientHeight
绘图缓冲：canvas.width / canvas.height / renderer.screen
```

只看 DOM 或只看 React state 都不够。对于 Pixi、Deck、Three.js 这类 WebGL 渲染器，最终必须确认 renderer 自己的 buffer 与屏幕容器同步。

