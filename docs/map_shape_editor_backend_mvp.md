# MapShapeEditor Rust 后端 MVP 实现说明

## 目标与边界

> ⚠️ 以下三个特性处于设计阶段，当前 MVP 尚未实现：
> - 语义化参数映射引擎（前端语义值 → 后端底层常量）
> - 单一 Seed 派生机制（用户主 Seed 派生各子系统 salt）
> - 配置快照体系（可分享的 `{ version, styleFamily, qualityTier, seed, controls }` JSON 对象）
>
> 当前 `coastline.rs` 使用 `shape.id + shape.name` 哈希与 `constants.rs` 固定 salt，参数为硬编码常量。

当前 `MapShapeEditor` 的 Rust 后端实现，目标不是完整 GIS / CAD / 地图学系统，而是先把下面这条链路稳定打通：

- 前端维护可编辑草稿 `shapes + keyLocations`
- 前端在 SVG 层完成基础描点与编辑
- 提交给 Tauri Rust 后端
- Rust 后端完成最小必要校验与展示态转换
- deck 展示层只消费后端返回的 `scene`

当前实现明确不做：

- 经纬度 / 投影 / 地理坐标换算
- 水文、地形、高度图推导
- 行政区划自动生成
- 布尔运算、自动吸附、撤销重做、版本历史
- 真实持久化

当前实现已经做了：

- `MapShapeSaveRequest -> MapShapeSaveResponse` 的 Tauri 命令
- 最小可用几何校验
- 关键地点关联图形的合法性判断
- deck 预览色彩归一
- 基于草稿轮廓的“自然海岸线 MVP”生成

## 入口与模块分工

### Tauri 命令入口

- [src-tauri/src/apis/map.rs](../src-tauri/src/apis/map.rs)

当前暴露命令：

- `map_save_scene(request)`

前端如果需要直接走真实后端，应使用：

- `invoke('map_save_scene', { request })`

### Rust map 模块

- [src-tauri/src/map/mod.rs](../src-tauri/src/map/mod.rs)

各文件职责：

- [types.rs](../src-tauri/src/map/types.rs)
  负责请求、响应、预览场景、错误响应的协议结构。

- [service.rs](../src-tauri/src/map/service.rs)
  负责保存主流程、请求校验、时间戳生成、场景组装。

- [geometry.rs](../src-tauri/src/map/geometry.rs)
  负责基础二维几何判断：
    - 点在线段上
    - 线段相交
    - 多边形自交检测
    - 点在多边形内

- [color.rs](../src-tauri/src/map/color.rs)
  负责 `fill / stroke` 十六进制颜色转 deck RGBA，以及关键地点类型颜色映射。

- [coastline.rs](../src-tauri/src/map/coastline.rs)
  负责“自然海岸线 MVP”生成（v1，默认算法）。

- [coastline_v2.rs](../src-tauri/src/map/coastline_v2.rs)
  v2 海岸线算法：全周长弧长参数化 + 整数谐波周期噪声，
  由 `request.meta.ext.coastlineAlgorithm == "v2"` 显式选择。
  设计与问题分析见 [coastline_algorithm_redesign.md](./coastline_algorithm_redesign.md)。

- [constants.rs](../src-tauri/src/map/constants.rs)
  负责集中管理当前可调参数，方便后续迭代。

## 协议现状

### 当前前端实际强依赖的成功结构

`flowcloudai-ui` 当前真正强依赖的是：

- `scene.canvas`
- `scene.shapes`
- `scene.keyLocations`
- `savedAt`
- `message?`

也就是说，对前端最关键的是：

- `scene` 必须合法
- `savedAt` 必须是字符串

### 当前 Rust 后端兼容的请求扩展

除基础草稿字段外，后端还兼容以下扩展字段：

