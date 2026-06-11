//! 海岸线自然化算法 v2：全周长弧长参数化 + 整数谐波周期噪声。
//!
//! 与 v1（coastline.rs，保持不动）的本质区别：
//! - 噪声以整条轮廓的弧长 s ∈ [0, P) 统一参数化，整数谐波保证闭合无缝，
//!   不再逐边参数化，因此不需要 sin(πt) 包络，原始顶点也不再被钉死；
//! - 频率/振幅/采样密度全部以世界单位（周长比例、像素）定义，与原始边长无关；
//! - 角点保护从"全边包络"收窄为"凹角/尖角附近的弧长窗口衰减"；
//! - 平滑使用 Taubin（λ/μ 双步），避免 Laplacian 的收缩效应。
//!
//! 设计文档：docs/coastline_algorithm_redesign.md。
//! 由 request.meta.ext.coastlineAlgorithm == "v2" 显式选择本实现，默认仍走 v1。

use crate::map::constants::{
    COASTLINE_DEDUPLICATE_DISTANCE_SQUARED, COASTLINE_FALLBACK_RELAX_PASSES,
    COASTLINE_FALLBACK_RELAX_WEIGHT, COASTLINE_V2_AMPLITUDE_SCALE,
    COASTLINE_V2_BAND_A_AMPLITUDE, COASTLINE_V2_BAND_A_AMPLITUDE_PERIMETER_RATIO,
    COASTLINE_V2_BAND_A_FEATURE_RATIO, COASTLINE_V2_BAND_A_WAVELENGTH_DIVISOR_MAX,
    COASTLINE_V2_BAND_A_WAVELENGTH_DIVISOR_MIN, COASTLINE_V2_BAND_A_WEIGHT,
    COASTLINE_V2_BAND_B_AMPLITUDE, COASTLINE_V2_BAND_B_FEATURE_RATIO,
    COASTLINE_V2_BAND_C_FEATURE_RATIO,
    COASTLINE_V2_BAND_B_AMPLITUDE_PERIMETER_RATIO, COASTLINE_V2_BAND_B_WAVELENGTH_CEIL_MAX,
    COASTLINE_V2_BAND_B_WAVELENGTH_CEIL_MIN, COASTLINE_V2_BAND_B_WAVELENGTH_DIVISOR_MAX,
    COASTLINE_V2_BAND_B_WAVELENGTH_DIVISOR_MIN, COASTLINE_V2_BAND_B_WAVELENGTH_FLOOR_MAX,
    COASTLINE_V2_BAND_B_WAVELENGTH_FLOOR_MIN, COASTLINE_V2_BAND_B_WEIGHT,
    COASTLINE_V2_BAND_C_AMPLITUDE, COASTLINE_V2_BAND_C_AMPLITUDE_PERIMETER_RATIO,
    COASTLINE_V2_BAND_C_WAVELENGTH_MAX, COASTLINE_V2_BAND_C_WAVELENGTH_MIN,
    COASTLINE_V2_BAND_C_WEIGHT, COASTLINE_V2_CONCAVE_CORNER_FACTOR,
    COASTLINE_V2_DETAIL_WAVELENGTH_SCALE, COASTLINE_V2_HARMONIC_RANDOM_FLOOR,
    COASTLINE_V2_MAX_HARMONICS_PER_BAND, COASTLINE_V2_ROUGHNESS_MODULATION_B,
    COASTLINE_V2_ROUGHNESS_MODULATION_C,
    COASTLINE_V2_CORNER_ROUNDING_PX, COASTLINE_V2_MAX_POINTS, COASTLINE_V2_MAX_POINTS_CEILING,
    COASTLINE_V2_MIN_POINTS, COASTLINE_V2_SMOOTH_PASSES, COASTLINE_V2_SPECTRAL_BETA,
    COASTLINE_V2_TAUBIN_LAMBDA, COASTLINE_V2_TAUBIN_MU,
    COASTLINE_V2_TOTAL_AMPLITUDE_CANVAS_RATIO_MAX, GEOMETRY_EPSILON, HASH_TEXT_OFFSET_BASIS,
    HASH_TEXT_PRIME, HASH_UNIT_INCREMENT, HASH_UNIT_MULTIPLIER, TAU,
};
use crate::map::geometry::{find_polygon_self_intersections, is_point_in_polygon};
use crate::map::types::{
    CoastlineV2Params, MapEditorCanvas, MapKeyLocationDraft, MapShapeDraft, MapShapeVertex,
};
use std::time::Instant;

/// 最近非邻近轮廓的安全位移比例（防窄缝自交）。
const COASTLINE_V2_NEAR_EDGE_SAFE_FACTOR: f64 = 0.38;
/// 关键地点的安全位移比例（防地点出界）。
const COASTLINE_V2_LOCATION_SAFE_FACTOR: f64 = 0.50;
/// 折叠几何判定：对面轮廓的空间距离 < 弧长距离 × 该比例时才视为窄缝/尖角/细颈并限幅；
/// 否则视为轮廓的自然延伸（含共线细分边，其空间距离 ≈ 弧长距离），跳过。
/// 该判据同时天然保证顶点细分不变性，并自动保护尖角（楔形两侧 d ≈ 弧距 × sin(角度)）。
const COASTLINE_V2_ARC_FLAT_RATIO: f64 = 0.5;
/// 软饱和限幅的拐点：位移在安全上限的该比例以内不干预，超过后平滑渐近逼近上限。
/// 硬截断会让细长地形两侧同时贴在限幅墙上形成平行壁/细针，软饱和消除该伪影。
const COASTLINE_V2_SOFT_LIMIT_KNEE: f64 = 0.6;
/// 安全降扰重试的振幅缩放序列（与 v1 一致）。
const COASTLINE_V2_SAFETY_RETRY_SCALES: [f64; 3] = [0.75, 0.55, 0.40];
/// 三个谐波带的盐值，仅区分带间随机模式。
const COASTLINE_V2_NOISE_SALT_A: u64 = 0xD6E8_FEB8_6659_FD93;
const COASTLINE_V2_NOISE_SALT_B: u64 = 0xA0761_D649_5B19_0C5 ^ 0x735A_2D97;
const COASTLINE_V2_NOISE_SALT_C: u64 = 0x8EBC_6AF0_9C88_C6E3;
/// 粗糙度调制包络的盐值（与三带独立）。
const COASTLINE_V2_NOISE_SALT_ROUGHNESS: u64 = 0x589E_C77B_3C99_45A1;

