/* eslint-disable react-refresh/only-export-components */
/**
 * shader 层验证挂载入口（临时 harness，不进产品构建）。
 *
 * 复刻 WorldMapPanel 的真实调用路径：getPixiMapStyle → compilePixiMapStyle
 * → MapShapeViewport(pixi)。通过 URL 参数切换预设与 shader 开关：
 *   ?style=tolkien|ink|flat  &shader=1|0  （配合 ?mapDebug=1 输出编译/叠加日志）
 */
import {StrictMode, useEffect, useState} from 'react'
import {createRoot} from 'react-dom/client'
import {compilePixiMapStyle, getPixiMapStyle} from '../features/maps/styles/pixi'
import type {PixiMapStyle} from '../features/maps/styles/pixi'
import {cloneMapShapeEditorDraft, MapShapeViewport} from '../features/maps/components/MapShapeEditor'
import type {
    MapPreviewScene,
    MapShapeEditorDraft,
    MapShapeEditorViewBox,
    MapTerrainStroke,
} from '../features/maps/components/MapShapeEditor'
import {
    createTerrainFieldData,
    resolveTerrainStrokesForViewport,
    TERRAIN_FIELD_EMPTY_INDEX,
} from '../features/maps/styles/common'

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

function assertTerrainLayering() {
    const strokes: MapTerrainStroke[] = [
        {id: 'base', kind: 'grass', points: [[32, 32]], radius: 20, mode: 'paint'},
        {id: 'middle', kind: 'desert', points: [[32, 32]], radius: 20, mode: 'paint'},
        {id: 'top', kind: 'grass', points: [[32, 32]], radius: 10, mode: 'paint'},
        {id: 'erase-top', kind: 'grass', points: [[32, 32]], radius: 6, mode: 'erase'},
    ]
    const field = createTerrainFieldData(strokes, 64, 64)
    const data = field?.data
    if (!data) throw new Error('地形场自检无法读取像素')

    const center = (32 * 64 + 32) * 4
    const topRing = (32 * 64 + 40) * 4
    if (data[center] !== TERRAIN_FIELD_EMPTY_INDEX || data[center + 1] !== 0) {
        throw new Error('地形场自检失败：擦除未清空全部地形')
    }
    if (data[topRing] !== 0 || data[topRing + 1] !== 255) {
        throw new Error('地形场自检失败：最上层地形未覆盖下层')
    }

    const overlapField = createTerrainFieldData([
        {id: 'overlap-base', kind: 'grass', points: [[32, 32]], radius: 20, mode: 'paint'},
        {id: 'overlap-top', kind: 'mountain', points: [[32, 32]], radius: 10, mode: 'paint'},
    ], 64, 64)
    const overlapData = overlapField?.data
    if (!overlapData) throw new Error('地形场重叠自检无法读取像素')
    for (let offset = 0; offset < overlapData.length; offset += 4) {
        if (overlapData[offset] === 1 && overlapData[offset + 1] < 255) {
            throw new Error('地形场自检失败：不同地形交界处露出半透明空隙')
        }
    }

    // 相邻异种笔画恰好拼接（半像素对齐）：交界行两侧各只有 ~50% 抗锯齿覆盖度，
    // 并集合并后胜者通道应恢复满覆盖——只保留胜者自身覆盖度会在交界行留下半透明缝。
    const seamField = createTerrainFieldData([
        {id: 'seam-grass', kind: 'grass', points: [[8, 20.5], [56, 20.5]], radius: 10, mode: 'paint'},
        {id: 'seam-mountain', kind: 'mountain', points: [[8, 40.5], [56, 40.5]], radius: 10, mode: 'paint'},
    ], 64, 64)
    const seamData = seamField?.data
    if (!seamData) throw new Error('地形场拼接自检无法读取像素')
    for (let y = 15; y <= 45; y++) {
        const offset = (y * 64 + 32) * 4
        const winnerCoverage = seamData[offset + 1]
        if (winnerCoverage < 250) {
            throw new Error(`地形场自检失败：相邻地形拼接行覆盖度塌陷（y=${y} coverage=${winnerCoverage}）`)
        }
    }

    const generated = [strokes[0]]
    if (resolveTerrainStrokesForViewport('edit', strokes, generated) !== strokes) {
        throw new Error('地形快照自检失败：编辑模式未读取草稿语义')
    }
    if (resolveTerrainStrokesForViewport('preview', strokes, generated) !== generated) {
        throw new Error('地形快照自检失败：预览模式未保持生成快照')
    }
}

