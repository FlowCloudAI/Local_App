# 水墨风格 Shader 优化实施方案

> **基于**: `docs/Ink.md` 视觉优化分析  
> **当前状态**: Shader 架构已完成（Phase 1-3）  
> **目标**: 实现水墨风格核心视觉特征

---

## 📋 当前已实现 vs 文档需求对照

### ✅ 已实现（Phase 1-3）

| 功能 | 文档编号 | 状态 | Shader |
|------|---------|------|--------|
| 宣纸颗粒 | A 部分 | ✅ 完成 | `paper-grain` |
| 墨水晕染 | 墨韵 | ✅ 完成 | `ink-bleed` |
| 边缘加深 | - | ✅ 完成 | `edge-darken` |
| 色调老化 | - | ✅ 完成 | `chromatic-ageing` |

### ❌ 待实现（文档核心需求）

| 功能 | 文档编号 | 优先级 | 描述 |
|------|---------|--------|------|
| 毛笔边界 + 飞白 | **B** | 🔥 最高 | 变宽、收出锋、带飞白的墨笔 |
| 淡墨浓淡渐变 | **C** | 🔥 高 | 近岸淡墨晕开、墨分五色 |
| 朱红闲章 + 落款 | 朱印 | 🔥 高 | 角落闲章 + 竖排题名 |
| 多层晕染 | 墨韵 | 中 | 焦墨核心 + 淡墨外晕分层 |
| 稀疏水纹 | **D** | 中 | 极稀疏淡墨曲线 |
| 皴法山峦 | **E** | 低 | 独立功能，工作量大 |

---

## 🎯 Phase 4: 水墨核心特征实施

### 优先级 1: 毛笔边界 + 飞白（项目 B）

**目标**: 实现水墨的"命门"——有提按顿挫和飞白的毛笔笔触

#### 实现方案

**1. Brush Stroke Shader**

```glsl
// brush-stroke.frag
precision highp float;

uniform sampler2D u_distanceField;
uniform sampler2D u_landMask;
uniform vec2 u_resolution;

// 毛笔参数
uniform float u_baseWidth;          // 基础笔宽 (2-5px)
uniform float u_widthVariation;     // 宽度变化 0-1
uniform float u_dryBrushThreshold;  // 飞白阈值 0-1
uniform vec3 u_inkColor;            // 墨色

varying vec2 vTextureCoord;

float hash(vec2 p) {
    return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453);
}

// 沿边缘的笔压模拟（转折重、直段轻）
float getBrushPressure(vec2 pos, vec2 grad) {
    // 梯度变化大 = 转折处 = 提按"顿"
    float gradChange = length(grad);
    return mix(0.7, 1.3, smoothstep(0.0, 0.5, gradChange));
}

void main() {
    float distToCoast = texture2D(u_distanceField, vTextureCoord).r * length(u_resolution);
    float isLand = texture2D(u_landMask, vTextureCoord).r;
    
    // 只在边缘附近处理
    if (distToCoast > 10.0) {
        discard;
    }
    
    // 仅海洋侧绘制墨线
    if (isLand > 0.5) {
        discard;
    }
    
    vec2 pos = vTextureCoord * u_resolution;
    
    // 计算边缘梯度（用于提按）
    vec2 grad = vec2(
        texture2D(u_distanceField, vTextureCoord + vec2(1.0/u_resolution.x, 0.0)).r - distToCoast,
        texture2D(u_distanceField, vTextureCoord + vec2(0.0, 1.0/u_resolution.y)).r - distToCoast
    );
    
    // 笔压（提按顿挫）
    float pressure = getBrushPressure(pos, grad);
    
    // 沿边缘的噪声（飞白）
    float edgeNoise = hash(pos * 0.1);
    
    // 飞白效果：随机断口
    if (edgeNoise < u_dryBrushThreshold) {
        discard;  // 枯笔处不画
    }
    
    // 笔宽变化
    float strokeWidth = u_baseWidth * pressure * (1.0 + (edgeNoise - 0.5) * u_widthVariation);
    
    // 距离到笔触的衰减
    float alpha = smoothstep(strokeWidth, strokeWidth * 0.5, distToCoast);
    
    // 墨色浓淡（边缘浓、外围淡）
    float inkDensity = mix(0.9, 0.4, distToCoast / strokeWidth);
    
    gl_FragColor = vec4(u_inkColor, alpha * inkDensity);
}
```

**预期效果**:
- ✅ 笔宽有粗细变化（提按）
- ✅ 转折处略粗（顿笔）
- ✅ 随机断口（飞白）
- ✅ 边缘浓、外围淡（墨韵）