macro_rules! param {
    ($params:expr, $field:ident, $default:expr) => {
        $params.and_then(|p| p.$field).unwrap_or($default)
    };
}

pub fn build_natural_coastline_polygon_v2(
    canvas: &MapEditorCanvas,
    shape: &MapShapeDraft,
    related_locations: &[MapKeyLocationDraft],
    params: Option<&CoastlineV2Params>,
) -> Vec<[f64; 2]> {
    let started_at = Instant::now();
    log::info!(
        "开始海岸线v2计算：shape_id={}，name={}，原始顶点数={}，关联关键地点数={}",
        shape.id,
        shape.name,
        shape.vertices.len(),
        related_locations.len()
    );

    if shape.vertices.len() < 3 {
        log::warn!(
            "海岸线v2计算直接返回原始轮廓：shape_id={}，原因=顶点数不足，顶点数={}",
            shape.id,
            shape.vertices.len()
        );
        return to_polygon(&shape.vertices);
    }

    let naturalized = naturalize_arc_length(canvas, shape, related_locations, params, 1.0);
    if coastline_is_usable(&naturalized, related_locations) {
        log::info!(
            "海岸线v2计算成功：shape_id={}，分支=自然化，输出顶点数={}，耗时={}ms",
            shape.id,
            naturalized.len(),
            started_at.elapsed().as_millis()
        );
        return to_polygon(&naturalized);
    }

    let naturalized_intersections = find_polygon_self_intersections(&naturalized);
    if !naturalized_intersections.is_empty() {
        log::warn!(
            "海岸线v2自然化结果不可用：shape_id={}，原因=自交，交叉数={}，输出顶点数={}",
            shape.id,
            naturalized_intersections.len(),
            naturalized.len()
        );
    } else {
        let outside_count = related_locations
            .iter()
            .filter(|location| {
                let point = MapShapeVertex {
                    id: location.id.clone(),
                    x: location.x,
                    y: location.y,
                };
                !is_point_in_polygon(&point, &naturalized)
            })
            .count();
        if outside_count > 0 {
            log::warn!(
                "海岸线v2自然化结果不可用：shape_id={}，原因=关键地点落到轮廓外，数量={}",
                shape.id,
                outside_count
            );
        }
    }

    for scale in COASTLINE_V2_SAFETY_RETRY_SCALES {
        let retried = naturalize_arc_length(canvas, shape, related_locations, params, scale);
        if coastline_is_usable(&retried, related_locations) {
            log::info!(
                "海岸线v2计算成功：shape_id={}，分支=安全降扰，降扰系数={}，输出顶点数={}，耗时={}ms",
                shape.id,
                scale,
                retried.len(),
                started_at.elapsed().as_millis()
            );
            return to_polygon(&retried);
        }
    }

    let smoothed = relax_polygon(
        &shape.vertices,
        COASTLINE_FALLBACK_RELAX_PASSES,
        COASTLINE_FALLBACK_RELAX_WEIGHT,
    );
    if coastline_is_usable(&smoothed, related_locations) {
        log::info!(
            "海岸线v2计算成功：shape_id={}，分支=回退平滑，输出顶点数={}，耗时={}ms",
            shape.id,
            smoothed.len(),
            started_at.elapsed().as_millis()
        );
        return to_polygon(&smoothed);
    }

    log::warn!(
        "海岸线v2计算失败并返回原始轮廓：shape_id={}，原始顶点数={}，耗时={}ms",
        shape.id,
        shape.vertices.len(),
        started_at.elapsed().as_millis()
    );
    to_polygon(&shape.vertices)
}

fn naturalize_arc_length(
    canvas: &MapEditorCanvas,
    shape: &MapShapeDraft,
    related_locations: &[MapKeyLocationDraft],
    params: Option<&CoastlineV2Params>,
    amplitude_scale: f64,
) -> Vec<MapShapeVertex> {
    let vertices = &shape.vertices;
    let (cumulative, perimeter) = cumulative_arc_lengths(vertices);
    if perimeter <= f64::EPSILON {
        return vertices.to_vec();
    }

    let sample_count = sample_count_for_perimeter(perimeter, params);
    let step = perimeter / sample_count as f64;
    let (base_points, arc_positions) =
        resample_by_arc_length(vertices, &cumulative, perimeter, sample_count);

    // 加噪声前先把手绘角磨圆：自然地形没有精确尖角，
    // 也避免噪声在尖点两侧沿突变法线位移形成针刺。
    let rounding_radius = param!(params, corner_rounding_px, COASTLINE_V2_CORNER_ROUNDING_PX)
        .min(perimeter * 0.06)
        .max(0.0);
    let base_points = round_corners(base_points, rounding_radius, step);

    let canvas_scale = canvas.width.min(canvas.height).max(1.0);
    let seed = hash_text(&format!("{}:{}", shape.id, shape.name));
    let (noise_bands, amplitude) = build_noise_bands(
        seed,
        &arc_positions,
        perimeter,
        sample_count,
        canvas_scale,
        amplitude_scale.clamp(0.0, 1.0),
        params,
    );
    let corner_windows =
        build_corner_windows(vertices, &cumulative, step, rounding_radius, params);
    let outward_sign = if signed_area(vertices) >= 0.0 {
        -1.0
    } else {
        1.0
    };

    let mut refined = Vec::with_capacity(sample_count);
    let mut constrained_offsets = 0usize;
    for index in 0..sample_count {
        let (base_x, base_y) = base_points[index];
        let previous = base_points[(index + sample_count - 1) % sample_count];
        let next = base_points[(index + 1) % sample_count];
        let tangent_x = next.0 - previous.0;
        let tangent_y = next.1 - previous.1;
        let tangent_length = (tangent_x * tangent_x + tangent_y * tangent_y).sqrt();

        let mut x = base_x;
        let mut y = base_y;
        if tangent_length > f64::EPSILON {
            let attenuation = corner_attenuation(&corner_windows, arc_positions[index], perimeter);
            // 局部特征尺寸（肢体宽度）：宏观带在细窄处熄火，细节带几乎不受限——
            // 细肢体跟随草稿、保留质感；宽阔腹地照常起大湾。
            let feature_size = local_feature_size(
                vertices,
                &cumulative,
                perimeter,
                arc_positions[index],
                base_x,
                base_y,
                step,
            );
            let mut requested_offset = 0.0;
            for band in &noise_bands {
                let local_amplitude = band.amplitude.min(band.feature_ratio * feature_size);
                requested_offset += local_amplitude * band.values[index];
            }
            requested_offset *= attenuation;

            let mut max_offset = amplitude;
            if feature_size.is_finite() {
                max_offset = max_offset.min(feature_size * COASTLINE_V2_NEAR_EDGE_SAFE_FACTOR);
            }
            max_offset = max_offset
                .min(location_safe_cap(related_locations, base_x, base_y))
                .max(0.0);
            let offset = soft_limit_offset(requested_offset, max_offset);
            if offset.abs() + f64::EPSILON < requested_offset.abs() {
                constrained_offsets += 1;
            }
            x += outward_sign * tangent_y / tangent_length * offset;
            y += outward_sign * -tangent_x / tangent_length * offset;
        }

        refined.push(MapShapeVertex {
            id: format!("{}-coast2-{}", shape.id, index),
            x,
            y,
        });
    }

    let raw_refined_len = refined.len();
    let refined = dedupe_adjacent_vertices(refined, COASTLINE_DEDUPLICATE_DISTANCE_SQUARED);
    let smoothed = taubin_smooth(
        refined,
        param!(params, smooth_passes, COASTLINE_V2_SMOOTH_PASSES),
        param!(params, taubin_lambda, COASTLINE_V2_TAUBIN_LAMBDA),
        param!(params, taubin_mu, COASTLINE_V2_TAUBIN_MU),
    );
    log::info!(
        "v2自然化细节：shape_id={}，原始顶点数={}，采样点数={}，去重后顶点数={}，振幅={:.2}，受限位移点数={}",
        shape.id,
        vertices.len(),
        raw_refined_len,
        smoothed.len(),
        amplitude,
        constrained_offsets
    );
    smoothed
}

