/* eslint-disable react-refresh/only-export-components */
/**
 * shader 层验证挂载入口（临时 harness，不进产品构建）。
 *
 * 复刻 WorldMapPanel 的真实调用路径：getPixiMapStyle → compilePixiMapStyle
 * → MapShapeViewport(pixi)。通过 URL 参数切换预设：
 *   ?style=tolkien|ink|flat（配合 ?mapDebug=1 输出编译/叠加日志）
 */
import {StrictMode, useEffect, useMemo, useState} from 'react'
import {createRoot} from 'react-dom/client'
import {compilePixiMapStyle, getPixiMapStyle} from '../features/maps/styles'
import type {PixiMapStyle} from '../features/maps/styles'
import {retainShapesWhenPolygonsMatch} from '../features/maps/styles/pixi/overlays'
import {buildTerrainSymbolPlacements} from '../features/maps/styles/pixi/terrainSymbols'
import {
    cloneMapShapeEditorDraft,
    buildPreviewKeyLocations,
    MapShapeViewport,
    simplifyTerrainStroke,
} from '../features/maps/components/MapShapeEditor'
import type {
    MapPreviewScene,
    MapShapeEditorDraft,
    MapShapeEditorViewBox,
    MapTerrainStroke,
} from '../features/maps/components/MapShapeEditor'
import {
    createTerrainFieldData,
    compactTerrainStrokes,
    resolveTerrainStrokesForViewport,
    TERRAIN_FIELD_EMPTY_INDEX,
} from '../features/maps/styles'

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
    const polygon: [number, number][] = [[0, 0], [10, 0], [0, 10]]
    const previousShapes: MapPreviewScene['shapes'] = [{
        id: 'stable-shape',
        name: '稳定多边形',
        polygon,
        fillColor: [0, 0, 0, 255],
        lineColor: [0, 0, 0, 255],
    }]
    const rebuiltShapes = previousShapes.map(shape => ({...shape}))
    if (retainShapesWhenPolygonsMatch(previousShapes, rebuiltShapes) !== previousShapes) {
        throw new Error('海岸场缓存自检失败：相同 polygon 引用未复用 shapes 数组')
    }
    const changedShapes = previousShapes.map(shape => ({...shape, polygon: [...shape.polygon]}))
    if (retainShapesWhenPolygonsMatch(previousShapes, changedShapes) !== changedShapes) {
        throw new Error('海岸场缓存自检失败：polygon 变化后错误复用 shapes 数组')
    }

    const simplified = simplifyTerrainStroke({
        id: 'simplify',
        kind: 'grass',
        points: [[0, 0], [1, 0.1], [2, -0.1], [3, 0]],
        radius: 4,
        mode: 'paint',
    })
    if (simplified.points.length !== 2) {
        throw new Error('地形笔画自检失败：近直线轨迹未被抽稀')
    }

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

    const squareField = createTerrainFieldData([
        {id: 'square', kind: 'grass', points: [[16, 16]], radius: 6, mode: 'paint', shape: 'square'},
    ], 32, 32)
    const squareData = squareField?.data
    const squareCorner = (21 * 32 + 21) * 4
    if (!squareData || squareData[squareCorner] !== 0 || squareData[squareCorner + 1] < 250) {
        throw new Error('地形场自检失败：方形笔刷未覆盖轴对齐角部')
    }

    const gcStrokes: MapTerrainStroke[] = [
        {id: 'old-erase', kind: 'grass', points: [[16, 16]], radius: 8, mode: 'erase'},
        ...Array.from({length: 52}, (_, index): MapTerrainStroke => ({
            id: `gc-${index}`,
            kind: index % 2 === 0 ? 'grass' : 'mountain',
            points: [[16, 16]],
            radius: 8,
            mode: 'paint',
        })),
    ]
    const compacted = compactTerrainStrokes(gcStrokes, 32, 32)
    if (compacted.length !== 50 || compacted[0].id !== 'gc-2') {
        throw new Error('地形笔画自检失败：保存 GC 未按最近 50 笔回收无贡献记录')
    }
    const beforeGc = createTerrainFieldData(gcStrokes, 32, 32)?.data
    const afterGc = createTerrainFieldData(compacted, 32, 32)?.data
    if (!beforeGc || !afterGc || beforeGc.some((value, index) => value !== afterGc[index])) {
        throw new Error('地形笔画自检失败：保存 GC 改变了最终地形场')
    }
    const unknown = [{id: 'future', kind: 'future-kind', points: [[1, 1]] as [number, number][], radius: 2, mode: 'paint' as const}]
    if (compactTerrainStrokes(unknown, 32, 32) !== unknown) {
        throw new Error('地形笔画自检失败：未知类型未被保守保留')
    }

    const generated = [strokes[0]]
    if (resolveTerrainStrokesForViewport('edit', strokes, generated) !== strokes) {
        throw new Error('地形快照自检失败：编辑模式未读取草稿语义')
    }
    if (resolveTerrainStrokesForViewport('preview', strokes, generated) !== generated) {
        throw new Error('地形快照自检失败：预览模式未保持生成快照')
    }

    for (const styleName of ['flat', 'tolkien', 'ink']) {
        const terrainConfig = getPixiMapStyle(styleName).decorations?.find(item => item.id === 'terrain')
        if (!terrainConfig) throw new Error(`地形预设自检失败：${styleName} 未启用 terrain`)
    }

    const symbolShapes: MapPreviewScene['shapes'] = [{
        id: 'symbol-land',
        name: '符号陆地',
        polygon: [[0, 0], [256, 0], [256, 256], [0, 256]],
        fillColor: [255, 255, 255, 255],
        lineColor: [0, 0, 0, 255],
    }]
    const symbolStyle = getPixiMapStyle('tolkien')
    for (const kind of ['mountain', 'hill', 'forest'] as const) {
        const symbolField = createTerrainFieldData([
            {id: `symbol-${kind}`, kind, points: [[128, 128]], radius: 120, mode: 'paint', shape: 'square'},
        ], 256, 256)
        const firstPlacements = buildTerrainSymbolPlacements(symbolField, symbolShapes, symbolStyle)
        const secondPlacements = buildTerrainSymbolPlacements(symbolField, symbolShapes, symbolStyle)
        if (firstPlacements.length === 0 || JSON.stringify(firstPlacements) !== JSON.stringify(secondPlacements)) {
            throw new Error(`地形符号自检失败：${kind} 图片放置为空或不确定`)
        }

        const edgePlacement = firstPlacements[0]
        const narrowLand: MapPreviewScene['shapes'] = [{
            ...symbolShapes[0],
            polygon: [
                [edgePlacement.x - 2, edgePlacement.y - 2],
                [edgePlacement.x + 2, edgePlacement.y - 2],
                [edgePlacement.x + 2, edgePlacement.y + 2],
                [edgePlacement.x - 2, edgePlacement.y + 2],
            ],
        }]
        if (buildTerrainSymbolPlacements(symbolField, narrowLand, symbolStyle).length !== 0) {
            throw new Error(`地形符号自检失败：${kind} 图片越过大陆边缘`)
        }
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
        {id: 'loc-1', name: '晨风王都', markerClass: 'major-city', position: [320, 260], color: [106, 67, 37, 255]},
        {id: 'loc-2', name: '雾湾村', markerClass: 'town', position: [420, 380], color: [106, 67, 37, 255]},
        {id: 'loc-3', name: '古神殿', markerClass: 'ruin', position: [640, 170], color: [106, 67, 37, 255]},
        {id: 'loc-4', name: '南礁港', markerClass: 'harbor', position: [618, 462], color: [106, 67, 37, 255]},
    ],
    terrainStrokes: [
        {id: 'terrain-grass', kind: 'grass', points: [[230, 270], [300, 230], [370, 250]], radius: 58, mode: 'paint'},
        {id: 'terrain-mountain', kind: 'mountain', points: [[275, 330], [340, 350], [400, 325]], radius: 42, mode: 'paint'},
        {id: 'terrain-desert', kind: 'desert', points: [[355, 225], [420, 275], [470, 310]], radius: 48, mode: 'paint'},
        {id: 'terrain-hill', kind: 'hill', points: [[420, 205], [455, 235], [480, 275]], radius: 52, mode: 'paint'},
        {id: 'terrain-forest', kind: 'forest', points: [[205, 365], [255, 395], [315, 410]], radius: 58, mode: 'paint'},
        {id: 'terrain-erase', kind: 'grass', points: [[292, 250], [320, 270]], radius: 18, mode: 'erase'},
    ],
}

