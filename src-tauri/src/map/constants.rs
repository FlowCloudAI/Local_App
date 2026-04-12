use crate::map::types::DeckColor;

/// 几何判断中的浮点容差。
/// 调大：共线、落点在线段上的判定更宽松；调小：几何判断更严格，但更容易受浮点误差影响。
pub const GEOMETRY_EPSILON: f64 = 1e-6;

/// 一个合法闭合图形所需的最少顶点数。
/// 调大：图形草稿要求更严格；调小：会允许过于粗糙的轮廓进入后端。
pub const MIN_SHAPE_VERTEX_COUNT: usize = 3;

/// 判断两个顶点“重复”的距离阈值。
/// 调大：更容易判定为重复点；调小：只有几乎完全重合才视为重复。
pub const DUPLICATE_VERTEX_DISTANCE: f64 = 1.0;

/// 判断两个顶点“过近”的距离阈值。
/// 调大：更容易拦截密集顶点；调小：允许更尖锐、更细碎的人工轮廓。
pub const MIN_VERTEX_DISTANCE: f64 = 12.0;

/// 海岸线细分后每条边至少保留的段数。
/// 调大：短边也会被进一步细分；调小：小岛更接近原始草稿。
pub const COASTLINE_MIN_SEGMENTS: usize = 2;

/// 海岸线细分后每条边允许的最大段数。
/// 调大：长边能生成更多细节，但顶点数和计算量上升；调小：轮廓更克制。
pub const COASTLINE_MAX_SEGMENTS: usize = 20;

/// 海岸线波动包络使用的圆周常量。
pub const TAU: f64 = std::f64::consts::PI * 2.0;

/// 边长归一化时的下限，避免超短边振幅塌缩到几乎不可见。
/// 调大：短边获得更大的归一化长度，细分和振幅更显著；调小：短边更接近真实长度，但可能细节消失。
pub const COASTLINE_NORMALIZED_LENGTH_MIN: f64 = 0.2;

/// 边长归一化时的上限，避免超长边振幅和细分数过度膨胀。
/// 调大：长边归一化更充分，细分预算和振幅更多；调小：长边被抑制，轮廓更克制。
pub const COASTLINE_NORMALIZED_LENGTH_MAX: f64 = 3.0;

/// 细分公式中的基础项。
/// 调大：所有边都会变得更碎；调小：整体更接近原始轮廓。
pub const COASTLINE_SEGMENT_BASE: f64 = 2.5;

/// 细分公式中长度归一值的权重。
/// 调大：长边和短边的细分差异更明显；调小：边长差异影响减弱。
pub const COASTLINE_SEGMENT_LENGTH_FACTOR: f64 = 1.8;

/// 细分公式中边长占周长比例的权重。
/// 调大：超长边更容易得到高细分预算；调小：更均匀。
pub const COASTLINE_SEGMENT_EDGE_RATIO_FACTOR: f64 = 14.0;

/// 位移振幅相对边长的基础比例。
/// 调大：海岸线起伏更明显；调小：更平顺。
pub const COASTLINE_AMPLITUDE_BASE: f64 = 0.5;

/// 振幅最小值，保证短边也有可见细节。
/// 调大：即使短边也有更明显的起伏；调小：短边可能过于平直。
pub const COASTLINE_AMPLITUDE_MIN: f64 = 2.0;

/// 振幅相对于画布尺度的上限。
/// 调大：大轮廓可以更野；调小：避免轮廓过度失真。
pub const COASTLINE_AMPLITUDE_CANVAS_RATIO_MAX: f64 = 0.025;

/// 海岸线第一次平滑的轮数。
/// 调大：轮廓更圆润，但可能磨平细节；调小：保留更多原始锯齿感。
pub const COASTLINE_RELAX_PASSES: usize = 2;

/// 海岸线第一次平滑的权重。
/// 调大：轮廓更圆润；调小：保留更多噪声感。
pub const COASTLINE_RELAX_WEIGHT: f64 = 0.16;

/// 当自然海岸线不可用时，回退平滑的轮数。
/// 调大：回退结果更圆滑；调小：回退轮廓更粗糙，贴近原始草稿。
pub const COASTLINE_FALLBACK_RELAX_PASSES: usize = 2;

/// 当自然海岸线不可用时，回退平滑的权重。
/// 调大：回退结果更圆滑；调小：更贴近原始草稿。
pub const COASTLINE_FALLBACK_RELAX_WEIGHT: f64 = 0.18;

/// 去重相邻顶点时允许的最小平方距离。
/// 调大：会更积极地删除近邻点；调小：保留更多细节。
pub const COASTLINE_DEDUPLICATE_DISTANCE_SQUARED: f64 = 0.25;

