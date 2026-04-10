# Tauri Rust 确定性词条关系图布局引擎

## 协议字段

输入协议固定为：

- `nodeOrigin?: [number, number]`
- `nodes: { id: string; width: number; height: number }[]`
- `edges: { id?: string; source: string; target: string; sourceHandle?: string; targetHandle?: string; kind?: 'one_way' | 'two_way' }[]`

输出协议固定为：

- `positions: Record<string, { x: number; y: number }>`
- `bounds?: { x: number; y: number; width: number; height: number }`
- `layoutHash?: string`

实现约束：

- 后端内部统一使用节点中心点坐标。
- 输出 `positions` 时才根据 `nodeOrigin` 转换为前端锚点坐标。
- `bounds` 始终按左上角坐标系返回，不额外加 padding。
- `layoutHash` 与缓存键基于标准化输入生成，可用于调试和缓存命中验证。

## 参考资料及其具体影响

当前实现明确参考了以下论文与官方文档，但没有照搬其完整架构：

- Fruchterman, T. M. J., & Reingold, E. M. (1991). Graph Drawing by Force-Directed Placement.
  影响：
  - 把 FR 作为理论基线。
  - 主循环中的吸引力和斥力保持经典形式：
    - `fa(d) = d^2 / k`
    - `fr(d) = k^2 / d`
  - `k` 的语义保留为“理想几何尺度”，只是从单一全局常量改成分量级 `k_c`。
  - 温度继续只承担位移截断和收敛控制职责。
  参考：
  - [FR 论文 PDF](https://www.reingold.co/force-directed.pdf)

- Graphviz `sfdp` 与 Graphviz overlap / pack 文档。
  影响：
  - 采用“分量先独立布局，再全局 pack”的工程分层。
  - 明确把“主布局”和“去重叠/压缩后处理”拆成两个层次，而不是混成一个单一过程。
  - 参考了 `pack` / `packmode` 的思想，当前用确定性 shelf 代替 Graphviz 的通用 packing。
  - 参考了 `overlap=prism0`、`overlap_shrink` 这类“先求一个好形状，再做 overlap removal / compression”的思路，
    因而当前实现保留了 FR 主循环之后的碰撞修正与主轴压缩后处理。
  参考：
  - [Graphviz sfdp](https://graphviz.org/docs/layouts/sfdp/)
  - [Graphviz Attributes](https://graphviz.org/doc/info/attrs.html)

- OGDF `FMMMLayout` 文档。
  影响：
  - 借鉴其工程组织方式，把协议层、标准化层、分量拆分层、参数生成层、求解层、后处理层、缓存层拆开。
  - 借鉴“参数对象驱动求解器”的方式，避免把公式散落在求解主循环里。
  - 借鉴“冷却、初始放置、力缩放是不同职责”的思路。
  参考：
  - [OGDF FMMMLayout](https://ogdf.github.io/doc/ogdf/classogdf_1_1_f_m_m_m_layout.html)
  - [OGDF Energy-based Layout Algorithms](https://ogdf.github.io/doc/ogdf/group__gd-energy.html)

- D3 `forceCollide` 与 `d3-force` 文档。
  影响：
  - 碰撞约束采用“节点半径决定最小间距”的语义，而不是把碰撞当成边长公式的一部分。
  - 保持 many-body / link / collide / packing 的职责分离，当前分别映射为斥力、边吸引、碰撞修正、分量摆放。
  - 当前碰撞是软约束风格：每轮位移后修正，而不是一次性精确矩形求解。
  参考：
  - [D3 forceCollide](https://d3js.org/d3-force/collide)
  - [D3-force](https://d3js.org/d3-force)

- petgraph `connected_components` 文档。
  影响：
  - 明确知道该 API 只返回分量数量，不返回成员。
  - 因而当前实现只用 `petgraph` 建图，不把 `connected_components` 当成员收集接口；
    分量成员由稳定 BFS 自行收集。
  参考：
  - [petgraph connected_components](https://docs.rs/petgraph/latest/petgraph/algo/fn.connected_components.html)

## 自适应参数生成

当前实现不再主要依赖单套固定布局常量，而是先对每个连通分量提取统计量，再生成分量级参数：

- `n`：节点数
- `m`：边数
- `rho`：图密度
- `mean_deg` / `std_deg` / `cv_deg`：度分布统计
- `r_mean` / `r_max`：基于节点真实尺寸推导的碰撞半径统计
- `eta`：双向边占比
- `pathish_score`：稀疏且度分布较均匀时升高的“链/树倾向分数”

节点碰撞半径使用：

- `r_i = max(width_i, height_i) / 2 + collision_padding`

在此基础上生成：

- 基础理想边长 `L_c`
- FR 主尺度 `k_c`
- 初始化半径 `R0`
- 初始温度 `T0`
- 最低温度 `T_min`
- 温度衰减率 `decay`
- 迭代次数 `iters`
- 分量估算面积 `A_c`
- 主轴压缩强度 `axis_compaction_strength`

双向边还会派生边级参数：

- 边目标长度 `L_ij`
- 边吸引权重

上述逻辑集中在 `src-tauri/src/layout/params.rs`，布局主循环只消费参数结果，不直接拼装公式。

其中 `pathish_score` 用于识别“容易被 FR 拉成超长骨架”的稀疏链式或树式分量：

- 密度越低，分数越高
- 度分布越均匀，分数越高
- 平均度越接近 2，分数越高
- 双向边占比越高，分数会被适度抑制

该分数会温和回缩 `L_c` 与 `R0`，并驱动布局末尾的主轴压缩后处理。

## 经典 FR 力模型

分量内部布局仍使用经典 Fruchterman-Reingold 静态布局，但主尺度改为“按分量自适应生成”：

- 初始化为固定圆周布局，半径使用自适应 `R0`。
- 斥力使用 `k_c^2 / d`。
- 边吸引力使用 `d^2 / L_ij`，其中 `L_ij` 为边级目标长度。
- 双向边允许更短、且吸引略强，但仍受碰撞下限约束。
- 每轮迭代都按稳定顺序执行：
  - 节点对斥力
  - 边吸引力
  - 温度截断位移
  - 圆形近似碰撞修正
- 不使用 ForceAtlas2。
- 不加入全局重力项。
- 不使用自适应随机扰动变体。
- 距离会钳位到最小值，避免除零。
- 单节点分量直接跳过 FR 迭代。
- 早停阈值仍为固定工程常量，但温度与迭代次数由分量参数生成器给出。
- 对稀疏链/树分量，会在 FR 与最终碰撞修正之后执行一次确定性的主轴压缩：
  - 通过位置协方差求主轴方向
  - 沿主轴方向温和收缩
  - 每轮收缩后立即再做碰撞修正
  - 用于抑制关系图被摊成过长的斜线或骨架

## 双向边合并规则

布局阶段会对边做几何简化，但不会修改原始边集合：

- 显式 `kind = 'two_way'` 的边按双向关系处理。
- 如果同时存在 `A -> B` 与 `B -> A`，即使都标记为单向，也会合并为双向关系。
- 重复边只在布局阶段折叠，不会写回响应。
- 自环边在布局阶段忽略。
- 引用不存在节点的边会静默丢弃。

合并后的布局边只保留无向节点对，并在参数生成阶段为其推导目标长度与吸引权重。

## 分量摆放规则

图会先拆成稳定有序的连通分量，再做全局 shelf 摆放：

- 使用 `petgraph` 建图。
- 分量成员收集通过显式 BFS 完成，不依赖 `connected_components` 返回成员。
- 所有遍历顺序都基于排序后的节点索引。
- 主分量与孤立节点分量分开处理。
- 主分量按真实外接矩形面积降序摆放。
- 按 shelf 规则从左到右放置，超过单行最大宽度后换行。
- 分量之间使用固定间距。
- 孤立节点放在主分量下方，按固定水平间距单独排布。

## 坐标系约定

后端只在内部维护中心点坐标：

- 节点碰撞和外接矩形都基于中心点与真实宽高计算。
- 节点渲染边缘始终是 `center +/- width/2` 和 `center +/- height/2`。
- 输出阶段根据 `nodeOrigin` 做坐标转换：
  - `x = center_x + (origin_x - 0.5) * width`
  - `y = center_y + (origin_y - 0.5) * height`

因此 `bounds` 与 `nodeOrigin` 无关，只与真实渲染矩形有关。

## 确定性保证策略

实现层面保证以下事项：

- 固定随机种子常量。
- 固定圆周初始化规则。
- 节点先按 `id` 排序。
- 边按稳定字段序排序。
- 连通分量按排序后的节点顺序遍历。
- FR 每轮的节点对和边遍历顺序固定。
- 不依赖 `HashMap` / `HashSet` 的自然迭代顺序做最终决策。
- 最终输出使用有序 map，保证序列化顺序稳定。

同一输入在同一版本常量下会得到完全一致的输出。

## 调试可观测性

参数生成阶段会在 `debug` 日志级别输出每个分量的关键统计量与派生参数，便于检查公式是否合理。日志包含：

- `component`
- `n`
- `m`
- `rho`
- `mean_deg`
- `std_deg`
- `cv_deg`
- `r_mean`
- `r_max`
- `eta`
- `pathish`
- `L_c`
- `k_c`
- `R0`
- `T0`
- `T_min`
- `decay`
- `iters`
- `A_c`
- `axis_compact`

默认生产环境可通过日志级别关闭，不会强制打印。

## 缓存键设计

缓存实现为通过 `tauri::Builder::manage(...)` 注入的全局严格 LRU：

- 命令内通过 `tauri::State` 访问。
- 不在命令内部创建临时缓存。
- 不使用 `static mut`。
- 缓存键基于标准化输入 JSON 串。
- 浮点在进入缓存键前先做稳定化缩放和四舍五入。
- 缓存命中直接返回完整 `LayoutResponse`。
- `layoutHash` 使用同一标准化输入生成，便于核对缓存是否命中预期请求。

## 常量调参说明

所有布局常量集中定义在 `src-tauri/src/layout/constants.rs`，但它们现在主要承担“公式系数、上下限和工程边界”的角色：

- 图驱动公式系数：密度/度离散度放大系数、双向边长度因子、双向边吸引权重。
- 链/树紧凑化：`pathish_score` 的边长回缩系数、初始化半径回缩系数、主轴压缩强度上限。
- 温度与迭代边界：温度比例系数、迭代公式系数、衰减率上下限。
- 碰撞控制：碰撞 padding、碰撞修正轮次。
- 分量摆放：分量间距、shelf 单行最大宽度、孤立节点水平间距。
- 缓存：缓存容量。
- 确定性：固定随机种子和内部扰动盐值。

调参优先级建议：

1. 优先保证确定性不变。
2. 优先调 `params.rs` 中的图驱动公式，再调 `constants.rs` 里的无量纲系数。
3. 其次控制 500 节点级别的静态布局耗时。
4. 最后再做视觉细节微调。
