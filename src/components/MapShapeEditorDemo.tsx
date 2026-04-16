import {useMemo, useState} from 'react'
import {
    buildPreviewSceneFromDraft,
    Button,
    createEmptyShapeDraft,
    createInitialMapShapeEditorViewBox,
    createMapShapeEditorLocalId,
    getShapeCenter,
    MapDeckPreview,
    type MapDeckPreviewRenderOptions,
    type MapEditorCanvas,
    type MapKeyLocationDraft,
    type MapPreviewScene,
    type MapShapeDraft,
    type MapShapeEditorApi,
    type MapShapeEditorDraft,
    type MapShapeEditorViewBox,
    MapShapeSvgEditor,
    RollingBox,
    submitMapShapeScene,
    validateMapEditorDraft,
} from 'flowcloudai-ui'
import {type CoastlineParamsPayload, map_save_scene} from '../api'
import './MapShapeEditorDemo.css'

interface DraftPreset {
    key: string
    label: string
    description: string
    draft: MapShapeEditorDraft
}

type SubmitState = 'idle' | 'draft' | 'submitting' | 'success' | 'error'
type PreviewSource = 'draft' | 'backend'

const DEFAULT_CANVAS: MapEditorCanvas = {
    width: 1000,
    height: 650,
}

function buildPreview(draft: MapShapeEditorDraft, canvas: MapEditorCanvas): MapPreviewScene {
    return buildPreviewSceneFromDraft({
        canvas,
        shapes: draft.shapes,
        keyLocations: draft.keyLocations,
    })
}

const DRAFT_PRESETS: DraftPreset[] = [
    {
        key: 'archipelago',
        label: '群岛草稿',
        description: '两块近海轮廓与三个关键地点，适合验证海岸线细化和地点约束。',
        draft: {
            shapes: [
                {
                    id: 'shape-east-bay',
                    name: '东湾群岛',
                    fill: '#d8ecff',
                    stroke: '#185fa5',
                    vertices: [
                        {id: 'v-eb-1', x: 180, y: 118},
                        {id: 'v-eb-2', x: 430, y: 144},
                        {id: 'v-eb-3', x: 468, y: 282},
                        {id: 'v-eb-4', x: 392, y: 404},
                        {id: 'v-eb-5', x: 228, y: 430},
                        {id: 'v-eb-6', x: 132, y: 292},
                    ],
                },
                {
                    id: 'shape-west-island',
                    name: '西侧小岛',
                    fill: '#eaf5d7',
                    stroke: '#426815',
                    vertices: [
                        {id: 'v-wi-1', x: 640, y: 212},
                        {id: 'v-wi-2', x: 774, y: 234},
                        {id: 'v-wi-3', x: 820, y: 334},
                        {id: 'v-wi-4', x: 738, y: 432},
                        {id: 'v-wi-5', x: 616, y: 388},
                        {id: 'v-wi-6', x: 592, y: 276},
                    ],
                },
            ],
            keyLocations: [
                {
                    id: 'loc-harbor',
                    name: '潮汐港',
                    type: '入口',
                    x: 258,
                    y: 224,
                    shapeId: 'shape-east-bay',
                },
                {
                    id: 'loc-watch',
                    name: '雾灯塔',
                    type: '观察点',
                    x: 330,
                    y: 336,
                    shapeId: 'shape-east-bay',
                },
                {
                    id: 'loc-west',
                    name: '补给滩',
                    type: '补给点',
                    x: 700,
                    y: 314,
                    shapeId: 'shape-west-island',
                },
            ],
        },
    },
    {
        key: 'peninsula',
        label: '半岛草稿',
        description: '单块狭长半岛草稿，方便观察长边细分与关键地点落点回退。',
        draft: {
            shapes: [
                {
                    id: 'shape-peninsula',
                    name: '银沙半岛',
                    fill: '#fdf0de',
                    stroke: '#aa4e0c',
                    vertices: [
                        {id: 'v-p-1', x: 122, y: 162},
                        {id: 'v-p-2', x: 352, y: 126},
                        {id: 'v-p-3', x: 620, y: 166},
                        {id: 'v-p-4', x: 812, y: 254},
                        {id: 'v-p-5', x: 742, y: 396},
                        {id: 'v-p-6', x: 522, y: 452},
                        {id: 'v-p-7', x: 264, y: 430},
                        {id: 'v-p-8', x: 148, y: 310},
                    ],
                },
            ],
            keyLocations: [
                {
                    id: 'loc-capital',
                    name: '银沙城',
                    type: '设备点',
                    x: 364,
                    y: 276,
                    shapeId: 'shape-peninsula',
                },
                {
                    id: 'loc-supply',
                    name: '北崖营地',
                    type: '补给点',
                    x: 650,
                    y: 262,
                    shapeId: 'shape-peninsula',
                },
            ],
        },
    },
]


const PREVIEW_RENDER_OPTIONS: MapDeckPreviewRenderOptions = {
    labelFontFamily: '"Microsoft YaHei UI", "Microsoft YaHei", "PingFang SC", "Noto Sans CJK SC", sans-serif',
}

function cloneDraft(draft: MapShapeEditorDraft): MapShapeEditorDraft {
    return {
        shapes: draft.shapes.map((shape) => ({
            ...shape,
            vertices: shape.vertices.map((vertex) => ({...vertex})),
        })),
        keyLocations: draft.keyLocations.map((location) => ({...location})),
    }
}

function formatNumber(value: number): string {
    return Number.isFinite(value) ? value.toFixed(1) : '0.0'
}

function buildLocationName(locations: MapKeyLocationDraft[]): string {
    return `关键地点 ${locations.length + 1}`
}

