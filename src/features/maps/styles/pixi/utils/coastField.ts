/**
 * 海岸场（Coast Field）生成器
 *
 * 在 CPU 上用 Felzenszwalb–Huttenlocher 精确欧氏距离变换（EDT，O(N) 可分离）
 * 计算每个像素到海岸线的有符号距离，编码进一张 RG16F 半浮点纹理：
 *   R = 有符号距离（场景像素）：>0 海侧，<0 陆侧，0 落在海岸线上
 *   G = 保留（当前恒为 0）
 *
 * shader 消费方式（线性采样，场景归一化 UV，见 plugins/shared.ts coastFieldGlsl）：
 *   float sd = texture(uCoastField, vUV).r;
 *   float dist = abs(sd); bool land = sd < 0.0;
 *
 * 为什么是 RG16F 而不是——
 * - RGBA8（旧编码）：距离压进 8-bit 只有约 1px 量化步，深放大后 floor()/
 *   环阈值把台阶放大成肉眼可见的块。半浮点在 0..255px 范围内精度 ≤0.125px。
 * - R16F：texel 2 字节，行距在奇数宽度下不是 4 的倍数；Pixi 上传不改
 *   UNPACK_ALIGNMENT（默认 4），会整幅错位。RG16F texel 4 字节永远对齐。
 * - R32F：WebGL2 线性过滤需要 OES_texture_float_linear 扩展；16F 可过滤是核心能力。
 *
 * 有符号单通道同时替代了旧 R 距离 + G 陆地遮罩：双线性插值跨边界平滑过零，
 * 边界判定（sd<0）天然亚像素精度，不再有二值遮罩的锯齿。
 */

export const COAST_FIELD_MAX_PX = 2048

const INF = 1e20

/**
 * 一维平方距离变换（下包络抛物线法）。
 * f: 输入代价（0 或 INF），d: 输出平方距离，v/z: 复用的工作区。
 */
function edt1d(f: Float32Array, d: Float32Array, v: Int32Array, z: Float32Array, n: number): void {
    let k = 0
    v[0] = 0
    z[0] = -INF
    z[1] = INF

    for (let q = 1; q < n; q++) {
        let s = (f[q] + q * q - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k])
        while (s <= z[k]) {
            k--
            s = (f[q] + q * q - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k])
        }
        k++
        v[k] = q
        z[k] = s
        z[k + 1] = INF
    }

    k = 0
    for (let q = 0; q < n; q++) {
        while (z[k + 1] < q) k++
        const dx = q - v[k]
        d[q] = dx * dx + f[v[k]]
    }
}

/** 二维欧氏距离变换：grid 就地更新为"到最近零值像素的平方距离"。 */
function edt2d(grid: Float32Array, width: number, height: number): void {
    const n = Math.max(width, height)
    const f = new Float32Array(n)
    const d = new Float32Array(n)
    const v = new Int32Array(n)
    const z = new Float32Array(n + 1)

    for (let x = 0; x < width; x++) {
        for (let y = 0; y < height; y++) f[y] = grid[y * width + x]
        edt1d(f, d, v, z, height)
        for (let y = 0; y < height; y++) grid[y * width + x] = d[y]
    }

    for (let y = 0; y < height; y++) {
        const row = y * width
        for (let x = 0; x < width; x++) f[x] = grid[row + x]
        edt1d(f, d, v, z, width)
        for (let x = 0; x < width; x++) grid[row + x] = d[x]
    }
}