/// 细节波长缩放（质量档位驱动），同时决定采样密度与 C 带波长。
fn detail_wavelength_scale(params: Option<&CoastlineV2Params>) -> f64 {
    param!(
        params,
        detail_wavelength_scale,
        COASTLINE_V2_DETAIL_WAVELENGTH_SCALE
    )
    .clamp(0.25, 2.0)
}

fn sample_count_for_perimeter(perimeter: f64, params: Option<&CoastlineV2Params>) -> usize {
    // 采样步长跟随最小波长（每周期 ≥4 个采样点），上限由质量档位控制。
    // C 带波长是绝对像素，因此采样密度（点/px）全图一致。
    let smallest_wavelength = COASTLINE_V2_BAND_C_WAVELENGTH_MIN * detail_wavelength_scale(params);
    let step = (smallest_wavelength / 4.0).clamp(1.0, 8.0);
    let desired = (perimeter / step).ceil() as usize;
    let max_points = param!(params, max_points, COASTLINE_V2_MAX_POINTS)
        .min(COASTLINE_V2_MAX_POINTS_CEILING);
    desired.clamp(COASTLINE_V2_MIN_POINTS, max_points.max(COASTLINE_V2_MIN_POINTS))
}

/// 角点圆化：对等弧长重采样后的基线做若干轮 Laplacian 扩散。
/// 直线段上的点等于邻居平均、位置不动，只有有曲率处（原始角点）被磨圆，
/// 圆化范围 ≈ 步长 × √轮数。在重采样域操作，天然满足顶点细分不变性。
fn round_corners(points: Vec<(f64, f64)>, radius: f64, step: f64) -> Vec<(f64, f64)> {
    if points.len() < 3 || radius <= f64::EPSILON || step <= f64::EPSILON {
        return points;
    }

    let passes = ((radius / step).powi(2)).ceil().clamp(2.0, 96.0) as usize;
    let total = points.len();
    let mut current = points;
    let mut next = Vec::with_capacity(total);
    for _ in 0..passes {
        next.clear();
        for index in 0..total {
            let previous = current[(index + total - 1) % total];
            let point = current[index];
            let following = current[(index + 1) % total];
            next.push((
                point.0 + 0.5 * ((previous.0 + following.0) * 0.5 - point.0),
                point.1 + 0.5 * ((previous.1 + following.1) * 0.5 - point.1),
            ));
        }
        std::mem::swap(&mut current, &mut next);
    }
    current
}

fn cumulative_arc_lengths(vertices: &[MapShapeVertex]) -> (Vec<f64>, f64) {
    let mut cumulative = Vec::with_capacity(vertices.len() + 1);
    cumulative.push(0.0);
    let mut total = 0.0;
    for index in 0..vertices.len() {
        let start = &vertices[index];
        let end = &vertices[(index + 1) % vertices.len()];
        let dx = end.x - start.x;
        let dy = end.y - start.y;
        total += (dx * dx + dy * dy).sqrt();
        cumulative.push(total);
    }
    (cumulative, total)
}

fn resample_by_arc_length(
    vertices: &[MapShapeVertex],
    cumulative: &[f64],
    perimeter: f64,
    sample_count: usize,
) -> (Vec<(f64, f64)>, Vec<f64>) {
    let total = vertices.len();
    let step = perimeter / sample_count as f64;
    let mut points = Vec::with_capacity(sample_count);
    let mut arc_positions = Vec::with_capacity(sample_count);
    let mut edge = 0usize;
    for index in 0..sample_count {
        let s = index as f64 * step;
        while edge + 1 < total && cumulative[edge + 1] <= s {
            edge += 1;
        }
        let edge_length = (cumulative[edge + 1] - cumulative[edge]).max(f64::EPSILON);
        let t = ((s - cumulative[edge]) / edge_length).clamp(0.0, 1.0);
        let start = &vertices[edge];
        let end = &vertices[(edge + 1) % total];
        points.push((start.x + (end.x - start.x) * t, start.y + (end.y - start.y) * t));
        arc_positions.push(s);
    }
    (points, arc_positions)
}

struct Harmonic {
    frequency: f64,
    amplitude: f64,
    phase: f64,
}

