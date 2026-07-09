/**
 * 海岸场（Coast Field）生成器
 *
 * 在 CPU 上用 Felzenszwalb–Huttenlocher 精确欧氏距离变换（EDT，O(N) 可分离）
 * 计算每个像素到海岸线的距离，连同陆地遮罩打包进一张 RGBA8 canvas：
 *   R = 到海岸线的距离 / COAST_FIELD_RANGE_PX（超出封顶到 1.0）
 *   G = 陆地遮罩（255=陆地，0=海洋）
 *   B / A = 保留（当前恒为 0 / 255）
 *
 * shader 消费方式（线性采样，场景归一化 UV）：
 *   vec4 field = texture(uCoastField, vUV);
 *   float dist = field.r * uDfRange;   // 场景像素单位
 *   bool land = field.g > 0.5;
 *
 * 为什么不用 GPU JFA：旧实现把种子坐标编码进 8-bit 通道（每轴最多 256 档，
 * 且 (0,0) 同时表示"无效"与左上角），结果不可用；且在未 init 的临时 Application
 * 上渲染必然抛错。CPU EDT 是精确解、确定性、可单测，场景分辨率下一次性数十 ms，
 * 且只在 shapes/画布尺寸变化时重算（调用方 memoize）。
 */

export const COAST_FIELD_RANGE_PX = 255

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
 * 计算海岸场并把 RGBA8 编码写入 out（长度 w*h*4，如 ImageData.data）。
 * 纯计算函数，便于单测；浏览器侧请用 createCoastFieldCanvas。
 */
export function encodeCoastField(mask: Uint8Array, width: number, height: number, out: Uint8ClampedArray): void {
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

    for (let i = 0; i < size; i++) {
        const land = mask[i] === 1
        // 边界落在相邻异侧像素之间：减 0.5px 使距离以边界为零点
        const dist = Math.max(0, Math.sqrt(land ? toSea[i] : toLand[i]) - 0.5)
        const encoded = Math.min(255, Math.round((dist / COAST_FIELD_RANGE_PX) * 255))
        const o = i * 4
        out[o] = encoded
        out[o + 1] = land ? 255 : 0
        out[o + 2] = 0
        out[o + 3] = 255
    }
}

/**
 * 生成海岸场 canvas（场景分辨率）。返回 null 表示无有效陆地或环境不支持。
 * 纹理生命周期交给调用方（overlays 的 useCanvasTexture 延迟销毁）。
 */
export function createCoastFieldCanvas(
    shapes: Array<{ polygon: [number, number][] }>,
    sceneWidth: number,
    sceneHeight: number,
): HTMLCanvasElement | null {
    const width = Math.round(sceneWidth)
    const height = Math.round(sceneHeight)
    if (width <= 0 || height <= 0) return null

    const mask = rasterizeLandMask(shapes, width, height)
    if (!mask) return null

    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height
    const ctx = canvas.getContext('2d')
    if (!ctx) return null

    const imageData = ctx.createImageData(width, height)
    encodeCoastField(mask, width, height, imageData.data)
    ctx.putImageData(imageData, 0, 0)
    return canvas
}