/** 光栅化陆地遮罩：返回长度 w*h 的 0/1 数组（1=陆地），无有效多边形时返回 null。 */
function rasterizeLandMask(
    shapes: Array<{ polygon: [number, number][] }>,
    width: number,
    height: number,
): Uint8Array | null {
    const polygons = shapes.filter(shape => shape.polygon.length >= 3)
    if (!polygons.length) return null

    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height
    const ctx = canvas.getContext('2d', {willReadFrequently: true})
    if (!ctx) return null

    ctx.fillStyle = '#fff'
    for (const shape of polygons) {
        const polygon = shape.polygon
        ctx.beginPath()
        ctx.moveTo(polygon[0][0], polygon[0][1])
        for (let i = 1; i < polygon.length; i++) {
            ctx.lineTo(polygon[i][0], polygon[i][1])
        }
        ctx.closePath()
        ctx.fill()
    }

    const imageData = ctx.getImageData(0, 0, width, height).data
    const mask = new Uint8Array(width * height)
    for (let i = 0; i < mask.length; i++) {
        mask[i] = imageData[i * 4] > 128 ? 1 : 0
    }
    return mask
}

/**
 * 计算有符号海岸距离（>0 海侧，<0 陆侧，单位场景像素，|sd| 封顶 COAST_FIELD_MAX_PX）。
 * 纯计算函数，便于单测；浏览器侧请用 createCoastFieldData。
 */
export function computeSignedCoastField(mask: Uint8Array, width: number, height: number): Float32Array {
    const size = width * height

    // 两个方向的 EDT：到最近海洋像素（陆地侧有效）与到最近陆地像素（海洋侧有效）
    const toSea = new Float32Array(size)
    const toLand = new Float32Array(size)
    for (let i = 0; i < size; i++) {
        const land = mask[i] === 1
        toSea[i] = land ? INF : 0
        toLand[i] = land ? 0 : INF
    }
    edt2d(toSea, width, height)
    edt2d(toLand, width, height)

    const out = new Float32Array(size)
    for (let i = 0; i < size; i++) {
        const land = mask[i] === 1
        // 边界落在相邻异侧像素之间：减 0.5px 使距离以边界为零点
        const dist = Math.min(
            COAST_FIELD_MAX_PX,
            Math.max(0, Math.sqrt(land ? toSea[i] : toLand[i]) - 0.5),
        )
        out[i] = land ? -dist : dist
    }
    return out
}

const f32Scratch = new Float32Array(1)
const u32Scratch = new Uint32Array(f32Scratch.buffer)

/** IEEE754 float32 → float16 位型转换（截断舍入；距离值域内误差远小于 0.01px）。 */
export function floatToHalf(value: number): number {
    f32Scratch[0] = value
    const bits = u32Scratch[0]
    const sign = (bits >>> 16) & 0x8000
    let exp = (bits >>> 23) & 0xff
    let frac = bits & 0x7fffff

    if (exp === 0xff) return sign | 0x7c00 | (frac ? 0x200 : 0) // Inf / NaN
    exp = exp - 127 + 15
    if (exp >= 0x1f) return sign | 0x7c00 // 溢出 → ±Inf（值域已封顶，正常到不了）
    if (exp <= 0) {
        if (exp < -10) return sign // 太小 → ±0
        frac = (frac | 0x800000) >> (1 - exp)
        return sign | (frac >> 13)
    }
    return sign | (exp << 10) | (frac >> 13)
}

export interface CoastFieldData {
    /** RG16F 纹理数据（每 texel 两个 half：R=有符号距离，G=0），长度 w*h*2 */
    data: Uint16Array
    width: number
    height: number
}

/**
 * 生成海岸场纹理数据（场景分辨率）。返回 null 表示无有效陆地或环境不支持。
 * 纹理生命周期交给调用方（overlays 的 useCoastFieldTexture 延迟销毁）。
 */
export function createCoastFieldData(
    shapes: Array<{ polygon: [number, number][] }>,
    sceneWidth: number,
    sceneHeight: number,
): CoastFieldData | null {
    const width = Math.round(sceneWidth)
    const height = Math.round(sceneHeight)
    if (width <= 0 || height <= 0) return null

    const mask = rasterizeLandMask(shapes, width, height)
    if (!mask) return null

    const sd = computeSignedCoastField(mask, width, height)
    const data = new Uint16Array(width * height * 2)
    for (let i = 0; i < sd.length; i++) {
        data[i * 2] = floatToHalf(sd[i])
        // G 通道保留为 0
    }
    return {data, width, height}
}