/// 在 [k_min, k_max] 整数谐波上做谱合成，带内做 RMS 归一。
/// 整数频率保证 f(0) == f(P)，闭合轮廓天然无缝。
/// 谐波数超限时分层抽样（每层取一条，hash 抖动选位）：求和成本封顶为
/// O(上限 × 采样点)，谱形与确定性保持。
fn build_harmonic_band(
    seed: u64,
    salt: u64,
    harmonic_min: u32,
    harmonic_max: u32,
    spectral_beta: f64,
    harmonic_cap: u32,
) -> Vec<Harmonic> {
    let harmonic_max = harmonic_max.min(harmonic_cap);
    if harmonic_min > harmonic_max {
        return Vec::new();
    }

    let count = harmonic_max - harmonic_min + 1;
    let take = count.min(COASTLINE_V2_MAX_HARMONICS_PER_BAND);
    let stratum = f64::from(count) / f64::from(take);

    let mut harmonics = Vec::with_capacity(take as usize);
    let mut power = 0.0;
    for slot in 0..take {
        let jitter = hash_unit(seed ^ salt.wrapping_mul(2 * u64::from(slot) + 5));
        let k = (harmonic_min + ((f64::from(slot) + jitter) * stratum).floor() as u32)
            .min(harmonic_max);
        let amplitude_random = COASTLINE_V2_HARMONIC_RANDOM_FLOOR
            + (1.0 - COASTLINE_V2_HARMONIC_RANDOM_FLOOR)
                * hash_unit(seed ^ salt.wrapping_mul(2 * u64::from(k) + 1));
        let amplitude = amplitude_random * f64::from(k).powf(-spectral_beta / 2.0);
        let phase = hash_unit(seed ^ salt.wrapping_mul(2 * u64::from(k) + 2)) * TAU;
        power += amplitude * amplitude * 0.5;
        harmonics.push(Harmonic {
            frequency: f64::from(k),
            amplitude,
            phase,
        });
    }

    let rms = power.sqrt();
    if rms > f64::EPSILON {
        for harmonic in &mut harmonics {
            harmonic.amplitude /= rms;
        }
    }
    harmonics
}

/// 单个噪声带规格：波长区间与峰值振幅（均已折算为该形状下的 px 值）。
struct BandSpec {
    wavelength_min: f64,
    wavelength_max: f64,
    amplitude: f64,
    feature_ratio: f64,
    weight: f64,
    salt: u64,
    /// 粗糙度调制深度：该带振幅沿轮廓被低频包络调制的比例（0 = 不调制）。
    roughness_modulation: f64,
}

/// 单带计算结果：峰值归一的采样值 + 有效振幅 + 特征尺寸比例。
/// 分带保留是为了"局部特征尺寸限幅"——细窄肢体上宏观带熄火、细节带保持全振幅，
/// 比对合成结果做整体限幅更能保住质感。
struct BandField {
    amplitude: f64,
    feature_ratio: f64,
    values: Vec<f64>,
}

/// 把绝对波长区间换算成该周长下的整数谐波区间。
/// 周长容不下一个最长波长时返回 None（小图形自动跳过宏观带）。
fn harmonic_range(
    perimeter: f64,
    wavelength_min: f64,
    wavelength_max: f64,
    harmonic_cap: u32,
) -> Option<(u32, u32)> {
    if wavelength_min <= 0.0 || wavelength_max < wavelength_min {
        return None;
    }
    let harmonic_min = ((perimeter / wavelength_max).ceil()).max(1.0) as u32;
    let harmonic_max = ((perimeter / wavelength_min).floor() as u32).min(harmonic_cap);
    if harmonic_min > harmonic_max {
        None
    } else {
        Some((harmonic_min, harmonic_max))
    }
}

