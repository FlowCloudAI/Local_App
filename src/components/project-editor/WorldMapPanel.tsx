import {type ChangeEvent, useCallback, useEffect, useMemo, useRef, useState} from 'react'
import {
    buildPreviewSceneFromDraft,
    createEmptyShapeDraft,
    createInitialMapShapeEditorViewBox,
    createMapShapeEditorLocalId,
    type MapKeyLocationDraft,
    type MapPreviewScene,
    type MapRgbaColor,
    type MapShapeDraft,
    type MapShapeEditorDraft,
    MapShapeViewport,
    type MapShapeViewportRenderer,
    RollingBox,
    useAlert,
    useContextMenu,
    validateMapEditorDraft,
} from 'flowcloudai-ui'
import {
    type CoastlineParamsPayload,
    db_list_entries,
    type EntryBrief,
    map_delete_map_entry,
    map_list_project_maps,
    map_save_map_entry,
    map_save_scene,
    type MapEntry,
} from '../../api'
import './WorldMapPanel.css'
import {getStyleDefinition, makeOceanSvgUrl, type MapStyle,} from './map-styles'

// ── Constants ─────────────────────────────────────────────────────────────────

type SaveStatus = 'idle' | 'saving' | 'saved' | 'error'
type ViewportMode = 'edit' | 'preview'

const CANVAS = {width: 1000, height: 1000}
const FLAT_PIXI_REGION_FILL: MapRgbaColor = [255, 255, 255, 255]

