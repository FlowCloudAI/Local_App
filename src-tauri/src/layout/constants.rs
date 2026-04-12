/// 节点碰撞半径额外补偿，保证视觉上不重叠。
/// 调大：节点间最小间距变大，布局更松散；调小：节点更紧凑，但可能贴边。
pub const COLLISION_PADDING: f64 = 20.0;
/// 节点之间希望额外保留的可见空隙。
/// 调大：理想边长与碰撞下限同步增大，整体布局更舒展；调小：更紧凑。
pub const NODE_GAP: f64 = 28.0;
/// 每轮位移应用后执行的碰撞修正轮数。
/// 调大：主循环中重叠消除更彻底，但单次迭代耗时增加；调小：可能残留轻微重叠。
pub const COLLISION_PASSES_PER_ITERATION: usize = 5;
/// 布局结束后补做的最终碰撞修正轮数。
/// 调大：最终输出更确保无重叠，收敛更慢；调小：极端情况下可能残留重叠。
pub const FINAL_COLLISION_PASSES: usize = 40;

/// 密度对基础理想边长的放大系数。
/// 调大：边越密集的图，节点被撑得越开；调小：密度对边长的影响减弱。
pub const EDGE_LENGTH_ALPHA_RHO: f64 = 0.7;
/// 度分布离散度对基础理想边长的放大系数。
/// 调大：度分布越不均（存在超级节点），整体边长越长；调小：该影响减弱。
pub const EDGE_LENGTH_ALPHA_CV: f64 = 0.5;
/// 基础理想边长的全局下限。
/// 调大：所有图的最小边长被强制抬高，小图也会变松散；调小：小图可以更紧凑。
pub const EDGE_LENGTH_MIN: f64 = 84.0;
/// 基础理想边长的全局上限。
/// 调大：超大图节点间距可进一步拉开；调小：限制最大图的舒展程度。
pub const EDGE_LENGTH_MAX: f64 = 320.0;

/// 双向边相对于分量主尺度的目标长度因子，应小于 1。
/// 调小：双向边两端节点被拉得更近；调大：双向边与单向边长度差异缩小。
pub const TWO_WAY_EDGE_LENGTH_FACTOR: f64 = 0.84;
/// 双向边吸引权重增强系数，应温和高于单向边。
/// 调大：双向关系更紧密，节点对更聚合；调小：双向与单向边吸引力差异减弱。
pub const TWO_WAY_ATTRACTION_WEIGHT: f64 = 1.26;

/// 初始温度相对于初始化半径的比例因子。
/// 调大：退火初期节点移动幅度更大，布局更随机但可能跳出局部最优；调小：初期更稳定。
pub const INITIAL_TEMPERATURE_GAMMA: f64 = 0.26;
/// 最低温度相对于平均碰撞半径的比例因子。
/// 调大：收敛阶段节点仍能微调，结果更精细但耗时更长；调小：提前冻结，收敛更快。
pub const MIN_TEMPERATURE_GAMMA: f64 = 0.08;
/// 初始温度至少要比最低温度高出的倍数。
/// 调大：强制保留更宽的退火区间，避免过快冻结；调小：允许更快降温。
pub const MIN_TEMPERATURE_RATIO: f64 = 1.5;

/// 迭代次数公式的基础项 a。
/// 调大：所有图的基础迭代轮数增加，布局质量提升但耗时增加；调小：更快输出。
pub const ITERATION_BASE: f64 = 54.0;
/// 迭代次数公式中 sqrt(n) 的系数 b。
/// 调大：节点数增多时迭代轮数增长更快；调小：大图迭代增长放缓，可能欠收敛。
pub const ITERATION_SQRT_SCALE: f64 = 28.0;
/// 迭代次数公式中密度 rho 的系数 c。
/// 调大：密集图获得更多迭代以缓解拥挤；调小：密集图可能重叠或拥挤。
pub const ITERATION_RHO_SCALE: f64 = 150.0;
/// 迭代次数下限。
/// 调大：即使极小图也会多轮迭代，保证稳定性；调小：微图响应更快。
pub const ITERATION_MIN: usize = 72;
/// 迭代次数上限。
/// 调大：超大图可进一步迭代优化；调小：限制超大图的最长耗时。
pub const ITERATION_MAX: usize = 360;

