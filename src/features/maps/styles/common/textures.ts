/**
 * 羊皮纸纹理生成器：渐变基底、边角老化、轻纸纤维。
 */
export function createParchmentTexture(width: number, height: number): string {
    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height
    const ctx = canvas.getContext('2d')

    if (!ctx) return ''

    const base = ctx.createRadialGradient(
        width * 0.5,
        height * 0.45,
        width * 0.08,
        width * 0.5,
        height * 0.5,
        width * 0.78,
    )
    base.addColorStop(0, '#f2e0ba')
    base.addColorStop(0.55, '#e5cb9c')
    base.addColorStop(1, '#c8a46a')
    ctx.fillStyle = base
    ctx.fillRect(0, 0, width, height)

    const corners: [number, number][] = [[0, 0], [width, 0], [0, height], [width, height]]
    for (const [cx, cy] of corners) {
        const corner = ctx.createRadialGradient(cx, cy, 0, cx, cy, width * 0.58)
        corner.addColorStop(0, 'rgba(95, 60, 18, 0.16)')
        corner.addColorStop(0.45, 'rgba(95, 60, 18, 0.06)')
        corner.addColorStop(1, 'rgba(95, 60, 18, 0)')
        ctx.fillStyle = corner
        ctx.fillRect(0, 0, width, height)
    }

    const topLight = ctx.createLinearGradient(0, 0, 0, height)
    topLight.addColorStop(0, 'rgba(255, 244, 210, 0.14)')
    topLight.addColorStop(0.35, 'rgba(255, 244, 210, 0)')
    topLight.addColorStop(1, 'rgba(70, 35, 0, 0.06)')
    ctx.fillStyle = topLight
    ctx.fillRect(0, 0, width, height)

    const sideLight = ctx.createLinearGradient(0, 0, width, 0)
    sideLight.addColorStop(0, 'rgba(80, 40, 0, 0.06)')
    sideLight.addColorStop(0.12, 'rgba(80, 40, 0, 0)')
    sideLight.addColorStop(0.88, 'rgba(80, 40, 0, 0)')
    sideLight.addColorStop(1, 'rgba(80, 40, 0, 0.06)')
    ctx.fillStyle = sideLight
    ctx.fillRect(0, 0, width, height)

    for (let i = 0; i < 180; i++) {
        const x = Math.random() * width
        const y = Math.random() * height
        const len = 50 + Math.random() * 160
        const angle = (Math.random() - 0.5) * 0.35
        ctx.globalAlpha = 0.018 + Math.random() * 0.038
        ctx.strokeStyle = Math.random() > 0.55 ? '#7a5018' : '#b89050'
        ctx.lineWidth = 0.4 + Math.random() * 0.7
        ctx.beginPath()
        ctx.moveTo(x, y)
        ctx.lineTo(x + Math.cos(angle) * len, y + Math.sin(angle) * len)
        ctx.stroke()
    }

    ctx.globalAlpha = 1
    return canvas.toDataURL('image/png')
}

/**
 * 宣纸纹理生成器：米白底、轻噪点、短纸纤维。
 */
export function createRicePaperTexture(width: number, height: number): string {
    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height
    const ctx = canvas.getContext('2d')

    if (!ctx) return ''

    ctx.fillStyle = '#fbfaf7'
    ctx.fillRect(0, 0, width, height)

    const imageData = ctx.getImageData(0, 0, width, height)
    const data = imageData.data
    for (let i = 0; i < data.length; i += 4) {
        const noise = (Math.random() - 0.5) * 6
        data[i] = Math.min(255, Math.max(0, data[i] + noise))
        data[i + 1] = Math.min(255, Math.max(0, data[i + 1] + noise))
        data[i + 2] = Math.min(255, Math.max(0, data[i + 2] + noise))
    }
    ctx.putImageData(imageData, 0, 0)

    for (let i = 0; i < 180; i++) {
        const x = Math.random() * width
        const y = Math.random() * height
        const len = 10 + Math.random() * 40
        const angle = (Math.random() - 0.5) * 0.4
        ctx.globalAlpha = 0.03 + Math.random() * 0.06
        ctx.strokeStyle = '#b0a898'
        ctx.lineWidth = 0.3 + Math.random() * 0.7
        ctx.beginPath()
        ctx.moveTo(x, y)
        ctx.lineTo(x + Math.cos(angle) * len, y + Math.sin(angle) * len)
        ctx.stroke()
    }

    ctx.globalAlpha = 1
    return canvas.toDataURL('image/png')
}
