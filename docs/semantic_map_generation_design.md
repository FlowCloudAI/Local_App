# FlowCloudAI MapShapeEditor：面向风格化地图生成的语义化控制与确定性渲染引擎

## 1. 项目概述

在传统的程序化地图生成工具中，用户往往被迫直接面对底层算法常量——频率、权重、哈希乘子、细分预算……这些参数对开发者而言是可控的，但对创作者而言却是认知负担。我们的目标不是做一个“参数更多”的生成器，而是构建一套**
“用户调结果，后端管公式”** 的风格化地图生产基线。

本项目基于 **Tauri (Rust) + React + TypeScript** 技术栈，围绕 `MapShapeEditor`
模块实现了一套解耦的地图编辑与生成系统。前端通过受控组件维护可编辑草稿，后端负责高保真的自然海岸线生成与确定性图布局计算。更重要的是，我们在产品层确立了一套
**语义化参数控制体系**，为未来的 fantasy、hand-drawn、parchment、cyber、political 等多种风格化地图奠定了统一的交互与接口基调。

---

## 2. 核心设计原则：五层范式

我们在设计参数体系时，确立了以下五条不可退让的核心原则：

1. **用户调结果，不调公式**  
   用户关心的是“更平滑还是更粗糙”“更紧还是更松”，不是 `COASTLINE_WAVE_B_WEIGHT` 或 `HASH_UNIT_MULTIPLIER`。

2. **标准 / 专业分层，但专业也不全开底层实现细节**  
   标准模式提供 6 个主旋钮；专业模式开放 12 个二级风格参数。数值保护项、时间常量、内部 salt 仍然不外露。

3. **质量档位独立出来，专门控制计算预算**  
   预览 / 快速 / 均衡 / 精细 / 发布，这五档控制的是迭代次数、细分预算、后处理强度与最终稳定化程度，与风格参数正交。

4. **保留单一 Seed，支持复现与社区分享**  
   用户只看到并操作一个主 Seed；后端由该 Seed 派生出 coastline 噪声盐值、布局随机源等完整子系统。

5. **分享的最小单位是“带版本的配置快照”**  
   可复现性不依赖 Seed 本身，而依赖 `{ version, styleFamily, qualityTier, seed, controlsSnapshot }` 这一完整对象。

---

## 3. 系统架构

```
┌─────────────────────────────────────────────────────────────┐
│                        前端 (React + TS)                     │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────────┐  │
│  │ MapShapeSvg  │  │ MapDeckPreview│  │ 语义化参数面板    │  │
│  │   Editor     │  │   (deck.gl)   │  │ 标准/专业/档位   │  │
│  └──────┬───────┘  └──────────────┘  └──────────────────┘  │
│         │ draft (shapes + keyLocations + viewBox)           │
│         └────────────────────────────────────────────────┐  │
│                          Tauri invoke                    │  │
└──────────────────────────────────────────────────────────┼──┘
                                                           │
┌──────────────────────────────────────────────────────────┼──┐
│                     后端 (Rust)                          │  │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────────┐│  │
│  │  coastline   │  │   layout     │  │  语义参数映射引擎 ││  │
│  │    .rs       │  │   engine     │  │  (计划中)        ││  │
│  └──────────────┘  └──────────────┘  └──────────────────┘│  │
│         │                   │                            │  │
│         └───────────────────┴────────────────────────────┘  │
│                          scene (MapPreviewScene)            │
└─────────────────────────────────────────────────────────────┘
```

### 3.1 前端：完全受控的状态托管

参考 `MapShapeEditorDemo.tsx` 的实现，前端不再依赖旧的一体式工作台，而是显式组合 `MapShapeSvgEditor`、`MapDeckPreview`
与外部状态：

- `draft`：当前可编辑的 shapes 与 keyLocations
- `selectedShapeId / selectedLocationId`：当前选中项
- `drawingShape`：正在绘制中的临时图形
- `viewBox`：编辑区视口状态
- `previewSource`：区分“草稿派生预览”与“后端返回场景”

所有删除、变更、缩放动作都在外部状态完成，编辑器本身保持纯受控，这为后续接入语义化参数面板提供了干净的状态边界。

### 3.2 后端：Rust 高性能计算层

