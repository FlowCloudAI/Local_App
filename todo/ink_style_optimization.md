# 水墨风格 Shader 优化策略

> **针对场景**: 水墨地图风格（Ink Style）  
> **优化目标**: 墨水晕染、笔触质感、纸张纹理  
> **日期**: 2026-07-09

---

## 🎯 水墨风格特征分析

### 视觉特点

1. **墨水晕染** - 墨水在宣纸上扩散的自然效果
2. **笔触质感** - 毛笔书写的不均匀边缘
3. **纸张纹理** - 宣纸的纤维质感和颗粒感
4. **浓淡变化** - 墨色从浓到淡的自然过渡
5. **留白艺术** - 适当的空白区域

### 当前实现状态

已实现的相关 shader：
- ✅ `ink-bleed` - 墨水晕染效果
- ✅ `paper-grain` - 纸张颗粒纹理
- ✅ `chromatic-ageing` - 色调老化（可用于墨色）

---

## 🔧 已实现的核心 Shader

### 1. Ink Bleed Shader（墨水晕染）

**当前实现**:
```glsl
// 简化的径向模糊
for (int i = 0; i < u_samples; i++) {
    float angle = float(i) * angleStep;
    vec2 offset = vec2(cos(angle), sin(angle)) * radius;
    float randomRadius = hash(vTextureCoord + offset) * 0.5 + 0.5;
    vec2 sampleCoord = vTextureCoord + offset * randomRadius;
    
    vec4 sampleColor = texture2D(uTexture, sampleCoord);
    float weight = sampleColor.a * (1.0 - randomRadius);
    
    bleedColor += sampleColor.rgb * weight;
    totalWeight += weight;
}

// 暗化混合
vec3 finalColor = mix(centerColor.rgb, bleedColor * 0.85, u_intensity);
```

**参数**:
- `bleedRadius`: 晕染半径（1-10px）
- `intensity`: 效果强度（0-1）
- `samples`: 采样数（4-12）

**性能**: ~3ms @ 1920×1080

### 2. Paper Grain Shader（纸张颗粒）

**当前实现**:
```glsl
float noise = hash(gl_FragCoord.xy);
if (noise < u_density / 10000.0) {
    float colorNoise = hash(gl_FragCoord.xy + vec2(271.8, 0.0));
    vec3 grainColor = mix(u_darkColor, u_lightColor, colorNoise);
    gl_FragColor = vec4(grainColor, u_opacity);
}
```

**参数**:
- `density`: 颗粒密度（800-2400）
- `opacity`: 不透明度（0.05-0.15）
- `darkColor/lightColor`: 颗粒颜色

**性能**: ~1ms @ 1920×1080

---

## 🚀 水墨风格增强建议

### Phase 4: 水墨专项优化（可选）

#### 1. 笔触边缘效果 Shader

**需求**: 模拟毛笔书写的不均匀边缘

```glsl
// brush-stroke-edge.frag
precision highp float;

uniform sampler2D u_distanceField;
uniform sampler2D u_landMask;
uniform vec2 u_resolution;
uniform float u_roughness;      // 边缘粗糙度 0-1
uniform float u_frequency;      // 波动频率

varying vec2 vTextureCoord;

float hash(vec2 p) {
    return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453);
}

void main() {
    float distToCoast = texture2D(u_distanceField, vTextureCoord).r;
    float isLand = texture2D(u_landMask, vTextureCoord).r;
    
    // 只处理边缘区域
    if (distToCoast > 5.0 || isLand < 0.1) {
        discard;
    }
    
    // 沿边缘方向的噪声扰动
    vec2 pos = vTextureCoord * u_resolution;
    float angle = atan(pos.y, pos.x);
    float noise = hash(vec2(angle * u_frequency, distToCoast));
    
    // 不均匀的边缘
    float edgeVariation = noise * u_roughness;
    float alpha = smoothstep(0.0, 2.0 + edgeVariation, distToCoast);
    
    gl_FragColor = vec4(vec3(0.0), (1.0 - alpha) * 0.3);
}
```

**预期性能**: ~2ms  
**视觉效果**: 毛笔笔触的自然粗糙边缘

#### 2. 墨色浓淡渐变 Shader

**需求**: 根据距离和位置实现墨色从浓到淡的自然过渡

