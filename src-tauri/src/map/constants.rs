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
pub const MIN_VERTEX_DISTANCE: f64 = 8.0;

/// 海岸线细分后每条边至少保留的段数。
/// 调大：短边也会被进一步细分；调小：小岛更接近原始草稿。
pub const COASTLINE_MIN_SEGMENTS: usize = 5;

/// 海岸线细分后每条边允许的最大段数。
/// 调大：长边能生成更多细节，但顶点数和计算量上升；调小：轮廓更克制。
pub const COASTLINE_MAX_SEGMENTS: usize = 32;

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
pub const COASTLINE_SEGMENT_BASE: f64 = 15.0;

/// 细分公式中长度归一值的权重。
/// 调大：长边和短边的细分差异更明显；调小：边长差异影响减弱。
pub const COASTLINE_SEGMENT_LENGTH_FACTOR: f64 = 8.0;

/// 细分公式中边长占周长比例的权重。
/// 调大：超长边更容易得到高细分预算；调小：更均匀。
pub const COASTLINE_SEGMENT_EDGE_RATIO_FACTOR: f64 = 18.0;

/// 位移振幅相对边长的基础比例。
/// 调大：海岸线起伏更明显；调小：更平顺。
pub const COASTLINE_AMPLITUDE_BASE: f64 = 1.0;

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
pub const COASTLINE_DEDUPLICATE_DISTANCE_SQUARED: f64 = 0.2;

/// 海岸线噪声第一层频率的基础值。
/// 调大：该层噪声波长更短，大尺度起伏更细碎；调小：波长更长，起伏更舒缓。
pub const COASTLINE_WAVE_A_BASE: f64 = 1.0;

/// 海岸线噪声第一层频率的可变范围。
/// 调大：不同边之间该层频率差异更大，多样性增强；调小：该层频率更统一。
pub const COASTLINE_WAVE_A_SPAN: f64 = 3.5;

/// 海岸线噪声第二层频率的基础值。
/// 调大：该层中尺度细节更密集；调小：中尺度起伏更平缓。
pub const COASTLINE_WAVE_B_BASE: f64 = 2.3;

/// 海岸线噪声第二层频率的可变范围。
/// 调大：中尺度噪声在不同边上变化更大；调小：更一致。
pub const COASTLINE_WAVE_B_SPAN: f64 = 3.7;

/// 海岸线噪声第三层频率的基础值。
/// 调大：该层细碎纹理更明显；调小：细节更柔和。
pub const COASTLINE_WAVE_C_BASE: f64 = 6.5;

/// 海岸线噪声第三层频率的可变范围。
/// 调大：细碎纹理在不同边上差异更大；调小：更统一。
pub const COASTLINE_WAVE_C_SPAN: f64 = 5.1;

/// 海岸线噪声第一层权重。
/// 调大：大尺度起伏对最终形状影响更大；调小：大尺度形态被削弱。
pub const COASTLINE_WAVE_A_WEIGHT: f64 = 0.50;

/// 海岸线噪声第一层强度。
/// 调大：大尺度起伏绝对幅度更强；调小：大尺度起伏绝对幅度减弱。
pub const COASTLINE_WAVE_A_STRENGTH: f64 = 1.0;

/// 海岸线噪声第二层权重。
/// 调大：中尺度细节更突出；调小：整体更平滑。
pub const COASTLINE_WAVE_B_WEIGHT: f64 = 0.29;

/// 海岸线噪声第二层强度。
/// 调大：中尺度起伏绝对幅度更强；调小：中尺度起伏绝对幅度减弱。
pub const COASTLINE_WAVE_B_STRENGTH: f64 = 1.0;

/// 海岸线噪声第三层权重。
/// 调大：海岸线表面更粗糙、更有纹理感；调小：更光滑。
pub const COASTLINE_WAVE_C_WEIGHT: f64 = 0.30;

/// 海岸线噪声第三层强度。
/// 调大：细碎纹理绝对幅度更强；调小：细碎纹理绝对幅度减弱。
pub const COASTLINE_WAVE_C_STRENGTH: f64 = 1.0;

/// 海岸线噪声第一组盐值。
/// 修改：会改变该层大尺度噪声的随机模式，海岸线宏观形态变化但保持确定性。
pub const COASTLINE_NOISE_SALT_A: u64 = 0x9E37_79B9_7F4A_7C15;

/// 海岸线噪声第二组盐值。
/// 修改：会改变该层中尺度噪声的随机模式，影响海岸中段细节。
pub const COASTLINE_NOISE_SALT_B: u64 = 0xC2B2_AE3D_27D4_EB4F;

/// 海岸线噪声第三组盐值。
/// 修改：会改变该层细碎纹理的随机模式，影响海岸表面粗糙感。
pub const COASTLINE_NOISE_SALT_C: u64 = 0x1656_67B1_9E37_79F9;

/// v2 海岸线采样点数下限，保证小图形仍有基本细分。
pub const COASTLINE_V2_MIN_POINTS: usize = 32;

