import type {MapPreviewScene} from 'flowcloudai-ui'
import type {DecoPath} from '../types'

/**
 * 从 scene.shapes 的多边形生成双重海岸线描边。
 * 外层 (9px 低透明) 提供晕染感，内层 (4px 中透明) 强化边界。
 */
export function buildCoastOutlines(scene: MapPreviewScene): DecoPath[] {
    return scene.shapes.flatMap(shape => {
        if (shape.polygon.length < 3) return []
        const poly = shape.polygon as [number, number][]
        return [
            {
                path: poly,
                color: [100, 65, 30, 55] as [number, number, number, number],
                widthPixels: 9,
            },
            {
                path: poly,
                color: [130, 88, 40, 120] as [number, number, number, number],
                widthPixels: 3.5,
            },
        ]
    })
}