```glsl
// ink-gradient.frag
precision highp float;

uniform sampler2D uTexture;
uniform vec2 u_resolution;
uniform vec3 u_darkInk;         // 浓墨颜色
uniform vec3 u_lightInk;        // 淡墨颜色
uniform float u_gradientScale;  // 渐变尺度

varying vec2 vTextureCoord;

void main() {
    vec4 texColor = texture2D(uTexture, vTextureCoord);
    
    if (texColor.a < 0.01) {
        discard;
    }
    
    // 基于位置的渐变（从中心到边缘）
    vec2 center = vec2(0.5, 0.5);
    float dist = length(vTextureCoord - center) * u_gradientScale;
    
    // 浓淡混合
    vec3 inkColor = mix(u_darkInk, u_lightInk, dist);
    vec3 finalColor = mix(texColor.rgb, inkColor, 0.5);
    
    gl_FragColor = vec4(finalColor, texColor.a);
}
```

**预期性能**: ~1.5ms  
**视觉效果**: 墨色自然浓淡变化

#### 3. 宣纸纹理增强 Shader

**需求**: 更真实的宣纸纤维纹理

```glsl
// xuan-paper-texture.frag
precision highp float;

uniform vec2 u_resolution;
uniform float u_fiberDensity;   // 纤维密度
uniform float u_fiberLength;    // 纤维长度
uniform vec3 u_paperColor;      // 纸张底色

varying vec2 vTextureCoord;

float hash(vec2 p) {
    return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453);
}

// 生成纤维状纹理
float fiberPattern(vec2 uv) {
    float fiber = 0.0;
    
    for (int i = 0; i < 8; i++) {
        vec2 seed = vec2(float(i) * 123.45, float(i) * 678.90);
        vec2 fiberPos = vec2(hash(seed), hash(seed + vec2(1.0, 0.0)));
        float fiberAngle = hash(seed + vec2(0.0, 1.0)) * 6.28318;
        
        vec2 fiberDir = vec2(cos(fiberAngle), sin(fiberAngle));
        vec2 toFiber = uv - fiberPos;
        
        float alongFiber = dot(toFiber, fiberDir);
        float perpFiber = abs(dot(toFiber, vec2(-fiberDir.y, fiberDir.x)));
        
        if (abs(alongFiber) < u_fiberLength && perpFiber < 0.002) {
            fiber += 0.3;
        }
    }
    
    return fiber;
}

void main() {
    vec2 uv = vTextureCoord;
    
    // 细颗粒
    float grain = hash(gl_FragCoord.xy) * 0.05;
    
    // 纤维纹理
    float fiber = fiberPattern(uv * u_fiberDensity);
    
    // 混合纸张颜色
    vec3 paperTexture = u_paperColor + vec3(grain) + vec3(fiber * 0.2);
    
    gl_FragColor = vec4(paperTexture, 1.0);
}
```

**预期性能**: ~2ms  
**视觉效果**: 更真实的宣纸质感

---

## 📋 水墨风格推荐配置

### 基础配置（使用现有 Shader）

```typescript
{
    effects: [
        {
            id: 'paper-grain',
            implementation: 'shader',
            params: {
                density: 1200,              // 较低密度，宣纸感
                opacity: 0.06,              // 较淡
                darkColor: '#d4c5a9',       // 米黄色
                lightColor: '#f5f0e8',      // 浅米色
            }
        },
        {
            id: 'ink-bleed',
            implementation: 'shader',
            params: {
                bleedRadius: 4,             // 适中晕染
                intensity: 0.35,            // 较强效果
                samples: 10,                // 较多采样，更柔和
            }
        },
        {
            id: 'chromatic-ageing',
            implementation: 'shader',
            params: {
                intensity: 0.10,            // 轻微泛黄
                desaturation: 0.25,         // 降低饱和度
                tint: '#f0e8d8',           // 宣纸色调
            }
        }
    ],
    decorations: [
        {
            id: 'sea',
            implementation: 'shader',
            params: {
                depthColor: '#2c3e50',      // 深墨色海洋
                depthOpacity: 0.15,         // 较淡
                waveOpacity: 0.10,          // 极淡的波浪
                waveDensity: 0.5,           // 较少波浪
            }
        }
    ]
}
```