后端通过 Tauri Command 暴露接口，当前核心命令为 `map_save_scene`。Rust 侧按模块化职责拆分：

| 模块             | 职责                         |
|----------------|----------------------------|
| `types.rs`     | 请求/响应协议、预览场景结构             |
| `service.rs`   | 保存主流程、校验、场景组装              |
| `geometry.rs`  | 点线关系、线段相交、多边形自交、点在多边形内     |
| `color.rs`     | 十六进制转 deck RGBA、地点类型颜色映射   |
| `coastline.rs` | 自然海岸线生成（细分 + 噪声 + 平滑 + 回退） |
| `constants.rs` | 底层算法常量集中管理                 |

---

## 4. 核心技术创新

### 4.1 语义化参数映射引擎：从“算法旋钮”到“风格旋钮”

#### 问题

在 `src-tauri/src/map/constants.rs` 中，海岸线算法涉及 20 余个底层常量，例如：

- `COASTLINE_AMPLITUDE_BASE`：振幅基础比例
- `COASTLINE_RELAX_WEIGHT`：平滑权重
- `COASTLINE_WAVE_A_BASE / SPAN / WEIGHT`：大尺度噪声频率与权重
- `COASTLINE_SEGMENT_BASE / LENGTH_FACTOR`：边长细分预算

若将这些常量直接暴露给前端，用户需要理解“频率”“权重”“归一化长度”等概念，产品门槛极高。

#### 解决方案

我们在后端计划引入一层**语义化参数映射引擎**（尚无独立模块，当前参数直接定义于 `constants.rs`）。MVP 阶段尚未实现该映射层，参数值由
`constants.rs` 中的硬编码常量直接提供。

**前端暴露的语义参数（标准模式）：**

| 语义参数                | 用户感知        | 映射的底层行为                      |
|---------------------|-------------|------------------------------|
| `roughness`（波动程度）   | 更平滑 ↔ 更狂野   | 振幅上下限、三层噪声权重组合               |
| `detail`（细节程度）      | 更少 ↔ 更多     | 细分预算 `min/max segments`、去重阈值 |
| `fidelity`（保真/约束程度） | 更自由 ↔ 更紧贴草稿 | 平滑轮数与权重、回退策略敏感度              |
| `scale`（尺度）         | 更小岛屿 ↔ 更大陆块 | 画布比例参考的振幅上限                  |
| `theme`（配色主题）       | 预设风格        | 填充/描边调色板、地点颜色映射              |
| `seed`（种子）          | 变体控制        | 派生所有内部噪声盐值                   |

**专业模式**在此基础上增加二级参数，例如：

- 大尺度起伏权重 `macroWaveWeight`
- 中尺度细节权重 `mesoWaveWeight`
- 表面纹理权重 `microWaveWeight`
- 平滑强度 `relaxStrength`
- 细分密度 `segmentDensity`

但即便如此，**内部 hash 乘子、时间常量、salt 值仍然不对外**。

#### 质量档位：独立的计算预算维度

质量档位与风格参数完全正交：

| 档位         | 迭代/细分策略             | 适用场景 |
|------------|---------------------|------|
| `preview`  | 最低细分、最少平滑轮数、跳过部分后处理 | 实时反馈 |
| `fast`     | 低细分、快速平滑            | 草稿验证 |
| `balanced` | 默认预算                | 日常创作 |
| `fine`     | 提高细分上限、增加平滑轮数       | 精修   |
| `publish`  | 最大细分、完整后处理、多重稳定化    | 最终输出 |

档位通过控制 `COASTLINE_MAX_SEGMENTS`、`COASTLINE_RELAX_PASSES`、以及未来可能引入的蒙特卡洛步数来实现，**不直接修改用户的审美设定
**。

---

### 4.2 确定性自然海岸线生成算法

实现于 `src-tauri/src/map/coastline.rs`，当前算法链路如下：

1. **边长自适应细分**  
   对每条边按长度和周长比例计算 `segment_count`，钳位于 `[COASTLINE_MIN_SEGMENTS, COASTLINE_MAX_SEGMENTS]`。