/// 计算三个噪声带在所有采样点的归一值与有效振幅。
/// 每带独立按峰值归一——三层扰动互不挤压；逐带返回（而非合成）以便
/// 主循环按局部特征尺寸对各带分别限幅。
fn build_noise_bands(
    seed: u64,
    arc_positions: &[f64],
    perimeter: f64,
    sample_count: usize,
    canvas_scale: f64,
    amplitude_scale: f64,
    params: Option<&CoastlineV2Params>,
) -> (Vec<BandField>, f64) {
    let spectral_beta = param!(params, spectral_beta, COASTLINE_V2_SPECTRAL_BETA);
    // 最高频带每周期至少 4 个采样点，杜绝欠采样混叠。
    let harmonic_cap = (sample_count / 4).max(1) as u32;
    let global_scale = param!(params, amplitude_scale, COASTLINE_V2_AMPLITUDE_SCALE)
        .clamp(0.0, 4.0)
        * amplitude_scale;

    // 波长随周长等比缩放（分形自相似），B/C 带另设绝对下限防止小图形塌缩成锯齿；
    // 振幅 = 周长比例，封顶于绝对上限（可由参数覆盖）。
    let band_specs = [
        BandSpec {
            wavelength_min: perimeter / COASTLINE_V2_BAND_A_WAVELENGTH_DIVISOR_MAX,
            wavelength_max: perimeter / COASTLINE_V2_BAND_A_WAVELENGTH_DIVISOR_MIN,
            amplitude: (perimeter * COASTLINE_V2_BAND_A_AMPLITUDE_PERIMETER_RATIO)
                .min(param!(params, band_a_amplitude, COASTLINE_V2_BAND_A_AMPLITUDE)),
            feature_ratio: COASTLINE_V2_BAND_A_FEATURE_RATIO,
            weight: param!(params, band_a_weight, COASTLINE_V2_BAND_A_WEIGHT),
            salt: COASTLINE_V2_NOISE_SALT_A,
            roughness_modulation: 0.0,
        },
        BandSpec {
            // 半相对：跟随图形大小，但被绝对窗口夹住。
            wavelength_min: (perimeter / COASTLINE_V2_BAND_B_WAVELENGTH_DIVISOR_MAX).clamp(
                COASTLINE_V2_BAND_B_WAVELENGTH_FLOOR_MIN,
                COASTLINE_V2_BAND_B_WAVELENGTH_CEIL_MIN,
            ),
            wavelength_max: (perimeter / COASTLINE_V2_BAND_B_WAVELENGTH_DIVISOR_MIN).clamp(
                COASTLINE_V2_BAND_B_WAVELENGTH_FLOOR_MAX,
                COASTLINE_V2_BAND_B_WAVELENGTH_CEIL_MAX,
            ),
            amplitude: (perimeter * COASTLINE_V2_BAND_B_AMPLITUDE_PERIMETER_RATIO)
                .min(param!(params, band_b_amplitude, COASTLINE_V2_BAND_B_AMPLITUDE)),
            feature_ratio: COASTLINE_V2_BAND_B_FEATURE_RATIO,
            weight: param!(params, band_b_weight, COASTLINE_V2_BAND_B_WEIGHT),
            salt: COASTLINE_V2_NOISE_SALT_B,
            roughness_modulation: COASTLINE_V2_ROUGHNESS_MODULATION_B,
        },
        BandSpec {
            // 绝对像素：细节质感不随图形大小变化，长直边与小岛同样粗糙。
            // 质量档位通过 detail_wavelength_scale 控制精细度（印刷 0.5 → 波长砍半）。
            wavelength_min: COASTLINE_V2_BAND_C_WAVELENGTH_MIN * detail_wavelength_scale(params),
            wavelength_max: COASTLINE_V2_BAND_C_WAVELENGTH_MAX * detail_wavelength_scale(params),
            // 振幅随波长等比缩放（分形自相似）：印刷档波长砍半、振幅同步减半，
            // 否则坡度翻倍呈现机械毛刺。放粗（>1）时不放大振幅。
            amplitude: (perimeter * COASTLINE_V2_BAND_C_AMPLITUDE_PERIMETER_RATIO)
                .min(param!(params, band_c_amplitude, COASTLINE_V2_BAND_C_AMPLITUDE))
                * detail_wavelength_scale(params).min(1.0),
            feature_ratio: COASTLINE_V2_BAND_C_FEATURE_RATIO,
            weight: param!(params, band_c_weight, COASTLINE_V2_BAND_C_WEIGHT),
            salt: COASTLINE_V2_NOISE_SALT_C,
            roughness_modulation: COASTLINE_V2_ROUGHNESS_MODULATION_C,
        },
    ];

    // 粗糙度包络：低频（波长 P/8~P/2）随机场归一到 [0,1]，调制 B/C 带振幅，
    // 形成"礁石段粗糙、滩涂段平静"的间歇感，消除全轮廓均匀抖动的机械毛刺。
    let roughness_envelope = build_roughness_envelope(seed, arc_positions, perimeter);

    let mut bands = Vec::with_capacity(band_specs.len());
    let mut total_amplitude = 0.0f64;
    for spec in &band_specs {
        let Some((harmonic_min, harmonic_max)) = harmonic_range(
            perimeter,
            spec.wavelength_min,
            spec.wavelength_max,
            harmonic_cap,
        ) else {
            continue;
        };
        // 淡入：周长刚够容纳一个最短波长时振幅从 0 平滑爬升到全值（P 达到 1.5 倍波长下限时满幅），
        // 避免相近大小的岛屿在"带出现阈值"两侧外观突变。
        let fade_in = ((perimeter / spec.wavelength_min - 1.0) / 0.5).clamp(0.0, 1.0);
        let fade_in = fade_in * fade_in * (3.0 - 2.0 * fade_in);
        let effective_amplitude =
            spec.amplitude * spec.weight.clamp(0.0, 4.0) * global_scale * fade_in;
        if effective_amplitude <= f64::EPSILON {
            continue;
        }

        let harmonics = build_harmonic_band(
            seed,
            spec.salt,
            harmonic_min,
            harmonic_max,
            spectral_beta,
            harmonic_cap,
        );
        let mut band_values = Vec::with_capacity(arc_positions.len());
        for &s in arc_positions {
            let mut value = 0.0;
            for harmonic in &harmonics {
                value += harmonic.amplitude
                    * (TAU * harmonic.frequency * s / perimeter + harmonic.phase).sin();
            }
            band_values.push(value);
        }

        let max_abs = band_values.iter().fold(0.0f64, |acc, v| acc.max(v.abs()));
        if max_abs <= f64::EPSILON {
            continue;
        }
        for value in &mut band_values {
            *value /= max_abs;
        }
        if spec.roughness_modulation > f64::EPSILON {
            for (value, envelope) in band_values.iter_mut().zip(&roughness_envelope) {
                *value *= 1.0 - spec.roughness_modulation * (1.0 - envelope);
            }
        }
        bands.push(BandField {
            amplitude: effective_amplitude,
            feature_ratio: spec.feature_ratio,
            values: band_values,
        });
        total_amplitude += effective_amplitude;
    }

    // 最后一道护栏：三带合计不超过画布短边的固定比例。
    let canvas_cap = canvas_scale * COASTLINE_V2_TOTAL_AMPLITUDE_CANVAS_RATIO_MAX;
    if total_amplitude > canvas_cap && total_amplitude > f64::EPSILON {
        let shrink = canvas_cap / total_amplitude;
        for band in &mut bands {
            band.amplitude *= shrink;
        }
        total_amplitude = canvas_cap;
    }

    (bands, total_amplitude)
}

/// 粗糙度包络：低频随机场归一到 [0,1]。1 = 全粗糙，0 = 最平静。
fn build_roughness_envelope(seed: u64, arc_positions: &[f64], perimeter: f64) -> Vec<f64> {
    let harmonics = build_harmonic_band(seed, COASTLINE_V2_NOISE_SALT_ROUGHNESS, 2, 8, 1.0, 8);
    let mut values = Vec::with_capacity(arc_positions.len());
    for &s in arc_positions {
        let mut value = 0.0;
        for harmonic in &harmonics {
            value += harmonic.amplitude
                * (TAU * harmonic.frequency * s / perimeter + harmonic.phase).sin();
        }
        values.push(value);
    }

    let max_abs = values.iter().fold(0.0f64, |acc, v| acc.max(v.abs()));
    if max_abs > f64::EPSILON {
        for value in &mut values {
            *value = (*value / max_abs + 1.0) * 0.5;
        }
    } else {
        values.fill(1.0);
    }
    values
}

struct CornerWindow {
    arc_position: f64,
    factor: f64,
    radius: f64,
}

/// 只对凹角做温和衰减（凹角内的大位移最容易跨缝自交）；
/// 凸角不衰减——岬角/半岛获得完整噪声，配合角点圆化保持自然。
fn build_corner_windows(
    vertices: &[MapShapeVertex],
    cumulative: &[f64],
    step: f64,
    rounding_radius: f64,
    params: Option<&CoastlineV2Params>,
) -> Vec<CornerWindow> {
    let radius = (rounding_radius * 2.0).max(4.0 * step);
    let concave_factor = param!(
        params,
        concave_corner_factor,
        COASTLINE_V2_CONCAVE_CORNER_FACTOR
    );
    let area_sign = signed_area(vertices);

    let mut windows = Vec::new();
    for index in 0..vertices.len() {
        let Some((_, is_concave)) = corner_geometry(vertices, index, area_sign) else {
            continue;
        };
        if !is_concave {
            continue;
        }
        windows.push(CornerWindow {
            arc_position: cumulative[index],
            factor: concave_factor,
            radius,
        });
    }
    windows
}