### 增强配置（如果实现了专项 Shader）

```typescript
{
    effects: [
        // ... 保留基础配置
        {
            id: 'brush-stroke-edge',
            implementation: 'shader',
            params: {
                roughness: 0.6,             // 较粗糙的边缘
                frequency: 20,              // 边缘波动频率
            }
        },
        {
            id: 'ink-gradient',
            implementation: 'shader',
            params: {
                darkInk: '#1a1a1a',        // 浓墨
                lightInk: '#6b6b6b',        // 淡墨
                gradientScale: 1.5,         // 渐变尺度
            }
        },
        {
            id: 'xuan-paper-texture',
            implementation: 'shader',
            params: {
                fiberDensity: 3.0,          // 纤维密度
                fiberLength: 0.05,          // 纤维长度
                paperColor: '#f5f0e8',      // 宣纸底色
            }
        }
    ]
}
```

---

## 🎨 视觉效果优化建议

### 1. 色彩调整

**水墨风格色彩特点**:
- 主色调：黑色（墨）+ 米黄色（纸）
- 避免高饱和度色彩
- 使用灰度渐变表现层次

**Shader 调整**:
```glsl
// 在所有颜色处理后，统一降低饱和度
vec3 hsv = rgb2hsv(finalColor);
hsv.y *= 0.3;  // 大幅降低饱和度
finalColor = hsv2rgb(hsv);
```

### 2. 边缘处理

**水墨笔触边缘不应过于锐利**:
- 使用 `smoothstep` 而非 `step`
- 增加边缘的随机扰动
- 避免完美的直线

### 3. 留白处理

**适当的空白区域很重要**:
- 海洋区域可以保持较淡的墨色
- 避免填满整个画布
- 边缘留白增强艺术感

---

## 📊 性能预估

### 当前实现（基础配置）

| Shader | 耗时 |
|--------|------|
| paper-grain | 1ms |
| ink-bleed | 3ms |
| chromatic-ageing | 1.5ms |
| sea | 2ms |
| **总计** | **7.5ms** |

### 增强版本（专项 Shader）

| Shader | 耗时 |
|--------|------|
| 基础配置 | 7.5ms |
| brush-stroke-edge | 2ms |
| ink-gradient | 1.5ms |
| xuan-paper-texture | 2ms |
| **总计** | **13ms** |

**结论**: 即使增强版本也能保持 60fps（16ms/帧）以下

---

## 🛠️ 实施建议

### 短期（立即可用）

1. **使用现有 Shader**
   - 调整 `ink-bleed` 参数以增强晕染
   - 调整 `paper-grain` 模拟宣纸质感
   - 使用 `chromatic-ageing` 降低饱和度

2. **参数调优**
   - 测试不同的 `bleedRadius` 和 `intensity`
   - 调整纸张颗粒的颜色和密度
   - 优化海洋的墨色深浅

### 中期（Phase 4 可选）

3. **实现专项 Shader**
   - `brush-stroke-edge`: 毛笔边缘效果
   - `ink-gradient`: 墨色浓淡渐变
   - `xuan-paper-texture`: 宣纸纤维纹理

4. **集成测试**
   - 验证视觉效果
   - 性能基准测试
   - 用户反馈收集

### 长期

5. **高级特性**
   - 笔触动画（墨迹扩散动画）
   - 多层墨色叠加
   - 墨水流动模拟

---

## 🎯 成功指标

1. **视觉质量**: 符合传统水墨画审美
2. **性能**: 保持 60fps（<16ms/帧）
3. **用户反馈**: 水墨风格辨识度高
4. **技术指标**: GPU 使用率 < 30%

---

## 📝 总结

**当前状态**: ✅ 基础水墨效果已实现  
**推荐行动**: 
1. 使用现有 shader 进行参数调优
2. 视觉效果验证
3. 如果需要更强的水墨感，考虑实现专项 shader

**优势**:
- 已有的 `ink-bleed` shader 提供核心晕染效果
- `paper-grain` 和 `chromatic-ageing` 可以模拟宣纸质感
- 性能优异，适合实时交互

**下一步**: 建议先用现有 shader 进行视觉调优，根据实际效果决定是否需要开发专项 shader。

---

**文档版本**: v1.0  
**日期**: 2026-07-09  
**状态**: 建议文档