2. **多层确定性噪声位移**  
   在细分点上沿外法线方向做位移，位移量由三层正弦波叠加决定：
    - Wave A：大尺度起伏（`base=1.0, span=3.5, weight=0.50`）
    - Wave B：中尺度细节（`base=2.3, span=3.7, weight=0.29`）
    - Wave C：细碎纹理（`base=6.5, span=5.1, weight=0.30`）

   噪声相位由 `hash_text(shape.id + shape.name)` 与固定 salt 通过 `hash_unit` 确定性生成，保证同一输入得到同一输出。

3. **包络控制**  
   使用 `sin(πt)^1.15` 作为边内包络，确保抖动在边两端自然衰减，避免顶点处出现尖锐断裂。

4. **轻量平滑**  
   通过 `relax_polygon` 做邻域加权平均（默认 2 轮，权重 0.16），在保留细节的同时消除数值噪声。

5. **双重回退保护**
    - 若自然化结果出现自交，或导致关键地点落在图形外，回退到“轻平滑结果”。
    - 若轻平滑结果仍不可用，回退到原始草稿轮廓。

   这一设计体现了 **可用性优先于视觉激进程度** 的工程哲学。

---

### 4.3 单一 Seed 与配置快照体系（⚠️ 设计阶段，MVP 尚未落地）

> ⚠️ 以下内容处于设计阶段，MVP 实现中尚未落地。

#### Seed 派生机制

用户只与一个主 Seed 交互（查看、输入、复制、随机、锁定）。后端通过稳定的哈希链从该 Seed 派生：

- `COASTLINE_NOISE_SALT_A = hash(seed || "coastline_a")`
- `COASTLINE_NOISE_SALT_B = hash(seed || "coastline_b")`
- `COASTLINE_NOISE_SALT_C = hash(seed || "coastline_c")`
- 布局引擎随机源、颜色抖动源等同理

**当前实现状态**：MVP 中 `coastline.rs` 使用 `shape.id + shape.name` 的哈希值与 `constants.rs` 中的固定 salt
生成噪声相位，尚未接入用户可配置的主 Seed 体系。

这意味着改变主 Seed 会一致性地改变整张地图的所有随机化表现，而不是让用户去记忆多个独立 salt。

#### 配置快照（Shareable Config Snapshot）

真正的社区分享单元不是 Seed，而是如下 JSON 对象（**当前尚无对应数据结构和 API**）：

```json
{
  "version": "map_shape_mvp_v1",
  "styleFamily": "coastline_mvp",
  "qualityTier": "fine",
  "seed": 42,
  "controls": {
    "roughness": 0.7,
    "detail": 0.6,
    "fidelity": 0.5,
    "scale": 1.0,
    "theme": "oceanic"
  }
}
```

该快照保证了：

- **可复现**：同一版本下，任何用户导入后得到完全一致的生成结果。
- **可兼容**：算法升级后，后端可通过 `version` 和 `styleFamily` 做向后兼容映射。
- **可交流**：创作者可以在社区分享“配置链接”而非截图。

---

### 4.4 确定性词条关系图布局引擎

除地图生成外，项目还实现了一套基于 **Fruchterman-Reingold 力导向模型** 的确定性图布局引擎（文档见
`tauri_deterministic_layout_engine.md`）。该引擎同样遵循“参数对象驱动求解器”的工程组织方式，与海岸线生成模块共享以下设计基因：

- **自适应参数生成**：根据连通分量的节点数 `n`、边数 `m`、图密度 `ρ`、度分布离散度 `cv_deg` 等统计量，自动推导理想边长 `L_c`
  、FR 主尺度 `k_c`、初始温度 `T0`、迭代次数等。
- **链/树型结构识别**：通过 `pathish_score` 识别稀疏链式或树式分量，温和回缩边长并执行主轴压缩，避免图被拉成过长的斜线骨架。
- **职责分离**：斥力、边吸引、碰撞修正、分量 Shelf 摆放四个阶段完全解耦。
- **确定性保证**：固定随机种子、节点按 `id` 排序、避免 `HashMap` 自然迭代顺序影响结果、输出使用有序 Map。
- **LRU 缓存**：基于标准化输入 JSON 的缓存键，浮点先稳定化缩放，避免重复计算。

这一布局引擎为项目中的“词条关系图”提供了稳定、可预测、可缓存的排版能力，与地图生成模块共同构成了**确定性程序化内容生成**
的技术双柱。

