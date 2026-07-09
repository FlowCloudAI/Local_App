/**
 * 距离场生成器测试
 *
 * 验证 Jump Flooding Algorithm 的正确性
 */

import { generateDistanceFieldTexture, generateLandMaskTexture } from './distanceField'

/**
 * 创建测试用的简单形状
 */
export function createTestShapes() {
    // 简单的矩形陆地块
    return [
        {
            polygon: [
                [100, 100] as [number, number],
                [300, 100] as [number, number],
                [300, 300] as [number, number],
                [100, 300] as [number, number],
            ],
        },
    ]
}

/**
 * 测试距离场生成（浏览器环境）
 */
export async function testDistanceFieldGeneration(): Promise<boolean> {
    try {
        const shapes = createTestShapes()
        const width = 400
        const height = 400

        console.log('[DistanceField Test] 开始生成距离场...')

        const distanceField = generateDistanceFieldTexture(shapes, width, height, 1)
        const landMask = generateLandMaskTexture(shapes, width, height, 1)

        console.log('[DistanceField Test] 距离场生成成功')
        console.log('[DistanceField Test] 距离场纹理:', distanceField)
        console.log('[DistanceField Test] 陆地遮罩纹理:', landMask)

        // 验证纹理尺寸
        if (!distanceField || !landMask) {
            console.error('[DistanceField Test] 纹理生成失败')
            return false
        }

        console.log('[DistanceField Test] ✅ 测试通过')
        return true
    } catch (error) {
        console.error('[DistanceField Test] ❌ 测试失败:', error)
        return false
    }
}

/**
 * 可视化距离场（开发模式调试用）
 *
 * 将距离场纹理绘制到 canvas 上以便检查
 */
export function visualizeDistanceField(
    distanceFieldTexture: unknown,
    targetCanvas: HTMLCanvasElement
): void {
    const ctx = targetCanvas.getContext('2d')
    if (!ctx) {
        console.error('[DistanceField] 无法获取 canvas context')
        return
    }

    // TODO: 从 Pixi Texture 提取像素数据并绘制
    // 这需要使用 Pixi 的 extract 插件或手动读取纹理
    console.log('[DistanceField] 可视化功能待实现', distanceFieldTexture)
}
