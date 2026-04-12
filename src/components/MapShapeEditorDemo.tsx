import {useMemo, useState} from 'react'
import {Button, MapShapeEditor, type MapShapeEditorApi, type MapShapeEditorDraft,} from 'flowcloudai-ui'
import {map_save_scene} from '../api'
import './MapShapeEditorDemo.css'

interface DraftPreset {
    key: string
    label: string
    description: string
    draft: MapShapeEditorDraft
}

const DRAFT_PRESETS: DraftPreset[] = [
    {
        key: 'archipelago',
        label: '群岛草稿',
        description: '两块近海轮廓 + 三个关键地点，适合观察后端自然海岸线细化效果。',
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
        description: '单块狭长半岛草稿，方便观察长边自适应细分和关键地点约束回退。',
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

const MAP_EDITOR_API: MapShapeEditorApi = {
    saveScene: map_save_scene,
}

export default function MapShapeEditorDemo() {
    const [presetKey, setPresetKey] = useState(DRAFT_PRESETS[0].key)
    const [editorVersion, setEditorVersion] = useState(0)

    const activePreset = useMemo(
        () => DRAFT_PRESETS.find((preset) => preset.key === presetKey) ?? DRAFT_PRESETS[0],
        [presetKey],
    )

    const summary = useMemo(() => {
        const shapes = activePreset.draft.shapes.length
        const vertices = activePreset.draft.shapes.reduce((total, shape) => total + shape.vertices.length, 0)
        const keyLocations = activePreset.draft.keyLocations.length
        return {shapes, vertices, keyLocations}
    }, [activePreset])

    return (
        <div className="map-shape-editor-demo">
            <div className="map-shape-editor-demo__header">
                <div>
                    <p className="map-shape-editor-demo__eyebrow">MapShapeEditor 本地联调入口</p>
                    <h1 className="map-shape-editor-demo__title">地图编辑器 Demo</h1>
                    <p className="map-shape-editor-demo__description">
                        这个页面使用前端假草稿数据初始化 `MapShapeEditor`，提交时直接调用 Tauri
                        `map_save_scene`，便于同时验证 SVG 草稿编辑、Rust 后端自然海岸线计算与 deck 回显。
                    </p>
                </div>
                <div className="map-shape-editor-demo__actions">
                    {DRAFT_PRESETS.map((preset) => (
                        <Button
                            key={preset.key}
                            size="sm"
                            variant={preset.key === activePreset.key ? 'outline' : 'ghost'}
                            onClick={() => {
                                setPresetKey(preset.key)
                                setEditorVersion((prev) => prev + 1)
                            }}
                        >
                            {preset.label}
                        </Button>
                    ))}
                    <Button
                        size="sm"
                        onClick={() => setEditorVersion((prev) => prev + 1)}
                    >
                        重置草稿
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
                <div className="map-shape-editor-demo__meta-card map-shape-editor-demo__meta-card--wide">
                    <span className="map-shape-editor-demo__meta-label">预设说明</span>
                    <span className="map-shape-editor-demo__meta-value map-shape-editor-demo__meta-value--normal">
                        {activePreset.description}
                    </span>
                </div>
            </div>

            <div className="map-shape-editor-demo__canvas-shell">
                <MapShapeEditor
                    key={`${activePreset.key}-${editorVersion}`}
                    initialDraft={activePreset.draft}
                    initialPreview={null}
                    api={MAP_EDITOR_API}
                    width="100%"
                    height="auto"
                    canvas={{width: 1000, height: 650}}
                />
            </div>
        </div>
    )
}