/// v2 海岸线采样点数默认上限（质量档位可覆盖）。
/// 调大：超大轮廓的细碎纹理更完整；调小：更快但大轮廓高频细节被截断。
pub const COASTLINE_V2_MAX_POINTS: usize = 2048;

/// v2 海岸线采样点数硬上限，防止参数覆盖导致顶点数失控。
pub const COASTLINE_V2_MAX_POINTS_CEILING: usize = 12288;

/// v2 细节波长缩放（质量档位驱动：印刷 0.5 → 细节带波长砍半、采样密度翻倍）。
/// 调小：细节更精细、点数更多；调大：更粗略更快。
pub const COASTLINE_V2_DETAIL_WAVELENGTH_SCALE: f64 = 1.0;

/// v2 单带谐波数上限。波长精细 + 周长大时整数谐波可达数千，
/// 全量求和是 O(谐波×采样点) 的性能黑洞；超限时分层抽样（每层取一条，保持确定性与闭合性）。
pub const COASTLINE_V2_MAX_HARMONICS_PER_BAND: u32 = 96;

/// v2 谐波振幅随机抖动下限（在 [下限, 1] 区间取随机）。
/// 调低：带内谱线强弱差异更大、纹理更不规则；接近 1 趋于均匀梳状谱（机械感）。
pub const COASTLINE_V2_HARMONIC_RANDOM_FLOOR: f64 = 0.25;

/// v2 粗糙度调制深度——C 带（细节）。细节振幅沿轮廓被低频包络（波长 P/8~P/2）调制：
/// 礁石段粗糙、滩涂段平静。0 = 处处均匀（机械毛刺感）；越大疏密对比越强。
pub const COASTLINE_V2_ROUGHNESS_MODULATION_C: f64 = 0.7;

/// v2 粗糙度调制深度——B 带（波动），比 C 带温和。
pub const COASTLINE_V2_ROUGHNESS_MODULATION_B: f64 = 0.35;

/// v2 噪声 A 带（宏观：模拟海岸线整体位移）波长 = 周长/divisor。
/// 波长随图形等比缩放（分形自相似），小岛获得与大陆相同的"视觉性格"。
pub const COASTLINE_V2_BAND_A_WAVELENGTH_DIVISOR_MAX: f64 = 7.0;

/// v2 噪声 A 带最长波长 = 周长/该值。调小：出现更大尺度的湾/岬。
pub const COASTLINE_V2_BAND_A_WAVELENGTH_DIVISOR_MIN: f64 = 2.5;

/// v2 噪声 B 带（中尺度：模拟波动）波长 = clamp(周长/divisor, 绝对窗口)。
/// B 带是"半相对"：跟随图形大小，但被绝对窗口夹住，避免大图形的波动带漂得太长。
pub const COASTLINE_V2_BAND_B_WAVELENGTH_DIVISOR_MAX: f64 = 18.0;

/// v2 噪声 B 带最长波长分母。
pub const COASTLINE_V2_BAND_B_WAVELENGTH_DIVISOR_MIN: f64 = 7.5;

/// v2 噪声 B 带波长绝对下限（px），防止小图形的波动带塌缩成锯齿。
pub const COASTLINE_V2_BAND_B_WAVELENGTH_FLOOR_MIN: f64 = 40.0;

/// v2 噪声 B 带最长波长绝对下限（px）。
pub const COASTLINE_V2_BAND_B_WAVELENGTH_FLOOR_MAX: f64 = 90.0;

/// v2 噪声 B 带波长绝对上限（px），大图形的波动带不再随周长无限变长。
pub const COASTLINE_V2_BAND_B_WAVELENGTH_CEIL_MIN: f64 = 110.0;

/// v2 噪声 B 带最长波长绝对上限（px）。
pub const COASTLINE_V2_BAND_B_WAVELENGTH_CEIL_MAX: f64 = 240.0;

/// v2 噪声 C 带（小尺度：模拟细节）波长下限，**绝对像素，不随图形缩放**。
/// 这是"任何形状、任何边上每像素粗糙度一致"的关键——细节带波长若随周长变长，
/// 大图形的长直边就会显得比小图形平滑。
pub const COASTLINE_V2_BAND_C_WAVELENGTH_MIN: f64 = 18.0;

/// v2 噪声 C 带波长上限（px，绝对）。
pub const COASTLINE_V2_BAND_C_WAVELENGTH_MAX: f64 = 45.0;

/// v2 噪声 A 带振幅 = 周长 × 该比例（再被绝对上限封顶）。
/// 调大：海湾/半岛更深，海岸线感更强。
pub const COASTLINE_V2_BAND_A_AMPLITUDE_PERIMETER_RATIO: f64 = 0.03;

/// v2 噪声 B 带振幅比例（"硬朗"档烘焙值 = 原 0.013 × 1.4）。
pub const COASTLINE_V2_BAND_B_AMPLITUDE_PERIMETER_RATIO: f64 = 0.018;