/// 海岸线噪声第一层频率的基础值。
/// 调大：该层噪声波长更短，大尺度起伏更细碎；调小：波长更长，起伏更舒缓。
pub const COASTLINE_WAVE_A_BASE: f64 = 1.0;

/// 海岸线噪声第一层频率的可变范围。
/// 调大：不同边之间该层频率差异更大，多样性增强；调小：该层频率更统一。
pub const COASTLINE_WAVE_A_SPAN: f64 = 2.4;

/// 海岸线噪声第二层频率的基础值。
/// 调大：该层中尺度细节更密集；调小：中尺度起伏更平缓。
pub const COASTLINE_WAVE_B_BASE: f64 = 2.3;

/// 海岸线噪声第二层频率的可变范围。
/// 调大：中尺度噪声在不同边上变化更大；调小：更一致。
pub const COASTLINE_WAVE_B_SPAN: f64 = 3.7;

/// 海岸线噪声第三层频率的基础值。
/// 调大：该层细碎纹理更明显；调小：细节更柔和。
pub const COASTLINE_WAVE_C_BASE: f64 = 4.5;

/// 海岸线噪声第三层频率的可变范围。
/// 调大：细碎纹理在不同边上差异更大；调小：更统一。
pub const COASTLINE_WAVE_C_SPAN: f64 = 5.1;

/// 海岸线噪声第一层权重。
/// 调大：大尺度起伏对最终形状影响更大；调小：大尺度形态被削弱。
pub const COASTLINE_WAVE_A_WEIGHT: f64 = 0.56;

/// 海岸线噪声第二层权重。
/// 调大：中尺度细节更突出；调小：整体更平滑。
pub const COASTLINE_WAVE_B_WEIGHT: f64 = 0.29;

/// 海岸线噪声第三层权重。
/// 调大：海岸线表面更粗糙、更有纹理感；调小：更光滑。
pub const COASTLINE_WAVE_C_WEIGHT: f64 = 0.15;

/// 海岸线噪声第一组盐值。
/// 修改：会改变该层大尺度噪声的随机模式，海岸线宏观形态变化但保持确定性。
pub const COASTLINE_NOISE_SALT_A: u64 = 0x9E37_79B9_7F4A_7C15;

/// 海岸线噪声第二组盐值。
/// 修改：会改变该层中尺度噪声的随机模式，影响海岸中段细节。
pub const COASTLINE_NOISE_SALT_B: u64 = 0xC2B2_AE3D_27D4_EB4F;

/// 海岸线噪声第三组盐值。
/// 修改：会改变该层细碎纹理的随机模式，影响海岸表面粗糙感。
pub const COASTLINE_NOISE_SALT_C: u64 = 0x1656_67B1_9E37_79F9;

/// 文本哈希的初始偏移量。
/// 修改：会改变文本哈希结果，影响基于文本的确定性随机（如颜色、形状等）。
pub const HASH_TEXT_OFFSET_BASIS: u64 = 0xcbf2_9ce4_8422_2325;

/// 文本哈希的乘子。
/// 修改：会改变文本哈希的扩散特性，同样影响文本驱动的确定性输出。
pub const HASH_TEXT_PRIME: u64 = 0x1000_0000_01b3;

/// 噪声 hash 混合乘子。
/// 修改：会改变噪声哈希的混合模式，影响所有基于哈希的确定性随机输出。
pub const HASH_UNIT_MULTIPLIER: u64 = 0x9E37_79B9_7F4A_7C15;

/// 噪声 hash 混合加数。
/// 修改：会改变噪声哈希的偏移特性，影响所有基于哈希的确定性随机输出。
pub const HASH_UNIT_INCREMENT: u64 = 0xBF58_476D_1CE4_E5B9;

/// ISO UTC 时间计算中每天的秒数。
/// 仅时间换算常量，通常无需调整。
pub const SECS_PER_DAY: i64 = 86_400;


/// 预览层默认填充色调色板，与前端 mock 保持一致。
/// 修改：直接改变地图预览层填充色的视觉表现，需与前端同步。
pub const SHAPE_FILL_PALETTE: [DeckColor; 4] = [
    [55, 138, 221, 88],
    [99, 153, 34, 88],
    [232, 113, 26, 88],
    [124, 92, 232, 88],
];

/// 预览层默认描边色调色板，与前端 mock 保持一致。
/// 修改：直接改变地图预览层描边色的视觉表现，需与前端同步。
pub const SHAPE_LINE_PALETTE: [DeckColor; 4] = [
    [24, 95, 165, 255],
    [66, 104, 21, 255],
    [170, 78, 12, 255],
    [80, 56, 176, 255],
];

/// 未命中类型映射时的关键地点默认颜色。
/// 修改：改变默认地点标记的颜色，需与前端设计规范保持一致。
pub const DEFAULT_LOCATION_COLOR: DeckColor = [212, 48, 106, 255];