const params = new URLSearchParams(window.location.search)
const styleId = params.get('style') ?? 'tolkien'
const editMode = params.get('edit') === '1'

const preset = getPixiMapStyle(styleId)
const style: PixiMapStyle = preset
const compiled = compilePixiMapStyle({style, canvas, scene: baseScene})

declare global {
    interface Window {
        __harnessInfo?: Record<string, unknown>
        __terrainStrokeCount?: number
    }
}
window.__harnessInfo = {
    styleId: style.id,
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
        markerClass: location.markerClass,
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
    const liveScene = useMemo<MapPreviewScene>(() => ({
        ...baseScene,
        keyLocations: buildPreviewKeyLocations(draft.keyLocations),
        terrainStrokes: draft.terrainStrokes,
    }), [draft.keyLocations, draft.terrainStrokes])
    const liveCompiled = useMemo(
        () => compilePixiMapStyle({style, canvas, scene: liveScene}),
        [liveScene],
    )
    useEffect(() => {
        window.__terrainStrokeCount = draft.terrainStrokes?.length ?? 0
    }, [draft.terrainStrokes])

    return (
        <MapShapeViewport
            mode="edit"
            canvas={canvas}
            scene={liveCompiled.scene}
            viewBox={viewBox}
            onViewBoxChange={setViewBox}
            shapeStyle={liveCompiled.shapeStyle}
            keyLocationStyle={liveCompiled.keyLocationStyle}
            labelStyle={liveCompiled.labelStyle}
            pixiProps={liveCompiled.pixiProps}
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