**性能**: ~2.5ms @ 1920×1080

---

### 优先级 2: 淡墨浓淡渐变（项目 C）

**目标**: 近岸一圈淡墨晕开，向内陆渐隐，实现"墨分五色"

#### 实现方案

**2. Ink Gradient Shader**

```glsl
// ink-wash.frag
precision highp float;

uniform sampler2D u_distanceField;
uniform sampler2D u_landMask;
uniform vec2 u_resolution;

// 淡墨参数
uniform float u_washWidth;          // 淡墨带宽度 (20-50px)
uniform vec3 u_lightInk;            // 淡墨颜色
uniform float u_washOpacity;        // 整体透明度

varying vec2 vTextureCoord;

void main() {
    float distToCoast = texture2D(u_distanceField, vTextureCoord).r * length(u_resolution);
    float isLand = texture2D(u_landMask, vTextureCoord).r;
    
    // 只在陆地侧处理
    if (isLand < 0.5) {
        discard;
    }
    
    // 近岸淡墨渐变（0px 浓 → washWidth 透明）
    float washFade = smoothstep(u_washWidth, 0.0, distToCoast);
    
    // 浓淡层次（多层叠加效果）
    float layer1 = smoothstep(u_washWidth * 0.3, 0.0, distToCoast) * 0.4;
    float layer2 = smoothstep(u_washWidth * 0.7, 0.0, distToCoast) * 0.3;
    float layer3 = washFade * 0.2;
    
    float totalAlpha = (layer1 + layer2 + layer3) * u_washOpacity;
    
    if (totalAlpha < 0.01) {
        discard;
    }
    
    gl_FragColor = vec4(u_lightInk, totalAlpha);
}
```

**预期效果**:
- ✅ 近岸淡墨晕开
- ✅ 三层浓淡（墨分五色）
- ✅ 向内陆平滑过渡到留白

**性能**: ~2ms @ 1920×1080

---

### 优先级 3: 朱红闲章 + 落款（朱印）

**目标**: 角落加朱红闲章 + 竖排题名，提升正宗感

#### 实现方案

**3. 使用现有资产系统**

在 `overlays.tsx` 中添加：

```typescript
// 绘制角落闲章
function drawCornerSeal(
    ctx: CanvasRenderingContext2D,
    canvas: { width: number; height: number },
    style: PixiMapStyle
) {
    const sealSize = 60
    const margin = 20
    const x = canvas.width - sealSize - margin
    const y = margin
    
    // 绘制朱红方形印章
    ctx.fillStyle = '#9b2323'
    ctx.globalAlpha = 0.85
    ctx.fillRect(x, y, sealSize, sealSize)
    
    // 绘制印文（简化版，可后续改为图片）
    ctx.fillStyle = '#f5f0e8'
    ctx.font = 'bold 32px STKaiti, KaiTi'
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillText('墨', x + sealSize/2, y + sealSize/2)
    
    ctx.globalAlpha = 1.0
}

// 绘制竖排落款
function drawVerticalInscription(
    ctx: CanvasRenderingContext2D,
    canvas: { width: number; height: number },
    mapName: string
) {
    const x = canvas.width - 100
    const y = 100
    
    ctx.fillStyle = '#121212'
    ctx.font = '18px STKaiti, KaiTi'
    ctx.globalAlpha = 0.7
    
    // 竖排文字
    const chars = mapName.split('')
    chars.forEach((char, i) => {
        ctx.fillText(char, x, y + i * 24)
    })
    
    ctx.globalAlpha = 1.0
}
```

**预期效果**:
- ✅ 右上角朱红闲章
- ✅ 右侧竖排地图名
- ✅ 极正宗的水墨画感觉

**性能**: ~0.5ms（Canvas 2D 绘制）

---

### 优先级 4: 多层晕染增强（墨韵）

**目标**: 现有 `ink-bleed` 改为多层叠加，焦墨核心 + 淡墨外晕

#### 实现方案

**4. 增强现有 Ink Bleed Shader**

在 `inkBleedPlugin.ts` 中添加多层模式：

```glsl
// 在原 shader 基础上添加多层支持
uniform int u_layers;               // 晕染层数 (2-4)
uniform float u_layerSpacing;       // 层间距

void main() {
    vec4 centerColor = texture2D(uTexture, vTextureCoord);
    
    if (centerColor.a < 0.01) {
        discard;
    }
    
    vec3 finalColor = centerColor.rgb;
    float totalAlpha = centerColor.a;
    
    // 多层晕染（从内到外）
    for (int layer = 0; layer < 4; layer++) {
        if (layer >= u_layers) break;
        
        float layerRadius = u_bleedRadius * (1.0 + float(layer) * u_layerSpacing);
        float layerIntensity = u_intensity * (1.0 - float(layer) / float(u_layers));
        
        // ... 原有的径向采样逻辑，使用 layerRadius
    }
    
    gl_FragColor = vec4(finalColor, totalAlpha);
}
```