- `shape.kind?: 'coastline'`
- `shape.bizId?: string | null`
- `shape.ext?: Record<string, unknown>`
- `keyLocation.bizId?: string | null`
- `keyLocation.ext?: Record<string, unknown>`
- `meta.protocolVersion?: 'map_shape_mvp_v1'`
- `meta.scenario?: 'coastline_mvp'`
- `meta.requestId?: string`
- `meta.ext?: Record<string, unknown>`

当前口径：

- `shape.kind` 仅支持 `'coastline'`
- `meta.protocolVersion` 若传入，当前仅支持 `map_shape_mvp_v1`
- `meta.scenario` 若传入，当前仅支持 `coastline_mvp`
- `keyLocation.shapeId` 在 MVP 里按必填处理

## 当前后端处理流程

### 1. 接收请求

入口函数：

- `save_map_shape_scene` in [service.rs](../src-tauri/src/map/service.rs)

### 2. 请求级校验

当前会做：

- `canvas.width / height` 必须为有效正数
- `meta.protocolVersion / scenario` 若存在，必须是当前受支持值
- `shape.id / keyLocation.id / vertex.id` 不允许重复

### 3. 图形校验

当前每个 shape 会检查：

- 顶点数至少 3 个
- 不允许重复点
- 不允许过近点
- 不允许自交
- `kind` 若存在，只允许 `coastline`

### 4. 关键地点校验

当前每个 keyLocation 会检查：

- `name` 必填
- `type` 必填
- `shapeId` 必填
- `shapeId` 必须引用存在的 shape
- 关键地点坐标必须落在关联 shape 内

### 5. 构建预览场景

当前返回的 `scene.shapes[].polygon` 已不再直接等于原始 `vertices`，而是：

- 先根据草稿轮廓生成自然海岸线 polygon
- 再与颜色、名称、业务字段一起组装成 `MapPreviewScene`

关键地点仍然直接返回：

- `position: [x, y]`

## 当前“自然海岸线 MVP”算法

实现位置：

- [coastline.rs](../src-tauri/src/map/coastline.rs)

### 算法链路

当前是一个保守版本的轮廓自然化流程：

1. 使用前端提交的闭合多边形作为基础轮廓。
2. 对每条边按边长自适应计算细分预算。
3. 在细分点上沿多边形外法线做确定性位移。
4. 对结果做轻量平滑。
5. 如果结果不可用，则回退。

### 当前“停止继续细分”的标准

当前不是递归细分，也不是误差驱动细分，而是“预算制”：

- 每条边先得到一个 `segment_count`
- 该值由边长、平均边长、边长占周长比例共同决定
- 并被钳制在：
    - `COASTLINE_MIN_SEGMENTS`
    - `COASTLINE_MAX_SEGMENTS`

达到这个段数后就停止，不会继续细分。

### 当前抖动的真实状态

当前确实已经支持“抖动”，但整体偏保守：

- 有边长自适应细分
- 有沿法线方向的多层波动
- 有平滑
- 有关键地点约束回退
- 有自交回退

因此最终视觉更接近：

- “经过自然化修饰的区域轮廓”

而不是：

- “世界地图级别、细碎且破碎的自然海岸线”

如果前端同学觉得“太平滑，不像海岸线”，这是符合当前后端真实实现状态的，不是前端显示问题。

## 当前最关键的调参入口

如果后续要继续强化海岸线效果，请优先查看：

- [constants.rs](../src-tauri/src/map/constants.rs)

### 一阶高优先级参数

- `COASTLINE_AMPLITUDE_BASE`
  控制海岸线抖动基础振幅。想更“野”，优先调大这个。

- `COASTLINE_AMPLITUDE_CANVAS_RATIO_MAX`
  控制振幅全局上限。调大后，长边和大轮廓能出现更明显波动。

- `COASTLINE_RELAX_WEIGHT`
  控制生成后平滑强度。调小后，细节更容易保留下来。

- `COASTLINE_RELAX_PASSES`
  控制平滑轮数。调小后更“毛”，调大后更圆。

### 二阶细节参数

- `COASTLINE_WAVE_B_WEIGHT`
- `COASTLINE_WAVE_C_WEIGHT`
- `COASTLINE_WAVE_B_SPAN`
- `COASTLINE_WAVE_C_SPAN`