/// 角点几何：返回（内角弧度，是否凹角）；共线顶点返回 None。
/// 共线必须显式判定，否则浮点噪声会让 signum 随机判凹，
/// 破坏"插入共线顶点输出不变"的不变性。
fn corner_geometry(
    vertices: &[MapShapeVertex],
    vertex_index: usize,
    area_sign: f64,
) -> Option<(f64, bool)> {
    let total = vertices.len();
    if total < 3 {
        return None;
    }

    let previous = &vertices[(vertex_index + total - 1) % total];
    let current = &vertices[vertex_index];
    let next = &vertices[(vertex_index + 1) % total];
    let in_x = previous.x - current.x;
    let in_y = previous.y - current.y;
    let out_x = next.x - current.x;
    let out_y = next.y - current.y;
    let in_length = (in_x * in_x + in_y * in_y).sqrt();
    let out_length = (out_x * out_x + out_y * out_y).sqrt();
    if in_length <= f64::EPSILON || out_length <= f64::EPSILON {
        return Some((0.0, false));
    }

    let turn_cross = (current.x - previous.x) * (next.y - current.y)
        - (current.y - previous.y) * (next.x - current.x);
    if turn_cross.abs() <= GEOMETRY_EPSILON * in_length * out_length {
        return None;
    }

    let dot = ((in_x * out_x + in_y * out_y) / (in_length * out_length)).clamp(-1.0, 1.0);
    let angle = dot.acos();
    Some((angle, turn_cross.signum() != area_sign.signum()))
}

/// 测试辅助：把 corner_geometry 的结果折算成单一衰减系数（与窗口构建逻辑一致：仅凹角衰减）。
#[cfg(test)]
fn vertex_corner_factor(
    vertices: &[MapShapeVertex],
    vertex_index: usize,
    area_sign: f64,
    concave_factor: f64,
) -> f64 {
    match corner_geometry(vertices, vertex_index, area_sign) {
        Some((_, true)) => concave_factor,
        _ => 1.0,
    }
}

fn corner_attenuation(windows: &[CornerWindow], arc_position: f64, perimeter: f64) -> f64 {
    let mut attenuation = 1.0f64;
    for window in windows {
        let distance = circular_distance(arc_position, window.arc_position, perimeter);
        if distance >= window.radius {
            continue;
        }
        let t = distance / window.radius;
        let smooth = t * t * (3.0 - 2.0 * t);
        attenuation = attenuation.min(window.factor + (1.0 - window.factor) * smooth);
    }
    attenuation
}

/// 局部特征尺寸：到"折叠几何"对面轮廓的最近距离（≈ 该处肢体宽度）。
/// 宽阔腹地无对面轮廓时返回 INFINITY。
/// 判据：空间距离接近弧长距离的是轮廓自然延伸（含共线细分边），跳过——
/// 该判据天然保证顶点细分不变性，并自动覆盖尖角（楔形两侧 d ≈ 弧距 × sin 角度）。
fn local_feature_size(
    vertices: &[MapShapeVertex],
    cumulative: &[f64],
    perimeter: f64,
    arc_position: f64,
    x: f64,
    y: f64,
    step: f64,
) -> f64 {
    let mut feature = f64::INFINITY;
    let total = vertices.len();
    for index in 0..total {
        let arc_distance = arc_distance_to_range(
            arc_position,
            cumulative[index],
            cumulative[index + 1],
            perimeter,
        );
        if arc_distance <= step {
            continue;
        }
        let distance =
            point_to_segment_distance(x, y, &vertices[index], &vertices[(index + 1) % total]);
        if distance >= arc_distance * COASTLINE_V2_ARC_FLAT_RATIO {
            continue;
        }
        feature = feature.min(distance);
    }
    feature
}

/// 关键地点的安全位移上限（无关联地点时为 INFINITY）。
fn location_safe_cap(related_locations: &[MapKeyLocationDraft], x: f64, y: f64) -> f64 {
    let mut cap = f64::INFINITY;
    for location in related_locations {
        let dx = location.x - x;
        let dy = location.y - y;
        let distance = (dx * dx + dy * dy).sqrt();
        cap = cap.min(distance * COASTLINE_V2_LOCATION_SAFE_FACTOR);
    }
    cap
}

/// 软饱和限幅：|位移| ≤ 上限 × 拐点比例时原样通过，超过后用 tanh 平滑渐近逼近上限。
/// 输出严格 < 上限，安全语义与硬截断一致；区别是受限区轮廓平滑减速而非贴墙。
fn soft_limit_offset(requested: f64, cap: f64) -> f64 {
    if cap <= f64::EPSILON {
        return 0.0;
    }
    let ratio = requested.abs() / cap;
    if ratio <= COASTLINE_V2_SOFT_LIMIT_KNEE {
        return requested;
    }
    let span = 1.0 - COASTLINE_V2_SOFT_LIMIT_KNEE;
    let saturated =
        COASTLINE_V2_SOFT_LIMIT_KNEE + span * ((ratio - COASTLINE_V2_SOFT_LIMIT_KNEE) / span).tanh();
    requested.signum() * cap * saturated
}

fn circular_distance(a: f64, b: f64, period: f64) -> f64 {
    let mut distance = (a - b).abs();
    if distance > period {
        distance %= period;
    }
    distance.min(period - distance)
}

fn arc_distance_to_range(s: f64, start: f64, end: f64, period: f64) -> f64 {
    if s >= start && s <= end {
        return 0.0;
    }
    circular_distance(s, start, period).min(circular_distance(s, end, period))
}

fn point_to_segment_distance(x: f64, y: f64, start: &MapShapeVertex, end: &MapShapeVertex) -> f64 {
    let dx = end.x - start.x;
    let dy = end.y - start.y;
    let length_squared = dx * dx + dy * dy;
    if length_squared <= f64::EPSILON {
        let px = x - start.x;
        let py = y - start.y;
        return (px * px + py * py).sqrt();
    }

    let t = (((x - start.x) * dx + (y - start.y) * dy) / length_squared).clamp(0.0, 1.0);
    let projected_x = start.x + dx * t;
    let projected_y = start.y + dy * t;
    let px = x - projected_x;
    let py = y - projected_y;
    (px * px + py * py).sqrt()
}

fn coastline_is_usable(
    vertices: &[MapShapeVertex],
    related_locations: &[MapKeyLocationDraft],
) -> bool {
    if vertices.len() < 3 {
        return false;
    }

    let intersections = find_polygon_self_intersections(vertices);
    if !intersections.is_empty() {
        return false;
    }

    related_locations.iter().all(|location| {
        let point = MapShapeVertex {
            id: location.id.clone(),
            x: location.x,
            y: location.y,
        };
        is_point_in_polygon(&point, vertices)
    })
}