**预期效果**:
- ✅ 焦墨核心（浓）
- ✅ 多层外晕（逐渐变淡）
- ✅ 更有墨韵

**性能**: ~4ms @ 1920×1080（多层）

---

## 📦 实施计划

### Phase 4.1: 核心毛笔效果（1-2 天）

**任务**:
1. 实现 `brushStrokePlugin.ts`（毛笔边界 + 飞白）
2. 实现 `inkWashPlugin.ts`（淡墨渐变）
3. 注册插件并集成到 overlays

**产出**:
- 水墨风格的决定性提升
- 性能开销 ~5ms（可接受）

### Phase 4.2: 正宗感补丁（半天）

**任务**:
1. 在 overlays.tsx 添加朱红闲章绘制
2. 添加竖排落款绘制
3. 集成到水墨风格配置

**产出**:
- 极正宗的水墨画视觉
- 性能开销 ~0.5ms（可忽略）

### Phase 4.3: 墨韵增强（可选，1 天）

**任务**:
1. 增强 `inkBleedPlugin` 支持多层晕染
2. 参数调优

**产出**:
- 更有层次的墨韵
- 性能开销 +1ms

---

## 🎨 推荐配置（Phase 4 完成后）

```typescript
// ink.ts 更新配置
{
    decorations: [
        {
            id: 'brush-stroke',        // 新增：毛笔边界
            implementation: 'shader',
            params: {
                baseWidth: 3.5,
                widthVariation: 0.4,
                dryBrushThreshold: 0.15,
                inkColor: '#121212',
            }
        },
        {
            id: 'ink-wash',            // 新增：淡墨渐变
            implementation: 'shader',
            params: {
                washWidth: 35,
                lightInk: '#666666',
                washOpacity: 0.12,
            }
        }
    ],
    effects: [
        {
            id: 'paper-grain',
            implementation: 'shader',
            params: {
                density: 1200,
                opacity: 0.06,
                darkColor: '#d4c5a9',
                lightColor: '#f5f0e8',
            }
        },
        {
            id: 'ink-bleed',           // 增强：多层晕染
            implementation: 'shader',
            params: {
                bleedRadius: 4,
                intensity: 0.35,
                samples: 10,
                layers: 3,             // 新增
                layerSpacing: 0.5,     // 新增
            }
        }
    ],
    // 新增：朱红闲章和落款
    cornerSeal: {
        enabled: true,
        color: '#9b2323',
        size: 60,
    },
    inscription: {
        enabled: true,
        text: '世界全图',
    }
}
```

---

## 📊 性能预估

### Phase 4 完成后

| Shader/功能 | 耗时 |
|------------|------|
| brush-stroke | 2.5ms |
| ink-wash | 2ms |
| paper-grain | 1ms |
| ink-bleed（多层） | 4ms |
| corner-seal + inscription | 0.5ms |
| **总计** | **10ms** |

**结论**: 仍然保持 60fps（16ms/帧）以下，性能优秀

---

## 🎯 成功指标

### 视觉质量

- ✅ 毛笔笔触有提按顿挫
- ✅ 飞白效果明显
- ✅ 墨分五色（浓淡层次）
- ✅ 朱红闲章 + 落款正宗
- ✅ 整体克制、留白充分

### 性能

- ✅ 首次渲染 < 60ms
- ✅ 缩放/平移 < 15ms
- ✅ 保持 60fps

### 用户反馈

- ✅ 水墨风格辨识度高
- ✅ 符合传统水墨画审美
- ✅ "一眼就是水墨"

---

## 📝 总结

基于 `docs/Ink.md` 的分析和已完成的 Shader 架构，Phase 4 将实现水墨风格的核心视觉特征：

**核心三要素**:
1. 毛笔边界 + 飞白（项目 B）
2. 淡墨浓淡渐变（项目 C）
3. 朱红闲章 + 落款（朱印）

**优势**:
- 基于已完成的 Shader 架构
- 清晰的技术路线
- 可控的性能开销
- 符合水墨美学要求

**下一步**: 开始实施 Phase 4.1（核心毛笔效果）

---

**文档版本**: v1.0  
**日期**: 2026-07-09  
**状态**: 实施方案
