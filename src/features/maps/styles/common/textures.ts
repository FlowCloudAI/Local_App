/** 确定性 PRNG（mulberry32）：均匀随机、可复现。用它撒点可避免 fract(sin) 哈希的规则/摩尔纹。 */
export function makeSeededRng(seed: number): () => number {
    let s = seed >>> 0
    return () => {
        s = (s + 0x6d2b79f5) >>> 0
        let t = Math.imul(s ^ (s >>> 15), 1 | s)
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296
    }
}

/**
 * 羊皮纸纹理生成器：暖色径向基底 + 不规则做旧色斑（受潮/陈化不均）+ 边角与四边磨损 +
 * 光照 + 双向纸纤维 + 细颗粒（纸张 tooth）。用确定性 PRNG，同尺寸每次一致、不闪变。
 * 注意：本纹理按超采样尺寸生成（见 pixi/compiler 的 mapRenderScale），细节以物理像素给出。
 * 返回 canvas 本体（供 Texture.from 直通），不做 PNG 编码。
 */
export function createParchmentTexture(width: number, height: number): HTMLCanvasElement | null {
    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height
    const ctx = canvas.getContext('2d')

    if (!ctx) return null

    const rng = makeSeededRng(Math.round(width) * 7919 + Math.round(height) * 104729 + 17)
    const area = width * height
    const maxSide = Math.max(width, height)

    // 1. 暖色径向基底
    const base = ctx.createRadialGradient(
        width * 0.5, height * 0.45, maxSide * 0.06,
        width * 0.5, height * 0.5, maxSide * 0.8,
    )
    base.addColorStop(0, '#f4e3bd')
    base.addColorStop(0.5, '#e7cf9f')
    base.addColorStop(0.82, '#d4b177')
    base.addColorStop(1, '#c09a5e')
    ctx.fillStyle = base
    ctx.fillRect(0, 0, width, height)

    // 2. 不规则做旧色斑：深浅各半、柔和大范围，只填各自包围盒省开销
    const stainCount = Math.round(area / 85000) + 8
    for (let i = 0; i < stainCount; i++) {
        const cx = rng() * width
        const cy = rng() * height
        const r = (0.06 + rng() * 0.2) * maxSide
        const dark = rng() > 0.5
        const a = 0.025 + rng() * 0.055
        const stain = ctx.createRadialGradient(cx, cy, r * 0.08, cx, cy, r)
        stain.addColorStop(0, dark ? `rgba(94, 58, 18, ${a})` : `rgba(255, 246, 214, ${a * 0.85})`)
        stain.addColorStop(0.6, dark ? `rgba(94, 58, 18, ${a * 0.4})` : `rgba(255, 246, 214, ${a * 0.35})`)
        stain.addColorStop(1, 'rgba(0, 0, 0, 0)')
        ctx.fillStyle = stain
        ctx.fillRect(cx - r, cy - r, r * 2, r * 2)
    }

    // 3. 四角老化（略强）
    const corners: [number, number][] = [[0, 0], [width, 0], [0, height], [width, height]]
    for (const [cx, cy] of corners) {
        const corner = ctx.createRadialGradient(cx, cy, 0, cx, cy, maxSide * 0.6)
        corner.addColorStop(0, 'rgba(88, 54, 16, 0.2)')
        corner.addColorStop(0.45, 'rgba(88, 54, 16, 0.07)')
        corner.addColorStop(1, 'rgba(88, 54, 16, 0)')
        ctx.fillStyle = corner
        ctx.fillRect(0, 0, width, height)
    }

    // 4. 四边内缩暗边（磨损的纸缘）
    const edge = Math.max(6, maxSide * 0.02)
    const edgeRects: [number, number, number, number, number, number, number, number][] = [
        [0, 0, 0, edge, 0, 0, width, edge],
        [0, height, 0, height - edge, 0, height - edge, width, edge],
        [0, 0, edge, 0, 0, 0, edge, height],
        [width, 0, width - edge, 0, width - edge, 0, edge, height],
    ]
    for (const [gx0, gy0, gx1, gy1, x, y, w, h] of edgeRects) {
        const g = ctx.createLinearGradient(gx0, gy0, gx1, gy1)
        g.addColorStop(0, 'rgba(76, 44, 12, 0.14)')
        g.addColorStop(1, 'rgba(76, 44, 12, 0)')
        ctx.fillStyle = g
        ctx.fillRect(x, y, w, h)
    }

    // 5. 顶部柔光
    const topLight = ctx.createLinearGradient(0, 0, 0, height)
    topLight.addColorStop(0, 'rgba(255, 244, 210, 0.14)')
    topLight.addColorStop(0.35, 'rgba(255, 244, 210, 0)')
    topLight.addColorStop(1, 'rgba(70, 35, 0, 0.06)')
    ctx.fillStyle = topLight
    ctx.fillRect(0, 0, width, height)

    // 6. 纸纤维：更多、含少量竖向
    const fiberCount = Math.round(area / 3400) + 120
    for (let i = 0; i < fiberCount; i++) {
        const x = rng() * width
        const y = rng() * height
        const vertical = rng() > 0.72
        const len = (vertical ? 24 : 46) + rng() * (vertical ? 80 : 150)
        const angle = vertical ? Math.PI / 2 + (rng() - 0.5) * 0.5 : (rng() - 0.5) * 0.32
        ctx.globalAlpha = 0.014 + rng() * 0.036
        ctx.strokeStyle = rng() > 0.55 ? '#7a5018' : '#c2a267'
        ctx.lineWidth = 0.3 + rng() * 0.75
        ctx.beginPath()
        ctx.moveTo(x, y)
        ctx.lineTo(x + Math.cos(angle) * len, y + Math.sin(angle) * len)
        ctx.stroke()
    }

    // 7. 细颗粒（纸张 tooth）
    const speckleCount = Math.round(area / 1100)
    for (let i = 0; i < speckleCount; i++) {
        const x = rng() * width
        const y = rng() * height
        const s = 0.4 + rng() * 0.9
        ctx.globalAlpha = 0.02 + rng() * 0.045
        ctx.fillStyle = rng() > 0.62 ? 'rgba(88, 56, 20, 1)' : 'rgba(255, 250, 226, 1)'
        ctx.fillRect(x, y, s, s)
    }

    ctx.globalAlpha = 1
    return canvas
}