/// 初始化半径中最大节点半径项的放大系数 beta_rmax。
/// 调大：存在超大节点时初始圆环半径更大，避免初始堆叠；调小：初始分布更紧凑。
pub const INIT_RADIUS_BETA_RMAX: f64 = 1.0;
/// 分量估算面积中密度项的放大系数。
/// 调大：密集图在分量摆放阶段占用更多空间；调小：密集图可能被低估面积而拥挤。
pub const ESTIMATED_AREA_BETA_RHO: f64 = 0.9;
/// 分量估算面积中度离散项的放大系数。
/// 调大：度分布不均的图估算面积更大；调小：该影响减弱。
pub const ESTIMATED_AREA_BETA_CV: f64 = 0.65;
/// 稀疏且度分布较均匀的链/树分量，对基础理想边长的回缩系数。
/// 调大：链/树类图边长更短，更紧凑；调小：链/树图与普通图边长差异缩小。
pub const PATHISH_EDGE_LENGTH_REDUCTION: f64 = 0.32;
/// 稀疏且度分布较均匀的链/树分量，对初始化半径的回缩系数。
/// 调大：链/树图初始圆环更小，更快收敛到紧凑形态；调小：初始分布更舒展。
pub const PATHISH_INIT_RADIUS_REDUCTION: f64 = 0.34;
/// 稀疏且度分布较均匀的链/树分量，主轴压缩的最大强度。
/// 调大：链/树图沿主轴被压得更扁，避免过长对角线；调小：形态更自然但可能拉长。
pub const PATHISH_AXIS_COMPACTION_MAX: f64 = 0.36;
/// 稀疏链/树分量在布局后对整体外圈做向心回收的最大强度。
/// 调大：外围节点被更强地拉向中心，整体更聚拢；调小：外圈更舒展。
pub const PATHISH_RADIAL_PULL_MAX: f64 = 0.2;
/// 稀疏链/树分量对末端节点做回拽的最大强度。
/// 调大：叶子节点更靠近主干；调小：叶子更外展。
pub const PATHISH_LEAF_PULL_MAX: f64 = 0.34;
/// 稀疏链/树分量对枝条做邻域平滑压缩的最大强度。
/// 调大：分支节点更贴近邻域中心，局部更紧凑；调小：分支结构更舒展。
pub const PATHISH_BRANCH_SMOOTHING_MAX: f64 = 0.28;
/// 主轴压缩迭代轮数，专门用于缓解超长对角线摊平。
/// 调大：压缩效果更充分，但后期处理耗时增加；调小：可能残留少量长对角线。
pub const POST_LAYOUT_COMPACTION_PASSES: usize = 5;

/// 早停的单轮最大位移阈值。
/// 调大：更容易触发早停，整体更快但可能牺牲最终精度；调小：更难早停，收敛更充分。
pub const EARLY_STOP_THRESHOLD: f64 = 0.14;
/// 连续多少轮低于阈值后提前停止。
/// 调大：需要更长时间稳定才停止，结果更精细；调小：更快结束，可能略欠稳定。
pub const EARLY_STOP_STREAK: usize = 12;

/// 分量之间的固定间距。
/// 调大：不同连通分量之间留白更多；调小：分量更紧凑，画布利用率更高。
pub const COMPONENT_GAP: f64 = 84.0;
/// shelf 排布单行的最大宽度。
/// 调大：更多分量可排在一行，整体更扁宽；调小：分行更早，整体更高窄。
pub const SHELF_ROW_MAX_WIDTH: f64 = 1800.0;
/// 孤立节点所在行的水平间距。
/// 调大：孤立节点横向更分散；调小：孤立节点更密集。
pub const ISOLATED_NODE_HORIZONTAL_GAP: f64 = 56.0;