assertTerrainLayering()

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
    terrainStrokes: [
        {id: 'terrain-grass', kind: 'grass', points: [[230, 270], [300, 230], [370, 250]], radius: 58, mode: 'paint'},
        {id: 'terrain-mountain', kind: 'mountain', points: [[275, 330], [340, 350], [400, 325]], radius: 42, mode: 'paint'},
        {id: 'terrain-desert', kind: 'desert', points: [[355, 225], [420, 275], [470, 310]], radius: 48, mode: 'paint'},
        {id: 'terrain-erase', kind: 'grass', points: [[292, 250], [320, 270]], radius: 18, mode: 'erase'},
    ],
}

const params = new URLSearchParams(window.location.search)
const styleId = params.get('style') ?? 'tolkien'
const shaderOn = params.get('shader') !== '0'
const editMode = params.get('edit') === '1'

const preset = getPixiMapStyle(styleId)
const style: PixiMapStyle = {
    ...preset,
    useShaderOptimization: shaderOn,
}
const compiled = compilePixiMapStyle({style, canvas, scene: baseScene})

declare global {
    interface Window {
        __harnessInfo?: Record<string, unknown>
        __terrainStrokeCount?: number
    }
}
window.__harnessInfo = {
    styleId: style.id,
    shaderOn,
    editMode,
    hasOverlay: Boolean(compiled.pixiProps.renderOverlay),
    hasGroundOverlay: Boolean(compiled.pixiProps.renderGroundOverlay),
}

const initialDraft: MapShapeEditorDraft = {
    shapes: baseScene.shapes.map(shape => ({
        id: shape.id,
        name: shape.name,
        vertices: shape.polygon.map((point, index) => ({
            id: `${shape.id}-vertex-${index}`,
            x: point[0],
            y: point[1],
        })),
    })),
    keyLocations: baseScene.keyLocations.map(location => ({
        id: location.id,
        name: location.name,
        type: location.type,
        x: location.position[0],
        y: location.position[1],
    })),
    terrainStrokes: baseScene.terrainStrokes,
}
const clonedDraft = cloneMapShapeEditorDraft(initialDraft)
if (clonedDraft.terrainStrokes?.[0]?.points === initialDraft.terrainStrokes?.[0]?.points) {
    throw new Error('草稿克隆自检失败：地形笔画未深克隆')
}

function TerrainEditorHarness() {
    const [draft, setDraft] = useState(initialDraft)
    const [viewBox, setViewBox] = useState<MapShapeEditorViewBox>({x: 0, y: 0, ...canvas})
    useEffect(() => {
        window.__terrainStrokeCount = draft.terrainStrokes?.length ?? 0
    }, [draft.terrainStrokes])

    return (
        <MapShapeViewport
            mode="edit"
            renderer="pixi"
            canvas={canvas}
            scene={{...compiled.scene, terrainStrokes: draft.terrainStrokes}}
            viewBox={viewBox}
            onViewBoxChange={setViewBox}
            shapeStyle={compiled.shapeStyle}
            keyLocationStyle={compiled.keyLocationStyle}
            labelStyle={compiled.labelStyle}
            pixiProps={compiled.pixiProps}
            svgProps={{
                draft,
                selectedShapeId: null,
                selectedLocationId: null,
                drawingShape: null,
                terrainBrush: {kind: 'grass', radius: 32, mode: 'paint', shape: 'round'},
                onDraftChange: setDraft,
                onSelectedShapeChange: () => undefined,
                onSelectedLocationChange: () => undefined,
                onDrawingShapeChange: () => undefined,
            }}
        />
    )
}

createRoot(document.getElementById('root')!).render(
    <StrictMode>
        <div style={{width: '100%', height: '100%', ...compiled.viewportStyle}}>
            {editMode ? <TerrainEditorHarness/> : (
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
            )}
        </div>
    </StrictMode>,
)