/**
 * 宣纸纹理生成器：米白底、轻噪点、短纸纤维。
 * 确定性 PRNG：原来用 Math.random，每次重编译噪点都变，调参/改场景时纸面会肉眼可见地"闪"。
 * 返回 canvas 本体（供 Texture.from 直通），不做 PNG 编码。
 */
export function createRicePaperTexture(width: number, height: number): HTMLCanvasElement | null {
    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height
    const ctx = canvas.getContext('2d')

    if (!ctx) return null

    const rng = makeSeededRng(Math.round(width) * 9973 + Math.round(height) * 4409 + 7)

    ctx.fillStyle = '#fbfaf7'
    ctx.fillRect(0, 0, width, height)

    const imageData = ctx.getImageData(0, 0, width, height)
    const data = imageData.data
    for (let i = 0; i < data.length; i += 4) {
        const noise = (rng() - 0.5) * 6
        data[i] = Math.min(255, Math.max(0, data[i] + noise))
        data[i + 1] = Math.min(255, Math.max(0, data[i + 1] + noise))
        data[i + 2] = Math.min(255, Math.max(0, data[i + 2] + noise))
    }
    ctx.putImageData(imageData, 0, 0)

    // 纤维数量随面积缩放：原来固定 180 根，超采样大图上过于稀疏
    const fiberCount = Math.round((width * height) / 4200) + 60
    for (let i = 0; i < fiberCount; i++) {
        const x = rng() * width
        const y = rng() * height
        const len = 10 + rng() * 40
        const angle = (rng() - 0.5) * 0.4
        ctx.globalAlpha = 0.03 + rng() * 0.06
        ctx.strokeStyle = '#b0a898'
        ctx.lineWidth = 0.3 + rng() * 0.7
        ctx.beginPath()
        ctx.moveTo(x, y)
        ctx.lineTo(x + Math.cos(angle) * len, y + Math.sin(angle) * len)
        ctx.stroke()
    }

    ctx.globalAlpha = 1
    return canvas
}