/// Taubin 平滑：一轮 = λ 收缩步 + μ 回胀步，去高频毛刺且整体无收缩。
fn taubin_smooth(
    vertices: Vec<MapShapeVertex>,
    passes: usize,
    lambda: f64,
    mu: f64,
) -> Vec<MapShapeVertex> {
    if vertices.len() < 3 || passes == 0 {
        return vertices;
    }

    let mut current = vertices;
    for _ in 0..passes {
        current = laplacian_step(&current, lambda);
        current = laplacian_step(&current, mu);
    }
    current
}

fn laplacian_step(vertices: &[MapShapeVertex], factor: f64) -> Vec<MapShapeVertex> {
    let total = vertices.len();
    let mut result = Vec::with_capacity(total);
    for index in 0..total {
        let previous = &vertices[(index + total - 1) % total];
        let current = &vertices[index];
        let following = &vertices[(index + 1) % total];
        result.push(MapShapeVertex {
            id: current.id.clone(),
            x: current.x + factor * ((previous.x + following.x) * 0.5 - current.x),
            y: current.y + factor * ((previous.y + following.y) * 0.5 - current.y),
        });
    }
    result
}

fn relax_polygon(vertices: &[MapShapeVertex], passes: usize, weight: f64) -> Vec<MapShapeVertex> {
    if vertices.len() < 3 || passes == 0 {
        return vertices.to_vec();
    }

    let total = vertices.len();
    let mut a = vertices.to_vec();
    let mut b = Vec::with_capacity(total);
    let w2 = weight * 2.0;

    for _ in 0..passes {
        let source = &a;
        b.clear();
        for index in 0..total {
            let previous = &source[(index + total - 1) % total];
            let current_vertex = &source[index];
            let following = &source[(index + 1) % total];
            b.push(MapShapeVertex {
                id: current_vertex.id.clone(),
                x: current_vertex.x * (1.0 - w2) + previous.x * weight + following.x * weight,
                y: current_vertex.y * (1.0 - w2) + previous.y * weight + following.y * weight,
            });
        }
        std::mem::swap(&mut a, &mut b);
    }
    a
}

fn dedupe_adjacent_vertices(
    vertices: Vec<MapShapeVertex>,
    distance_squared: f64,
) -> Vec<MapShapeVertex> {
    if vertices.len() < 3 {
        return vertices;
    }

    let mut deduped = Vec::new();
    for vertex in &vertices {
        let should_push = deduped.last().is_none_or(|previous: &MapShapeVertex| {
            let dx = previous.x - vertex.x;
            let dy = previous.y - vertex.y;
            dx * dx + dy * dy > distance_squared
        });
        if should_push {
            deduped.push(vertex.clone());
        }
    }

    if deduped.len() > 1 {
        let first = deduped.first().cloned();
        let last = deduped.last().cloned();
        if let (Some(first), Some(last)) = (first, last) {
            let dx = first.x - last.x;
            let dy = first.y - last.y;
            if dx * dx + dy * dy <= distance_squared {
                deduped.pop();
            }
        }
    }

    if deduped.len() < 3 {
        return vertices;
    }
    deduped
}

fn signed_area(vertices: &[MapShapeVertex]) -> f64 {
    let mut area = 0.0;
    for index in 0..vertices.len() {
        let current = &vertices[index];
        let next = &vertices[(index + 1) % vertices.len()];
        area += current.x * next.y - next.x * current.y;
    }
    area * 0.5
}

fn to_polygon(vertices: &[MapShapeVertex]) -> Vec<[f64; 2]> {
    vertices.iter().map(|vertex| [vertex.x, vertex.y]).collect()
}

fn hash_text(value: &str) -> u64 {
    let mut hash = HASH_TEXT_OFFSET_BASIS;
    for byte in value.as_bytes() {
        hash ^= u64::from(*byte);
        hash = hash.wrapping_mul(HASH_TEXT_PRIME);
    }
    hash
}

