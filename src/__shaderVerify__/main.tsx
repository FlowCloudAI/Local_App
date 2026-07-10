/**
 * shader 层验证挂载入口（临时 harness，不进产品构建）。
 *
 * 复刻 WorldMapPanel 的真实调用路径：getPixiMapStyle → compilePixiMapStyle
 * → MapShapeViewport(pixi)。通过 URL 参数切换预设与 shader 开关：
 *   ?style=tolkien|ink|flat  &shader=1|0  （配合 ?mapDebug=1 输出编译/叠加日志）
 */
import {StrictMode} from 'react'
import {createRoot} from 'react-dom/client'
import {compilePixiMapStyle, getPixiMapStyle} from '../features/maps/styles/pixi'
import type {PixiMapStyle} from '../features/maps/styles/pixi'
import {MapShapeViewport} from '../features/maps/components/MapShapeEditor'
import type {MapPreviewScene} from '../features/maps/components/MapShapeEditor'

function makeIsland(
    cx: number,
    cy: number,
    r: number,
    verts: number,
    seed: number,
): [number, number][] {
    const pts: [number, number][] = []
    for (let i = 0; i < verts; i++) {
        const a = (i / verts) * Math.PI * 2
        const wobble = 1
            + 0.22 * Math.sin(a * 3 + seed)
            + 0.12 * Math.sin(a * 7 + seed * 2.7)
            + 0.06 * Math.sin(a * 13 + seed * 5.1)
        pts.push([cx + Math.cos(a) * r * wobble, cy + Math.sin(a) * r * wobble])
    }
    return pts
}

const canvas = {width: 800, height: 600}

const baseScene: MapPreviewScene = {
    canvas,
    shapes: [
        {
            id: 'island-main',
            name: '主大陆',
            polygon: makeIsland(340, 300, 170, 96, 1.3),
            fillColor: [232, 211, 162, 255],
            lineColor: [111, 71, 36, 230],
        },
        {
            id: 'island-east',
            name: '东屿',
            polygon: makeIsland(640, 180, 70, 64, 4.1),
            fillColor: [232, 211, 162, 255],
            lineColor: [111, 71, 36, 230],
        },
        {
            id: 'island-south',
            name: '南礁',
            polygon: makeIsland(620, 470, 46, 48, 7.7),
            fillColor: [232, 211, 162, 255],
            lineColor: [111, 71, 36, 230],
        },
    ],
    keyLocations: [
        {id: 'loc-1', name: '晨风王都', type: '王都', position: [320, 260], color: [106, 67, 37, 255]},
        {id: 'loc-2', name: '雾湾村', type: '村庄', position: [420, 380], color: [106, 67, 37, 255]},
        {id: 'loc-3', name: '古神殿', type: '遗迹', position: [640, 170], color: [106, 67, 37, 255]},
        {id: 'loc-4', name: '南礁港', type: '港口', position: [618, 462], color: [106, 67, 37, 255]},
    ],
}

const params = new URLSearchParams(window.location.search)
const styleId = params.get('style') ?? 'tolkien'
const shaderOn = params.get('shader') !== '0'

const preset = getPixiMapStyle(styleId)
const style: PixiMapStyle = {
    ...preset,
    useShaderOptimization: shaderOn,
}
const compiled = compilePixiMapStyle({style, canvas, scene: baseScene})

declare global {
    interface Window {
        __harnessInfo?: Record<string, unknown>
    }
}
window.__harnessInfo = {
    styleId: style.id,
    shaderOn,
    hasOverlay: Boolean(compiled.pixiProps.renderOverlay),
}

createRoot(document.getElementById('root')!).render(
    <StrictMode>
        <div style={{width: '100%', height: '100%', ...compiled.viewportStyle}}>
            <MapShapeViewport
                mode="preview"
                renderer="pixi"
                canvas={canvas}
                scene={compiled.scene}
                shapeStyle={compiled.shapeStyle}
                keyLocationStyle={compiled.keyLocationStyle}
                labelStyle={compiled.labelStyle}
                pixiProps={compiled.pixiProps}
            />
        </div>
    </StrictMode>,
)
