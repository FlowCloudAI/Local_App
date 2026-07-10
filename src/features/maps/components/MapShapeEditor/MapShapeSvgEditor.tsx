import {
    type CSSProperties,
    type MouseEvent as ReactMouseEvent,
    type PointerEvent as ReactPointerEvent,
    useEffect,
    useRef,
    useState,
} from 'react';

import type {
    MapEditorCanvas,
    MapShapeDraft,
    MapShapeEditorDraft,
    MapShapeEditorViewBox,
    MapTerrainBrush,
    MapTerrainKind,
    MapTerrainStroke,
} from './types';
import {MAP_TERRAIN_KIND_COLORS} from './types';
import type {CoordinateSnapshot} from './mapShapeEditorSvgUtils';
import {
    buildShapePoints,
    clampMapShapeEditorViewBox,
    createMapShapeEditorLocalId,
    getClampedShapeDelta,
    getShapeEdge,
    projectPointToSegment,
    toSvgPoint,
    updateKeyLocation,
    updateShapeTranslation,
    updateVertex,
} from './mapShapeEditorSvgUtils';
import {isPointInPolygon} from './geometry';
import './MapShapeEditor.css';

const LOCATION_DRAG_THRESHOLD = 4;
const PAN_DRAG_THRESHOLD = 3;

type DragState =
    | { kind: 'vertex'; shapeId: string; vertexId: string }
    | { kind: 'keyLocation'; locationId: string }
    | {
    kind: 'shape';
    shapeId: string;
    startPoint: { x: number; y: number };
    originVertices: CoordinateSnapshot[];
    originLocations: CoordinateSnapshot[];
};

type PendingPointerState =
    | {
    kind: 'keyLocation';
    locationId: string;
    startClientX: number;
    startClientY: number;
}
    | {
    kind: 'shape';
    shapeId: string;
    startClientX: number;
    startClientY: number;
    startPoint: { x: number; y: number };
    originVertices: CoordinateSnapshot[];
    originLocations: CoordinateSnapshot[];
};

interface PanState {
    startClientX: number;
    startClientY: number;
    originViewBox: MapShapeEditorViewBox;
    hasMoved: boolean;
}

interface BaseContextMenuDetail {
    nativeEvent: MouseEvent;
    clientX: number;
    clientY: number;
}

export interface MapShapeSvgEditorCanvasContextMenuDetail extends BaseContextMenuDetail {
    kind: 'canvas';
}

export interface MapShapeSvgEditorShapeContextMenuDetail extends BaseContextMenuDetail {
    kind: 'shape';
    shapeId: string;
    shapeIndex: number;
    shapeCount: number;
    isAtFront: boolean;
    isAtBack: boolean;
}

export interface MapShapeSvgEditorVertexContextMenuDetail extends BaseContextMenuDetail {
    kind: 'vertex';
    shapeId: string;
    vertexId: string;
}

export interface MapShapeSvgEditorLocationContextMenuDetail extends BaseContextMenuDetail {
    kind: 'location';
    locationId: string;
}

export interface MapShapeSvgEditorProps {
    canvas: MapEditorCanvas;
    draft: MapShapeEditorDraft;
    selectedShapeId: string | null;
    selectedLocationId: string | null;
    drawingShape: MapShapeDraft | null;
    terrainBrush?: MapTerrainBrush | null;
    viewBox: MapShapeEditorViewBox;
    invalidShapeIds?: Iterable<string> | null;
    invalidKeyLocationIds?: Iterable<string> | null;
    width?: string | number;
    height?: string | number;
    className?: string;
    style?: CSSProperties;
    emptyHint?: string;
    /** SVG 背景图 URL，渲染在所有图形之下，使用 cover 适配模式 */
    backgroundImage?: string;
    /** 只读模式：保留缩放/平移，禁用所有编辑交互 */
    readOnly?: boolean;
    onDraftChange: (draft: MapShapeEditorDraft) => void;
    onSelectedShapeChange: (shapeId: string | null) => void;
    onSelectedLocationChange: (locationId: string | null) => void;
    onDrawingShapeChange: (shape: MapShapeDraft | null) => void;
    onViewBoxChange: (viewBox: MapShapeEditorViewBox) => void;
    onRequestShapeDelete?: (shapeId: string) => void;
    onRequestVertexDelete?: (shapeId: string, vertexId: string) => void;
    onRequestLocationDelete?: (locationId: string) => void;
    onCanvasContextMenu?: (detail: MapShapeSvgEditorCanvasContextMenuDetail) => void;
    onShapeContextMenu?: (detail: MapShapeSvgEditorShapeContextMenuDetail) => void;
    onVertexContextMenu?: (detail: MapShapeSvgEditorVertexContextMenuDetail) => void;
    onLocationContextMenu?: (detail: MapShapeSvgEditorLocationContextMenuDetail) => void;
}