fn hash_unit(seed: u64) -> f64 {
    let mixed = seed
        .wrapping_mul(HASH_UNIT_MULTIPLIER)
        .rotate_left(17)
        .wrapping_add(HASH_UNIT_INCREMENT);
    (mixed as f64) / (u64::MAX as f64)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::map::types::MapShapeKind;

    fn vertex(id: &str, x: f64, y: f64) -> MapShapeVertex {
        MapShapeVertex {
            id: id.to_string(),
            x,
            y,
        }
    }

    fn shape_with_vertices(vertices: Vec<MapShapeVertex>) -> MapShapeDraft {
        MapShapeDraft {
            id: "shape-v2".to_string(),
            name: "大陆".to_string(),
            vertices,
            fill: None,
            stroke: None,
            biz_id: None,
            kind: Some(MapShapeKind::Coastline),
            ext: None,
        }
    }

    fn square_shape() -> MapShapeDraft {
        shape_with_vertices(vec![
            vertex("v1", 100.0, 100.0),
            vertex("v2", 500.0, 100.0),
            vertex("v3", 500.0, 500.0),
            vertex("v4", 100.0, 500.0),
        ])
    }

    /// 与 square_shape 同一轮廓，但每条边插入了共线中点。
    fn subdivided_square_shape() -> MapShapeDraft {
        shape_with_vertices(vec![
            vertex("v1", 100.0, 100.0),
            vertex("m1", 300.0, 100.0),
            vertex("v2", 500.0, 100.0),
            vertex("m2", 500.0, 300.0),
            vertex("v3", 500.0, 500.0),
            vertex("m3", 300.0, 500.0),
            vertex("v4", 100.0, 500.0),
            vertex("m4", 100.0, 300.0),
        ])
    }

    fn narrow_shape() -> MapShapeDraft {
        shape_with_vertices(vec![
            vertex("n1", 100.0, 100.0),
            vertex("n2", 420.0, 100.0),
            vertex("n3", 420.0, 210.0),
            vertex("n4", 260.0, 210.0),
            vertex("n5", 260.0, 270.0),
            vertex("n6", 420.0, 270.0),
            vertex("n7", 420.0, 420.0),
            vertex("n8", 100.0, 420.0),
        ])
    }

    fn canvas() -> MapEditorCanvas {
        MapEditorCanvas {
            width: 1000.0,
            height: 640.0,
        }
    }

    fn to_vertices(polygon: &[[f64; 2]]) -> Vec<MapShapeVertex> {
        polygon
            .iter()
            .enumerate()
            .map(|(index, point)| MapShapeVertex {
                id: format!("g-{index}"),
                x: point[0],
                y: point[1],
            })
            .collect()
    }

    fn directed_hausdorff(from: &[MapShapeVertex], to: &[MapShapeVertex]) -> f64 {
        let total = to.len();
        from.iter()
            .map(|point| {
                (0..total)
                    .map(|index| {
                        point_to_segment_distance(
                            point.x,
                            point.y,
                            &to[index],
                            &to[(index + 1) % total],
                        )
                    })
                    .fold(f64::INFINITY, f64::min)
            })
            .fold(0.0f64, f64::max)
    }

    fn symmetric_hausdorff(a: &[MapShapeVertex], b: &[MapShapeVertex]) -> f64 {
        directed_hausdorff(a, b).max(directed_hausdorff(b, a))
    }

    #[test]
    fn v2_adds_points_and_stays_valid() {
        let polygon = build_natural_coastline_polygon_v2(&canvas(), &square_shape(), &[], None);

        assert!(polygon.len() > 4);
        assert!(find_polygon_self_intersections(&to_vertices(&polygon)).is_empty());
    }

    #[test]
    fn v2_is_deterministic() {
        let first = build_natural_coastline_polygon_v2(&canvas(), &square_shape(), &[], None);
        let second = build_natural_coastline_polygon_v2(&canvas(), &square_shape(), &[], None);

        assert_eq!(first, second);
    }

    #[test]
    fn v2_noise_field_is_periodic() {
        let perimeter = 1600.0;
        let band = build_harmonic_band(42, COASTLINE_V2_NOISE_SALT_A, 2, 6, 1.8, 80);
        let evaluate = |s: f64| -> f64 {
            band.iter()
                .map(|h| h.amplitude * (TAU * h.frequency * s / perimeter + h.phase).sin())
                .sum()
        };

        assert!((evaluate(0.0) - evaluate(perimeter)).abs() < 1e-9);
    }

    /// 核心回归判据：插入共线顶点（形状不变）不得改变输出。
    /// v1 的逐边参数化在此必然大幅失败；v2 的弧长参数化应通过。
    #[test]
    fn v2_vertex_insertion_invariance() {
        let coarse = build_natural_coastline_polygon_v2(&canvas(), &square_shape(), &[], None);
        let dense =
            build_natural_coastline_polygon_v2(&canvas(), &subdivided_square_shape(), &[], None);

        let distance = symmetric_hausdorff(&to_vertices(&coarse), &to_vertices(&dense));
        assert!(
            distance < 0.5,
            "顶点细分不变性被破坏：Hausdorff 距离 = {distance}"
        );
    }

    #[test]
    fn v2_corner_damping_only_applies_to_concave() {
        let square = subdivided_square_shape();
        let square_sign = signed_area(&square.vertices);
        // 索引 1 是插入的共线中点，索引 2 是原始凸直角——都不衰减。
        assert_eq!(vertex_corner_factor(&square.vertices, 1, square_sign, 0.45), 1.0);
        assert_eq!(vertex_corner_factor(&square.vertices, 2, square_sign, 0.45), 1.0);

        // 窄湾形状的凹角（索引 3）衰减到 concave_factor。
        let narrow = narrow_shape();
        let narrow_sign = signed_area(&narrow.vertices);
        assert_eq!(vertex_corner_factor(&narrow.vertices, 3, narrow_sign, 0.45), 0.45);
    }

    #[test]
    fn v2_keeps_key_location_inside() {
        let location = MapKeyLocationDraft {
            id: "loc-1".to_string(),
            name: "主入口".to_string(),
            r#type: "入口".to_string(),
            x: 200.0,
            y: 180.0,
            shape_id: Some("shape-v2".to_string()),
            biz_id: None,
            ext: None,
        };
        let polygon = build_natural_coastline_polygon_v2(
            &canvas(),
            &square_shape(),
            std::slice::from_ref(&location),
            None,
        );
        let vertices = to_vertices(&polygon);

        assert!(find_polygon_self_intersections(&vertices).is_empty());
        assert!(is_point_in_polygon(
            &MapShapeVertex {
                id: "loc-1".to_string(),
                x: 200.0,
                y: 180.0,
            },
            &vertices
        ));
    }

    #[test]
    fn v2_narrow_shape_stays_safe() {
        let polygon = build_natural_coastline_polygon_v2(&canvas(), &narrow_shape(), &[], None);

        assert!(polygon.len() > 8);
        assert!(find_polygon_self_intersections(&to_vertices(&polygon)).is_empty());
    }

    #[test]
    fn v2_soft_limit_passes_small_and_saturates_large() {
        // 拐点以内原样通过
        assert_eq!(soft_limit_offset(3.0, 10.0), 3.0);
        assert_eq!(soft_limit_offset(-3.0, 10.0), -3.0);
        // 超限请求渐近逼近但严格小于上限
        let saturated = soft_limit_offset(30.0, 10.0);
        assert!(saturated > 8.0 && saturated < 10.0);
        let negative = soft_limit_offset(-30.0, 10.0);
        assert!(negative < -8.0 && negative > -10.0);
        // 上限为零时不位移
        assert_eq!(soft_limit_offset(5.0, 0.0), 0.0);
    }

    #[test]
    fn v2_band_respects_sampling_cap() {
        // 谐波上限被采样密度截断：cap=10 时 28..56 的 C 带应为空。
        let band = build_harmonic_band(7, COASTLINE_V2_NOISE_SALT_C, 28, 56, 1.8, 10);
        assert!(band.is_empty());

        let clipped = build_harmonic_band(7, COASTLINE_V2_NOISE_SALT_B, 9, 18, 1.8, 12);
        assert_eq!(clipped.len(), 4);
    }

    #[test]
    fn v2_wavelength_bands_are_absolute() {
        // 小图形（周长 300px）容不下 360~900px 的宏观波长 → 跳过 A 带。
        assert!(harmonic_range(300.0, 360.0, 900.0, 80).is_none());
        // 同一小图形的中尺度带换算为 k=2..3。
        assert_eq!(harmonic_range(300.0, 90.0, 220.0, 80), Some((2, 3)));
        // 大图形（周长 3000px）的宏观带换算为 k=4..8。
        assert_eq!(harmonic_range(3000.0, 360.0, 900.0, 80), Some((4, 8)));
        // 细节带波长 22~55px 在大图形上受采样上限截断。
        assert_eq!(harmonic_range(3000.0, 22.0, 55.0, 80), Some((55, 80)));
    }
}