---

## 5. 前端交互与状态设计

在 `MapShapeEditorDemo.tsx` 中，我们采用了一套**完全外部托管的受控模式**：

```tsx
<MapShapeSvgEditor
  canvas={DEMO_CANVAS}
  draft={draft}
  selectedShapeId={selectedShapeId}
  selectedLocationId={selectedLocationId}
  drawingShape={drawingShape}
  viewBox={viewBox}
  invalidShapeIds={invalidShapeIds}
  invalidKeyLocationIds={invalidKeyLocationIds}
  onDraftChange={setDraft}
  onSelectedShapeChange={setSelectedShapeId}
  onSelectedLocationChange={setSelectedLocationId}
  onDrawingShapeChange={setDrawingShape}
  onViewBoxChange={setViewBox}
  onRequestShapeDelete={handleDeleteShape}
  onRequestVertexDelete={handleDeleteVertex}
  onRequestLocationDelete={handleDeleteLocation}
/>
```

这种设计的优势在于：

- **解耦**：编辑器组件本身不持有业务状态，易于嵌入不同页面。
- **可扩展**：语义化参数面板可以直接读写同一层外部状态，无需穿透组件层级。
- **可调试**：所有中间状态对用户透明，便于在 Demo 页面验证算法行为。

预览区则通过 `MapDeckPreview` 消费后端返回的 `MapPreviewScene`，保持“编辑层只管草稿，渲染层只管场景”的清晰边界。

---

## 6. 工程实现与代码质量

### 6.1 模块化与可维护性

Rust 后端严格按职责拆分模块，避免了“一个文件写所有算法”的泥潭。`constants.rs` 集中管理所有可调参数，并附带中文注释说明调参方向，极大降低了后续迭代成本。

### 6.2 协议版本控制

请求与响应中均包含 `protocol_version`（当前为 `map_shape_mvp_v1`）和 `scenario`（当前为 `coastline_mvp`
）。这为未来的风格扩展和协议升级预留了明确的兼容锚点。

### 6.3 结构化错误响应

后端返回的错误对象包含 `code`、`message`、`field_errors` 等字段，前端可直接展示 `message`，也可在后续增强为表单级错误高亮。

### 6.4 测试覆盖

`coastline.rs` 中包含单元测试，验证：

- 海岸线生成后顶点数增加（`coastline_generation_adds_more_points`）
- 关键地点始终位于生成后的多边形内部（`coastline_generation_keeps_key_location_inside`）

---

## 7. 应用价值与未来展望

### 7.1 当前成果

- 完成了从 SVG 草稿编辑到 Rust 后端自然海岸线生成的完整闭环。
- 确立了“语义化参数 + 模式分层 + 档位分层 + 单一 Seed + 配置快照”的产品基线。
- 实现了高确定性的图布局引擎，支撑关系图的可复现排版。

### 7.2 未来扩展路径

基于当前统一的交互模型，未来可无缝扩展以下风格：

| 风格         | 视觉特征       | 后端调整方向             |
|------------|------------|--------------------|
| Fantasy    | 夸张海岸线、岛屿群  | 增强振幅与噪声层数          |
| Hand-drawn | 手绘感、不规则边缘  | 引入笔触模拟与纸张纹理        |
| Parchment  | 古旧、泛黄、低饱和度 | 调色板与后处理滤镜          |
| Cyber      | 网格化、直角、霓虹  | 替换为结构化几何生成         |
| Political  | 清晰边界、行政区色块 | 引入布尔运算与 Voronoi 分区 |

无论风格如何变化，外层的交互模型保持不变：
> **先选风格 → 再选质量档位 → 再调主旋钮 → Seed 决定变体 → 导出配置可复现**

---

## 8. 结语

FlowCloudAI MapShapeEditor 不仅仅是一个地图生成器的 MVP，更是一套**面向风格化内容生产的长期基线架构**
。我们通过将底层算法常量封装为语义化控制、将计算预算与审美目标解耦、将单一 Seed 与配置快照作为社区分享单元，成功实现了从“技术参数面板”到“创作者工具”的范式跃迁。

**用户调结果，后端管公式。** 这是我们对程序化内容生成的核心回答。