export function MapShapeSvgEditor({
                                      canvas,
                                      draft,
                                      selectedShapeId,
                                      selectedLocationId,
                                      drawingShape,
                                      terrainBrush = null,
                                      viewBox,
                                      invalidShapeIds,
                                      invalidKeyLocationIds,
                                      width = '100%',
                                      height = 'auto',
                                      className,
                                      style,
                                      emptyHint = '请在调用方中传入 draft 与交互状态。',
                                      backgroundImage,
                                      readOnly = false,
                                      onDraftChange,
                                      onSelectedShapeChange,
                                      onSelectedLocationChange,
                                      onDrawingShapeChange,
                                      onViewBoxChange,
                                      onRequestShapeDelete,
                                      onRequestVertexDelete,
                                      onRequestLocationDelete,
                                      onCanvasContextMenu,
                                      onShapeContextMenu,
                                      onVertexContextMenu,
                                      onLocationContextMenu,
                                  }: MapShapeSvgEditorProps) {
    const svgRef = useRef<SVGSVGElement | null>(null);
    const suppressCanvasClickRef = useRef(false);
    const [dragState, setDragState] = useState<DragState | null>(null);
    const [pendingPointerState, setPendingPointerState] = useState<PendingPointerState | null>(null);
    const [panState, setPanState] = useState<PanState | null>(null);
    const [activeTerrainStrokeId, setActiveTerrainStrokeId] = useState<string | null>(null);
    // 活动地形笔画不进 draft：每个采样点都写 draft 会导致整个面板重渲 + 地形场全量重光栅化，
    // 这是涂画卡顿的根源。ref 供事件处理器读写（避免 effect 因笔画数据重订阅），
    // state 镜像只驱动本组件的 SVG 活笔预览，松手时一次性提交进 draft。
    const activeTerrainStrokeRef = useRef<MapTerrainStroke | null>(null);
    const [activeTerrainStroke, setActiveTerrainStroke] = useState<MapTerrainStroke | null>(null);
    const [terrainCursorPoint, setTerrainCursorPoint] = useState<{ x: number; y: number } | null>(null);

    const invalidShapeIdSet = new Set(invalidShapeIds ? Array.from(invalidShapeIds) : []);
    const invalidKeyLocationIdSet = new Set(invalidKeyLocationIds ? Array.from(invalidKeyLocationIds) : []);

    useEffect(() => {
        if (selectedShapeId && draft.shapes.some(shape => shape.id === selectedShapeId)) return;
        if (selectedShapeId !== null) {
            onSelectedShapeChange(null);
        }
    }, [draft.shapes, onSelectedShapeChange, selectedShapeId]);

    useEffect(() => {
        if (selectedLocationId && draft.keyLocations.some(location => location.id === selectedLocationId)) return;
        if (selectedLocationId !== null) {
            onSelectedLocationChange(null);
        }
    }, [draft.keyLocations, onSelectedLocationChange, selectedLocationId]);

    useEffect(() => {
        if (!dragState && !pendingPointerState && !panState && !activeTerrainStrokeId) return;

        const handlePointerMove = (event: PointerEvent) => {
            if (panState) {
                const svgElement = svgRef.current;
                if (!svgElement) return;

                const rect = svgElement.getBoundingClientRect();
                if (rect.width <= 0 || rect.height <= 0) return;

                const deltaClientX = event.clientX - panState.startClientX;
                const deltaClientY = event.clientY - panState.startClientY;
                const nextViewBox = clampMapShapeEditorViewBox({
                    ...panState.originViewBox,
                    x: panState.originViewBox.x - (deltaClientX / rect.width) * panState.originViewBox.width,
                    y: panState.originViewBox.y - (deltaClientY / rect.height) * panState.originViewBox.height,
                }, canvas);
                const moved = Math.hypot(deltaClientX, deltaClientY) >= PAN_DRAG_THRESHOLD;

                onViewBoxChange(nextViewBox);
                setPanState(currentState => (currentState ? {
                    ...currentState,
                    hasMoved: currentState.hasMoved || moved,
                } : currentState));
                return;
            }

            const svgElement = svgRef.current;
            if (!svgElement) return;

            const point = toSvgPoint(svgElement, event.clientX, event.clientY, canvas);
            if (activeTerrainStrokeId) {
                setTerrainCursorPoint(point);
                const activeStroke = activeTerrainStrokeRef.current;
                if (!activeStroke) return;

                // 高速运笔时浏览器只按帧率派发 pointermove，原始事件间距可达几十像素，
                // 直线连点就是"快笔成折线"的来源——getCoalescedEvents 取回帧间被合并的轨迹点。
                const rect = svgElement.getBoundingClientRect();
                const minSceneDistance = rect.width > 0 ? (viewBox.width / rect.width) * 2 : 2;
                const coalesced = typeof event.getCoalescedEvents === 'function' ? event.getCoalescedEvents() : [];
                const sourceEvents = coalesced.length > 0 ? coalesced : [event];

                const points = [...activeStroke.points];
                for (const sourceEvent of sourceEvents) {
                    const scenePoint = toSvgPoint(svgElement, sourceEvent.clientX, sourceEvent.clientY, canvas);
                    const lastPoint = points.at(-1);
                    if (lastPoint && Math.hypot(scenePoint.x - lastPoint[0], scenePoint.y - lastPoint[1]) < minSceneDistance) continue;
                    points.push([scenePoint.x, scenePoint.y]);
                }
                if (points.length === activeStroke.points.length) return;

                const nextStroke = {...activeStroke, points};
                activeTerrainStrokeRef.current = nextStroke;
                setActiveTerrainStroke(nextStroke);
                return;
            }

            if (dragState) {
                if (dragState.kind === 'vertex') {
                    onDraftChange(updateVertex(draft, dragState.shapeId, dragState.vertexId, point));
                    return;
                }

                if (dragState.kind === 'shape') {
                    const delta = getClampedShapeDelta({
                        canvas,
                        currentPoint: point,
                        originVertices: dragState.originVertices,
                        startPoint: dragState.startPoint,
                    });

                    onDraftChange(updateShapeTranslation(
                        draft,
                        dragState.shapeId,
                        delta,
                        dragState.originVertices,
                        dragState.originLocations,
                    ));
                    return;
                }

                onDraftChange(updateKeyLocation(draft, dragState.locationId, location => ({
                    ...location,
                    x: point.x,
                    y: point.y,
                })));
                return;
            }

            if (!pendingPointerState) return;

            const distance = Math.hypot(
                event.clientX - pendingPointerState.startClientX,
                event.clientY - pendingPointerState.startClientY,
            );

            if (distance < LOCATION_DRAG_THRESHOLD) return;

            if (pendingPointerState.kind === 'keyLocation') {
                setPendingPointerState(null);
                setDragState({kind: 'keyLocation', locationId: pendingPointerState.locationId});
                onSelectedShapeChange(null);
                onSelectedLocationChange(pendingPointerState.locationId);
                onDraftChange(updateKeyLocation(draft, pendingPointerState.locationId, location => ({
                    ...location,
                    x: point.x,
                    y: point.y,
                })));
                return;
            }

            const nextShapeDragState: DragState = {
                kind: 'shape',
                shapeId: pendingPointerState.shapeId,
                startPoint: pendingPointerState.startPoint,
                originVertices: pendingPointerState.originVertices,
                originLocations: pendingPointerState.originLocations,
            };
            const delta = getClampedShapeDelta({
                canvas,
                currentPoint: point,
                originVertices: pendingPointerState.originVertices,
                startPoint: pendingPointerState.startPoint,
            });

            setPendingPointerState(null);
            setDragState(nextShapeDragState);
            onSelectedShapeChange(pendingPointerState.shapeId);
            onSelectedLocationChange(null);
            onDraftChange(updateShapeTranslation(
                draft,
                pendingPointerState.shapeId,
                delta,
                pendingPointerState.originVertices,
                pendingPointerState.originLocations,
            ));
        };

        const handlePointerUp = () => {
            if (activeTerrainStrokeId) {
                suppressCanvasClickRef.current = true;
                // 松手一次性提交：涂画全程 draft 不变，地形场只在此刻重建一次
                const stroke = activeTerrainStrokeRef.current;
                activeTerrainStrokeRef.current = null;
                setActiveTerrainStroke(null);
                if (stroke && stroke.points.length > 0) {
                    onDraftChange({
                        ...draft,
                        terrainStrokes: [...(draft.terrainStrokes ?? []), stroke],
                    });
                }
            }
            if (panState?.hasMoved) {
                suppressCanvasClickRef.current = true;
            }

            if (!dragState && pendingPointerState) {
                if (pendingPointerState.kind === 'keyLocation') {
                    onSelectedShapeChange(null);
                    onSelectedLocationChange(pendingPointerState.locationId);
                } else {
                    onSelectedShapeChange(pendingPointerState.shapeId);
                    onSelectedLocationChange(null);
                }
            }

            if (dragState?.kind === 'keyLocation') {
                onSelectedShapeChange(null);
                onSelectedLocationChange(dragState.locationId);
            }

            setDragState(null);
            setPendingPointerState(null);
            setPanState(null);
            setActiveTerrainStrokeId(null);
        };

        window.addEventListener('pointermove', handlePointerMove);
        window.addEventListener('pointerup', handlePointerUp);
        window.addEventListener('pointercancel', handlePointerUp);

        return () => {
            window.removeEventListener('pointermove', handlePointerMove);
            window.removeEventListener('pointerup', handlePointerUp);
            window.removeEventListener('pointercancel', handlePointerUp);
        };
    }, [
        canvas,
        activeTerrainStrokeId,
        dragState,
        draft,
        onDraftChange,
        onSelectedLocationChange,
        onSelectedShapeChange,
        onViewBoxChange,
        panState,
        pendingPointerState,
        viewBox.width,
    ]);

    useEffect(() => {
        const svgElement = svgRef.current;
        if (!svgElement) return;

        const handleNativeWheel = (event: WheelEvent) => {
            event.preventDefault();

            const zoomFactor = event.deltaY < 0 ? 0.9 : 1.1;
            const pointer = toSvgPoint(svgElement, event.clientX, event.clientY, canvas);
            const nextWidth = viewBox.width * zoomFactor;
            const nextHeight = viewBox.height * zoomFactor;
            const widthRatio = nextWidth / viewBox.width;
            const heightRatio = nextHeight / viewBox.height;
            const nextViewBox = clampMapShapeEditorViewBox({
                width: nextWidth,
                height: nextHeight,
                x: pointer.x - (pointer.x - viewBox.x) * widthRatio,
                y: pointer.y - (pointer.y - viewBox.y) * heightRatio,
            }, canvas);

            onViewBoxChange(nextViewBox);
        };

        svgElement.addEventListener('wheel', handleNativeWheel, {passive: false});
        return () => {
            svgElement.removeEventListener('wheel', handleNativeWheel);
        };
    }, [canvas, onViewBoxChange, viewBox]);

    const handleShapePointerDown = (
        event: ReactPointerEvent<SVGPolygonElement>,
        shape: MapShapeDraft,
    ) => {
        if (readOnly) return;
        if (terrainBrush) return;
        const svgElement = svgRef.current;
        if (!svgElement) return;

        event.preventDefault();
        event.stopPropagation();

        if (selectedShapeId !== shape.id) {
            onSelectedShapeChange(shape.id);
            onSelectedLocationChange(null);
            return;
        }

        setPendingPointerState({
            kind: 'shape',
            shapeId: shape.id,
            startClientX: event.clientX,
            startClientY: event.clientY,
            startPoint: toSvgPoint(svgElement, event.clientX, event.clientY, canvas),
            originVertices: shape.vertices.map(vertex => ({...vertex})),
            originLocations: draft.keyLocations
                .filter(location => isPointInPolygon({x: location.x, y: location.y}, shape.vertices))
                .map(location => ({id: location.id, x: location.x, y: location.y})),
        });
    };

    const handleVertexPointerDown = (
        event: ReactPointerEvent<SVGCircleElement>,
        shapeId: string,
        vertexId: string,
    ) => {
        if (readOnly) return;
        if (terrainBrush) return;
        event.preventDefault();
        event.stopPropagation();
        setPendingPointerState(null);
        onSelectedShapeChange(shapeId);
        onSelectedLocationChange(null);
        setDragState({kind: 'vertex', shapeId, vertexId});
    };

    const handleKeyLocationPointerDown = (
        event: ReactPointerEvent<SVGGElement>,
        locationId: string,
    ) => {
        if (readOnly) return;
        if (terrainBrush) return;
        event.preventDefault();
        event.stopPropagation();
        setPendingPointerState({
            kind: 'keyLocation',
            locationId,
            startClientX: event.clientX,
            startClientY: event.clientY,
        });
    };

    const handleEdgeDoubleClick = (
        event: ReactMouseEvent<SVGLineElement>,
        shapeId: string,
        edgeIndex: number,
    ) => {
        if (readOnly) return;
        if (terrainBrush) return;
        event.preventDefault();
        event.stopPropagation();

        const svgElement = svgRef.current;
        if (!svgElement) return;

        const nextDraft: MapShapeEditorDraft = {
            ...draft,
            shapes: draft.shapes.map(shape => {
                if (shape.id !== shapeId) return shape;

                const {start, end} = getShapeEdge(shape, edgeIndex);
                const clickPoint = toSvgPoint(svgElement, event.clientX, event.clientY, canvas);
                const insertedPoint = projectPointToSegment(clickPoint, start, end);
                const vertices = [...shape.vertices];

                vertices.splice(edgeIndex + 1, 0, {
                    id: createMapShapeEditorLocalId('vertex'),
                    x: insertedPoint.x,
                    y: insertedPoint.y,
                });

                return {
                    ...shape,
                    vertices,
                };
            }),
        };

        onDraftChange(nextDraft);
        onSelectedShapeChange(shapeId);
        onSelectedLocationChange(null);
    };

    const handleCanvasPointerDown = (event: ReactPointerEvent<SVGSVGElement>) => {
        if (readOnly) {
            if (event.button !== 0 && event.button !== 1) return;
            event.preventDefault();
            setPendingPointerState(null);
            setDragState(null);
            setPanState({
                startClientX: event.clientX,
                startClientY: event.clientY,
                originViewBox: viewBox,
                hasMoved: false,
            });
            return;
        }

        if (terrainBrush && event.button === 0) {
            const svgElement = svgRef.current;
            if (!svgElement) return;
            const point = toSvgPoint(svgElement, event.clientX, event.clientY, canvas);
            const stroke: MapTerrainStroke = {
                id: createMapShapeEditorLocalId('terrain'),
                kind: terrainBrush.kind,
                points: [[point.x, point.y]],
                radius: terrainBrush.radius,
                mode: terrainBrush.mode,
            };
            event.preventDefault();
            event.stopPropagation();
            setPendingPointerState(null);
            setDragState(null);
            setPanState(null);
            setTerrainCursorPoint(point);
            activeTerrainStrokeRef.current = stroke;
            setActiveTerrainStroke(stroke);
            setActiveTerrainStrokeId(stroke.id);
            return;
        }

        const target = event.target as SVGElement | null;
        const isBackgroundTarget = target?.tagName === 'svg' || target?.tagName === 'rect';
        const targetShapeId = target?.getAttribute('data-shape-id');
        const isUnselectedShapeTarget = Boolean(targetShapeId) && targetShapeId !== selectedShapeId;
        const shouldStartPan = event.button === 1 || (
            event.button === 0
            && !drawingShape
            && (isBackgroundTarget || isUnselectedShapeTarget)
        );
        if (!shouldStartPan) return;

        event.preventDefault();
        event.stopPropagation();
        setPendingPointerState(null);
        setDragState(null);
        setPanState({
            startClientX: event.clientX,
            startClientY: event.clientY,
            originViewBox: viewBox,
            hasMoved: false,
        });
    };

    const handleCanvasClick = (event: ReactMouseEvent<SVGSVGElement>) => {
        if (readOnly) return;
        if (suppressCanvasClickRef.current) {
            suppressCanvasClickRef.current = false;
            return;
        }
        if (terrainBrush) return;

        const svgElement = svgRef.current;
        if (!svgElement) return;

        if (drawingShape) {
            if (event.detail > 1) return;
            event.stopPropagation();
            const point = toSvgPoint(svgElement, event.clientX, event.clientY, canvas);

            onDrawingShapeChange({
                ...drawingShape,
                vertices: [
                    ...drawingShape.vertices,
                    {id: createMapShapeEditorLocalId('vertex'), x: point.x, y: point.y},
                ],
            });
            return;
        }

        const target = event.target as SVGElement | null;
        const isBackgroundTarget = target?.tagName === 'svg' || target?.tagName === 'rect';
        if (isBackgroundTarget) {
            onSelectedShapeChange(null);
            onSelectedLocationChange(null);
        }
    };

    const handleFinishDrawingShape = (event?: ReactMouseEvent<SVGElement>) => {
        if (!drawingShape || drawingShape.vertices.length < 3) return;

        event?.preventDefault();
        event?.stopPropagation();
        onDraftChange({
            ...draft,
            shapes: [...draft.shapes, drawingShape],
        });
        onDrawingShapeChange(null);
        onSelectedShapeChange(drawingShape.id);
        onSelectedLocationChange(null);
    };

    const handleShapeContextMenuInternal = (
        event: ReactMouseEvent<SVGPolygonElement>,
        shapeId: string,
    ) => {
        if (readOnly) return;
        event.preventDefault();
        event.stopPropagation();
        onSelectedShapeChange(shapeId);
        onSelectedLocationChange(null);

        const shapeIndex = draft.shapes.findIndex(shape => shape.id === shapeId);
        const shapeCount = draft.shapes.length;

        const detail: MapShapeSvgEditorShapeContextMenuDetail = {
            kind: 'shape',
            shapeId,
            shapeIndex,
            shapeCount,
            isAtFront: shapeIndex === shapeCount - 1,
            isAtBack: shapeIndex <= 0,
            nativeEvent: event.nativeEvent,
            clientX: event.clientX,
            clientY: event.clientY,
        };

        if (onShapeContextMenu) {
            onShapeContextMenu(detail);
            return;
        }

        onRequestShapeDelete?.(shapeId);
    };

    const handleVertexContextMenuInternal = (
        event: ReactMouseEvent<SVGCircleElement>,
        shapeId: string,
        vertexId: string,
    ) => {
        if (readOnly) return;
        event.preventDefault();
        event.stopPropagation();
        onSelectedShapeChange(shapeId);
        onSelectedLocationChange(null);

        const detail: MapShapeSvgEditorVertexContextMenuDetail = {
            kind: 'vertex',
            shapeId,
            vertexId,
            nativeEvent: event.nativeEvent,
            clientX: event.clientX,
            clientY: event.clientY,
        };

        if (onVertexContextMenu) {
            onVertexContextMenu(detail);
            return;
        }

        onRequestVertexDelete?.(shapeId, vertexId);
    };

    const handleLocationContextMenuInternal = (
        event: ReactMouseEvent<SVGGElement>,
        locationId: string,
    ) => {
        if (readOnly) return;
        event.preventDefault();
        event.stopPropagation();
        onSelectedShapeChange(null);
        onSelectedLocationChange(locationId);

        const detail: MapShapeSvgEditorLocationContextMenuDetail = {
            kind: 'location',
            locationId,
            nativeEvent: event.nativeEvent,
            clientX: event.clientX,
            clientY: event.clientY,
        };

        if (onLocationContextMenu) {
            onLocationContextMenu(detail);
            return;
        }

        onRequestLocationDelete?.(locationId);
    };

    const handleCanvasContextMenuInternal = (event: ReactMouseEvent<SVGSVGElement>) => {
        if (readOnly || !onCanvasContextMenu) return;

        event.preventDefault();
        onCanvasContextMenu({
            kind: 'canvas',
            nativeEvent: event.nativeEvent,
            clientX: event.clientX,
            clientY: event.clientY,
        });
    };

    const handleCanvasPointerMove = (event: ReactPointerEvent<SVGSVGElement>) => {
        if (!terrainBrush || activeTerrainStrokeId) return;
        const svgElement = svgRef.current;
        if (!svgElement) return;
        setTerrainCursorPoint(toSvgPoint(svgElement, event.clientX, event.clientY, canvas));
    };

    const handleTerrainStrokeContextMenu = (
        event: ReactMouseEvent<SVGElement>,
        strokeId: string,
    ) => {
        event.preventDefault();
        event.stopPropagation();
        onDraftChange({
            ...draft,
            terrainStrokes: (draft.terrainStrokes ?? []).filter(stroke => stroke.id !== strokeId),
        });
    };

    const zoomPercentage = Math.round((canvas.width / Math.max(viewBox.width, 1)) * 100);
    const locationEditorScale = viewBox.width / Math.max(canvas.width, 1);
    const locationHitRadius = 18 * locationEditorScale;
    const locationHitOffsetY = -10 * locationEditorScale;
    const wrapperClassName = [
        'fc-map-shape-svg-editor',
        readOnly ? 'fc-map-shape-svg-editor--readonly' : '',
        terrainBrush ? 'fc-map-shape-svg-editor--terrain-brush' : '',
        className,
    ].filter(Boolean).join(' ');

    return (
        <div className={wrapperClassName} style={{width, height, ...style}}>
            <div className="fc-map-shape-editor__editor-shell"
                 style={{aspectRatio: `${canvas.width} / ${canvas.height}`}}>
                <div className="fc-map-shape-editor__viewport-tools">
                    <span className="fc-map-shape-editor__viewport-badge">缩放 {zoomPercentage}%</span>
                    <span className="fc-map-shape-editor__viewport-badge">
                        视窗 {Math.round(viewBox.x)}, {Math.round(viewBox.y)}
                    </span>
                </div>

                <svg
                    ref={svgRef}
                    className={`fc-map-shape-editor__canvas${panState ? ' fc-map-shape-editor__canvas--panning' : ''}`}
                    viewBox={`${viewBox.x} ${viewBox.y} ${viewBox.width} ${viewBox.height}`}
                    preserveAspectRatio="xMidYMid meet"
                    role="img"
                    aria-label="地图轮廓 SVG 编辑器"
                    onClick={handleCanvasClick}
                    onDoubleClick={handleFinishDrawingShape}
                    onPointerDown={handleCanvasPointerDown}
                    onPointerMove={handleCanvasPointerMove}
                    onPointerLeave={() => {
                        if (!activeTerrainStrokeId) setTerrainCursorPoint(null);
                    }}
                    onContextMenu={handleCanvasContextMenuInternal}
                >
                    <rect x={0} y={0} width={canvas.width} height={canvas.height} fill="transparent"/>

                    {backgroundImage && (
                        <image
                            href={backgroundImage}
                            x={0}
                            y={0}
                            width={canvas.width}
                            height={canvas.height}
                            preserveAspectRatio="xMidYMid slice"
                        />
                    )}

                    {draft.shapes.length === 0
                    && !drawingShape
                    && draft.keyLocations.length === 0
                    && (draft.terrainStrokes?.length ?? 0) === 0 ? (
                        <text
                            className="fc-map-shape-editor__empty-hint"
                            x={canvas.width / 2}
                            y={canvas.height / 2}
                            textAnchor="middle"
                        >
                            {emptyHint}
                        </text>
                    ) : null}

                    {draft.shapes.map(shape => {
                        const isSelected = shape.id === selectedShapeId;
                        const isInvalid = invalidShapeIdSet.has(shape.id);
                        const shapeStyle = {
                            ['--fc-mse-shape-fill-color' as const]: shape.fill ?? '#d8ecff',
                            ['--fc-mse-shape-stroke-color' as const]: shape.stroke ?? '#185fa5',
                        } as CSSProperties;

                        return (
                            <g key={shape.id} style={shapeStyle}>
                                <polygon
                                    data-shape-id={shape.id}
                                    className={[
                                        'fc-map-shape-editor__shape-polygon',
                                        isSelected ? 'fc-map-shape-editor__shape-polygon--selected' : '',
                                        isInvalid ? 'fc-map-shape-editor__shape-polygon--invalid' : '',
                                    ].filter(Boolean).join(' ')}
                                    points={buildShapePoints(shape)}
                                    onPointerDown={event => handleShapePointerDown(event, shape)}
                                    onDoubleClick={event => {
                                        event.preventDefault();
                                        event.stopPropagation();
                                        onSelectedShapeChange(shape.id);
                                        onSelectedLocationChange(null);
                                    }}
                                    onContextMenu={event => handleShapeContextMenuInternal(event, shape.id)}
                                />

                                {isSelected && !readOnly && shape.vertices.map((vertex, index) => {
                                    const edge = getShapeEdge(shape, index);
                                    return (
                                        <g key={`${shape.id}-${vertex.id}`}>
                                            <line
                                                className="fc-map-shape-editor__edge"
                                                x1={edge.start.x}
                                                y1={edge.start.y}
                                                x2={edge.end.x}
                                                y2={edge.end.y}
                                            />
                                            <line
                                                className="fc-map-shape-editor__edge-hit"
                                                x1={edge.start.x}
                                                y1={edge.start.y}
                                                x2={edge.end.x}
                                                y2={edge.end.y}
                                                onDoubleClick={event => handleEdgeDoubleClick(event, shape.id, index)}
                                            />
                                            <circle
                                                className="fc-map-shape-editor__vertex"
                                                cx={vertex.x}
                                                cy={vertex.y}
                                                r={7}
                                                onPointerDown={event => handleVertexPointerDown(event, shape.id, vertex.id)}
                                                onContextMenu={event => handleVertexContextMenuInternal(event, shape.id, vertex.id)}
                                            />
                                        </g>
                                    );
                                })}
                            </g>
                        );
                    })}

                    {!readOnly && drawingShape && (
                        <g
                            style={{
                                ['--fc-mse-shape-fill-color' as const]: drawingShape.fill ?? '#d8ecff',
                                ['--fc-mse-shape-stroke-color' as const]: drawingShape.stroke ?? '#185fa5',
                            } as CSSProperties}
                        >
                            {drawingShape.vertices.length >= 3 ? (
                                <polygon className="fc-map-shape-editor__draft-polygon"
                                         points={buildShapePoints(drawingShape)}/>
                            ) : null}
                            {drawingShape.vertices.length >= 2 ? (
                                <polyline
                                    className="fc-map-shape-editor__draft-line"
                                    points={buildShapePoints(drawingShape)}
                                />
                            ) : null}
                            {drawingShape.vertices.map((vertex, index) => {
                                const isLastVertex = index === drawingShape.vertices.length - 1;
                                const canFinish = isLastVertex && drawingShape.vertices.length >= 3;
                                return (
                                    <circle
                                        key={vertex.id}
                                        className={[
                                            'fc-map-shape-editor__draft-vertex',
                                            canFinish ? 'fc-map-shape-editor__draft-vertex--closable' : '',
                                        ].filter(Boolean).join(' ')}
                                        cx={vertex.x}
                                        cy={vertex.y}
                                        r={6}
                                        onDoubleClick={canFinish ? handleFinishDrawingShape : undefined}
                                    />
                                );
                            })}
                        </g>
                    )}

                    {draft.keyLocations.map(location => (
                        <g
                            key={location.id}
                            className={[
                                'fc-map-shape-editor__key-location',
                                location.id === selectedLocationId ? 'fc-map-shape-editor__key-location--selected' : '',
                                invalidKeyLocationIdSet.has(location.id) ? 'fc-map-shape-editor__key-location--invalid' : '',
                            ].filter(Boolean).join(' ')}
                            transform={`translate(${location.x} ${location.y})`}
                            onPointerDown={event => handleKeyLocationPointerDown(event, location.id)}
                            onContextMenu={event => handleLocationContextMenuInternal(event, location.id)}
                        >
                            <circle
                                className="fc-map-shape-editor__key-location-core"
                                cy={locationHitOffsetY}
                                r={locationHitRadius}
                                vectorEffect="non-scaling-stroke"
                            />
                        </g>
                    ))}

                    {terrainBrush && (draft.terrainStrokes ?? []).map(stroke => {
                        if (stroke.points.length === 1) {
                            return (
                                <circle
                                    key={stroke.id}
                                    className="fc-map-shape-editor__terrain-stroke-hit-point"
                                    cx={stroke.points[0][0]}
                                    cy={stroke.points[0][1]}
                                    r={Math.max(6, stroke.radius)}
                                    onContextMenu={event => handleTerrainStrokeContextMenu(event, stroke.id)}
                                />
                            );
                        }
                        if (stroke.points.length < 2) return null;
                        return (
                            <polyline
                                key={stroke.id}
                                className="fc-map-shape-editor__terrain-stroke-hit"
                                points={stroke.points.map(point => `${point[0]},${point[1]}`).join(' ')}
                                strokeWidth={Math.max(12, stroke.radius * 2)}
                                onContextMenu={event => handleTerrainStrokeContextMenu(event, stroke.id)}
                            />
                        );
                    })}

                    {/* 活笔预览：涂画期间 draft 不更新，可见反馈由这条彩色轨迹承担 */}
                    {terrainBrush && activeTerrainStroke && (() => {
                        const previewColor = activeTerrainStroke.mode === 'erase'
                            ? '#f6f4ee'
                            : MAP_TERRAIN_KIND_COLORS[activeTerrainStroke.kind as MapTerrainKind] ?? '#8a8a8a';
                        if (activeTerrainStroke.points.length === 1) {
                            return (
                                <circle
                                    className="fc-map-shape-editor__terrain-active"
                                    cx={activeTerrainStroke.points[0][0]}
                                    cy={activeTerrainStroke.points[0][1]}
                                    r={activeTerrainStroke.radius}
                                    fill={previewColor}
                                />
                            );
                        }
                        return (
                            <polyline
                                className="fc-map-shape-editor__terrain-active"
                                points={activeTerrainStroke.points.map(point => `${point[0]},${point[1]}`).join(' ')}
                                fill="none"
                                stroke={previewColor}
                                strokeWidth={activeTerrainStroke.radius * 2}
                                strokeLinecap="round"
                                strokeLinejoin="round"
                            />
                        );
                    })()}

                    {terrainBrush && terrainCursorPoint && (
                        <circle
                            className="fc-map-shape-editor__terrain-cursor"
                            cx={terrainCursorPoint.x}
                            cy={terrainCursorPoint.y}
                            r={terrainBrush.radius}
                            vectorEffect="non-scaling-stroke"
                        />
                    )}
                </svg>
            </div>
        </div>
    );
}
