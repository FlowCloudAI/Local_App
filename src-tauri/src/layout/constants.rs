/// 节点碰撞半径额外补偿，保证视觉上不重叠。
pub const COLLISION_PADDING: f64 = 18.0;
/// 节点之间希望额外保留的可见空隙。
pub const NODE_GAP: f64 = 28.0;
/// 每轮位移应用后执行的碰撞修正轮数。
pub const COLLISION_PASSES_PER_ITERATION: usize = 4;
/// 布局结束后补做的最终碰撞修正轮数。
pub const FINAL_COLLISION_PASSES: usize = 40;

/// 密度对基础理想边长的放大系数。
pub const EDGE_LENGTH_ALPHA_RHO: f64 = 0.68;
/// 度分布离散度对基础理想边长的放大系数。
pub const EDGE_LENGTH_ALPHA_CV: f64 = 0.4;
/// 基础理想边长的全局下限。
pub const EDGE_LENGTH_MIN: f64 = 84.0;
/// 基础理想边长的全局上限。
pub const EDGE_LENGTH_MAX: f64 = 320.0;

/// 双向边相对于分量主尺度的目标长度因子，应小于 1。
pub const TWO_WAY_EDGE_LENGTH_FACTOR: f64 = 0.84;
/// 双向边吸引权重增强系数，应温和高于单向边。
pub const TWO_WAY_ATTRACTION_WEIGHT: f64 = 1.26;

/// 初始温度相对于初始化半径的比例因子。
pub const INITIAL_TEMPERATURE_GAMMA: f64 = 0.26;
/// 最低温度相对于平均碰撞半径的比例因子。
pub const MIN_TEMPERATURE_GAMMA: f64 = 0.08;
/// 初始温度至少要比最低温度高出的倍数。
pub const MIN_TEMPERATURE_RATIO: f64 = 1.5;

/// 迭代次数公式的基础项 a。
pub const ITERATION_BASE: f64 = 54.0;
/// 迭代次数公式中 sqrt(n) 的系数 b。
pub const ITERATION_SQRT_SCALE: f64 = 28.0;
/// 迭代次数公式中密度 rho 的系数 c。
pub const ITERATION_RHO_SCALE: f64 = 150.0;
/// 迭代次数下限。
pub const ITERATION_MIN: usize = 72;
/// 迭代次数上限。
pub const ITERATION_MAX: usize = 360;

/// 初始化半径中最大节点半径项的放大系数 beta_rmax。
pub const INIT_RADIUS_BETA_RMAX: f64 = 1.0;
/// 分量估算面积中密度项的放大系数。
pub const ESTIMATED_AREA_BETA_RHO: f64 = 0.9;
/// 分量估算面积中度离散项的放大系数。
pub const ESTIMATED_AREA_BETA_CV: f64 = 0.65;
/// 稀疏且度分布较均匀的链/树分量，对基础理想边长的回缩系数。
pub const PATHISH_EDGE_LENGTH_REDUCTION: f64 = 0.32;
/// 稀疏且度分布较均匀的链/树分量，对初始化半径的回缩系数。
pub const PATHISH_INIT_RADIUS_REDUCTION: f64 = 0.34;
/// 稀疏且度分布较均匀的链/树分量，主轴压缩的最大强度。
pub const PATHISH_AXIS_COMPACTION_MAX: f64 = 0.36;
/// 稀疏链/树分量在布局后对整体外圈做向心回收的最大强度。
pub const PATHISH_RADIAL_PULL_MAX: f64 = 0.2;
/// 稀疏链/树分量对末端节点做回拽的最大强度。
pub const PATHISH_LEAF_PULL_MAX: f64 = 0.34;
/// 稀疏链/树分量对枝条做邻域平滑压缩的最大强度。
pub const PATHISH_BRANCH_SMOOTHING_MAX: f64 = 0.28;
/// 主轴压缩迭代轮数，专门用于缓解超长对角线摊平。
pub const POST_LAYOUT_COMPACTION_PASSES: usize = 5;

/// 早停的单轮最大位移阈值。
pub const EARLY_STOP_THRESHOLD: f64 = 0.14;
/// 连续多少轮低于阈值后提前停止。
pub const EARLY_STOP_STREAK: usize = 12;

/// 分量之间的固定间距。
pub const COMPONENT_GAP: f64 = 84.0;
/// shelf 排布单行的最大宽度。
pub const SHELF_ROW_MAX_WIDTH: f64 = 1800.0;
/// 孤立节点所在行的水平间距。
pub const ISOLATED_NODE_HORIZONTAL_GAP: f64 = 56.0;

/// 簇级布局中矩形盒子之间的基础安全间距。
pub const CLUSTER_BOX_GAP: f64 = 56.0;
/// 簇图连接边对应的额外目标距离基准。
pub const CLUSTER_LINK_DISTANCE_BASE: f64 = 110.0;
/// 簇级轻量力导向的软斥力系数，避免整体炸开。
pub const CLUSTER_REPULSION_SOFT: f64 = 14.0;
/// 簇级布局向画面中心回收的轻微拉力。
pub const CLUSTER_CENTER_PULL: f64 = 0.015;
/// 簇级布局的初始温度。
pub const CLUSTER_TEMPERATURE_INITIAL: f64 = 42.0;
/// 簇级布局的温度衰减率。
pub const CLUSTER_TEMPERATURE_DECAY: f64 = 0.92;
/// 簇级布局的最大迭代轮数。
pub const CLUSTER_ITERATIONS: usize = 80;
/// 跨簇双向关系在簇图中的额外权重奖励。
pub const CLUSTER_TWO_WAY_BONUS: f64 = 0.35;

/// LRU 缓存容量。
pub const CACHE_CAPACITY: usize = 64;
/// 全局固定随机种子，保证确定性。
pub const FIXED_RANDOM_SEED: u64 = 0x5EED_2026_0409_A11C;

/// 输入浮点参与缓存键和哈希前的稳定化缩放倍数。
pub const HASH_FLOAT_SCALE: f64 = 1_000_000.0;
/// 距离钳位下限，避免除零和过大力值。
pub const MIN_DISTANCE: f64 = 1e-6;
/// 节点尺寸兜底下限。
pub const MIN_NODE_SIZE: f64 = 1.0;
/// 分量基础理想边长计算时的最小度均值分母。
pub const MIN_MEAN_DEGREE: f64 = 1e-9;
/// 温度衰减公式中用于保护 ln(Tmin / T0) 的下限。
pub const MIN_TEMPERATURE_FOR_LOG: f64 = 1e-6;
/// 温度衰减率的工程下限，防止过快冻结。
pub const TEMPERATURE_DECAY_MIN: f64 = 0.85;
/// 温度衰减率的工程上限，防止长期不收敛。
pub const TEMPERATURE_DECAY_MAX: f64 = 0.995;

/// 吸引力方向退化时使用的确定性扰动盐值。
pub const ATTRACTIVE_DIRECTION_SALT: u64 = 0xA5A5_A5A5_A5A5_A5A5;
/// 最终碰撞修正阶段使用的确定性扰动盐值。
pub const FINAL_COLLISION_SALT: u64 = 0xC011_1DE5;
/// 碰撞方向退化时使用的确定性扰动盐值。
pub const COLLISION_DIRECTION_SALT: u64 = 0xD15A_51DE;