/// v2 噪声 C 带振幅比例（"硬朗"档烘焙值 = 原 0.012 × 2，小图形护栏，很快到达绝对上限）。
pub const COASTLINE_V2_BAND_C_AMPLITUDE_PERIMETER_RATIO: f64 = 0.024;

/// v2 噪声 A 带峰值振幅绝对上限（px），大图形不至于无限狂野。
pub const COASTLINE_V2_BAND_A_AMPLITUDE: f64 = 55.0;

/// v2 噪声 B 带峰值振幅绝对上限（px，"硬朗"档烘焙值）。
pub const COASTLINE_V2_BAND_B_AMPLITUDE: f64 = 28.0;

/// v2 噪声 C 带峰值振幅绝对上限（px，"硬朗"档烘焙值）。配合绝对波长，全图细节质感统一。
pub const COASTLINE_V2_BAND_C_AMPLITUDE: f64 = 8.0;

/// v2 噪声 A 带位移相对局部特征尺寸（肢体宽度）的上限比例。
/// 宏观海湾需要大空间才施展：细窄肢体上自动熄火，避免把画好的形状扭走；宽阔腹地不受限。
pub const COASTLINE_V2_BAND_A_FEATURE_RATIO: f64 = 0.2;

/// v2 噪声 B 带的特征尺寸比例（中尺度波动所需空间较小）。
pub const COASTLINE_V2_BAND_B_FEATURE_RATIO: f64 = 0.32;

/// v2 噪声 C 带的特征尺寸比例（细节纹理在细窄肢体上也几乎保持全振幅）。
pub const COASTLINE_V2_BAND_C_FEATURE_RATIO: f64 = 0.5;

/// v2 噪声 A 带强度乘子（前端"大尺度扰动"滑杆，默认 1）。
pub const COASTLINE_V2_BAND_A_WEIGHT: f64 = 1.0;

/// v2 噪声 B 带强度乘子（前端"中尺度扰动"滑杆，默认 1）。
pub const COASTLINE_V2_BAND_B_WEIGHT: f64 = 1.0;

/// v2 噪声 C 带强度乘子（前端"细节扰动"滑杆，默认 1）。
pub const COASTLINE_V2_BAND_C_WEIGHT: f64 = 1.0;

/// v2 全带振幅整体缩放（前端"尺度系数"滑杆，默认 1）。
pub const COASTLINE_V2_AMPLITUDE_SCALE: f64 = 1.0;

/// v2 三带合计振幅相对画布短边的上限（最后一道护栏，纯防失控，不参与审美）。
pub const COASTLINE_V2_TOTAL_AMPLITUDE_CANVAS_RATIO_MAX: f64 = 0.12;

/// v2 谐波谱斜率 β（带内振幅 ∝ k^(-β/2)），分形海岸线典型取值 1.6~2.0。
/// 调大：带内高频衰减更快、更平滑；调小：带内高频更强、更粗糙。
pub const COASTLINE_V2_SPECTRAL_BETA: f64 = 1.8;

/// v2 角点圆化半径（px，绝对单位；另被 0.06×周长封顶）。
/// 加噪声前先把手绘多边形的角磨圆——自然地形没有精确尖角，
/// 也避免噪声在被钉死的尖点两侧形成针刺。调大：角更圆润；调小：保留更多原始棱角。
pub const COASTLINE_V2_CORNER_ROUNDING_PX: f64 = 22.0;

/// v2 凹角的额外衰减系数（凹角内大位移最易自交）。
pub const COASTLINE_V2_CONCAVE_CORNER_FACTOR: f64 = 0.45;

/// v2 尖角衰减系数下限（角度越尖衰减越强，但不低于此值）。
pub const COASTLINE_V2_SHARP_CORNER_FACTOR_MIN: f64 = 0.35;

/// v2 Taubin 平滑的轮数（一轮 = λ 收缩 + μ 回胀，整体无收缩）。
pub const COASTLINE_V2_SMOOTH_PASSES: usize = 1;

/// v2 Taubin 平滑收缩步长 λ。
pub const COASTLINE_V2_TAUBIN_LAMBDA: f64 = 0.33;

/// v2 Taubin 平滑回胀步长 μ（须为负且 |μ| 略大于 λ）。
pub const COASTLINE_V2_TAUBIN_MU: f64 = -0.34;

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


/// 因为Claude额度耗尽，如下变量的存在只为通过编译
pub const COASTLINE_V2_BAND_C_WAVELENGTH_DIVISOR_MAX: f64 = 0.0;
pub const COASTLINE_V2_BAND_C_WAVELENGTH_DIVISOR_MIN: f64 = 0.0;
pub const COASTLINE_V2_BAND_C_WAVELENGTH_FLOOR_MIN: f64 = 0.0;
pub const COASTLINE_V2_BAND_C_WAVELENGTH_FLOOR_MAX: f64 = 0.0;