export default function MapShapeEditorDemo() {
    const initialPreset = DRAFT_PRESETS[0]
    const initialDraft = cloneDraft(initialPreset.draft)

    const [presetKey, setPresetKey] = useState(initialPreset.key)
    const [draft, setDraft] = useState<MapShapeEditorDraft>(initialDraft)
    const [selectedShapeId, setSelectedShapeId] = useState<string | null>(initialDraft.shapes[0]?.id ?? null)
    const [selectedLocationId, setSelectedLocationId] = useState<string | null>(initialDraft.keyLocations[0]?.id ?? null)
    const [drawingShape, setDrawingShape] = useState<MapShapeDraft | null>(null)
    const [canvas, setCanvas] = useState<MapEditorCanvas>(DEFAULT_CANVAS)
    const [viewBox, setViewBox] = useState<MapShapeEditorViewBox>(() => createInitialMapShapeEditorViewBox(DEFAULT_CANVAS))
    const [preview, setPreview] = useState<MapPreviewScene | null>(() => buildPreview(initialDraft, DEFAULT_CANVAS))
    const [previewSource, setPreviewSource] = useState<PreviewSource>('draft')
    const [submitState, setSubmitState] = useState<SubmitState>('idle')
    const [submitMessage, setSubmitMessage] = useState('当前预览来自初始草稿。')

    const [coastlineParams, setCoastlineParams] = useState<CoastlineParamsPayload>({
        minSegments: 5,
        maxSegments: 32,
        normalizedLengthMin: 0.2,
        normalizedLengthMax: 3.0,
        segmentBase: 15,
        segmentLengthFactor: 8,
        segmentEdgeRatioFactor: 18,
        amplitudeBase: 1,
        amplitudeMin: 2,
        amplitudeCanvasRatioMax: 0.025,
        relaxPasses: 2,
        relaxWeight: 0.16,
        fallbackRelaxPasses: 2,
        fallbackRelaxWeight: 0.18,
        deduplicateDistanceSquared: 0.2,
        waveABase: 1.0,
        waveASpan: 3.5,
        waveBBase: 2.3,
        waveBSpan: 3.7,
        waveCBase: 6.5,
        waveCSpan: 5.1,
        waveAWeight: 0.50,
        waveBWeight: 0.29,
        waveCWeight: 0.30,
        noiseSaltA: '0x9E3779B97F4A7C15',
        noiseSaltB: '0xC2B2AE3D27D4EB4F',
        noiseSaltC: '0x165667B19E3779F9',
        hashTextOffsetBasis: '0xcbf29ce484222325',
        hashTextPrime: '0x100000001b3',
        hashUnitMultiplier: '0x9E3779B97F4A7C15',
        hashUnitIncrement: '0xBF58476D1CE4E5B9',
    })

    const mapEditorApi = useMemo<MapShapeEditorApi>(() => ({
        saveScene: (request) => map_save_scene(request, coastlineParams),
    }), [coastlineParams])

    const activePreset = useMemo(
        () => DRAFT_PRESETS.find((preset) => preset.key === presetKey) ?? DRAFT_PRESETS[0],
        [presetKey],
    )

    const validationResult = useMemo(
        () => validateMapEditorDraft(draft, {hasDrawingShapeInProgress: Boolean(drawingShape)}),
        [draft, drawingShape],
    )

    const invalidShapeIds = useMemo(
        () => validationResult.shapeResults.filter((item) => !item.isValid).map((item) => item.shapeId),
        [validationResult.shapeResults],
    )

    const invalidKeyLocationIds = useMemo(
        () => validationResult.keyLocationResults.filter((item) => !item.isValid).map((item) => item.keyLocationId),
        [validationResult.keyLocationResults],
    )

    const selectedShape = useMemo(
        () => draft.shapes.find((shape) => shape.id === selectedShapeId) ?? null,
        [draft.shapes, selectedShapeId],
    )

    const selectedLocation = useMemo(
        () => draft.keyLocations.find((location) => location.id === selectedLocationId) ?? null,
        [draft.keyLocations, selectedLocationId],
    )

    const summary = useMemo(() => {
        const shapes = draft.shapes.length
        const vertices = draft.shapes.reduce((total, shape) => total + shape.vertices.length, 0)
        const keyLocations = draft.keyLocations.length
        const zoom = Math.round((canvas.width / Math.max(viewBox.width, 1)) * 100)
        return {shapes, vertices, keyLocations, zoom}
    }, [draft, canvas.width, viewBox.width])

    const previewSummary = useMemo(() => {
        if (!preview) {
            return {shapes: 0, polygonPoints: 0}
        }

        return {
            shapes: preview.shapes.length,
            polygonPoints: preview.shapes.reduce((total, shape) => total + shape.polygon.length, 0),
        }
    }, [preview])

    const loadPreset = (preset: DraftPreset) => {
        const nextDraft = cloneDraft(preset.draft)
        setPresetKey(preset.key)
        setDraft(nextDraft)
        setSelectedShapeId(nextDraft.shapes[0]?.id ?? null)
        setSelectedLocationId(nextDraft.keyLocations[0]?.id ?? null)
        setDrawingShape(null)
        setCanvas(DEFAULT_CANVAS)
        setViewBox(createInitialMapShapeEditorViewBox(DEFAULT_CANVAS))
        setPreview(buildPreview(nextDraft, DEFAULT_CANVAS))
        setPreviewSource('draft')
        setSubmitState('idle')
        setSubmitMessage(`已载入 ${preset.label}，当前预览来自草稿。`)
    }

    const handleAddShape = () => {
        const nextShape = createEmptyShapeDraft(draft.shapes)
        setDrawingShape(nextShape)
        setSelectedShapeId(nextShape.id)
        setSelectedLocationId(null)
        setSubmitState('idle')
        setSubmitMessage('已进入新图形绘制状态，等待在编辑区继续落点。')
    }

    const handleAddLocation = () => {
        const relatedShape = selectedShape ?? draft.shapes[0] ?? null
        const center = relatedShape
            ? getShapeCenter(relatedShape, canvas)
            : {x: canvas.width / 2, y: canvas.height / 2}

        const nextLocation: MapKeyLocationDraft = {
            id: createMapShapeEditorLocalId('key-location'),
            name: buildLocationName(draft.keyLocations),
            type: '观察点',
            x: center.x,
            y: center.y,
            shapeId: relatedShape?.id ?? null,
        }

        setDraft((current) => ({
            ...current,
            keyLocations: [...current.keyLocations, nextLocation],
        }))
        setSelectedShapeId(relatedShape?.id ?? null)
        setSelectedLocationId(nextLocation.id)
        setSubmitState('idle')
        setSubmitMessage('已在外部状态中新增关键地点。')
    }

    const handleDeleteShape = (shapeId: string) => {
        const removedLocationIds = new Set(
            draft.keyLocations.filter((location) => location.shapeId === shapeId).map((location) => location.id),
        )

        setDraft((current) => ({
            shapes: current.shapes.filter((shape) => shape.id !== shapeId),
            keyLocations: current.keyLocations.filter((location) => location.shapeId !== shapeId),
        }))
        setSelectedShapeId((current) => (current === shapeId ? null : current))
        setSelectedLocationId((current) => (current && removedLocationIds.has(current) ? null : current))
        if (drawingShape?.id === shapeId) {
            setDrawingShape(null)
        }
        setSubmitState('idle')
        setSubmitMessage(`已删除图形 ${shapeId}。`)
    }

    const handleDeleteVertex = (shapeId: string, vertexId: string) => {
        setDraft((current) => ({
            ...current,
            shapes: current.shapes.map((shape) => (
                shape.id === shapeId
                    ? {...shape, vertices: shape.vertices.filter((vertex) => vertex.id !== vertexId)}
                    : shape
            )),
        }))
        setSubmitState('idle')
        setSubmitMessage(`已删除顶点 ${vertexId}。`)
    }

    const handleDeleteLocation = (locationId: string) => {
        setDraft((current) => ({
            ...current,
            keyLocations: current.keyLocations.filter((location) => location.id !== locationId),
        }))
        setSelectedLocationId((current) => (current === locationId ? null : current))
        setSubmitState('idle')
        setSubmitMessage(`已删除关键地点 ${locationId}。`)
    }

    const handleSelectedShapeFieldChange = (field: 'name' | 'fill' | 'stroke', value: string) => {
        if (!selectedShapeId) return

        setDraft((current) => ({
            ...current,
            shapes: current.shapes.map((shape) => (
                shape.id === selectedShapeId
                    ? {...shape, [field]: value}
                    : shape
            )),
        }))
    }

    const handleSelectedLocationFieldChange = (field: 'name' | 'type' | 'shapeId', value: string) => {
        if (!selectedLocationId) return

        setDraft((current) => ({
            ...current,
            keyLocations: current.keyLocations.map((location) => (
                location.id === selectedLocationId
                    ? {...location, [field]: field === 'shapeId' ? (value || null) : value}
                    : location
            )),
        }))
    }

    const handleDrawingShapeFieldChange = (field: 'name' | 'fill' | 'stroke', value: string) => {
        if (!drawingShape) return

        setDrawingShape({
            ...drawingShape,
            [field]: value,
        })
    }

    const handleCanvasChange = (field: 'width' | 'height', value: string) => {
        const num = Number(value)
        if (!Number.isFinite(num) || num <= 0) return
        setCanvas((current) => ({...current, [field]: num}))
    }

    const handleBuildPreview = () => {
        setPreview(buildPreview(draft, canvas))
        setPreviewSource('draft')
        setSubmitState('draft')
        setSubmitMessage('已使用当前草稿重新构建 MapDeckPreview 场景。')
    }

    const handleSubmit = async () => {
        if (!validationResult.isValid) {
            setSubmitState('error')
            setSubmitMessage(`前端校验未通过，共 ${validationResult.issues.length} 项问题。`)
            return
        }

        setSubmitState('submitting')
        setSubmitMessage('正在调用 map_save_scene，请稍候…')

        try {
            const response = await submitMapShapeScene(mapEditorApi, {
                canvas,
                shapes: draft.shapes,
                keyLocations: draft.keyLocations,
            })

            setPreview(response.scene)
            setPreviewSource('backend')
            setSubmitState('success')
            setSubmitMessage(response.message ?? `提交成功，保存时间：${response.savedAt}`)
        } catch (error) {
            setSubmitState('error')
            setSubmitMessage(error instanceof Error ? error.message : String(error))
        }
    }

    return (
        <RollingBox className="map-shape-editor-demo" thumbSize="thin">
            <div className="map-shape-editor-demo__header">
                <div>
                    <p className="map-shape-editor-demo__eyebrow">Map 组件解耦示例</p>
                    <h1 className="map-shape-editor-demo__title">地图编辑器 Demo</h1>
                    <p className="map-shape-editor-demo__description">
                        这个页面不再依赖旧的一体式工作台，而是显式组合 `MapShapeSvgEditor`、
                        `MapDeckPreview`、校验和提交方法，方便你验证解耦后的状态托管方式。
                    </p>
                </div>
                <div className="map-shape-editor-demo__actions">
                    {DRAFT_PRESETS.map((preset) => (
                        <Button
                            key={preset.key}
                            size="sm"
                            variant={preset.key === activePreset.key ? 'outline' : 'ghost'}
                            onClick={() => loadPreset(preset)}
                        >
                            {preset.label}
                        </Button>
                    ))}
                    <Button
                        size="sm"
                        variant="ghost"
                        onClick={handleAddShape}
                    >
                        开始绘制图形
                    </Button>
                    <Button
                        size="sm"
                        variant="ghost"
                        onClick={handleAddLocation}
                    >
                        新增关键地点
                    </Button>
                    <Button
                        size="sm"
                        onClick={() => loadPreset(activePreset)}
                    >
                        重置当前草稿
                    </Button>
                </div>
            </div>

            <div className="map-shape-editor-demo__meta">
                <div className="map-shape-editor-demo__meta-card">
                    <span className="map-shape-editor-demo__meta-label">当前草稿</span>
                    <span className="map-shape-editor-demo__meta-value">{activePreset.label}</span>
                </div>
                <div className="map-shape-editor-demo__meta-card">
                    <span className="map-shape-editor-demo__meta-label">图形数量</span>
                    <span className="map-shape-editor-demo__meta-value">{summary.shapes} 个</span>
                </div>
                <div className="map-shape-editor-demo__meta-card">
                    <span className="map-shape-editor-demo__meta-label">顶点数量</span>
                    <span className="map-shape-editor-demo__meta-value">{summary.vertices} 个</span>
                </div>
                <div className="map-shape-editor-demo__meta-card">
                    <span className="map-shape-editor-demo__meta-label">关键地点</span>
                    <span className="map-shape-editor-demo__meta-value">{summary.keyLocations} 个</span>
                </div>
                <div className="map-shape-editor-demo__meta-card">
                    <span className="map-shape-editor-demo__meta-label">缩放比例</span>
                    <span className="map-shape-editor-demo__meta-value">{summary.zoom}%</span>
                </div>
                <div className="map-shape-editor-demo__meta-card map-shape-editor-demo__meta-card--wide">
                    <span className="map-shape-editor-demo__meta-label">预设说明</span>
                    <span className="map-shape-editor-demo__meta-value map-shape-editor-demo__meta-value--normal">
                        {activePreset.description}
                    </span>
                </div>
                <div className="map-shape-editor-demo__meta-card">
                    <span className="map-shape-editor-demo__meta-label">预览图形数</span>
                    <span className="map-shape-editor-demo__meta-value">{previewSummary.shapes} 个</span>
                </div>
                <div className="map-shape-editor-demo__meta-card">
                    <span className="map-shape-editor-demo__meta-label">预览顶点数</span>
                    <span className="map-shape-editor-demo__meta-value">{previewSummary.polygonPoints} 个</span>
                </div>
            </div>

            <div className="map-shape-editor-demo__workspace">
                <section className="map-shape-editor-demo__surface">
                    <div className="map-shape-editor-demo__surface-header">
                        <div>
                            <h2 className="map-shape-editor-demo__surface-title">MapShapeSvgEditor</h2>
                            <p className="map-shape-editor-demo__surface-subtitle">
                                受控状态全部由示例页维护：草稿、选中项、绘制中图形、视口和删除动作都在外部。
                            </p>
                        </div>
                        <div className="map-shape-editor-demo__hint">
                            viewBox: {formatNumber(viewBox.x)}, {formatNumber(viewBox.y)}, {formatNumber(viewBox.width)}, {formatNumber(viewBox.height)}
                        </div>
                    </div>
                    <div className="map-shape-editor-demo__editor-shell">
                        <MapShapeSvgEditor
                            canvas={canvas}
                            draft={draft}
                            selectedShapeId={selectedShapeId}
                            selectedLocationId={selectedLocationId}
                            drawingShape={drawingShape}
                            viewBox={viewBox}
                            invalidShapeIds={invalidShapeIds}
                            invalidKeyLocationIds={invalidKeyLocationIds}
                            width="100%"
                            height="100%"
                            onDraftChange={setDraft}
                            onSelectedShapeChange={setSelectedShapeId}
                            onSelectedLocationChange={setSelectedLocationId}
                            onDrawingShapeChange={setDrawingShape}
                            onViewBoxChange={setViewBox}
                            onRequestShapeDelete={handleDeleteShape}
                            onRequestVertexDelete={handleDeleteVertex}
                            onRequestLocationDelete={handleDeleteLocation}
                        />
                    </div>
                </section>
                <div className="map-shape-editor-demo__sidebar">
                    <section className="map-shape-editor-demo__panel">
                        <div className="map-shape-editor-demo__panel-header">
                            <h3 className="map-shape-editor-demo__panel-title">预览与提交</h3>
                            <p className={`map-shape-editor-demo__status map-shape-editor-demo__status--${submitState}`}>
                                {submitMessage}
                            </p>
                        </div>
                        <div className="map-shape-editor-demo__panel-body">
                            <div className="map-shape-editor-demo__field-row">
                                <div className="map-shape-editor-demo__field">
                                    <label htmlFor="map-demo-canvas-width">画布宽</label>
                                    <input
                                        id="map-demo-canvas-width"
                                        type="number"
                                        min={100}
                                        step={10}
                                        value={canvas.width}
                                        onChange={(event) => handleCanvasChange('width', event.target.value)}
                                    />
                                </div>
                                <div className="map-shape-editor-demo__field">
                                    <label htmlFor="map-demo-canvas-height">画布高</label>
                                    <input
                                        id="map-demo-canvas-height"
                                        type="number"
                                        min={100}
                                        step={10}
                                        value={canvas.height}
                                        onChange={(event) => handleCanvasChange('height', event.target.value)}
                                    />
                                </div>
                            </div>
                            <div className="map-shape-editor-demo__button-row">
                                <Button size="sm" onClick={handleBuildPreview}>仅用草稿生成预览</Button>
                                <Button size="sm" variant="ghost" onClick={handleSubmit}>提交到后端</Button>
                            </div>
                            <div className="map-shape-editor-demo__issue-list">
                                {validationResult.issues.length > 0 ? (
                                    validationResult.issues.map((issue) => (
                                        <div key={`${issue.code}-${issue.message}`}
                                             className="map-shape-editor-demo__issue-item">
                                            {issue.message}
                                        </div>
                                    ))
                                ) : (
                                    <div className="map-shape-editor-demo__empty">当前草稿校验通过。</div>
                                )}
                            </div>
                        </div>
                    </section>

                    <RollingBox className="map-shape-editor-demo__sidebar-scroll" thumbSize="thin">
                        <section className="map-shape-editor-demo__panel map-shape-editor-demo__params-panel">
                        <div className="map-shape-editor-demo__panel-header">
                            <h3 className="map-shape-editor-demo__panel-title">海岸线参数</h3>
                        </div>
                        <div className="map-shape-editor-demo__panel-body">
                            <div className="map-shape-editor-demo__field-row">
                                <div className="map-shape-editor-demo__field">
                                    <label htmlFor="map-demo-min-segments">最小段数</label>
                                    <input id="map-demo-min-segments" type="number" step={1}
                                           value={coastlineParams.minSegments ?? ''}
                                           onChange={(e) => setCoastlineParams((p) => ({
                                               ...p,
                                               minSegments: Number(e.target.value) || undefined
                                           }))}/>
                                </div>
                                <div className="map-shape-editor-demo__field">
                                    <label htmlFor="map-demo-max-segments">最大段数</label>
                                    <input id="map-demo-max-segments" type="number" step={1}
                                           value={coastlineParams.maxSegments ?? ''}
                                           onChange={(e) => setCoastlineParams((p) => ({
                                               ...p,
                                               maxSegments: Number(e.target.value) || undefined
                                           }))}/>
                                </div>
                            </div>
                            <div className="map-shape-editor-demo__field-row">
                                <div className="map-shape-editor-demo__field">
                                    <label htmlFor="map-demo-normalized-length-min">归一长度下限</label>
                                    <input id="map-demo-normalized-length-min" type="number" step={0.1}
                                           value={coastlineParams.normalizedLengthMin ?? ''}
                                           onChange={(e) => setCoastlineParams((p) => ({
                                               ...p,
                                               normalizedLengthMin: Number(e.target.value) || undefined
                                           }))}/>
                                </div>
                                <div className="map-shape-editor-demo__field">
                                    <label htmlFor="map-demo-normalized-length-max">归一长度上限</label>
                                    <input id="map-demo-normalized-length-max" type="number" step={0.1}
                                           value={coastlineParams.normalizedLengthMax ?? ''}
                                           onChange={(e) => setCoastlineParams((p) => ({
                                               ...p,
                                               normalizedLengthMax: Number(e.target.value) || undefined
                                           }))}/>
                                </div>
                            </div>
                            <div className="map-shape-editor-demo__field-row">
                                <div className="map-shape-editor-demo__field">
                                    <label htmlFor="map-demo-segment-base">细分基础</label>
                                    <input id="map-demo-segment-base" type="number" step={1}
                                           value={coastlineParams.segmentBase ?? ''}
                                           onChange={(e) => setCoastlineParams((p) => ({
                                               ...p,
                                               segmentBase: Number(e.target.value) || undefined
                                           }))}/>
                                </div>
                                <div className="map-shape-editor-demo__field">
                                    <label htmlFor="map-demo-segment-length-factor">长度因子</label>
                                    <input id="map-demo-segment-length-factor" type="number" step={1}
                                           value={coastlineParams.segmentLengthFactor ?? ''}
                                           onChange={(e) => setCoastlineParams((p) => ({
                                               ...p,
                                               segmentLengthFactor: Number(e.target.value) || undefined
                                           }))}/>
                                </div>
                            </div>
                            <div className="map-shape-editor-demo__field-row">
                                <div className="map-shape-editor-demo__field">
                                    <label htmlFor="map-demo-segment-edge-ratio-factor">边长比例因子</label>
                                    <input id="map-demo-segment-edge-ratio-factor" type="number" step={1}
                                           value={coastlineParams.segmentEdgeRatioFactor ?? ''}
                                           onChange={(e) => setCoastlineParams((p) => ({
                                               ...p,
                                               segmentEdgeRatioFactor: Number(e.target.value) || undefined
                                           }))}/>
                                </div>
                                <div className="map-shape-editor-demo__field">
                                    <label htmlFor="map-demo-amplitude-base">振幅基础</label>
                                    <input id="map-demo-amplitude-base" type="number" step={0.1}
                                           value={coastlineParams.amplitudeBase ?? ''}
                                           onChange={(e) => setCoastlineParams((p) => ({
                                               ...p,
                                               amplitudeBase: Number(e.target.value) || undefined
                                           }))}/>
                                </div>
                            </div>
                            <div className="map-shape-editor-demo__field-row">
                                <div className="map-shape-editor-demo__field">
                                    <label htmlFor="map-demo-amplitude-min">振幅最小</label>
                                    <input id="map-demo-amplitude-min" type="number" step={0.5}
                                           value={coastlineParams.amplitudeMin ?? ''}
                                           onChange={(e) => setCoastlineParams((p) => ({
                                               ...p,
                                               amplitudeMin: Number(e.target.value) || undefined
                                           }))}/>
                                </div>
                                <div className="map-shape-editor-demo__field">
                                    <label htmlFor="map-demo-amplitude-canvas-ratio-max">振幅画布比例上限</label>
                                    <input id="map-demo-amplitude-canvas-ratio-max" type="number" step={0.001}
                                           value={coastlineParams.amplitudeCanvasRatioMax ?? ''}
                                           onChange={(e) => setCoastlineParams((p) => ({
                                               ...p,
                                               amplitudeCanvasRatioMax: Number(e.target.value) || undefined
                                           }))}/>
                                </div>
                            </div>
                            <div className="map-shape-editor-demo__field-row">
                                <div className="map-shape-editor-demo__field">
                                    <label htmlFor="map-demo-relax-passes">平滑轮数</label>
                                    <input id="map-demo-relax-passes" type="number" step={1} min={0}
                                           value={coastlineParams.relaxPasses ?? ''}
                                           onChange={(e) => setCoastlineParams((p) => ({
                                               ...p,
                                               relaxPasses: Number(e.target.value) || undefined
                                           }))}/>
                                </div>
                                <div className="map-shape-editor-demo__field">
                                    <label htmlFor="map-demo-relax-weight">平滑权重</label>
                                    <input id="map-demo-relax-weight" type="number" step={0.01} min={0} max={0.5}
                                           value={coastlineParams.relaxWeight ?? ''}
                                           onChange={(e) => setCoastlineParams((p) => ({
                                               ...p,
                                               relaxWeight: Number(e.target.value) || undefined
                                           }))}/>
                                </div>
                            </div>
                            <div className="map-shape-editor-demo__field-row">
                                <div className="map-shape-editor-demo__field">
                                    <label htmlFor="map-demo-fallback-relax-passes">回退平滑轮数</label>
                                    <input id="map-demo-fallback-relax-passes" type="number" step={1} min={0}
                                           value={coastlineParams.fallbackRelaxPasses ?? ''}
                                           onChange={(e) => setCoastlineParams((p) => ({
                                               ...p,
                                               fallbackRelaxPasses: Number(e.target.value) || undefined
                                           }))}/>
                                </div>
                                <div className="map-shape-editor-demo__field">
                                    <label htmlFor="map-demo-fallback-relax-weight">回退平滑权重</label>
                                    <input id="map-demo-fallback-relax-weight" type="number" step={0.01} min={0}
                                           max={0.5} value={coastlineParams.fallbackRelaxWeight ?? ''}
                                           onChange={(e) => setCoastlineParams((p) => ({
                                               ...p,
                                               fallbackRelaxWeight: Number(e.target.value) || undefined
                                           }))}/>
                                </div>
                            </div>
                            <div className="map-shape-editor-demo__field-row">
                                <div className="map-shape-editor-demo__field">
                                    <label htmlFor="map-demo-deduplicate-distance-squared">去重距离平方</label>
                                    <input id="map-demo-deduplicate-distance-squared" type="number" step={0.1}
                                           value={coastlineParams.deduplicateDistanceSquared ?? ''}
                                           onChange={(e) => setCoastlineParams((p) => ({
                                               ...p,
                                               deduplicateDistanceSquared: Number(e.target.value) || undefined
                                           }))}/>
                                </div>
                            </div>
                            <div className="map-shape-editor-demo__field-row">
                                <div className="map-shape-editor-demo__field">
                                    <label htmlFor="map-demo-wave-a-base">Wave A 基础</label>
                                    <input id="map-demo-wave-a-base" type="number" step={0.1}
                                           value={coastlineParams.waveABase ?? ''}
                                           onChange={(e) => setCoastlineParams((p) => ({
                                               ...p,
                                               waveABase: Number(e.target.value) || undefined
                                           }))}/>
                                </div>
                                <div className="map-shape-editor-demo__field">
                                    <label htmlFor="map-demo-wave-a-span">Wave A 范围</label>
                                    <input id="map-demo-wave-a-span" type="number" step={0.1}
                                           value={coastlineParams.waveASpan ?? ''}
                                           onChange={(e) => setCoastlineParams((p) => ({
                                               ...p,
                                               waveASpan: Number(e.target.value) || undefined
                                           }))}/>
                                </div>
                            </div>
                            <div className="map-shape-editor-demo__field-row">
                                <div className="map-shape-editor-demo__field">
                                    <label htmlFor="map-demo-wave-b-base">Wave B 基础</label>
                                    <input id="map-demo-wave-b-base" type="number" step={0.1}
                                           value={coastlineParams.waveBBase ?? ''}
                                           onChange={(e) => setCoastlineParams((p) => ({
                                               ...p,
                                               waveBBase: Number(e.target.value) || undefined
                                           }))}/>
                                </div>
                                <div className="map-shape-editor-demo__field">
                                    <label htmlFor="map-demo-wave-b-span">Wave B 范围</label>
                                    <input id="map-demo-wave-b-span" type="number" step={0.1}
                                           value={coastlineParams.waveBSpan ?? ''}
                                           onChange={(e) => setCoastlineParams((p) => ({
                                               ...p,
                                               waveBSpan: Number(e.target.value) || undefined
                                           }))}/>
                                </div>
                            </div>
                            <div className="map-shape-editor-demo__field-row">
                                <div className="map-shape-editor-demo__field">
                                    <label htmlFor="map-demo-wave-c-base">Wave C 基础</label>
                                    <input id="map-demo-wave-c-base" type="number" step={0.1}
                                           value={coastlineParams.waveCBase ?? ''}
                                           onChange={(e) => setCoastlineParams((p) => ({
                                               ...p,
                                               waveCBase: Number(e.target.value) || undefined
                                           }))}/>
                                </div>
                                <div className="map-shape-editor-demo__field">
                                    <label htmlFor="map-demo-wave-c-span">Wave C 范围</label>
                                    <input id="map-demo-wave-c-span" type="number" step={0.1}
                                           value={coastlineParams.waveCSpan ?? ''}
                                           onChange={(e) => setCoastlineParams((p) => ({
                                               ...p,
                                               waveCSpan: Number(e.target.value) || undefined
                                           }))}/>
                                </div>
                            </div>
                            <div className="map-shape-editor-demo__field-row">
                                <div className="map-shape-editor-demo__field">
                                    <label htmlFor="map-demo-wave-a-weight">Wave A 权重</label>
                                    <input id="map-demo-wave-a-weight" type="number" step={0.01}
                                           value={coastlineParams.waveAWeight ?? ''}
                                           onChange={(e) => setCoastlineParams((p) => ({
                                               ...p,
                                               waveAWeight: Number(e.target.value) || undefined
                                           }))}/>
                                </div>
                                <div className="map-shape-editor-demo__field">
                                    <label htmlFor="map-demo-wave-b-weight">Wave B 权重</label>
                                    <input id="map-demo-wave-b-weight" type="number" step={0.01}
                                           value={coastlineParams.waveBWeight ?? ''}
                                           onChange={(e) => setCoastlineParams((p) => ({
                                               ...p,
                                               waveBWeight: Number(e.target.value) || undefined
                                           }))}/>
                                </div>
                            </div>
                            <div className="map-shape-editor-demo__field-row">
                                <div className="map-shape-editor-demo__field">
                                    <label htmlFor="map-demo-wave-c-weight">Wave C 权重</label>
                                    <input id="map-demo-wave-c-weight" type="number" step={0.01}
                                           value={coastlineParams.waveCWeight ?? ''}
                                           onChange={(e) => setCoastlineParams((p) => ({
                                               ...p,
                                               waveCWeight: Number(e.target.value) || undefined
                                           }))}/>
                                </div>
                            </div>
                            <div className="map-shape-editor-demo__field-row">
                                <div className="map-shape-editor-demo__field">
                                    <label htmlFor="map-demo-noise-salt-a">Noise Salt A</label>
                                    <input id="map-demo-noise-salt-a" value={coastlineParams.noiseSaltA ?? ''}
                                           onChange={(e) => setCoastlineParams((p) => ({
                                               ...p,
                                               noiseSaltA: e.target.value || undefined
                                           }))}/>
                                </div>
                                <div className="map-shape-editor-demo__field">
                                    <label htmlFor="map-demo-noise-salt-b">Noise Salt B</label>
                                    <input id="map-demo-noise-salt-b" value={coastlineParams.noiseSaltB ?? ''}
                                           onChange={(e) => setCoastlineParams((p) => ({
                                               ...p,
                                               noiseSaltB: e.target.value || undefined
                                           }))}/>
                                </div>
                            </div>
                            <div className="map-shape-editor-demo__field-row">
                                <div className="map-shape-editor-demo__field">
                                    <label htmlFor="map-demo-noise-salt-c">Noise Salt C</label>
                                    <input id="map-demo-noise-salt-c" value={coastlineParams.noiseSaltC ?? ''}
                                           onChange={(e) => setCoastlineParams((p) => ({
                                               ...p,
                                               noiseSaltC: e.target.value || undefined
                                           }))}/>
                                </div>
                            </div>
                            <div className="map-shape-editor-demo__field-row">
                                <div className="map-shape-editor-demo__field">
                                    <label htmlFor="map-demo-hash-text-offset-basis">Hash Text Offset</label>
                                    <input id="map-demo-hash-text-offset-basis"
                                           value={coastlineParams.hashTextOffsetBasis ?? ''}
                                           onChange={(e) => setCoastlineParams((p) => ({
                                               ...p,
                                               hashTextOffsetBasis: e.target.value || undefined
                                           }))}/>
                                </div>
                                <div className="map-shape-editor-demo__field">
                                    <label htmlFor="map-demo-hash-text-prime">Hash Text Prime</label>
                                    <input id="map-demo-hash-text-prime" value={coastlineParams.hashTextPrime ?? ''}
                                           onChange={(e) => setCoastlineParams((p) => ({
                                               ...p,
                                               hashTextPrime: e.target.value || undefined
                                           }))}/>
                                </div>
                            </div>
                            <div className="map-shape-editor-demo__field-row">
                                <div className="map-shape-editor-demo__field">
                                    <label htmlFor="map-demo-hash-unit-multiplier">Hash Unit Multiplier</label>
                                    <input id="map-demo-hash-unit-multiplier"
                                           value={coastlineParams.hashUnitMultiplier ?? ''}
                                           onChange={(e) => setCoastlineParams((p) => ({
                                               ...p,
                                               hashUnitMultiplier: e.target.value || undefined
                                           }))}/>
                                </div>
                                <div className="map-shape-editor-demo__field">
                                    <label htmlFor="map-demo-hash-unit-increment">Hash Unit Increment</label>
                                    <input id="map-demo-hash-unit-increment"
                                           value={coastlineParams.hashUnitIncrement ?? ''}
                                           onChange={(e) => setCoastlineParams((p) => ({
                                               ...p,
                                               hashUnitIncrement: e.target.value || undefined
                                           }))}/>
                                </div>
                            </div>
                            <div className="map-shape-editor-demo__button-row">
                                <Button
                                    size="sm"
                                    variant="ghost"
                                    onClick={() => setCoastlineParams({
                                        minSegments: 5,
                                        maxSegments: 32,
                                        normalizedLengthMin: 0.2,
                                        normalizedLengthMax: 3.0,
                                        segmentBase: 15,
                                        segmentLengthFactor: 8,
                                        segmentEdgeRatioFactor: 18,
                                        amplitudeBase: 1,
                                        amplitudeMin: 2,
                                        amplitudeCanvasRatioMax: 0.025,
                                        relaxPasses: 2,
                                        relaxWeight: 0.16,
                                        fallbackRelaxPasses: 2,
                                        fallbackRelaxWeight: 0.18,
                                        deduplicateDistanceSquared: 0.2,
                                        waveABase: 1.0,
                                        waveASpan: 3.5,
                                        waveBBase: 2.3,
                                        waveBSpan: 3.7,
                                        waveCBase: 6.5,
                                        waveCSpan: 5.1,
                                        waveAWeight: 0.50,
                                        waveBWeight: 0.29,
                                        waveCWeight: 0.30,
                                        noiseSaltA: '0x9E3779B97F4A7C15',
                                        noiseSaltB: '0xC2B2AE3D27D4EB4F',
                                        noiseSaltC: '0x165667B19E3779F9',
                                        hashTextOffsetBasis: '0xcbf29ce484222325',
                                        hashTextPrime: '0x100000001b3',
                                        hashUnitMultiplier: '0x9E3779B97F4A7C15',
                                        hashUnitIncrement: '0xBF58476D1CE4E5B9',
                                    })}
                                >
                                    重置默认值
                                </Button>
                            </div>
                        </div>
                    </section>

                    <section className="map-shape-editor-demo__panel">
                        <div className="map-shape-editor-demo__panel-header">
                            <h3 className="map-shape-editor-demo__panel-title">选中图形</h3>
                        </div>
                        <div className="map-shape-editor-demo__panel-body">
                            <div className="map-shape-editor-demo__field">
                                <label htmlFor="map-demo-selected-shape">selectedShapeId</label>
                                <select
                                    id="map-demo-selected-shape"
                                    value={selectedShapeId ?? ''}
                                    onChange={(event) => setSelectedShapeId(event.target.value || null)}
                                >
                                    <option value="">未选中</option>
                                    {draft.shapes.map((shape) => (
                                        <option key={shape.id} value={shape.id}>{shape.name}</option>
                                    ))}
                                </select>
                            </div>
                            {selectedShape ? (
                                <>
                                    <div className="map-shape-editor-demo__field">
                                        <label htmlFor="map-demo-shape-name">名称</label>
                                        <input
                                            id="map-demo-shape-name"
                                            value={selectedShape.name}
                                            onChange={(event) => handleSelectedShapeFieldChange('name', event.target.value)}
                                        />
                                    </div>
                                    <div className="map-shape-editor-demo__field">
                                        <label htmlFor="map-demo-shape-fill">填充色</label>
                                        <input
                                            id="map-demo-shape-fill"
                                            value={selectedShape.fill ?? ''}
                                            onChange={(event) => handleSelectedShapeFieldChange('fill', event.target.value)}
                                        />
                                    </div>
                                    <div className="map-shape-editor-demo__field">
                                        <label htmlFor="map-demo-shape-stroke">描边色</label>
                                        <input
                                            id="map-demo-shape-stroke"
                                            value={selectedShape.stroke ?? ''}
                                            onChange={(event) => handleSelectedShapeFieldChange('stroke', event.target.value)}
                                        />
                                    </div>
                                    <div className="map-shape-editor-demo__inline-meta">
                                        <span>顶点数</span>
                                        <strong>{selectedShape.vertices.length}</strong>
                                    </div>
                                    <Button size="sm" variant="ghost"
                                            onClick={() => handleDeleteShape(selectedShape.id)}>
                                        删除当前图形
                                    </Button>
                                </>
                            ) : (
                                <div className="map-shape-editor-demo__empty">当前没有选中图形。</div>
                            )}
                        </div>
                    </section>

                    <section className="map-shape-editor-demo__panel">
                        <div className="map-shape-editor-demo__panel-header">
                            <h3 className="map-shape-editor-demo__panel-title">关键地点</h3>
                        </div>
                        <div className="map-shape-editor-demo__panel-body">
                            <div className="map-shape-editor-demo__field">
                                <label htmlFor="map-demo-selected-location">selectedLocationId</label>
                                <select
                                    id="map-demo-selected-location"
                                    value={selectedLocationId ?? ''}
                                    onChange={(event) => setSelectedLocationId(event.target.value || null)}
                                >
                                    <option value="">未选中</option>
                                    {draft.keyLocations.map((location) => (
                                        <option key={location.id} value={location.id}>{location.name}</option>
                                    ))}
                                </select>
                            </div>
                            {selectedLocation ? (
                                <>
                                    <div className="map-shape-editor-demo__field">
                                        <label htmlFor="map-demo-location-name">名称</label>
                                        <input
                                            id="map-demo-location-name"
                                            value={selectedLocation.name}
                                            onChange={(event) => handleSelectedLocationFieldChange('name', event.target.value)}
                                        />
                                    </div>
                                    <div className="map-shape-editor-demo__field">
                                        <label htmlFor="map-demo-location-type">类型</label>
                                        <input
                                            id="map-demo-location-type"
                                            value={selectedLocation.type}
                                            onChange={(event) => handleSelectedLocationFieldChange('type', event.target.value)}
                                        />
                                    </div>
                                    <div className="map-shape-editor-demo__field">
                                        <label htmlFor="map-demo-location-shape">关联图形</label>
                                        <select
                                            id="map-demo-location-shape"
                                            value={selectedLocation.shapeId ?? ''}
                                            onChange={(event) => handleSelectedLocationFieldChange('shapeId', event.target.value)}
                                        >
                                            <option value="">未关联</option>
                                            {draft.shapes.map((shape) => (
                                                <option key={shape.id} value={shape.id}>{shape.name}</option>
                                            ))}
                                        </select>
                                    </div>
                                    <div className="map-shape-editor-demo__inline-meta">
                                        <span>坐标</span>
                                        <strong>{formatNumber(selectedLocation.x)} / {formatNumber(selectedLocation.y)}</strong>
                                    </div>
                                    <Button size="sm" variant="ghost"
                                            onClick={() => handleDeleteLocation(selectedLocation.id)}>
                                        删除当前关键地点
                                    </Button>
                                </>
                            ) : (
                                <div className="map-shape-editor-demo__empty">当前没有选中关键地点。</div>
                            )}
                        </div>
                    </section>

                    <section className="map-shape-editor-demo__panel">
                        <div className="map-shape-editor-demo__panel-header">
                            <h3 className="map-shape-editor-demo__panel-title">绘制中图形</h3>
                        </div>
                        <div className="map-shape-editor-demo__panel-body">
                            {drawingShape ? (
                                <>
                                    <div className="map-shape-editor-demo__field">
                                        <label htmlFor="map-demo-drawing-name">名称</label>
                                        <input
                                            id="map-demo-drawing-name"
                                            value={drawingShape.name}
                                            onChange={(event) => handleDrawingShapeFieldChange('name', event.target.value)}
                                        />
                                    </div>
                                    <div className="map-shape-editor-demo__field">
                                        <label htmlFor="map-demo-drawing-fill">填充色</label>
                                        <input
                                            id="map-demo-drawing-fill"
                                            value={drawingShape.fill ?? ''}
                                            onChange={(event) => handleDrawingShapeFieldChange('fill', event.target.value)}
                                        />
                                    </div>
                                    <div className="map-shape-editor-demo__field">
                                        <label htmlFor="map-demo-drawing-stroke">描边色</label>
                                        <input
                                            id="map-demo-drawing-stroke"
                                            value={drawingShape.stroke ?? ''}
                                            onChange={(event) => handleDrawingShapeFieldChange('stroke', event.target.value)}
                                        />
                                    </div>
                                    <div className="map-shape-editor-demo__inline-meta">
                                        <span>已落点</span>
                                        <strong>{drawingShape.vertices.length}</strong>
                                    </div>
                                    <Button size="sm" variant="ghost" onClick={() => setDrawingShape(null)}>
                                        取消绘制
                                    </Button>
                                </>
                            ) : (
                                <div className="map-shape-editor-demo__empty">
                                    当前没有绘制中的图形。点击“开始绘制图形”后，这里会显示外部托管的临时图形状态。
                                </div>
                            )}
                        </div>
                    </section>
                    </RollingBox>
                </div>

            </div>

            <section className="map-shape-editor-demo__surface">
                <div className="map-shape-editor-demo__surface-header">
                    <div>
                        <h2 className="map-shape-editor-demo__surface-title">MapDeckPreview</h2>
                        <p className="map-shape-editor-demo__surface-subtitle">
                            预览组件只消费 `scene`。假设库侧 deck 初始化已修复，这里应直接回显草稿预览和后端返回结果。
                        </p>
                    </div>
                    <div className="map-shape-editor-demo__hint">
                        预览来源：{previewSource === 'backend' ? 'Rust 后端返回' : '前端草稿派生'}
                    </div>
                </div>
                <div className="map-shape-editor-demo__preview-shell">
                    <MapDeckPreview
                        scene={preview}
                        emptyHint="当前还没有可预览的 scene。"
                        previewRenderOptions={PREVIEW_RENDER_OPTIONS}
                        style={{height: '100%'}}
                    />
                </div>
            </section>
        </RollingBox>
    )
}