/// 簇级布局中矩形盒子之间的基础安全间距。
/// 调大：簇与簇之间更安全距离，重叠风险更低；调小：簇级布局更紧凑。
pub const CLUSTER_BOX_GAP: f64 = 56.0;
/// 簇图连接边对应的额外目标距离基准。
/// 调大：有连接的簇之间保持更远距离；调小：关联簇更靠近。
pub const CLUSTER_LINK_DISTANCE_BASE: f64 = 110.0;
/// 簇级轻量力导向的软斥力系数，避免整体炸开。
/// 调大：簇间软斥力增强，整体更分散；调小：簇更容易聚集。
pub const CLUSTER_REPULSION_SOFT: f64 = 14.0;
/// 簇级布局向画面中心回收的轻微拉力。
/// 调大：簇更向中心聚拢，画布更集中；调小：簇分布更自由，可能外扩。
pub const CLUSTER_CENTER_PULL: f64 = 0.015;
/// 簇级布局的初始温度。
/// 调大：簇级退火初期移动更剧烈，探索更广；调小：簇级布局更稳定。
pub const CLUSTER_TEMPERATURE_INITIAL: f64 = 42.0;
/// 簇级布局的温度衰减率。
/// 调大：降温更慢，簇级收敛更充分；调小：更快冻结，可能欠优化。
pub const CLUSTER_TEMPERATURE_DECAY: f64 = 0.92;
/// 簇级布局的最大迭代轮数。
/// 调大：簇级位置优化更充分；调小：簇级布局更快完成。
pub const CLUSTER_ITERATIONS: usize = 80;
/// 跨簇双向关系在簇图中的额外权重奖励。
/// 调大：跨簇双向关系更强地拉近对应簇；调小：该特殊关系影响减弱。
pub const CLUSTER_TWO_WAY_BONUS: f64 = 0.35;

/// LRU 缓存容量。
/// 调大：可缓存更多历史布局结果，重复请求命中率高但内存占用增加；调小：内存更省。
pub const CACHE_CAPACITY: usize = 64;
/// 全局固定随机种子，保证确定性。
/// 修改：会改变所有随机扰动方向，导致同一输入产生不同但仍是确定性的布局。
pub const FIXED_RANDOM_SEED: u64 = 0x5EED_2026_0409_A11C;

/// 输入浮点参与缓存键和哈希前的稳定化缩放倍数。
/// 调大：对浮点差异更敏感，微小变化即视为不同缓存键；调小：更宽容，但可能忽略细微差异。
pub const HASH_FLOAT_SCALE: f64 = 1_000_000.0;
/// 距离钳位下限，避免除零和过大力值。
/// 调大：力计算更保守，极端近距离时斥力上限降低；调小：数值风险略增。
pub const MIN_DISTANCE: f64 = 1e-6;
/// 节点尺寸兜底下限。
/// 调大：极小节点也会被强制放大，影响碰撞和边长；调小：允许更接近零的节点尺寸。
pub const MIN_NODE_SIZE: f64 = 1.0;
/// 分量基础理想边长计算时的最小度均值分母。
/// 仅数值保护，通常无需调整。
pub const MIN_MEAN_DEGREE: f64 = 1e-9;
/// 温度衰减公式中用于保护 ln(Tmin / T0) 的下限。
/// 仅数值保护，通常无需调整。
pub const MIN_TEMPERATURE_FOR_LOG: f64 = 1e-6;
/// 温度衰减率的工程下限，防止过快冻结。
/// 调大：不允许过快降温，保证最低收敛质量；调小：允许更快冻结，可能早停。
pub const TEMPERATURE_DECAY_MIN: f64 = 0.85;
/// 温度衰减率的工程上限，防止长期不收敛。
/// 调小：强制更快降温，限制最长迭代有效温度；调大：允许更慢降温，但可能拖尾。
pub const TEMPERATURE_DECAY_MAX: f64 = 0.995;

/// 吸引力方向退化时使用的确定性扰动盐值。
/// 修改：会改变边吸引力方向退化时的回退方向，影响重叠或共线边的行为。
pub const ATTRACTIVE_DIRECTION_SALT: u64 = 0xA5A5_A5A5_A5A5_A5A5;
/// 最终碰撞修正阶段使用的确定性扰动盐值。
/// 修改：会改变最终碰撞修正时的退化方向选择，导致同一输入的最终微调结果不同。
pub const FINAL_COLLISION_SALT: u64 = 0xC011_1DE5;
/// 碰撞方向退化时使用的确定性扰动盐值。
/// 修改：会改变碰撞处理中方向退化时的回退方向，影响节点分离路径。
pub const COLLISION_DIRECTION_SALT: u64 = 0xD15A_51DE;
