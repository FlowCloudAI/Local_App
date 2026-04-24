# 地图风格化模块

本目录采用**插件式注册表**架构，每个地图风格自包含在一个文件中，便于独立维护与扩展。

---

## 如何新增一个风格

1. **新建风格定义文件**，如 `cyberpunk.ts`：

```ts
import type {MapStyleDefinition} from './types'
import {makeOceanSvgUrl} from './utils' // 如有需要

export const cyberpunkStyle: MapStyleDefinition = {
    id: 'cyberpunk',
    label: '赛博',
    fontFamily: '"Orbitron", sans-serif',
    oceanColor: '#0a0a1a',

    deckConfig: {
        polygonShaderInject: {
            'fs:DECKGL_FILTER_COLOR': `color *= vec4(0.2, 1.0, 1.2, 1.0);`,
        },
        polygonLayerProps: {lineWidthMinPixels: 1},
        scatterplotLayerProps: {/* ... */},
        textLayerProps: {/* ... */},
        deckEffects: undefined,
    },

    buildShapeTooltip: (shape) => ({
        html: `<div style="color:#0ff">${shape.name}</div>`,
        style: {backgroundColor: 'transparent', border: 'none', padding: '0'},
    }),

    // 可选：createBackgroundTexture、buildLocationIcon、transformScene 等
}
```

2. **在 `index.ts` 中注册**：

```ts
import {cyberpunkStyle} from './cyberpunk'

const registry: Record<MapStyle, MapStyleDefinition> = {
    flat: flatStyle,
    tolkien: tolkienStyle,
    ink: inkStyle,
    cyberpunk: cyberpunkStyle, // <-- 新增
}
```

3. **在 `WorldMapPanel.tsx` 的 `MapStyle` 类型中追加联合值**（若 TS 严格限定）：

```ts
// 在 WorldMapPanel.tsx 中
type MapStyle = 'flat' | 'tolkien' | 'ink' | 'cyberpunk'
```

> 注：Deck 预设统一从 `MapStyles/deck/presets` 导出，便于与 Pixi 风格系统分离演进。

---

## 接口速查

| 字段                        | 必填 | 说明                              |
|---------------------------|----|---------------------------------|
| `id`                      | ✅  | 风格唯一标识符                         |
| `label`                   | ✅  | UI 显示名称                         |
| `fontFamily`              | ✅  | 标签字体                            |
| `oceanColor`              | ✅  | 无背景图时的海洋/底色                     |
| `deckConfig`              | ✅  | deck.gl 层配置（GLSL、props、effects） |
| `createBackgroundTexture` | ❌  | 生成自定义纸张/纹理底图                    |
| `buildLocationIcon`       | ❌  | 地点 SVG 图标工厂                     |
| `buildShapeTooltip`       | ❌  | 图形悬浮提示                          |
| `buildLocationTooltip`    | ❌  | 地点悬浮提示                          |
| `transformScene`          | ❌  | scene 后处理（图标注入等）                |

---

## 现有风格

- **`flat.ts`** — 扁平现代矢量风格（默认）
- **`tolkien.ts`** — 托尔金中古羊皮纸风格（暗角 + 暖色滤镜 + 羊皮纸纹理）
- **`ink.ts`** — 水墨国画风格（去色 + 晕染后处理 + 宣纸纹理）