这组参数更偏“局部细碎感”与“高频边缘细节”。

### 细分预算参数

- `COASTLINE_MIN_SEGMENTS`
- `COASTLINE_MAX_SEGMENTS`
- `COASTLINE_SEGMENT_BASE`
- `COASTLINE_SEGMENT_LENGTH_FACTOR`
- `COASTLINE_SEGMENT_EDGE_RATIO_FACTOR`

这组参数影响的是：

- 长边会被切多少刀
- 短边保留多少控制感
- 世界地图级别轮廓是否有足够顶点承载更复杂的抖动

## 当前回退逻辑

当前生成自然海岸线后，不会无条件采用结果，而是有两级回退：

1. 如果自然化结果出现自交，或者让关联关键地点跑到图形外，放弃自然化结果。
2. 退回到“只做更轻的平滑结果”。
3. 如果平滑结果仍不安全，则直接回到原始草稿轮廓。

这意味着当前后端实现的优先级是：

- 可用性 > 海岸线视觉激进程度

前端如果发现某些图形提交后“变化不大”，很可能不是没走算法，而是被回退保护吃掉了。

## 当前颜色逻辑

为避免前端 deck 层额外推导颜色，后端当前会补齐 RGBA：

- shape fill 来自：
    - 传入 `fill` 的十六进制颜色
    - 否则退回默认 fill 调色板

- shape line 来自：
    - 传入 `stroke` 的十六进制颜色
    - 否则退回默认 line 调色板

- keyLocation color 来自：
    - `type -> color` 的固定映射
    - 否则退回默认颜色

目标是让前端 deck 层保持“只渲染，不推导”。

## 错误响应现状

当前命令失败时会返回结构化错误对象：

- `code`
- `message`
- `requestId?`
- `retryable?`
- `fieldErrors?`
- `ext?`

当前最主要的错误码：

- `MAP_SHAPE_VALIDATION_FAILED`

当前前端即使不细消费 `fieldErrors`，也至少能直接展示 `message`。

如果后续前端要增强表单级错误反馈，建议优先消费：

- `fieldErrors[].field`
- `fieldErrors[].code`
- `fieldErrors[].message`

## 前端协作建议

### 当前前端可安全依赖的事实

- `map_save_scene` 已存在
- 只要成功返回 `scene + savedAt`，前端就可以当作最新展示结果
- 后端当前会主动生成自然海岸线 polygon
- deck 回显不要再自己推导海岸线

### 当前前端不要假设的事实

- 不要假设 `scene.shapes[].polygon` 与 `draft.vertices` 完全相同
- 不要假设海岸线细节一定很强，某些情况下会被回退
- 不要假设后端已经真实持久化，当前 `meta.persisted` 固定是 `false`
- 不要假设存在地理坐标语义，当前仍然只是二维画布坐标

## 后续推荐迭代顺序

如果下一位 Codex 或前端同学需要继续推进，建议按这个顺序：

1. 先把前端 API 层稳定绑定到 `map_save_scene`，确保不再走 mock。
2. 在 Demo 和真实界面里观察不同草稿对自然海岸线的表现。
3. 如果海岸线太平滑，优先只调 `constants.rs`，不要先改协议。
4. 若回退过于频繁，再考虑把回退原因显式写进 `meta.ext` 供前端调试。
5. 等轮廓自然化稳定后，再考虑是否要做真实持久化。

## 适合后续继续补的方向

当前最值得继续迭代的点是：

- 更强的世界地图级海岸线抖动
- 更合理的长边细分预算
- 更细的回退诊断信息
- 前端展示当前是“原始轮廓 / 自然海岸线 / 回退结果”

当前不建议立刻做的方向：

- GIS / 投影
- 高度图 / 河流 / 湖泊
- 行政区自动生成
- 复杂布尔运算

因为这些会把当前收敛清晰的 MVP 链路重新打散。