const DEFAULT_COASTLINE_PARAMS: CoastlineParamsPayload = {
    minSegments: 5,
    maxSegments: 32,
    segmentBase: 15,
    segmentLengthFactor: 8,
    amplitudeBase: 1,
    amplitudeMin: 2,
    relaxPasses: 2,
    relaxWeight: 0.16,
    waveAWeight: 0.50,
    waveBWeight: 0.29,
    waveCWeight: 0.30,
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function emptyDraft(): MapShapeEditorDraft {
    return {shapes: [], keyLocations: []}
}

function newMapEntry(name: string): MapEntry {
    const now = new Date().toISOString()
    return {
        id: createMapShapeEditorLocalId('map'),
        name,
        draftJson: JSON.stringify(emptyDraft()),
        sceneJson: null,
        coastlineParamsJson: JSON.stringify(DEFAULT_COASTLINE_PARAMS),
        style: 'flat',
        backgroundImageUrl: null,
        createdAt: now,
        updatedAt: now,
    }
}

function normalizeSceneForPixiRenderer(scene: MapPreviewScene, style: MapStyle): MapPreviewScene {
    if (style !== 'flat') return scene

    return {
        ...scene,
        // Deck 的 flat 风格会通过 layer props 强制白色不透明填充；Pixi 直接读取 scene，需要在宿主侧补齐一致性。
        shapes: scene.shapes.map(shape => ({
            ...shape,
            fillColor: [...FLAT_PIXI_REGION_FILL],
        })),
    }
}

// ── Icons ─────────────────────────────────────────────────────────────────────

function BackArrow() {
    return (
        <svg viewBox="0 0 16 16" aria-hidden="true" style={{width: 16, height: 16}}>
            <path d="M8.6 3.25L4.1 7.75L8.6 12.25" fill="none" stroke="currentColor" strokeWidth="1.8"
                  strokeLinecap="round" strokeLinejoin="round"/>
            <path d="M4.5 7.75H12.25" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"/>
        </svg>
    )
}

function PlusIcon() {
    return (
        <svg viewBox="0 0 16 16" aria-hidden="true" style={{width: 13, height: 13}}>
            <path d="M8 3V13M3 8H13" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"/>
        </svg>
    )
}

function TrashIcon() {
    return (
        <svg viewBox="0 0 16 16" aria-hidden="true" style={{width: 13, height: 13}}>
            <path d="M3 5H13M6 5V3.5H10V5M5.5 5L6 13H10L10.5 5" fill="none" stroke="currentColor" strokeWidth="1.5"
                  strokeLinecap="round" strokeLinejoin="round"/>
        </svg>
    )
}

function ImageIcon() {
    return (
        <svg viewBox="0 0 16 16" aria-hidden="true" style={{width: 13, height: 13}}>
            <rect x="2" y="3" width="12" height="10" rx="1.5" fill="none" stroke="currentColor" strokeWidth="1.5"/>
            <circle cx="5.5" cy="6.5" r="1.2" fill="currentColor"/>
            <path d="M2 11L5.5 7.5L8.5 10.5L11 8L14 11" fill="none" stroke="currentColor" strokeWidth="1.4"
                  strokeLinecap="round" strokeLinejoin="round"/>
        </svg>
    )
}

// ── Main Component ────────────────────────────────────────────────────────────

interface WorldMapPanelProps {
    projectId: string
    projectName: string
    onBack?: () => void
    onOpenEntry?: (entry: { id: string; title: string }) => void
}

function isLikelyLocationEntryType(type?: string | null): boolean {
    if (!type) return false
    return type.trim().toLowerCase() === 'location'
}

function readLinkedEntryId(location: MapKeyLocationDraft | null): string {
    const value = location?.ext?.linkedEntryId
    return typeof value === 'string' ? value : ''
}

export default function WorldMapPanel({projectId, projectName, onBack, onOpenEntry}: WorldMapPanelProps) {
    const {showAlert} = useAlert()
    useContextMenu()
    const imageInputRef = useRef<HTMLInputElement>(null)

    // ── Map list state ────────────────────────────────────────────────────────
    const [isLoading, setIsLoading] = useState(true)
    const [maps, setMaps] = useState<MapEntry[]>([])
    const [activeMapId, setActiveMapId] = useState<string | null>(null)
    const [entryOptions, setEntryOptions] = useState<EntryBrief[]>([])

    // ── Active map editor state ───────────────────────────────────────────────
    const [draft, setDraft] = useState<MapShapeEditorDraft>(emptyDraft)
    const [scene, setScene] = useState<MapPreviewScene | null>(null)
    const [style, setStyle] = useState<MapStyle>('flat')
    const [backgroundImageUrl, setBackgroundImageUrl] = useState<string | null>(null)
    const [activeMapName, setActiveMapName] = useState('')
    const [sceneDirty, setSceneDirty] = useState(false)
    const [coastlineParams, setCoastlineParams] = useState<CoastlineParamsPayload>(DEFAULT_COASTLINE_PARAMS)

    // ── Editor interaction state ──────────────────────────────────────────────
    const [drawingShape, setDrawingShape] = useState<MapShapeDraft | null>(null)
    const [selectedShapeId, setSelectedShapeId] = useState<string | null>(null)
    const [selectedLocationId, setSelectedLocationId] = useState<string | null>(null)
    const [viewBox, setViewBox] = useState(() => createInitialMapShapeEditorViewBox(CANVAS))
    const [viewportMode, setViewportMode] = useState<ViewportMode>('preview')
    const [previewRenderer, setPreviewRenderer] = useState<MapShapeViewportRenderer>('pixi')

    // ── Op state ─────────────────────────────────────────────────────────────
    const [saveStatus, setSaveStatus] = useState<SaveStatus>('idle')
    const [isGenerating, setIsGenerating] = useState(false)
    const [errorMsg, setErrorMsg] = useState<string | null>(null)

    const updateDraft = useCallback((updater: MapShapeEditorDraft | ((draft: MapShapeEditorDraft) => MapShapeEditorDraft)) => {
        setDraft(current => typeof updater === 'function'
            ? (updater as (draft: MapShapeEditorDraft) => MapShapeEditorDraft)(current)
            : updater)
        setSceneDirty(true)
        setSaveStatus('idle')
    }, [])

    const loadMapDataRef = useRef<(entry: MapEntry) => void>(() => {
    })

    // ── Load map list on mount ────────────────────────────────────────────────

    useEffect(() => {
        let cancelled = false
        setIsLoading(true)

        void map_list_project_maps(projectId).then((entries) => {
            if (cancelled) return
            setMaps(entries)
            if (entries.length > 0) {
                loadMapDataRef.current(entries[0])
            }
            setIsLoading(false)
        }).catch((e: unknown) => {
            if (!cancelled) {
                setErrorMsg(`加载地图列表失败：${e instanceof Error ? e.message : String(e)}`)
                setIsLoading(false)
            }
        })

        return () => {
            cancelled = true
        }
    }, [projectId])

    useEffect(() => {
        let cancelled = false

        void db_list_entries({
            projectId,
            limit: 1000,
            offset: 0,
        }).then((entries) => {
            if (cancelled) return
            setEntryOptions(entries.filter(entry => isLikelyLocationEntryType(entry.type)))
        }).catch(() => {
            if (!cancelled) setEntryOptions([])
        })

        return () => {
            cancelled = true
        }
    }, [projectId])

    // ── Load a map entry into editor state ────────────────────────────────────

    const loadMapData = useCallback((entry: MapEntry) => {
        try {
            setDraft(JSON.parse(entry.draftJson) as MapShapeEditorDraft)
        } catch {
            setDraft(emptyDraft())
        }
        try {
            setScene(entry.sceneJson ? JSON.parse(entry.sceneJson) as MapPreviewScene : null)
        } catch {
            setScene(null)
        }
        try {
            setCoastlineParams(
                entry.coastlineParamsJson
                    ? JSON.parse(entry.coastlineParamsJson) as CoastlineParamsPayload
                    : DEFAULT_COASTLINE_PARAMS,
            )
        } catch {
            setCoastlineParams(DEFAULT_COASTLINE_PARAMS)
        }
        setStyle((entry.style as MapStyle) ?? 'flat')
        setBackgroundImageUrl(entry.backgroundImageUrl)
        setActiveMapName(entry.name)
        setActiveMapId(entry.id)
        setSceneDirty(false)
        setDrawingShape(null)
        setSelectedShapeId(null)
        setSelectedLocationId(null)
        setViewBox(createInitialMapShapeEditorViewBox(CANVAS))
        setViewportMode('preview')
        setSaveStatus('idle')
        setErrorMsg(null)
    }, [])

    useEffect(() => {
        loadMapDataRef.current = loadMapData
    }, [loadMapData])

    // ── Build current entry from editor state ─────────────────────────────────

    const buildCurrentEntry = useCallback((
        existingEntry: MapEntry,
        currentScene: MapPreviewScene | null,
        currentDraft: MapShapeEditorDraft,
        currentStyle: MapStyle,
        currentBg: string | null,
        currentName: string,
        currentCoastlineParams: CoastlineParamsPayload,
    ): MapEntry => ({
        ...existingEntry,
        name: currentName,
        draftJson: JSON.stringify(currentDraft),
        sceneJson: currentScene ? JSON.stringify(currentScene) : existingEntry.sceneJson,
        coastlineParamsJson: JSON.stringify(currentCoastlineParams),
        style: currentStyle,
        backgroundImageUrl: currentBg,
        updatedAt: new Date().toISOString(),
    }), [])

    // ── Auto-save current map (silent, called before switching) ───────────────

    const autoSave = useCallback(async (
        mapId: string,
        currentDraft: MapShapeEditorDraft,
        currentScene: MapPreviewScene | null,
        currentStyle: MapStyle,
        currentBg: string | null,
        currentName: string,
        currentCoastlineParams: CoastlineParamsPayload,
    ) => {
        const existing = maps.find(m => m.id === mapId)
        if (!existing) return
        if (currentDraft.shapes.length === 0 && !currentBg) return // nothing worth saving

        const previewScene = buildPreviewSceneFromDraft({
            canvas: CANVAS,
            shapes: currentDraft.shapes,
            keyLocations: currentDraft.keyLocations
        })
        const hasContent = currentDraft.shapes.length > 0 || currentDraft.keyLocations.length > 0
        const sceneToSave = currentScene
            ? {...currentScene, keyLocations: previewScene.keyLocations}
            : hasContent ? previewScene : null

        const entry = buildCurrentEntry(existing, sceneToSave, currentDraft, currentStyle, currentBg, currentName, currentCoastlineParams)
        try {
            const saved = await map_save_map_entry(projectId, entry)
            setMaps(prev => prev.map(m => m.id === mapId ? saved : m))
        } catch {
            // Silent — don't block the switch
        }
    }, [maps, projectId, buildCurrentEntry])

    // ── Switch to another map ─────────────────────────────────────────────────

    const handleSwitchMap = useCallback(async (entry: MapEntry) => {
        if (entry.id === activeMapId) return
        if (activeMapId) {
            await autoSave(activeMapId, draft, scene, style, backgroundImageUrl, activeMapName, coastlineParams)
        }
        loadMapData(entry)
    }, [activeMapId, draft, scene, style, backgroundImageUrl, activeMapName, coastlineParams, autoSave, loadMapData])

    // ── Create new map ────────────────────────────────────────────────────────

    const handleCreateMap = useCallback(async () => {
        if (activeMapId) {
            await autoSave(activeMapId, draft, scene, style, backgroundImageUrl, activeMapName, coastlineParams)
        }
        const entry = newMapEntry(`地图 ${maps.length + 1}`)
        setMaps(prev => [...prev, entry])
        loadMapData(entry)
    }, [activeMapId, draft, scene, style, backgroundImageUrl, activeMapName, coastlineParams, maps.length, autoSave, loadMapData])

    // ── Delete a map ──────────────────────────────────────────────────────────

    const handleDeleteMap = useCallback(async (mapId: string) => {
        const target = maps.find(m => m.id === mapId)
        const confirmed = await showAlert(
            `确认删除地图“${target?.name ?? '未命名地图'}”？删除后不可恢复。`,
            'warning',
            'confirm',
        )
        if (confirmed !== 'yes') return

        try {
            await map_delete_map_entry(projectId, mapId)
            const remaining = maps.filter(m => m.id !== mapId)
            setMaps(remaining)
            if (activeMapId === mapId) {
                if (remaining.length > 0) {
                    loadMapData(remaining[0])
                } else {
                    setActiveMapId(null)
                    setDraft(emptyDraft())
                    setScene(null)
                    setStyle('flat')
                    setBackgroundImageUrl(null)
                    setActiveMapName('')
                }
            }
        } catch (e) {
            setErrorMsg(`删除失败：${e instanceof Error ? e.message : String(e)}`)
        }
    }, [projectId, maps, activeMapId, loadMapData, showAlert])

    const validation = useMemo(
        () => validateMapEditorDraft(draft, {hasDrawingShapeInProgress: Boolean(drawingShape)}),
        [draft, drawingShape],
    )

    // ── Save current map ──────────────────────────────────────────────────────

    const handleSave = useCallback(async () => {
        if (!activeMapId) {
            setErrorMsg('请先新建或选择一个地图。')
            return
        }
        if (draft.shapes.length === 0 && !backgroundImageUrl) {
            setErrorMsg('请先绘制图形或上传底图再保存。')
            return
        }
        if (draft.shapes.length > 0 && !validation.isValid) {
            setErrorMsg('当前地图草稿存在无效图形或地点，请先补完绘制或修正关联后再保存。')
            return
        }
        const existing = maps.find(m => m.id === activeMapId)
        if (!existing) return

        const previewScene = buildPreviewSceneFromDraft({
            canvas: CANVAS,
            shapes: draft.shapes,
            keyLocations: draft.keyLocations
        })
        const hasContent = draft.shapes.length > 0 || draft.keyLocations.length > 0
        const sceneToSave = scene
            ? {...scene, keyLocations: previewScene.keyLocations}
            : hasContent ? previewScene : null

        setSaveStatus('saving')
        setErrorMsg(null)
        try {
            const entry = buildCurrentEntry(existing, sceneToSave, draft, style, backgroundImageUrl, activeMapName, coastlineParams)
            const saved = await map_save_map_entry(projectId, entry)
            setMaps(prev => prev.map(m => m.id === activeMapId ? saved : m))
            setScene(sceneToSave)
            setSceneDirty(false)
            setSaveStatus('saved')
            setTimeout(() => setSaveStatus('idle'), 2500)
        } catch (e) {
            setSaveStatus('error')
            setErrorMsg(`保存失败：${e instanceof Error ? e.message : String(e)}`)
        }
    }, [activeMapId, draft, scene, style, backgroundImageUrl, activeMapName, coastlineParams, maps, projectId, buildCurrentEntry, validation.isValid])

    // ── Rename active map ─────────────────────────────────────────────────────

    const handleRename = useCallback((name: string) => {
        setActiveMapName(name)
        setMaps(prev => prev.map(m => m.id === activeMapId ? {...m, name} : m))
    }, [activeMapId])

    const requestDeleteShape = useCallback(async (shapeId: string) => {
        const target = draft.shapes.find(shape => shape.id === shapeId)
        const confirmed = await showAlert(
            `确认删除图形“${target?.name ?? '未命名图形'}”？相关关键地点也会一并移除。`,
            'warning',
            'confirm',
        )
        if (confirmed !== 'yes') return

        updateDraft(d => ({
            shapes: d.shapes.filter(s => s.id !== shapeId),
            keyLocations: d.keyLocations.filter(l => l.shapeId !== shapeId),
        }))
        setSelectedShapeId(id => (id === shapeId ? null : id))
    }, [draft.shapes, showAlert, updateDraft])

    const requestDeleteLocation = useCallback(async (locationId: string) => {
        const target = draft.keyLocations.find(location => location.id === locationId)
        const confirmed = await showAlert(
            `确认删除关键地点“${target?.name ?? '未命名地点'}”？`,
            'warning',
            'confirm',
        )
        if (confirmed !== 'yes') return

        updateDraft(d => ({...d, keyLocations: d.keyLocations.filter(l => l.id !== locationId)}))
        setSelectedLocationId(id => (id === locationId ? null : id))
    }, [draft.keyLocations, showAlert, updateDraft])

    // ── Generate coastline ────────────────────────────────────────────────────

    const handleGenerate = useCallback(async () => {
        if (draft.shapes.length === 0) {
            setErrorMsg('请先绘制至少一个图形再生成海岸线。')
            return
        }
        if (!validation.isValid) {
            setErrorMsg('当前草稿仍有未闭合图形或无效地点，暂时不能生成海岸线。')
            return
        }
        setIsGenerating(true)
        setErrorMsg(null)
        try {
            const response = await map_save_scene({
                canvas: CANVAS,
                shapes: draft.shapes,
                keyLocations: draft.keyLocations,
            }, coastlineParams)
            setScene(response.scene)
            setSceneDirty(false)
        } catch (e) {
            setErrorMsg(`生成海岸线失败：${e instanceof Error ? e.message : String(e)}`)
        } finally {
            setIsGenerating(false)
        }
    }, [draft, validation.isValid, coastlineParams])

    // ── Quick preview ─────────────────────────────────────────────────────────

    const handleQuickPreview = useCallback(() => {
        if (draft.shapes.length === 0) {
            setErrorMsg('请先绘制至少一个图形。')
            return
        }
        setScene(buildPreviewSceneFromDraft({canvas: CANVAS, shapes: draft.shapes, keyLocations: draft.keyLocations}))
        setSceneDirty(false)
    }, [draft])

    // ── Background image upload ───────────────────────────────────────────────

    const handleImageFileChange = useCallback((e: ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0]
        if (!file) return
        const reader = new FileReader()
        reader.onload = () => {
            setBackgroundImageUrl(reader.result as string)
            setSaveStatus('idle')
        }
        reader.readAsDataURL(file)
        if (imageInputRef.current) imageInputRef.current.value = ''
    }, [])

    const handleRemoveImage = useCallback(() => {
        setBackgroundImageUrl(null)
        setSaveStatus('idle')
    }, [])

    // ── Shape editing helpers ─────────────────────────────────────────────────

    const deleteVertex = useCallback((shapeId: string, vertexId: string) => {
        updateDraft(d => ({
            ...d,
            shapes: d.shapes.map(s =>
                s.id === shapeId ? {...s, vertices: s.vertices.filter(v => v.id !== vertexId)} : s,
            ),
        }))
    }, [updateDraft])

    const updateSelectedShape = useCallback((field: 'name' | 'fill' | 'stroke', value: string) => {
        updateDraft(d => ({
            ...d,
            shapes: d.shapes.map(s => (s.id === selectedShapeId ? {...s, [field]: value} : s)),
        }))
    }, [selectedShapeId, updateDraft])

    const updateDrawingShapeField = useCallback((field: 'name' | 'fill' | 'stroke', value: string) => {
        setDrawingShape(ds => ds ? {...ds, [field]: value} : ds)
    }, [])

    const updateSelectedLocation = useCallback((field: 'name' | 'type', value: string) => {
        updateDraft(d => ({
            ...d,
            keyLocations: d.keyLocations.map(l => (l.id === selectedLocationId ? {...l, [field]: value} : l)),
        }))
    }, [selectedLocationId, updateDraft])

    const updateSelectedLocationShapeId = useCallback((shapeId: string | null) => {
        updateDraft(d => ({
            ...d,
            keyLocations: d.keyLocations.map(l => (l.id === selectedLocationId ? {...l, shapeId} : l)),
        }))
    }, [selectedLocationId, updateDraft])

    const updateSelectedLocationLinkedEntryId = useCallback((entryId: string | null) => {
        const linkedEntry = entryOptions.find(entry => entry.id === entryId) ?? null
        updateDraft(d => ({
            ...d,
            keyLocations: d.keyLocations.map(l => {
                if (l.id !== selectedLocationId) return l
                return {
                    ...l,
                    ext: entryId ? {
                        ...(l.ext ?? {}),
                        linkedEntryId: entryId,
                        linkedEntryTitle: linkedEntry?.title ?? '',
                        linkedEntryType: linkedEntry?.type ?? '',
                    } : Object.keys(l.ext ?? {}).reduce<Record<string, unknown>>((next, key) => {
                        if (key !== 'linkedEntryId' && key !== 'linkedEntryTitle' && key !== 'linkedEntryType') {
                            next[key] = l.ext?.[key]
                        }
                        return next
                    }, {}),
                }
            }),
        }))
    }, [entryOptions, selectedLocationId, updateDraft])

    const updateCoastlineParam = useCallback((
        field: keyof CoastlineParamsPayload,
        value: string,
    ) => {
        const trimmed = value.trim()
        setCoastlineParams(current => ({
            ...current,
            [field]: trimmed === '' ? undefined : Number(trimmed),
        }))
    }, [])

    // ── Add shape / location ──────────────────────────────────────────────────

    const handleAddShape = useCallback(() => {
        const next = createEmptyShapeDraft(draft.shapes)
        setDrawingShape(next)
        setSelectedShapeId(next.id)
        setSelectedLocationId(null)
    }, [draft.shapes])

    const handleAddLocation = useCallback(() => {
        const relatedShape = draft.shapes.find(s => s.id === selectedShapeId) ?? draft.shapes[0] ?? null
        const cx = relatedShape
            ? relatedShape.vertices.reduce((sum, v) => sum + v.x, 0) / Math.max(relatedShape.vertices.length, 1)
            : CANVAS.width / 2
        const cy = relatedShape
            ? relatedShape.vertices.reduce((sum, v) => sum + v.y, 0) / Math.max(relatedShape.vertices.length, 1)
            : CANVAS.height / 2
        const loc: MapKeyLocationDraft = {
            id: createMapShapeEditorLocalId('loc'),
            name: `地点 ${draft.keyLocations.length + 1}`,
            type: '标记点',
            x: cx,
            y: cy,
            shapeId: relatedShape?.id ?? null,
        }
        updateDraft(d => ({...d, keyLocations: [...d.keyLocations, loc]}))
        setSelectedLocationId(loc.id)
    }, [draft, selectedShapeId, updateDraft])

    // ── Deck & SVG props ──────────────────────────────────────────────────────

    const styleTextureUrl = useMemo(() => {
        if (backgroundImageUrl) return null
        const def = getStyleDefinition(style)
        return def.createBackgroundTexture?.(CANVAS) ?? null
    }, [style, backgroundImageUrl])

    const displayScene = useMemo(() => {
        const def = getStyleDefinition(style)
        const oceanUrl = makeOceanSvgUrl(def.oceanColor)
        const bgUrl = backgroundImageUrl ?? styleTextureUrl ?? oceanUrl
        const previewScene = buildPreviewSceneFromDraft({
            canvas: CANVAS,
            shapes: draft.shapes,
            keyLocations: draft.keyLocations
        })
        const base: MapPreviewScene = viewportMode === 'edit' && scene
            ? scene
            : !sceneDirty && scene
                ? scene
                : previewScene
        const withBg: MapPreviewScene = {
            ...base,
            // 关键地点属于编辑草稿数据，预览时始终以 draft 为准，避免旧 scene 覆盖最新地点。
            keyLocations: previewScene.keyLocations,
            backgroundImage: {url: bgUrl, fit: backgroundImageUrl ? 'cover' as const : 'fill' as const},
        }
        return def.transformScene?.(withBg) ?? withBg
    }, [scene, sceneDirty, draft, style, backgroundImageUrl, viewportMode, styleTextureUrl])

    const renderedScene = useMemo(() => (
        previewRenderer === 'pixi'
            ? normalizeSceneForPixiRenderer(displayScene, style)
            : displayScene
    ), [displayScene, previewRenderer, style])

    const deckProps = useMemo(() => {
        const def = getStyleDefinition(style)
        const decorations = def.buildDecorations?.({canvas: CANVAS, scene: displayScene}) ?? {}
        const extraLayers = def.createExtraLayers?.({canvas: CANVAS, scene: displayScene, decorations}) ?? []
        return {
            ...def.deckConfig,
            style: {backgroundColor: def.oceanColor},
            showLabels: true,
            keyLocationRenderMode: (style === 'flat' ? 'circle' : 'auto') as 'circle' | 'auto',
            extraLayers,
        }
    }, [style, displayScene])

    const pixiProps = useMemo(() => {
        const def = getStyleDefinition(style)
        return {
            style: {backgroundColor: def.oceanColor},
            showLabels: true,
            keyLocationRenderMode: (style === 'flat' ? 'circle' : 'auto') as 'circle' | 'auto',
            emptyHint: '提交后将在这里显示 Pixi 预览结果。',
        }
    }, [style])

    const viewportRenderKey = `${previewRenderer}-${style}-${backgroundImageUrl ? 'custom-bg' : 'style-bg'}`

    const svgProps = useMemo(() => ({
        draft,
        selectedShapeId,
        selectedLocationId,
        drawingShape,
        invalidShapeIds: [] as string[],
        invalidKeyLocationIds: [] as string[],
        onDraftChange: updateDraft,
        onSelectedShapeChange: (id: string | null) => {
            setSelectedShapeId(id);
            if (id) setSelectedLocationId(null)
        },
        onSelectedLocationChange: (id: string | null) => {
            setSelectedLocationId(id);
            if (id) setSelectedShapeId(null)
        },
        onDrawingShapeChange: setDrawingShape,
        onRequestShapeDelete: requestDeleteShape,
        onRequestVertexDelete: deleteVertex,
        onRequestLocationDelete: requestDeleteLocation,
    }), [draft, selectedShapeId, selectedLocationId, drawingShape, requestDeleteShape, deleteVertex, requestDeleteLocation, updateDraft])

    // ── Derived ───────────────────────────────────────────────────────────────

    const selectedShape = draft.shapes.find(s => s.id === selectedShapeId) ?? null
    const selectedLocation = draft.keyLocations.find(l => l.id === selectedLocationId) ?? null
    const selectedLinkedEntryId = readLinkedEntryId(selectedLocation)
    const selectedLinkedEntry = entryOptions.find(entry => entry.id === selectedLinkedEntryId) ?? null

    const saveStatusLabel = useMemo(() => {
        if (saveStatus === 'saving') return '保存中…'
        if (saveStatus === 'saved') return '已保存'
        if (saveStatus === 'error') return '保存失败'
        const active = maps.find(m => m.id === activeMapId)
        if (active?.updatedAt) {
            const d = new Date(active.updatedAt)
            if (!Number.isNaN(d.getTime())) {
                return `上次保存 ${new Intl.DateTimeFormat('zh-CN', {
                    month: '2-digit',
                    day: '2-digit',
                    hour: '2-digit',
                    minute: '2-digit'
                }).format(d)}`
            }
        }
        return '未保存'
    }, [saveStatus, maps, activeMapId])

    if (isLoading) {
        return <div className="wm-panel">
            <div className="wm-loading">加载地图中…</div>
        </div>
    }

    // ── Render ────────────────────────────────────────────────────────────────

    return (
        <div className="wm-panel">
            {/* Hidden file input */}
            <input ref={imageInputRef} type="file" accept="image/*" style={{display: 'none'}}
                   onChange={handleImageFileChange}/>

            {/* ── Header ── */}
            <div className="wm-header">
                <button type="button" className="wm-back-btn" onClick={onBack}><BackArrow/>返回</button>
                <h2 className="wm-title">世界地图 · {projectName}</h2>
                <div className="wm-style-switcher">
                    {(['flat', 'tolkien', 'ink'] as MapStyle[]).map(s => (
                        <button key={s} type="button"
                                className={`wm-style-btn${style === s ? ' is-active' : ''}`}
                                onClick={() => setStyle(s)}>{getStyleDefinition(s).label}</button>
                    ))}
                </div>
                <div className="wm-header-actions">
                    <span className={`wm-save-status${saveStatus !== 'idle' ? ` is-${saveStatus}` : ''}`}>
                        {saveStatusLabel}
                    </span>
                    <button type="button" className="wm-chip"
                            onClick={() => void handleSave()}
                            disabled={saveStatus === 'saving' || !activeMapId}>
                        保存地图
                    </button>
                </div>
            </div>

            {/* ── Toolbar ── */}
            <div className="wm-toolbar">
                <button type="button"
                        className={`wm-chip${viewportMode === 'preview' ? ' is-active' : ''}`}
                        onClick={() => {
                            setViewportMode(m => {
                                const next = m === 'edit' ? 'preview' : 'edit'
                                if (next === 'preview') {
                                    setSelectedShapeId(null)
                                    setSelectedLocationId(null)
                                    setDrawingShape(null)
                                }
                                return next
                            })
                        }}>
                    {viewportMode === 'edit' ? '切换预览' : '切换编辑'}
                </button>
                <div className="wm-toolbar-sep"/>
                <button type="button"
                        className={`wm-chip${previewRenderer === 'pixi' ? ' is-active' : ''}`}
                        onClick={() => setPreviewRenderer('pixi')}>
                    Pixi 引擎
                </button>
                <button type="button"
                        className={`wm-chip${previewRenderer === 'deck' ? ' is-active' : ''}`}
                        onClick={() => setPreviewRenderer('deck')}>
                    Deck 回退
                </button>
                {viewportMode === 'edit' && (
                    <>
                        <div className="wm-toolbar-sep"/>
                        <button type="button"
                                className={`wm-chip${drawingShape ? ' is-active' : ''}`}
                                onClick={drawingShape ? () => setDrawingShape(null) : handleAddShape}
                                disabled={!activeMapId}>
                            {drawingShape ? '取消绘制' : '绘制图形'}
                        </button>
                        <button type="button" className="wm-chip" onClick={handleAddLocation} disabled={!activeMapId}>
                            新增地点
                        </button>
                        <div className="wm-toolbar-sep"/>
                        <button type="button" className="wm-chip"
                                onClick={() => imageInputRef.current?.click()} disabled={!activeMapId}>
                            <ImageIcon/>{backgroundImageUrl ? '更换底图' : '上传底图'}
                        </button>
                        {backgroundImageUrl && (
                            <button type="button" className="wm-chip is-danger" onClick={handleRemoveImage}>
                                移除底图
                            </button>
                        )}
                        <div className="wm-toolbar-sep"/>
                        <button type="button" className="wm-chip" onClick={handleQuickPreview}
                                disabled={!activeMapId || draft.shapes.length === 0}>快速预览
                        </button>
                        <button type="button" className="wm-chip"
                                onClick={() => void handleGenerate()}
                                disabled={!activeMapId || isGenerating || !validation.isValid || draft.shapes.length === 0}>
                            {isGenerating ? '生成中…' : '生成海岸线'}
                        </button>
                    </>
                )}
            </div>

            {/* ── Error Banner ── */}
            {errorMsg && (
                <div className="wm-error-banner">
                    {errorMsg}
                    <button type="button" className="wm-error-banner__close" onClick={() => setErrorMsg(null)}>×
                    </button>
                </div>
            )}

            {/* ── Body ── */}
            <div className="wm-body">
                {/* ── Sidebar ── */}
                <div className="wm-sidebar">
                    {/* Map list section */}
                    <div className="wm-sidebar__section">
                        <div className="wm-sidebar__section-header">
                            <span className="wm-sidebar__section-title">地图列表</span>
                            <button type="button" className="wm-icon-btn" onClick={() => void handleCreateMap()}
                                    title="新建地图">
                                <PlusIcon/>
                            </button>
                        </div>
                        <div className="wm-map-list">
                            {maps.length === 0 && (
                                <div className="wm-map-list__empty">暂无地图，点击 + 新建</div>
                            )}
                            {maps.map(m => (
                                <div key={m.id}
                                     className={`wm-map-item${m.id === activeMapId ? ' is-active' : ''}`}
                                     onClick={() => void handleSwitchMap(m)}
                                >
                                    <span className="wm-map-item__name">{m.name}</span>
                                    <span
                                        className="wm-map-item__meta">{getStyleDefinition((m.style as MapStyle) ?? 'flat').label}</span>
                                    <button
                                        type="button"
                                        className="wm-map-item__delete"
                                        title="删除此地图"
                                        onClick={e => {
                                            e.stopPropagation();
                                            void handleDeleteMap(m.id)
                                        }}
                                    >
                                        <TrashIcon/>
                                    </button>
                                </div>
                            ))}
                        </div>
                    </div>

                    <div className="wm-sidebar__sep"/>

                    {/* Properties section */}
                    <div className="wm-sidebar__section wm-sidebar__section--flex">
                        <div className="wm-sidebar__section-header">
                            <span className="wm-sidebar__section-title">
                                {drawingShape ? '绘制中图形' : selectedShape ? '图形属性' : selectedLocation ? '地点属性' : activeMapId ? '地图属性' : '操作提示'}
                            </span>
                        </div>
                        <RollingBox
                            className="wm-sidebar__body"
                            thumbSize="thin"
                            interceptWheel={(event) => {
                                event.stopPropagation()
                                return false
                            }}
                        >
                            {/* Active map name */}
                            {activeMapId && !drawingShape && !selectedShape && (!selectedLocation || viewportMode === 'preview') && (
                                <>
                                    <div className="wm-field">
                                        <label>地图名称</label>
                                        <input value={activeMapName} onChange={e => handleRename(e.target.value)}/>
                                    </div>
                                    <div className="wm-sidebar-hints">
                                        <div
                                            className="wm-sidebar-hint">点击「绘制图形」在画布上逐点绘制区域，右键图形可选中/删除
                                        </div>
                                        <div className="wm-sidebar-hint">绘制完图形后点击「快速预览」可查看 deck
                                            展示效果
                                        </div>
                                        <div className="wm-sidebar-hint">「生成海岸线」对图形边缘做自然化处理</div>
                                        <div className="wm-sidebar-hint">「上传底图」将图片显示在 deck 层，SVG
                                            层叠加区域标记
                                        </div>
                                        <div className="wm-sidebar-hint">切换风格可改变海洋背景色和图形着色</div>
                                        {!validation.isValid && (
                                            <div className="wm-sidebar-hint wm-sidebar-hint--error">
                                                当前草稿还没通过校验，完善图形或地点后才能生成海岸线。
                                            </div>
                                        )}
                                    </div>
                                    <div className="wm-sidebar-sep"/>
                                    <div className="wm-sidebar-subsection">
                                        <div className="wm-sidebar-subsection__header">
                                            <span className="wm-sidebar-subsection__title">海岸线属性</span>
                                            <button
                                                type="button"
                                                className="wm-chip"
                                                onClick={() => setCoastlineParams(DEFAULT_COASTLINE_PARAMS)}
                                            >
                                                恢复默认
                                            </button>
                                        </div>
                                        <div className="wm-field">
                                            <label>最小段数</label>
                                            <input
                                                type="number"
                                                step={1}
                                                value={coastlineParams.minSegments ?? ''}
                                                onChange={e => updateCoastlineParam('minSegments', e.target.value)}
                                            />
                                        </div>
                                        <div className="wm-field">
                                            <label>最大段数</label>
                                            <input
                                                type="number"
                                                step={1}
                                                value={coastlineParams.maxSegments ?? ''}
                                                onChange={e => updateCoastlineParam('maxSegments', e.target.value)}
                                            />
                                        </div>
                                        <div className="wm-field">
                                            <label>细分基础</label>
                                            <input
                                                type="number"
                                                step={1}
                                                value={coastlineParams.segmentBase ?? ''}
                                                onChange={e => updateCoastlineParam('segmentBase', e.target.value)}
                                            />
                                        </div>
                                        <div className="wm-field">
                                            <label>长度因子</label>
                                            <input
                                                type="number"
                                                step={1}
                                                value={coastlineParams.segmentLengthFactor ?? ''}
                                                onChange={e => updateCoastlineParam('segmentLengthFactor', e.target.value)}
                                            />
                                        </div>
                                        <div className="wm-field">
                                            <label>振幅基础</label>
                                            <input
                                                type="number"
                                                step={0.1}
                                                value={coastlineParams.amplitudeBase ?? ''}
                                                onChange={e => updateCoastlineParam('amplitudeBase', e.target.value)}
                                            />
                                        </div>
                                        <div className="wm-field">
                                            <label>振幅最小</label>
                                            <input
                                                type="number"
                                                step={0.5}
                                                value={coastlineParams.amplitudeMin ?? ''}
                                                onChange={e => updateCoastlineParam('amplitudeMin', e.target.value)}
                                            />
                                        </div>
                                        <div className="wm-field">
                                            <label>平滑轮数</label>
                                            <input
                                                type="number"
                                                step={1}
                                                min={0}
                                                value={coastlineParams.relaxPasses ?? ''}
                                                onChange={e => updateCoastlineParam('relaxPasses', e.target.value)}
                                            />
                                        </div>
                                        <div className="wm-field">
                                            <label>平滑权重</label>
                                            <input
                                                type="number"
                                                step={0.01}
                                                min={0}
                                                max={0.5}
                                                value={coastlineParams.relaxWeight ?? ''}
                                                onChange={e => updateCoastlineParam('relaxWeight', e.target.value)}
                                            />
                                        </div>
                                        <div className="wm-field">
                                            <label>Wave A 权重</label>
                                            <input
                                                type="number"
                                                step={0.01}
                                                value={coastlineParams.waveAWeight ?? ''}
                                                onChange={e => updateCoastlineParam('waveAWeight', e.target.value)}
                                            />
                                        </div>
                                        <div className="wm-field">
                                            <label>Wave B 权重</label>
                                            <input
                                                type="number"
                                                step={0.01}
                                                value={coastlineParams.waveBWeight ?? ''}
                                                onChange={e => updateCoastlineParam('waveBWeight', e.target.value)}
                                            />
                                        </div>
                                        <div className="wm-field">
                                            <label>Wave C 权重</label>
                                            <input
                                                type="number"
                                                step={0.01}
                                                value={coastlineParams.waveCWeight ?? ''}
                                                onChange={e => updateCoastlineParam('waveCWeight', e.target.value)}
                                            />
                                        </div>
                                        <div className="wm-sidebar-hints">
                                            <div className="wm-sidebar-hint">段数越高，海岸线细节越多，但计算量也会上升。
                                            </div>
                                            <div className="wm-sidebar-hint">振幅和平滑决定轮廓起伏感，建议先小幅调整。
                                            </div>
                                            <div className="wm-sidebar-hint">三组 Wave
                                                权重控制大中小三个尺度的纹理占比。
                                            </div>
                                        </div>
                                    </div>
                                </>
                            )}
                            {!activeMapId && (
                                <div className="wm-sidebar-hints">
                                    <div className="wm-sidebar-hint">点击上方 + 新建第一张地图</div>
                                </div>
                            )}

                            {/* Drawing shape editor */}
                            {drawingShape && (
                                <>
                                    <div className="wm-field">
                                        <label>名称</label>
                                        <input value={drawingShape.name ?? ''}
                                               onChange={e => updateDrawingShapeField('name', e.target.value)}/>
                                    </div>
                                    <div className="wm-field">
                                        <label>填充色</label>
                                        <div className="wm-color-row">
                                            <span className="wm-color-swatch"
                                                  style={{background: drawingShape.fill ?? '#ccc'}}/>
                                            <input value={drawingShape.fill ?? ''} placeholder="#cccccc"
                                                   onChange={e => updateDrawingShapeField('fill', e.target.value)}/>
                                        </div>
                                    </div>
                                    <div className="wm-field">
                                        <label>描边色</label>
                                        <div className="wm-color-row">
                                            <span className="wm-color-swatch"
                                                  style={{background: drawingShape.stroke ?? '#888'}}/>
                                            <input value={drawingShape.stroke ?? ''} placeholder="#888888"
                                                   onChange={e => updateDrawingShapeField('stroke', e.target.value)}/>
                                        </div>
                                    </div>
                                    <div className="wm-meta-row">
                                        <span>已落点</span><strong>{drawingShape.vertices.length}</strong>
                                    </div>
                                    <div className="wm-sidebar-sep"/>
                                    <button type="button" className="wm-chip is-full"
                                            onClick={() => setDrawingShape(null)}>取消绘制
                                    </button>
                                </>
                            )}

                            {/* Selected shape editor */}
                            {!drawingShape && selectedShape && viewportMode === 'edit' && (
                                <>
                                    <div className="wm-field">
                                        <label>名称</label>
                                        <input value={selectedShape.name ?? ''}
                                               onChange={e => updateSelectedShape('name', e.target.value)}/>
                                    </div>
                                    <div className="wm-field">
                                        <label>填充色</label>
                                        <div className="wm-color-row">
                                            <span className="wm-color-swatch"
                                                  style={{background: selectedShape.fill ?? '#ccc'}}/>
                                            <input value={selectedShape.fill ?? ''} placeholder="#cccccc"
                                                   onChange={e => updateSelectedShape('fill', e.target.value)}/>
                                        </div>
                                    </div>
                                    <div className="wm-field">
                                        <label>描边色</label>
                                        <div className="wm-color-row">
                                            <span className="wm-color-swatch"
                                                  style={{background: selectedShape.stroke ?? '#888'}}/>
                                            <input value={selectedShape.stroke ?? ''} placeholder="#888888"
                                                   onChange={e => updateSelectedShape('stroke', e.target.value)}/>
                                        </div>
                                    </div>
                                    <div className="wm-meta-row">
                                        <span>顶点数</span><strong>{selectedShape.vertices.length}</strong>
                                    </div>
                                    <div className="wm-sidebar-sep"/>
                                    <button type="button" className="wm-chip is-danger is-full"
                                            onClick={() => void requestDeleteShape(selectedShape.id)}>删除图形
                                    </button>
                                </>
                            )}

                            {/* Selected location editor */}
                            {!drawingShape && !selectedShape && selectedLocation && viewportMode === 'edit' && (
                                <>
                                    <div className="wm-field">
                                        <label>名称</label>
                                        <input value={selectedLocation.name}
                                               onChange={e => updateSelectedLocation('name', e.target.value)}/>
                                    </div>
                                    <div className="wm-field">
                                        <label>类型</label>
                                        <input value={selectedLocation.type}
                                               onChange={e => updateSelectedLocation('type', e.target.value)}/>
                                    </div>
                                    <div className="wm-field">
                                        <label>关联图形</label>
                                        <select value={selectedLocation.shapeId ?? ''}
                                                onChange={e => updateSelectedLocationShapeId(e.target.value || null)}>
                                            <option value="">未关联</option>
                                            {draft.shapes.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                                        </select>
                                    </div>
                                    <div className="wm-field">
                                        <label>关联词条</label>
                                        <select
                                            value={selectedLinkedEntryId}
                                            onChange={e => updateSelectedLocationLinkedEntryId(e.target.value || null)}
                                            disabled={entryOptions.length === 0}
                                        >
                                            <option value="">未关联</option>
                                            {entryOptions.map(entry => (
                                                <option key={entry.id} value={entry.id}>
                                                    {entry.title}
                                                </option>
                                            ))}
                                        </select>
                                    </div>
                                    {entryOptions.length === 0 && (
                                        <div className="wm-sidebar-hint">
                                            当前项目还没有类型为 location 的词条，暂时无法关联地点。
                                        </div>
                                    )}
                                    {selectedLinkedEntry && (
                                        <div className="wm-sidebar-actions">
                                            <button
                                                type="button"
                                                className="wm-chip"
                                                onClick={() => onOpenEntry?.({
                                                    id: selectedLinkedEntry.id,
                                                    title: selectedLinkedEntry.title
                                                })}
                                            >
                                                打开词条
                                            </button>
                                            <button
                                                type="button"
                                                className="wm-chip"
                                                onClick={() => updateSelectedLocationLinkedEntryId(null)}
                                            >
                                                清除关联
                                            </button>
                                        </div>
                                    )}
                                    <div className="wm-meta-row">
                                        <span>坐标</span>
                                        <strong>{selectedLocation.x.toFixed(1)} / {selectedLocation.y.toFixed(1)}</strong>
                                    </div>
                                    <div className="wm-sidebar-sep"/>
                                    <button type="button" className="wm-chip is-danger is-full"
                                            onClick={() => void requestDeleteLocation(selectedLocation.id)}>删除地点
                                    </button>
                                </>
                            )}
                        </RollingBox>
                    </div>
                </div>

                {/* ── Viewport ── */}
                <div className="wm-viewport-container">
                    {activeMapId ? (
                        <MapShapeViewport
                            key={viewportRenderKey}
                            mode={viewportMode}
                            renderer={previewRenderer}
                            canvas={CANVAS}
                            scene={renderedScene}
                            viewBox={viewBox}
                            onViewBoxChange={setViewBox}
                            svgProps={svgProps}
                            deckProps={deckProps}
                            pixiProps={pixiProps}
                        />
                    ) : (
                        <div className="wm-viewport-empty">
                            点击侧边栏中的 + 新建第一张地图
                        </div>
                    )}
                </div>
            </div>
        </div>
    )
}
