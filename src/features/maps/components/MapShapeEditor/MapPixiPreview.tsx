import {Application, extend, useApplication} from '@pixi/react';
import {
    Circle,
    Container,
    type FederatedPointerEvent,
    type Filter,
    Graphics,
    Rectangle,
    Sprite,
    Text,
    type TextStyleOptions,
    Texture,
} from 'pixi.js';
import {
    type CSSProperties,
    type PointerEvent as ReactPointerEvent,
    type ReactNode,
    useCallback,
    useEffect,
    useLayoutEffect,
    useMemo,
    useRef,
    useState,
} from 'react';

import type {
    MapEditorCanvas,
    MapKeyLocationRenderMode,
    MapPreviewBackgroundImage,
    MapPreviewEmptyPickDetail,
    MapPreviewKeyLocation,
    MapPreviewKeyLocationPickDetail,
    MapPreviewKeyLocationStyle,
    MapPreviewLabelStyle,
    MapPreviewPickDetail,
    MapPreviewScene,
    MapPreviewShape,
    MapPreviewShapePickDetail,
    MapPreviewShapeStyle,
    MapPreviewTooltip,
    MapRgbaColor,
    MapShapeEditorViewBox,
} from './types';
import {clampMapShapeEditorViewBox, createInitialMapShapeEditorViewBox,} from './mapShapeEditorSvgUtils';
import './MapShapeEditor.css';

extend({
    Container,
    Graphics,
    Sprite,
    Text,
});

const MIN_RENDER_SIZE = 2;
const DEFAULT_LOCATION_RADIUS = 8;
const DEFAULT_LOCATION_STROKE_WIDTH = 2;
const DEFAULT_LOCATION_STROKE_COLOR: MapRgbaColor = [255, 255, 255, 255];
const DEFAULT_LABEL_FONT_SIZE = 13;
const DEFAULT_LABEL_COLOR: MapRgbaColor = [38, 43, 56, 255];
const DEFAULT_LABEL_FONT_FAMILY = '"Microsoft YaHei UI", sans-serif';
const DEFAULT_ICON_SIZE = 28;
const PAN_DRAG_THRESHOLD = 3;
const MAX_PIXI_RESOLUTION = 2;

interface ElementSize {
    width: number;
    height: number;
}

type BackgroundBounds = {
    x: number;
    y: number;
    width: number;
    height: number;
};

interface PixiViewportTransform {
    x: number;
    y: number;
    scale: number;
}

interface PixiPanState {
    pointerId: number;
    startClientX: number;
    startClientY: number;
    originViewBox: MapShapeEditorViewBox;
    hasMoved: boolean;
}

interface TooltipPosition {
    left: number;
    top: number;
}

export interface MapPixiPerfStats {
    shapeCount: number;
    vertexCount: number;
    visibleShapeCount: number;
    redrawShapeCount: number;
    redrawVertexCount: number;
    drawMs: number;
    hitTestMs: number;
    cullMs: number;
    cullCount: number;
    lodEstimateCount: number;
    visibleVertexCount: number;
    lodVertexCount: number;
    lodLevel: PixiLodLevel;
    pointerMoveCount: number;
    scale: number;
}

interface PixiPerfAccumulator {
    redrawShapeCount: number;
    redrawVertexCount: number;
    drawMs: number;
    hitTestMs: number;
    cullMs: number;
    cullCount: number;
    lodEstimateCount: number;
    pointerMoveCount: number;
}

export type MapPixiLodLevel = 'overview' | 'low' | 'medium' | 'high' | 'original';
export type MapPixiLodSetting = 'auto' | MapPixiLodLevel;
type PixiLodLevel = MapPixiLodLevel;

interface PixiPerfMeta {
    shapeCount: number;
    vertexCount: number;
    visibleShapeCount: number;
    visibleVertexCount: number;
    lodVertexCount: number;
    lodLevel: PixiLodLevel;
    scale: number;
}

interface PixiPerfRecorder {
    recordShapeRedraw: (pointCount: number, drawMs: number) => void;
    recordHitTest: (hitTestMs: number) => void;
    recordCull: (visibleShapeCount: number, cullMs: number) => void;
    recordLodEstimate: (visibleVertexCount: number, lodVertexCount: number, lodLevel: PixiLodLevel) => void;
    recordPointerMove: () => void;
}

interface PixiShapeBounds {
    minX: number;
    minY: number;
    maxX: number;
    maxY: number;
}

interface CompiledPixiShape {
    source: MapPreviewShape;
    flatPolygon: number[];
    lod: Record<PixiLodLevel, number[]>;
    bbox: PixiShapeBounds;
    pointCount: number;
    fillColor: number;
    fillAlpha: number;
    strokeColor: number;
    strokeAlpha: number;
}

interface PixiViewportCullBucket {
    key: string;
    x: number;
    y: number;
    scale: number;
}

const VIEWPORT_CULLING_PADDING_PIXELS = 128;
const VIEWPORT_CULLING_BUCKET_PIXELS = 64;
const VIEWPORT_CULLING_ZOOM_BUCKETS_PER_OCTAVE = 4;
const PIXI_POLYGON_LOD_LEVELS: PixiLodLevel[] = ['overview', 'low', 'medium', 'high', 'original'];
const PIXI_POLYGON_LOD_CONFIG: Record<PixiLodLevel, { tolerance: number; minPointCount: number }> = {
    overview: {tolerance: 6, minPointCount: 80},
    low: {tolerance: 1.2, minPointCount: 1200},
    medium: {tolerance: 0.65, minPointCount: 2200},
    high: {tolerance: 0.25, minPointCount: 4200},
    original: {tolerance: 0, minPointCount: 0},
};

interface MapPixiApplicationGuardProps {
    onContextLost: () => void;
    onContextRestored: () => void;
}

type MapPixiApplicationLike = {
    canvas?: HTMLCanvasElement | null;
    renderer?: {
        canvas?: HTMLCanvasElement | null;
    };
};

function resolvePixiApplicationCanvas(app: MapPixiApplicationLike | null | undefined): HTMLCanvasElement | null {
    if (!app) {
        return null;
    }

    const rendererCanvas = app.renderer?.canvas ?? null;
    if (rendererCanvas) {
        return rendererCanvas;
    }

    try {
        return app.canvas ?? null;
    } catch {
        return null;
    }
}

/** @deprecated 使用 {@link MapKeyLocationRenderMode}。 */
export type MapPixiKeyLocationRenderMode = MapKeyLocationRenderMode;

/** @deprecated 使用 {@link MapPreviewShapePickDetail} */
export type MapPixiPreviewShapePickDetail = MapPreviewShapePickDetail;
/** @deprecated 使用 {@link MapPreviewKeyLocationPickDetail} */
export type MapPixiPreviewKeyLocationPickDetail = MapPreviewKeyLocationPickDetail;
/** @deprecated 使用 {@link MapPreviewPickDetail} */
export type MapPixiPreviewPickDetail = MapPreviewPickDetail;
/** @deprecated 使用 {@link MapPreviewTooltip} */
export type MapPixiPreviewTooltip = MapPreviewTooltip;

export interface MapPixiPreviewOverlayContext {
    scene: MapPreviewScene;
    /** 当前 Pixi 场景容器到屏幕坐标的变换。 */
    viewportTransform: {
        x: number;
        y: number;
        scale: number;
    };
    /** 预览容器的屏幕像素尺寸。 */
    viewportSize: {
        width: number;
        height: number;
    };
}

export interface MapPixiPreviewProps {
    scene: MapPreviewScene | null;
    className?: string;
    style?: CSSProperties;
    emptyHint?: string;
    /** 是否显示关键地点文字标签，默认显示。 */
    showLabels?: boolean;
    /** 通用图形样式。优先使用该接口，散装样式 props 仅保留兼容。 */
    shapeStyle?: MapPreviewShapeStyle;
    /** 通用关键地点样式。优先使用该接口，散装样式 props 仅保留兼容。 */
    keyLocationStyle?: MapPreviewKeyLocationStyle;
    /** 通用标签样式。优先使用该接口，散装样式 props 仅保留兼容。 */
    labelStyle?: MapPreviewLabelStyle;
    /** @deprecated 使用 `shapeStyle.lineWidth`。 */
    polygonLineWidth?: number;
    /** @deprecated 使用 `keyLocationStyle.radius`。 */
    keyLocationRadius?: number;
    /** @deprecated 使用 `keyLocationStyle.strokeColor`。 */
    keyLocationStrokeColor?: MapRgbaColor;
    /**
     * @deprecated 使用 `keyLocationStyle.renderMode`。
     */
    keyLocationRenderMode?: MapPixiKeyLocationRenderMode;
    /** @deprecated 使用 `keyLocationStyle.iconSize`。 */
    iconSize?: number;
    /** @deprecated 使用 `labelStyle.fontSize`。 */
    labelFontSize?: number;
    /** @deprecated 使用 `labelStyle.color`。 */
    labelColor?: MapRgbaColor;
    /** @deprecated 使用 `labelStyle.fontFamily`。 */
    labelFontFamily?: string;
    /** 为 true 时关闭 Pixi 内置 tooltip。 */
    disableTooltip?: boolean;
    /**
     * 自定义 Pixi 悬浮 tooltip。返回 `undefined` 会使用默认 tooltip；返回 `null` 会禁用该对象 tooltip。
     * 返回字符串等同于 `{ text: string }`。
     */
    getTooltip?: (detail: MapPreviewPickDetail) => MapPreviewTooltip | string | null | undefined;
    /**
     * Pixi 专属场景滤镜，应用到内置图层和 `renderOverlay` 所在的场景容器。
     * 适合承接轻量后处理；自定义 shader / geometry 建议先通过 `renderOverlay` 封装为 React Pixi 子树。
     */
    sceneFilters?: Filter[];
    /**
     * 在内置 Pixi 图层之后渲染额外 React Pixi 子树。
     * 返回内容位于场景坐标系内，可直接使用 scene.canvas 坐标。
     */
    renderOverlay?: (context: MapPixiPreviewOverlayContext) => ReactNode;
    /** 多边形 LOD 档位。`auto` 会按当前缩放自动选择，固定档位用于调试和性能对比。 */
    lodLevel?: MapPixiLodSetting;
    /** 开发态性能统计开关。默认关闭，避免影响常规预览。 */
    debugPerf?: boolean;
    /** Pixi 性能统计回调。未提供时，开启 `debugPerf` 会输出到 console.debug。 */
    onPerfStats?: (stats: MapPixiPerfStats) => void;
    onPixiClick?: (detail: MapPreviewPickDetail) => void;
    onPixiHover?: (detail: MapPreviewPickDetail | null) => void;
    onShapeClick?: (detail: MapPreviewShapePickDetail) => void;
    onShapeHover?: (detail: MapPreviewShapePickDetail | null) => void;
    onKeyLocationClick?: (detail: MapPreviewKeyLocationPickDetail) => void;
    onKeyLocationHover?: (detail: MapPreviewKeyLocationPickDetail | null) => void;
    /** @deprecated 使用 `enablePanZoom` 和 `enablePicking` 分别控制预览交互能力。 */
    interactive?: boolean;
    /**
     * 开启预览模式下的滚轮缩放和拖拽平移。传入 syncViewBox 时会忽略该能力。
     * 未传入时回退到 `interactive`。
     */
    enablePanZoom?: boolean;
    /** 是否启用 Pixi picking、hover、click 与 tooltip。未传入时默认启用。 */
    enablePicking?: boolean;
    /**
     * 与 SVG 编辑器共享 viewBox，用于编辑模式下同步缩放和平移。
     * 为空时会按场景画布自动适配容器。
     */
    syncViewBox?: MapShapeEditorViewBox;
    /**
     * 预览视口变化回调。仅在 `interactive` 模式下内部管理视口时触发。
     * 若传入了 `syncViewBox`，该回调不会触发（视口由外部控制）。
     */
    onPreviewViewBoxChange?: (viewBox: MapShapeEditorViewBox) => void;
}

function normalizeElementSize(width: number, height: number): ElementSize {
    return {
        width: Number.isFinite(width) ? Math.max(0, Math.round(width)) : 0,
        height: Number.isFinite(height) ? Math.max(0, Math.round(height)) : 0,
    };
}

function getPixiResolution(): number {
    if (typeof window === 'undefined') {
        return 1;
    }

    return Math.max(1, Math.min(window.devicePixelRatio || 1, MAX_PIXI_RESOLUTION));
}

function useElementSize<T extends HTMLElement>() {
    const elementRef = useRef<T | null>(null);
    const [size, setSize] = useState<ElementSize>({width: 0, height: 0});

    useEffect(() => {
        const node = elementRef.current;
        if (!node) return;

        let frameId: number | null = null;

        const commitSize = (width: number, height: number) => {
            const nextSize = normalizeElementSize(width, height);
            setSize(currentSize => (
                currentSize.width === nextSize.width && currentSize.height === nextSize.height
                    ? currentSize
                    : nextSize
            ));
        };

        const scheduleSizeUpdate = (width: number, height: number) => {
            if (typeof window === 'undefined' || typeof window.requestAnimationFrame !== 'function') {
                commitSize(width, height);
                return;
            }

            if (frameId !== null) {
                window.cancelAnimationFrame(frameId);
            }

            frameId = window.requestAnimationFrame(() => {
                frameId = null;
                commitSize(width, height);
            });
        };

        const observer = new ResizeObserver(entries => {
            const entry = entries[0];
            if (!entry) return;

            scheduleSizeUpdate(entry.contentRect.width, entry.contentRect.height);
        });

        observer.observe(node);
        const rect = node.getBoundingClientRect();
        scheduleSizeUpdate(rect.width, rect.height);

        return () => {
            observer.disconnect();
            if (typeof window !== 'undefined' && typeof window.cancelAnimationFrame === 'function' && frameId !== null) {
                window.cancelAnimationFrame(frameId);
            }
        };
    }, []);

    return {elementRef, size};
}

function useImageNaturalSize(url: string | undefined): { width: number; height: number } | null {
    const [naturalSize, setNaturalSize] = useState<{ width: number; height: number } | null>(null);

    useEffect(() => {
        if (!url) {
            setNaturalSize(null);
            return;
        }

        let cancelled = false;
        const image = new Image();
        image.onload = () => {
            if (!cancelled) {
                setNaturalSize({width: image.naturalWidth, height: image.naturalHeight});
            }
        };
        image.onerror = () => {
            if (!cancelled) {
                setNaturalSize(null);
            }
        };
        image.src = url;

        return () => {
            cancelled = true;
        };
    }, [url]);

    return naturalSize;
}

function usePixiImageTexture(url: string | undefined): Texture {
    const [texture, setTexture] = useState<Texture>(Texture.EMPTY);

    useEffect(() => {
        if (!url) {
            setTexture(Texture.EMPTY);
            return undefined;
        }

        let cancelled = false;
        let activeTexture: Texture | null = null;
        const image = new Image();

        if (!url.startsWith('data:')) {
            image.crossOrigin = 'anonymous';
        }

        image.onload = () => {
            if (cancelled) {
                return;
            }

            activeTexture = Texture.from({resource: image}, true);
            setTexture(activeTexture);
        };
        image.onerror = () => {
            if (!cancelled) {
                setTexture(Texture.EMPTY);
            }
        };
        image.src = url;

        return () => {
            cancelled = true;
            if (activeTexture && activeTexture !== Texture.EMPTY && !activeTexture.destroyed) {
                activeTexture.destroy(true);
            }
        };
    }, [url]);

    return texture;
}

function colorToHex(color: MapRgbaColor): number {
    return (color[0] << 16) + (color[1] << 8) + color[2];
}

function colorToAlpha(color: MapRgbaColor): number {
    return Math.max(0, Math.min(1, color[3] / 255));
}

function normalizePositiveNumber(value: number | undefined, fallback: number): number {
    return typeof value === 'number' && Number.isFinite(value) ? Math.max(0, value) : fallback;
}

function createEmptyPerfAccumulator(): PixiPerfAccumulator {
    return {
        redrawShapeCount: 0,
        redrawVertexCount: 0,
        drawMs: 0,
        hitTestMs: 0,
        cullMs: 0,
        cullCount: 0,
        lodEstimateCount: 0,
        pointerMoveCount: 0,
    };
}

function getHighResolutionTime(): number {
    return typeof performance !== 'undefined' && typeof performance.now === 'function'
        ? performance.now()
        : Date.now();
}

function countSceneVertices(scene: MapPreviewScene | null): number {
    return scene?.shapes.reduce((total, shape) => total + shape.polygon.length, 0) ?? 0;
}

function usePixiPerfRecorder({
                                 enabled,
                                 scene,
                                 scale,
                                 onStats,
                             }: {
    enabled: boolean;
    scene: MapPreviewScene | null;
    scale: number;
    onStats?: (stats: MapPixiPerfStats) => void;
}): PixiPerfRecorder | undefined {
    const accumulatorRef = useRef<PixiPerfAccumulator>(createEmptyPerfAccumulator());
    const flushTimerRef = useRef<number | null>(null);
    const enabledRef = useRef(enabled);
    const onStatsRef = useRef(onStats);
    const vertexCount = useMemo(() => countSceneVertices(scene), [scene]);
    const latestMetaRef = useRef<PixiPerfMeta>({
        shapeCount: scene?.shapes.length ?? 0,
        vertexCount,
        visibleShapeCount: scene?.shapes.length ?? 0,
        visibleVertexCount: vertexCount,
        lodVertexCount: vertexCount,
        lodLevel: 'original',
        scale,
    });

    useEffect(() => {
        enabledRef.current = enabled;
        onStatsRef.current = onStats;
    }, [enabled, onStats]);

    useEffect(() => {
        latestMetaRef.current = {
            ...latestMetaRef.current,
            shapeCount: scene?.shapes.length ?? 0,
            vertexCount,
            scale,
        };
    }, [scale, scene?.shapes.length, vertexCount]);

    const flushStats = useCallback(() => {
        flushTimerRef.current = null;

        if (!enabledRef.current) {
            accumulatorRef.current = createEmptyPerfAccumulator();
            return;
        }

        const accumulator = accumulatorRef.current;
        const hasSamples = accumulator.redrawShapeCount > 0
            || accumulator.pointerMoveCount > 0
            || accumulator.hitTestMs > 0
            || accumulator.cullCount > 0
            || accumulator.lodEstimateCount > 0;

        if (!hasSamples) {
            return;
        }

        accumulatorRef.current = createEmptyPerfAccumulator();

        const stats: MapPixiPerfStats = {
            ...latestMetaRef.current,
            redrawShapeCount: accumulator.redrawShapeCount,
            redrawVertexCount: accumulator.redrawVertexCount,
            drawMs: Number(accumulator.drawMs.toFixed(2)),
            hitTestMs: Number(accumulator.hitTestMs.toFixed(2)),
            cullMs: Number(accumulator.cullMs.toFixed(2)),
            cullCount: accumulator.cullCount,
            lodEstimateCount: accumulator.lodEstimateCount,
            pointerMoveCount: accumulator.pointerMoveCount,
        };

        if (onStatsRef.current) {
            onStatsRef.current(stats);
            return;
        }

        console.debug('[MapPixiPreview perf]', stats);
    }, []);

    const scheduleFlush = useCallback(() => {
        if (!enabledRef.current || flushTimerRef.current !== null || typeof window === 'undefined') {
            return;
        }

        flushTimerRef.current = window.setTimeout(flushStats, 250);
    }, [flushStats]);

    useEffect(() => () => {
        if (flushTimerRef.current !== null && typeof window !== 'undefined') {
            window.clearTimeout(flushTimerRef.current);
        }
    }, []);

    return useMemo(() => {
        if (!enabled) {
            return undefined;
        }

        return {
            recordShapeRedraw: (pointCount: number, drawMs: number) => {
                const accumulator = accumulatorRef.current;
                accumulator.redrawShapeCount += 1;
                accumulator.redrawVertexCount += pointCount;
                accumulator.drawMs += drawMs;
                scheduleFlush();
            },
            recordPointerMove: () => {
                accumulatorRef.current.pointerMoveCount += 1;
                scheduleFlush();
            },
            recordHitTest: (hitTestMs: number) => {
                accumulatorRef.current.hitTestMs += hitTestMs;
                scheduleFlush();
            },
            recordCull: (visibleShapeCount: number, cullMs: number) => {
                const accumulator = accumulatorRef.current;
                accumulator.cullMs += cullMs;
                accumulator.cullCount += 1;
                latestMetaRef.current = {
                    ...latestMetaRef.current,
                    visibleShapeCount,
                };
                scheduleFlush();
            },
            recordLodEstimate: (visibleVertexCount, lodVertexCount, lodLevel) => {
                accumulatorRef.current.lodEstimateCount += 1;
                latestMetaRef.current = {
                    ...latestMetaRef.current,
                    visibleVertexCount,
                    lodVertexCount,
                    lodLevel,
                };
                scheduleFlush();
            },
        };
    }, [enabled, scheduleFlush]);
}

function shouldRenderKeyLocationAsIcon(
    location: MapPreviewKeyLocation,
    renderMode: MapPixiKeyLocationRenderMode,
): boolean {
    if (!location.icon?.url) {
        return false;
    }

    return renderMode === 'icon' || renderMode === 'auto';
}

function resolveIconSourceSize(location: MapPreviewKeyLocation, fallbackSize: number): {
    width: number;
    height: number
} {
    return {
        width: normalizePositiveNumber(location.icon?.width, fallbackSize) || fallbackSize,
        height: normalizePositiveNumber(location.icon?.height, fallbackSize) || fallbackSize,
    };
}

function resolveIconRenderSize(
    location: MapPreviewKeyLocation,
    iconSize: number,
    scale: number,
): { width: number; height: number } {
    const sourceSize = resolveIconSourceSize(location, DEFAULT_ICON_SIZE);
    const renderHeight = normalizePositiveNumber(location.iconSize, iconSize) / Math.max(scale, 0.01);
    const renderWidth = renderHeight * (sourceSize.width / Math.max(sourceSize.height, 1));

    return {
        width: renderWidth,
        height: renderHeight,
    };
}

function resolveIconAnchor(location: MapPreviewKeyLocation): { x: number; y: number } {
    const sourceSize = resolveIconSourceSize(location, DEFAULT_ICON_SIZE);
    const anchorX = normalizePositiveNumber(location.icon?.anchorX, sourceSize.width / 2);
    const anchorY = normalizePositiveNumber(location.icon?.anchorY, sourceSize.height / 2);

    return {
        x: Math.max(0, Math.min(1, anchorX / Math.max(sourceSize.width, 1))),
        y: Math.max(0, Math.min(1, anchorY / Math.max(sourceSize.height, 1))),
    };
}

function normalizeTooltip(
    value: MapPreviewTooltip | string | null | undefined,
): MapPreviewTooltip | null {
    if (!value) {
        return null;
    }

    if (typeof value === 'string') {
        return {text: value};
    }

    if (value.text || value.html) {
        return value;
    }

    return null;
}

function getDefaultTooltip(detail: MapPreviewPickDetail): MapPreviewTooltip | null {
    if (detail.kind === 'empty') {
        return null;
    }

    if (detail.kind === 'shape') {
        return {text: `图形：${detail.object.name}`};
    }

    return {text: `关键地点：${detail.object.name}\n类型：${detail.object.type}`};
}

function getEventScreenPoint(event: FederatedPointerEvent): { x: number; y: number } {
    return {
        x: event.global.x,
        y: event.global.y,
    };
}

function getEventCanvasCoordinate(
    event: FederatedPointerEvent,
    transform: PixiViewportTransform,
): [number, number] {
    const point = getEventScreenPoint(event);

    return [
        (point.x - transform.x) / Math.max(transform.scale, 0.01),
        (point.y - transform.y) / Math.max(transform.scale, 0.01),
    ];
}

function createEmptyPickDetail(
    transform: PixiViewportTransform,
    event: FederatedPointerEvent,
): MapPreviewEmptyPickDetail {
    const point = getEventScreenPoint(event);
    return {
        kind: 'empty',
        object: null,
        index: -1,
        layerId: 'fc-map-pixi-preview-empty',
        x: point.x,
        y: point.y,
        coordinate: getEventCanvasCoordinate(event, transform),
    };
}

function toScreenPoint(
    position: [number, number],
    transform: PixiViewportTransform,
): [number, number] {
    return [
        Math.round(transform.x + position[0] * transform.scale),
        Math.round(transform.y + position[1] * transform.scale),
    ];
}

function toViewBoxPoint(
    clientX: number,
    clientY: number,
    rect: DOMRect,
    viewBox: MapShapeEditorViewBox,
): { x: number; y: number } {
    return {
        x: viewBox.x + ((clientX - rect.left) / Math.max(rect.width, 1)) * viewBox.width,
        y: viewBox.y + ((clientY - rect.top) / Math.max(rect.height, 1)) * viewBox.height,
    };
}

function buildViewportTransform(
    canvas: MapEditorCanvas,
    size: ElementSize,
    syncViewBox?: MapShapeEditorViewBox,
): PixiViewportTransform {
    const viewBox = syncViewBox ?? createInitialMapShapeEditorViewBox(canvas);
    const scale = size.width / Math.max(viewBox.width, 1);

    return {
        x: -viewBox.x * scale,
        y: -viewBox.y * scale,
        scale,
    };
}

function computeBackgroundBounds(
    canvas: MapEditorCanvas,
    backgroundImage: MapPreviewBackgroundImage,
    naturalSize: { width: number; height: number } | null,
): BackgroundBounds {
    const fit = backgroundImage.fit ?? 'fill';
    if (fit === 'fill' || !naturalSize || naturalSize.width <= 0 || naturalSize.height <= 0) {
        return {x: 0, y: 0, width: canvas.width, height: canvas.height};
    }

    const canvasRatio = canvas.width / canvas.height;
    const imageRatio = naturalSize.width / naturalSize.height;
    let width: number;
    let height: number;

    if (fit === 'cover') {
        if (imageRatio > canvasRatio) {
            height = canvas.height;
            width = imageRatio * canvas.height;
        } else {
            width = canvas.width;
            height = canvas.width / imageRatio;
        }
    } else if (imageRatio > canvasRatio) {
        width = canvas.width;
        height = canvas.width / imageRatio;
    } else {
        height = canvas.height;
        width = imageRatio * canvas.height;
    }

    return {
        x: (canvas.width - width) / 2,
        y: (canvas.height - height) / 2,
        width,
        height,
    };
}

function flattenPolygon(polygon: [number, number][]): number[] {
    return polygon.flatMap(([x, y]) => [x, y]);
}

function getSquaredDistance(a: [number, number], b: [number, number]): number {
    const dx = a[0] - b[0];
    const dy = a[1] - b[1];
    return dx * dx + dy * dy;
}

function getSquaredDistanceToSegment(
    point: [number, number],
    start: [number, number],
    end: [number, number],
): number {
    const dx = end[0] - start[0];
    const dy = end[1] - start[1];

    if (dx === 0 && dy === 0) {
        return getSquaredDistance(point, start);
    }

    const t = Math.max(0, Math.min(1, ((point[0] - start[0]) * dx + (point[1] - start[1]) * dy) / (dx * dx + dy * dy)));
    const projection: [number, number] = [start[0] + t * dx, start[1] + t * dy];
    return getSquaredDistance(point, projection);
}

function simplifyPolylineDouglasPeucker(
    points: [number, number][],
    toleranceSquared: number,
): [number, number][] {
    if (points.length <= 2) {
        return points;
    }

    const keep = new Array<boolean>(points.length).fill(false);
    keep[0] = true;
    keep[points.length - 1] = true;

    const stack: Array<[number, number]> = [[0, points.length - 1]];
    while (stack.length > 0) {
        const [startIndex, endIndex] = stack.pop()!;
        let maxDistance = 0;
        let maxIndex = -1;

        for (let index = startIndex + 1; index < endIndex; index += 1) {
            const distance = getSquaredDistanceToSegment(points[index], points[startIndex], points[endIndex]);
            if (distance > maxDistance) {
                maxDistance = distance;
                maxIndex = index;
            }
        }

        if (maxIndex >= 0 && maxDistance > toleranceSquared) {
            keep[maxIndex] = true;
            stack.push([startIndex, maxIndex], [maxIndex, endIndex]);
        }
    }

    return points.filter((_, index) => keep[index]);
}

function samplePolygonEvenly(polygon: [number, number][], targetPointCount: number): [number, number][] {
    const count = Math.min(polygon.length, targetPointCount);
    if (polygon.length <= count) {
        return polygon;
    }

    const sampled: [number, number][] = [];
    let lastIndex = -1;
    for (let index = 0; index < count; index += 1) {
        const sourceIndex = Math.floor((index * polygon.length) / count);
        if (sourceIndex !== lastIndex) {
            sampled.push(polygon[sourceIndex]);
            lastIndex = sourceIndex;
        }
    }

    return sampled.length >= 3 ? sampled : polygon.slice(0, 3);
}

function simplifyPolygonDouglasPeucker(
    polygon: [number, number][],
    tolerance: number,
    minPointCount: number,
): [number, number][] {
    if (polygon.length <= 3 || tolerance <= 0) {
        return polygon;
    }

    let splitIndex = 1;
    let maxDistance = 0;
    for (let index = 1; index < polygon.length; index += 1) {
        const distance = getSquaredDistance(polygon[0], polygon[index]);
        if (distance > maxDistance) {
            maxDistance = distance;
            splitIndex = index;
        }
    }

    const toleranceSquared = tolerance * tolerance;
    const firstPath = simplifyPolylineDouglasPeucker(polygon.slice(0, splitIndex + 1), toleranceSquared);
    const secondPath = simplifyPolylineDouglasPeucker([...polygon.slice(splitIndex), polygon[0]], toleranceSquared);
    const simplified = firstPath.concat(secondPath.slice(1, -1));

    if (simplified.length < 3) {
        return polygon.slice(0, 3);
    }

    if (minPointCount > 0 && simplified.length < Math.min(polygon.length, minPointCount)) {
        return samplePolygonEvenly(polygon, minPointCount);
    }

    return simplified;
}

function computePolygonBounds(polygon: [number, number][]): PixiShapeBounds {
    if (polygon.length === 0) {
        return {minX: 0, minY: 0, maxX: 0, maxY: 0};
    }

    let minX = Number.POSITIVE_INFINITY;
    let minY = Number.POSITIVE_INFINITY;
    let maxX = Number.NEGATIVE_INFINITY;
    let maxY = Number.NEGATIVE_INFINITY;

    for (const [x, y] of polygon) {
        minX = Math.min(minX, x);
        minY = Math.min(minY, y);
        maxX = Math.max(maxX, x);
        maxY = Math.max(maxY, y);
    }

    return {minX, minY, maxX, maxY};
}

function isPointInBounds(point: [number, number], bounds: PixiShapeBounds): boolean {
    const [x, y] = point;
    return x >= bounds.minX && x <= bounds.maxX && y >= bounds.minY && y <= bounds.maxY;
}

function doBoundsIntersect(a: PixiShapeBounds, b: PixiShapeBounds): boolean {
    return a.minX <= b.maxX && a.maxX >= b.minX && a.minY <= b.maxY && a.maxY >= b.minY;
}

function computeViewportWorldBounds(
    transform: PixiViewportTransform | PixiViewportCullBucket,
    size: ElementSize,
): PixiShapeBounds {
    const scale = Math.max(transform.scale, 0.01);
    const padding = VIEWPORT_CULLING_PADDING_PIXELS / scale;

    return {
        minX: (-transform.x / scale) - padding,
        minY: (-transform.y / scale) - padding,
        maxX: ((size.width - transform.x) / scale) + padding,
        maxY: ((size.height - transform.y) / scale) + padding,
    };
}

function computeViewportCullKey(transform: PixiViewportTransform): string {
    const bucketX = Math.floor(transform.x / VIEWPORT_CULLING_BUCKET_PIXELS);
    const bucketY = Math.floor(transform.y / VIEWPORT_CULLING_BUCKET_PIXELS);
    const scaleBucket = Math.round(
        Math.log2(Math.max(transform.scale, 0.01)) * VIEWPORT_CULLING_ZOOM_BUCKETS_PER_OCTAVE,
    );

    return `${bucketX}:${bucketY}:${scaleBucket}`;
}

function parseViewportCullKey(key: string): PixiViewportCullBucket {
    const [bucketX = 0, bucketY = 0, scaleBucket = 0] = key
        .split(':')
        .map(value => Number.parseInt(value, 10));

    return {
        key,
        x: bucketX * VIEWPORT_CULLING_BUCKET_PIXELS,
        y: bucketY * VIEWPORT_CULLING_BUCKET_PIXELS,
        scale: Math.pow(2, scaleBucket / VIEWPORT_CULLING_ZOOM_BUCKETS_PER_OCTAVE),
    };
}

function isPointInPolygon(point: [number, number], polygon: [number, number][]): boolean {
    const [x, y] = point;
    let inside = false;

    for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i, i += 1) {
        const [xi, yi] = polygon[i];
        const [xj, yj] = polygon[j];
        const intersects = ((yi > y) !== (yj > y))
            && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi;

        if (intersects) {
            inside = !inside;
        }
    }

    return inside;
}

function findCompiledShapeAtPoint(
    shapes: CompiledPixiShape[],
    point: [number, number],
): { shape: CompiledPixiShape; index: number } | null {
    for (let index = shapes.length - 1; index >= 0; index -= 1) {
        const shape = shapes[index];
        if (isPointInBounds(point, shape.bbox) && isPointInPolygon(point, shape.source.polygon)) {
            return {shape, index};
        }
    }

    return null;
}

function computePixiLodZoomRatio(
    scene: MapPreviewScene,
    transform: PixiViewportTransform,
    size: ElementSize,
): number {
    return (transform.scale * scene.canvas.width) / Math.max(size.width, 1);
}

function selectPixiShapeLodLevel(zoomRatio: number): PixiLodLevel {
    if (zoomRatio <= 1.05) {
        return 'overview';
    }

    if (zoomRatio <= 1.75) {
        return 'low';
    }

    if (zoomRatio <= 3) {
        return 'medium';
    }

    if (zoomRatio <= 6) {
        return 'high';
    }

    return 'original';
}

function buildPixiShapeLods(polygon: [number, number][], flatPolygon: number[]): Record<PixiLodLevel, number[]> {
    const lods = {} as Record<PixiLodLevel, number[]>;
    for (const lodLevel of PIXI_POLYGON_LOD_LEVELS) {
        const config = PIXI_POLYGON_LOD_CONFIG[lodLevel];
        lods[lodLevel] = lodLevel === 'original'
            ? flatPolygon
            : flattenPolygon(simplifyPolygonDouglasPeucker(polygon, config.tolerance, config.minPointCount));
    }

    return lods;
}

function resolvePixiLodLevel(
    lodLevel: MapPixiLodSetting,
    scene: MapPreviewScene,
    transform: PixiViewportTransform,
    size: ElementSize,
): PixiLodLevel {
    if (lodLevel !== 'auto') {
        return lodLevel;
    }

    return selectPixiShapeLodLevel(computePixiLodZoomRatio(scene, transform, size));
}

function countLodVertices(shapes: CompiledPixiShape[], lodLevel: PixiLodLevel): number {
    return shapes.reduce((total, shape) => total + shape.lod[lodLevel].length / 2, 0);
}

function getPixiShapeLodPolygon(shape: CompiledPixiShape, lodLevel: PixiLodLevel): number[] {
    return shape.lod[lodLevel];
}

function compilePixiShape(shape: MapPreviewShape): CompiledPixiShape {
    const flatPolygon = flattenPolygon(shape.polygon);

    return {
        source: shape,
        flatPolygon,
        lod: buildPixiShapeLods(shape.polygon, flatPolygon),
        bbox: computePolygonBounds(shape.polygon),
        pointCount: shape.polygon.length,
        fillColor: colorToHex(shape.fillColor),
        fillAlpha: colorToAlpha(shape.fillColor),
        strokeColor: colorToHex(shape.lineColor),
        strokeAlpha: colorToAlpha(shape.lineColor),
    };
}

function drawShapeFill(
    graphics: Graphics,
    shape: CompiledPixiShape,
    polygon: number[],
) {
    graphics.clear();
    if (polygon.length < 6) {
        return;
    }

    graphics
        .poly(polygon, true)
        .fill({
            color: shape.fillColor,
            alpha: shape.fillAlpha,
        });
}

function drawShapeStroke(
    graphics: Graphics,
    shape: CompiledPixiShape,
    polygon: number[],
    scale: number,
    polygonLineWidth: number,
    hovered: boolean,
) {
    graphics.clear();
    if (polygon.length < 6) {
        return;
    }

    const strokeWidth = (normalizePositiveNumber(polygonLineWidth, 2) + (hovered ? 1 : 0)) / Math.max(scale, 0.01);

    graphics
        .poly(polygon, true)
        .stroke({
            width: strokeWidth,
            color: shape.strokeColor,
            alpha: shape.strokeAlpha,
        });
}

function drawKeyLocationCircle(
    graphics: Graphics,
    location: MapPreviewKeyLocation,
    scale: number,
    keyLocationRadius: number,
    keyLocationStrokeColor: MapRgbaColor,
    keyLocationStrokeWidth: number,
    hovered: boolean,
) {
    graphics.clear();
    const radius = (normalizePositiveNumber(keyLocationRadius, DEFAULT_LOCATION_RADIUS) + (hovered ? 1 : 0)) / Math.max(scale, 0.01);
    const strokeWidth = (
        normalizePositiveNumber(keyLocationStrokeWidth, DEFAULT_LOCATION_STROKE_WIDTH) + (hovered ? 1 : 0)
    ) / Math.max(scale, 0.01);

    graphics
        .circle(location.position[0], location.position[1], radius)
        .fill({
            color: colorToHex(location.color),
            alpha: colorToAlpha(location.color),
        })
        .stroke({
            width: strokeWidth,
            color: colorToHex(keyLocationStrokeColor),
            alpha: colorToAlpha(keyLocationStrokeColor),
        });
}

function MapPixiBackground({
                               backgroundImage,
                               bounds,
                           }: {
    backgroundImage: MapPreviewBackgroundImage;
    bounds: BackgroundBounds;
}) {
    const texture = usePixiImageTexture(backgroundImage.url);

    return (
        <pixiSprite
            texture={texture}
            x={bounds.x}
            y={bounds.y}
            width={bounds.width}
            height={bounds.height}
            alpha={backgroundImage.opacity ?? 1}
        />
    );
}

function MapPixiShape({
                          shape,
                          lodLevel,
                          transform,
                          polygonLineWidth,
                          hovered,
                          perfRecorder,
                      }: {
    shape: CompiledPixiShape;
    lodLevel: PixiLodLevel;
    transform: PixiViewportTransform;
    polygonLineWidth: number;
    hovered: boolean;
    perfRecorder?: PixiPerfRecorder;
}) {
    const polygon = getPixiShapeLodPolygon(shape, lodLevel);
    const polygonVertexCount = polygon.length / 2;
    const drawFill = useCallback((graphics: Graphics) => {
        const startedAt = perfRecorder ? getHighResolutionTime() : 0;
        drawShapeFill(graphics, shape, polygon);
        if (perfRecorder) {
            perfRecorder.recordShapeRedraw(polygonVertexCount, getHighResolutionTime() - startedAt);
        }
    }, [perfRecorder, polygon, polygonVertexCount, shape]);
    const drawStroke = useCallback((graphics: Graphics) => {
        const startedAt = perfRecorder ? getHighResolutionTime() : 0;
        drawShapeStroke(graphics, shape, polygon, transform.scale, polygonLineWidth, hovered);
        if (perfRecorder) {
            perfRecorder.recordShapeRedraw(polygonVertexCount, getHighResolutionTime() - startedAt);
        }
    }, [hovered, perfRecorder, polygon, polygonLineWidth, polygonVertexCount, shape, transform.scale]);

    return (
        <>
            <pixiGraphics draw={drawFill}/>
            <pixiGraphics draw={drawStroke}/>
        </>
    );
}

function MapPixiKeyLocationCircle({
                                      location,
                                      index,
                                      transform,
                                      keyLocationRadius,
                                      keyLocationStrokeColor,
                                      keyLocationStrokeWidth,
                                      enablePicking,
                                      hovered,
                                      onClick,
                                      onHover,
                                      onMove,
                                      onOut,
                                  }: {
    location: MapPreviewKeyLocation;
    index: number;
    transform: PixiViewportTransform;
    keyLocationRadius: number;
    keyLocationStrokeColor: MapRgbaColor;
    keyLocationStrokeWidth: number;
    enablePicking: boolean;
    hovered: boolean;
    onClick: (detail: MapPreviewKeyLocationPickDetail, event: FederatedPointerEvent) => void;
    onHover: (detail: MapPreviewKeyLocationPickDetail, event: FederatedPointerEvent) => void;
    onMove: (detail: MapPreviewKeyLocationPickDetail, event: FederatedPointerEvent) => void;
    onOut: () => void;
}) {
    const radius = normalizePositiveNumber(keyLocationRadius, DEFAULT_LOCATION_RADIUS) / Math.max(transform.scale, 0.01);
    const hitArea = useMemo(() => new Circle(location.position[0], location.position[1], Math.max(radius, 6 / Math.max(transform.scale, 0.01))), [location.position, radius, transform.scale]);
    const draw = useCallback((graphics: Graphics) => {
        drawKeyLocationCircle(
            graphics,
            location,
            transform.scale,
            keyLocationRadius,
            keyLocationStrokeColor,
            keyLocationStrokeWidth,
            hovered,
        );
    }, [hovered, keyLocationRadius, keyLocationStrokeColor, keyLocationStrokeWidth, location, transform.scale]);
    const createDetail = useCallback((event: FederatedPointerEvent): MapPreviewKeyLocationPickDetail => {
        const point = getEventScreenPoint(event);
        return {
            kind: 'keyLocation',
            object: location,
            index,
            layerId: 'fc-map-pixi-preview-key-locations',
            x: point.x,
            y: point.y,
            coordinate: getEventCanvasCoordinate(event, transform),
        };
    }, [index, location, transform]);

    return (
        <pixiGraphics
            draw={draw}
            eventMode={enablePicking ? 'static' : 'none'}
            cursor={enablePicking ? 'pointer' : undefined}
            hitArea={hitArea}
            onClick={(event: FederatedPointerEvent) => {
                event.stopPropagation();
                onClick(createDetail(event), event);
            }}
            onPointerOver={(event: FederatedPointerEvent) => {
                event.stopPropagation();
                onHover(createDetail(event), event);
            }}
            onPointerMove={(event: FederatedPointerEvent) => {
                event.stopPropagation();
                onMove(createDetail(event), event);
            }}
            onPointerOut={(event: FederatedPointerEvent) => {
                event.stopPropagation();
                onOut();
            }}
        />
    );
}

function MapPixiKeyLocationIcon({
                                    location,
                                    index,
                                    iconSize,
                                    transform,
                                    enablePicking,
                                    hovered,
                                    onClick,
                                    onHover,
                                    onMove,
                                    onOut,
                                }: {
    location: MapPreviewKeyLocation;
    index: number;
    iconSize: number;
    transform: PixiViewportTransform;
    enablePicking: boolean;
    hovered: boolean;
    onClick: (detail: MapPreviewKeyLocationPickDetail, event: FederatedPointerEvent) => void;
    onHover: (detail: MapPreviewKeyLocationPickDetail, event: FederatedPointerEvent) => void;
    onMove: (detail: MapPreviewKeyLocationPickDetail, event: FederatedPointerEvent) => void;
    onOut: () => void;
}) {
    const texture = usePixiImageTexture(location.icon?.url);
    const renderSize = useMemo(() => (
        resolveIconRenderSize(location, iconSize, transform.scale)
    ), [iconSize, location, transform.scale]);
    const anchor = useMemo(() => resolveIconAnchor(location), [location]);
    const hitArea = useMemo(() => new Rectangle(
        -anchor.x * renderSize.width,
        -anchor.y * renderSize.height,
        renderSize.width,
        renderSize.height,
    ), [anchor.x, anchor.y, renderSize.height, renderSize.width]);
    const createDetail = useCallback((event: FederatedPointerEvent): MapPreviewKeyLocationPickDetail => {
        const point = getEventScreenPoint(event);
        return {
            kind: 'keyLocation',
            object: location,
            index,
            layerId: 'fc-map-pixi-preview-key-location-icons',
            x: point.x,
            y: point.y,
            coordinate: getEventCanvasCoordinate(event, transform),
        };
    }, [index, location, transform]);

    return (
        <pixiContainer
            x={location.position[0]}
            y={location.position[1]}
            eventMode={enablePicking ? 'static' : 'none'}
            cursor={enablePicking ? 'pointer' : undefined}
            hitArea={hitArea}
            onClick={(event: FederatedPointerEvent) => {
                event.stopPropagation();
                onClick(createDetail(event), event);
            }}
            onPointerOver={(event: FederatedPointerEvent) => {
                event.stopPropagation();
                onHover(createDetail(event), event);
            }}
            onPointerMove={(event: FederatedPointerEvent) => {
                event.stopPropagation();
                onMove(createDetail(event), event);
            }}
            onPointerOut={(event: FederatedPointerEvent) => {
                event.stopPropagation();
                onOut();
            }}
            scale={hovered ? 1.08 : 1}
        >
            <pixiSprite
                texture={texture}
                width={renderSize.width}
                height={renderSize.height}
                anchor={anchor}
            />
        </pixiContainer>
    );
}

function MapPixiEmptyHitArea({
                                 scene,
                                 transform,
                                 enablePicking,
                                 onClick,
                                 onHover,
                                 onMove,
                                 onOut,
                             }: {
    scene: MapPreviewScene;
    transform: PixiViewportTransform;
    enablePicking: boolean;
    onClick: (detail: MapPreviewEmptyPickDetail, event: FederatedPointerEvent) => void;
    onHover: (detail: MapPreviewEmptyPickDetail, event: FederatedPointerEvent) => void;
    onMove: (detail: MapPreviewEmptyPickDetail, event: FederatedPointerEvent) => void;
    onOut: () => void;
}) {
    const hitArea = useMemo(() => new Rectangle(0, 0, scene.canvas.width, scene.canvas.height), [scene.canvas.height, scene.canvas.width]);
    const createDetail = useCallback((event: FederatedPointerEvent) => createEmptyPickDetail(transform, event), [transform]);

    return (
        <pixiContainer
            eventMode={enablePicking ? 'static' : 'none'}
            hitArea={hitArea}
            onClick={(event: FederatedPointerEvent) => onClick(createDetail(event), event)}
            onPointerOver={(event: FederatedPointerEvent) => onHover(createDetail(event), event)}
            onPointerMove={(event: FederatedPointerEvent) => onMove(createDetail(event), event)}
            onPointerOut={onOut}
        />
    );
}

function MapPixiShapeHitLayer({
                                  scene,
                                  shapes,
                                  transform,
                                  enablePicking,
                                  onClick,
                                  onHover,
                                  onMove,
                                  onOut,
                                  perfRecorder,
                              }: {
    scene: MapPreviewScene;
    shapes: CompiledPixiShape[];
    transform: PixiViewportTransform;
    enablePicking: boolean;
    onClick: (detail: MapPreviewPickDetail, event: FederatedPointerEvent) => void;
    onHover: (detail: MapPreviewPickDetail, event: FederatedPointerEvent) => void;
    onMove: (detail: MapPreviewPickDetail, event: FederatedPointerEvent) => void;
    onOut: () => void;
    perfRecorder?: PixiPerfRecorder;
}) {
    const hoverKeyRef = useRef<string>('empty');
    const hitArea = useMemo(() => new Rectangle(0, 0, scene.canvas.width, scene.canvas.height), [scene.canvas.height, scene.canvas.width]);
    const createDetail = useCallback((event: FederatedPointerEvent): MapPreviewPickDetail => {
        const startedAt = perfRecorder ? getHighResolutionTime() : 0;
        const coordinate = getEventCanvasCoordinate(event, transform);
        const hit = findCompiledShapeAtPoint(shapes, coordinate);
        if (perfRecorder) {
            perfRecorder.recordHitTest(getHighResolutionTime() - startedAt);
        }

        if (!hit) {
            return createEmptyPickDetail(transform, event);
        }

        const point = getEventScreenPoint(event);
        return {
            kind: 'shape',
            object: hit.shape.source,
            index: hit.index,
            layerId: 'fc-map-pixi-preview-polygons',
            x: point.x,
            y: point.y,
            coordinate,
        };
    }, [perfRecorder, shapes, transform]);
    const handleMove = useCallback((event: FederatedPointerEvent) => {
        const detail = createDetail(event);
        const nextHoverKey = detail.kind === 'shape' ? `shape:${detail.object.id}` : 'empty';

        if (hoverKeyRef.current !== nextHoverKey) {
            hoverKeyRef.current = nextHoverKey;
            onHover(detail, event);
        }

        onMove(detail, event);
    }, [createDetail, onHover, onMove]);
    const handleOut = useCallback(() => {
        hoverKeyRef.current = 'empty';
        onOut();
    }, [onOut]);

    return (
        <pixiContainer
            eventMode={enablePicking ? 'static' : 'none'}
            hitArea={hitArea}
            onClick={(event: FederatedPointerEvent) => {
                onClick(createDetail(event), event);
            }}
            onPointerOver={handleMove}
            onPointerMove={handleMove}
            onPointerOut={handleOut}
        />
    );
}

function MapPixiScene({
                          scene,
                          showLabels,
                          transform,
                          size,
                          enablePicking,
                          polygonLineWidth,
                          keyLocationRadius,
                          keyLocationStrokeColor,
                          keyLocationStrokeWidth,
                          keyLocationRenderMode,
                          iconSize,
                          labelFontSize,
                          labelColor,
                          labelFontFamily,
                          labelFontWeight,
                          hoveredDetail,
                          onPickClick,
                          onPickHover,
                          onPickMove,
                          onPickOut,
                          sceneFilters,
                          renderOverlay,
                          lodLevel,
                          perfRecorder,
                      }: {
    scene: MapPreviewScene;
    showLabels: boolean;
    transform: PixiViewportTransform;
    size: ElementSize;
    enablePicking: boolean;
    polygonLineWidth: number;
    keyLocationRadius: number;
    keyLocationStrokeColor: MapRgbaColor;
    keyLocationStrokeWidth: number;
    keyLocationRenderMode: MapPixiKeyLocationRenderMode;
    iconSize: number;
    labelFontSize: number;
    labelColor: MapRgbaColor;
    labelFontFamily: string;
    labelFontWeight: string;
    hoveredDetail: MapPreviewPickDetail | null;
    onPickClick: (detail: MapPreviewPickDetail, event: FederatedPointerEvent) => void;
    onPickHover: (detail: MapPreviewPickDetail, event: FederatedPointerEvent) => void;
    onPickMove: (detail: MapPreviewPickDetail, event: FederatedPointerEvent) => void;
    onPickOut: () => void;
    sceneFilters?: Filter[];
    renderOverlay?: (context: MapPixiPreviewOverlayContext) => ReactNode;
    lodLevel: MapPixiLodSetting;
    perfRecorder?: PixiPerfRecorder;
}) {
    const backgroundImage = scene.backgroundImage;
    const naturalSize = useImageNaturalSize(
        backgroundImage?.url && (backgroundImage.fit ?? 'fill') !== 'fill'
            ? backgroundImage.url
            : undefined,
    );
    const backgroundBounds = useMemo(() => (
        backgroundImage
            ? computeBackgroundBounds(scene.canvas, backgroundImage, naturalSize)
            : null
    ), [backgroundImage, naturalSize, scene.canvas]);
    const compiledShapes = useMemo(() => scene.shapes.map(compilePixiShape), [scene.shapes]);
    const viewportCullKey = useMemo(() => computeViewportCullKey(transform), [transform]);
    const viewportCullBucket = useMemo(() => parseViewportCullKey(viewportCullKey), [viewportCullKey]);
    const viewportWorldBounds = useMemo(() => (
        computeViewportWorldBounds(viewportCullBucket, size)
    ), [size, viewportCullBucket]);
    const visibleShapeResult = useMemo(() => {
        const startedAt = perfRecorder ? getHighResolutionTime() : 0;
        const shapes = compiledShapes.filter(shape => doBoundsIntersect(shape.bbox, viewportWorldBounds));

        return {
            shapes,
            cullMs: perfRecorder ? getHighResolutionTime() - startedAt : 0,
        };
    }, [compiledShapes, perfRecorder, viewportWorldBounds]);
    const visibleShapes = visibleShapeResult.shapes;
    const visibleVertexCount = useMemo(() => (
        visibleShapes.reduce((total, shape) => total + shape.pointCount, 0)
    ), [visibleShapes]);
    const resolvedLodLevel = resolvePixiLodLevel(lodLevel, scene, transform, size);
    const lodVertexCount = useMemo(() => (
        countLodVertices(visibleShapes, resolvedLodLevel)
    ), [resolvedLodLevel, visibleShapes]);

    useEffect(() => {
        perfRecorder?.recordCull(visibleShapes.length, visibleShapeResult.cullMs);
    }, [perfRecorder, visibleShapeResult.cullMs, visibleShapes.length]);

    useEffect(() => {
        perfRecorder?.recordLodEstimate(visibleVertexCount, lodVertexCount, resolvedLodLevel);
    }, [lodVertexCount, perfRecorder, resolvedLodLevel, visibleVertexCount]);

    const circleKeyLocationItems = useMemo(() => scene.keyLocations
        .map((location, index) => ({location, index}))
        .filter(({location}) => (
            keyLocationRenderMode === 'circle'
            || !shouldRenderKeyLocationAsIcon(location, keyLocationRenderMode)
        )), [keyLocationRenderMode, scene.keyLocations]);
    const iconKeyLocationItems = useMemo(() => scene.keyLocations
        .map((location, index) => ({location, index}))
        .filter(({location}) => shouldRenderKeyLocationAsIcon(location, keyLocationRenderMode)), [keyLocationRenderMode, scene.keyLocations]);
    const labelStyle = useMemo<TextStyleOptions>(() => ({
        fontFamily: labelFontFamily,
        fontSize: normalizePositiveNumber(labelFontSize, DEFAULT_LABEL_FONT_SIZE),
        fill: colorToHex(labelColor),
        fontWeight: labelFontWeight as TextStyleOptions['fontWeight'],
        align: 'center',
    }), [labelColor, labelFontFamily, labelFontSize, labelFontWeight]);
    const getLabelOffset = useCallback((location: MapPreviewKeyLocation) => {
        if (shouldRenderKeyLocationAsIcon(location, keyLocationRenderMode)) {
            const markerSize = normalizePositiveNumber(location.iconSize, iconSize);
            return Math.max(markerSize / 2 + 8, 18);
        }

        return 18;
    }, [iconSize, keyLocationRenderMode]);

    return (
        <pixiContainer filters={sceneFilters}>
            <pixiContainer x={transform.x} y={transform.y} scale={transform.scale}>
                <MapPixiEmptyHitArea
                    scene={scene}
                    transform={transform}
                    enablePicking={enablePicking}
                    onClick={onPickClick}
                    onHover={onPickHover}
                    onMove={onPickMove}
                    onOut={onPickOut}
                />
                {backgroundImage && backgroundBounds && (
                    <MapPixiBackground backgroundImage={backgroundImage} bounds={backgroundBounds}/>
                )}
                {visibleShapes.map(shape => (
                    <MapPixiShape
                        key={shape.source.id}
                        shape={shape}
                        lodLevel={resolvedLodLevel}
                        transform={transform}
                        polygonLineWidth={polygonLineWidth}
                        hovered={hoveredDetail?.kind === 'shape' && hoveredDetail.object.id === shape.source.id}
                        perfRecorder={perfRecorder}
                    />
                ))}
                <MapPixiShapeHitLayer
                    scene={scene}
                    shapes={visibleShapes}
                    transform={transform}
                    enablePicking={enablePicking}
                    onClick={onPickClick}
                    onHover={onPickHover}
                    onMove={onPickMove}
                    onOut={onPickOut}
                    perfRecorder={perfRecorder}
                />
                {circleKeyLocationItems.map(({location, index}) => (
                    <MapPixiKeyLocationCircle
                        key={location.id}
                        location={location}
                        index={index}
                        transform={transform}
                        keyLocationRadius={keyLocationRadius}
                        keyLocationStrokeColor={keyLocationStrokeColor}
                        keyLocationStrokeWidth={keyLocationStrokeWidth}
                        enablePicking={enablePicking}
                        hovered={hoveredDetail?.kind === 'keyLocation' && hoveredDetail.object.id === location.id}
                        onClick={onPickClick}
                        onHover={onPickHover}
                        onMove={onPickMove}
                        onOut={onPickOut}
                    />
                ))}
                {iconKeyLocationItems.map(({location, index}) => (
                    <MapPixiKeyLocationIcon
                        key={location.id}
                        location={location}
                        index={index}
                        iconSize={iconSize}
                        transform={transform}
                        enablePicking={enablePicking}
                        hovered={hoveredDetail?.kind === 'keyLocation' && hoveredDetail.object.id === location.id}
                        onClick={onPickClick}
                        onHover={onPickHover}
                        onMove={onPickMove}
                        onOut={onPickOut}
                    />
                ))}
                {renderOverlay?.({
                    scene,
                    viewportTransform: transform,
                    viewportSize: size,
                })}
            </pixiContainer>
            {showLabels && scene.keyLocations.map(location => {
                const [screenX, screenY] = toScreenPoint(location.position, transform);

                return (
                    <pixiText
                        key={location.id}
                        text={location.name}
                        x={screenX}
                        y={screenY - getLabelOffset(location)}
                        anchor={0.5}
                        alpha={colorToAlpha(labelColor)}
                        style={labelStyle}
                    />
                );
            })}
        </pixiContainer>
    );
}

function MapPixiApplicationGuard({
                                      onContextLost,
                                      onContextRestored,
                                  }: MapPixiApplicationGuardProps) {
    const {app} = useApplication() as { app?: MapPixiApplicationLike | null };

    useEffect(() => {
        const canvas = resolvePixiApplicationCanvas(app);
        if (!canvas || typeof canvas.addEventListener !== 'function') {
            return undefined;
        }

        const handleContextLost = (event: Event) => {
            event.preventDefault();
            onContextLost();
        };
        const handleContextRestored = () => {
            onContextRestored();
        };

        canvas.addEventListener('webglcontextlost', handleContextLost);
        canvas.addEventListener('webglcontextrestored', handleContextRestored);

        return () => {
            canvas.removeEventListener('webglcontextlost', handleContextLost);
            canvas.removeEventListener('webglcontextrestored', handleContextRestored);
        };
    }, [app, onContextLost, onContextRestored]);

    return null;
}

export function MapPixiPreview({
                                   scene,
                                   className,
                                   style,
                                   emptyHint = '提交后将在这里显示后端回传的 Pixi 结果。',
                                   showLabels = true,
                                   shapeStyle,
                                   keyLocationStyle,
                                   labelStyle,
                                   polygonLineWidth = 2,
                                   keyLocationRadius = DEFAULT_LOCATION_RADIUS,
                                   keyLocationStrokeColor = DEFAULT_LOCATION_STROKE_COLOR,
                                   keyLocationRenderMode = 'auto',
                                   iconSize = DEFAULT_ICON_SIZE,
                                   labelFontSize = DEFAULT_LABEL_FONT_SIZE,
                                   labelColor = DEFAULT_LABEL_COLOR,
                                   labelFontFamily = DEFAULT_LABEL_FONT_FAMILY,
                                   disableTooltip = false,
                                   getTooltip,
                                   sceneFilters,
                                   renderOverlay,
                                   lodLevel = 'auto',
                                   debugPerf = false,
                                   onPerfStats,
                                   onPixiClick,
                                   onPixiHover,
                                   onShapeClick,
                                   onShapeHover,
                                   onKeyLocationClick,
                                   onKeyLocationHover,
                                   interactive = false,
                                   enablePanZoom,
                                   enablePicking = true,
                                   syncViewBox,
                                   onPreviewViewBoxChange,
                               }: MapPixiPreviewProps) {
    const {elementRef, size} = useElementSize<HTMLDivElement>();
    const tooltipRef = useRef<HTMLDivElement | null>(null);
    const suppressPickClickRef = useRef(false);
    const [hoveredDetail, setHoveredDetail] = useState<MapPreviewPickDetail | null>(null);
    const [tooltipState, setTooltipState] = useState<{
        tooltip: MapPreviewTooltip;
        x: number;
        y: number;
    } | null>(null);
    const [tooltipPosition, setTooltipPosition] = useState<TooltipPosition | null>(null);
    const [interactiveViewBox, setInteractiveViewBox] = useState<MapShapeEditorViewBox | null>(null);
    const [panState, setPanState] = useState<PixiPanState | null>(null);
    const [shouldMountApplication, setShouldMountApplication] = useState(false);
    const [contextLost, setContextLost] = useState(false);
    const [contextRevision, setContextRevision] = useState(0);
    const hasScene = Boolean(scene);
    const hasRenderableSize = size.width >= MIN_RENDER_SIZE && size.height >= MIN_RENDER_SIZE;
    const panZoomEnabled = enablePanZoom ?? interactive;
    const pickingEnabled = enablePicking;
    const shouldUseInteractiveViewBox = Boolean(panZoomEnabled && !syncViewBox && scene);
    const pixiResolution = getPixiResolution();
    const resolvedPolygonLineWidth = shapeStyle?.lineWidth ?? polygonLineWidth;
    const resolvedKeyLocationRadius = keyLocationStyle?.radius ?? keyLocationRadius;
    const resolvedKeyLocationStrokeColor = keyLocationStyle?.showStroke === false
        ? [keyLocationStrokeColor[0], keyLocationStrokeColor[1], keyLocationStrokeColor[2], 0] as MapRgbaColor
        : keyLocationStyle?.strokeColor ?? keyLocationStrokeColor;
    const resolvedKeyLocationStrokeWidth = keyLocationStyle?.strokeWidth ?? DEFAULT_LOCATION_STROKE_WIDTH;
    const resolvedKeyLocationRenderMode = keyLocationStyle?.renderMode ?? keyLocationRenderMode;
    const resolvedIconSize = keyLocationStyle?.iconSize ?? iconSize;
    const resolvedLabelFontSize = labelStyle?.fontSize ?? labelFontSize;
    const resolvedLabelColor = labelStyle?.color ?? labelColor;
    const resolvedLabelFontFamily = labelStyle?.fontFamily ?? labelFontFamily;
    const resolvedLabelFontWeight = labelStyle?.fontWeight ?? '600';
    const effectiveSyncViewBox = syncViewBox ?? (shouldUseInteractiveViewBox && scene
        ? interactiveViewBox ?? createInitialMapShapeEditorViewBox(scene.canvas)
        : undefined);
    const transform = useMemo(() => (
        scene && hasRenderableSize
            ? buildViewportTransform(scene.canvas, size, effectiveSyncViewBox)
            : null
    ), [effectiveSyncViewBox, hasRenderableSize, scene, size]);
    const perfRecorder = usePixiPerfRecorder({
        enabled: debugPerf,
        scene,
        scale: transform?.scale ?? 1,
        onStats: onPerfStats,
    });

    useEffect(() => {
        if (!hasScene) {
            setShouldMountApplication(false);
            setContextLost(false);
            return undefined;
        }

        let frameId: number | null = null;
        let timeoutId: number | null = null;
        const commitMount = () => {
            frameId = null;
            timeoutId = null;
            setShouldMountApplication(true);
        };

        if (typeof window !== 'undefined' && typeof window.requestAnimationFrame === 'function') {
            frameId = window.requestAnimationFrame(commitMount);
        } else if (typeof window !== 'undefined') {
            timeoutId = window.setTimeout(commitMount, 0);
        } else {
            commitMount();
        }

        return () => {
            if (typeof window !== 'undefined' && typeof window.cancelAnimationFrame === 'function' && frameId !== null) {
                window.cancelAnimationFrame(frameId);
            }
            if (typeof window !== 'undefined' && timeoutId !== null) {
                window.clearTimeout(timeoutId);
            }
            setShouldMountApplication(false);
        };
    }, [hasScene]);

    useLayoutEffect(() => {
        if (!tooltipState) {
            setTooltipPosition(null);
            return;
        }

        const tooltipNode = tooltipRef.current;
        if (!tooltipNode || size.width <= 0 || size.height <= 0) {
            setTooltipPosition({
                left: tooltipState.x + 12,
                top: tooltipState.y + 12,
            });
            return;
        }

        const margin = 8;
        const offset = 12;
        const tooltipWidth = tooltipNode.offsetWidth;
        const tooltipHeight = tooltipNode.offsetHeight;
        const maxLeft = Math.max(margin, size.width - tooltipWidth - margin);
        const maxTop = Math.max(margin, size.height - tooltipHeight - margin);
        let left = tooltipState.x + offset;
        let top = tooltipState.y + offset;

        if (left > maxLeft) {
            left = tooltipState.x - tooltipWidth - offset;
        }

        if (top > maxTop) {
            top = tooltipState.y - tooltipHeight - offset;
        }

        setTooltipPosition({
            left: Math.min(Math.max(left, margin), maxLeft),
            top: Math.min(Math.max(top, margin), maxTop),
        });
    }, [size.height, size.width, tooltipState]);

    useEffect(() => {
        if (!scene || !panZoomEnabled || syncViewBox) {
            setInteractiveViewBox(null);
            setPanState(null);
            return;
        }

        setInteractiveViewBox(currentViewBox => (
            currentViewBox
                ? clampMapShapeEditorViewBox(currentViewBox, scene.canvas)
                : createInitialMapShapeEditorViewBox(scene.canvas)
        ));
    }, [panZoomEnabled, scene, syncViewBox]);

    useEffect(() => {
        if (interactiveViewBox && onPreviewViewBoxChange) {
            onPreviewViewBoxChange(interactiveViewBox);
        }
    }, [interactiveViewBox, onPreviewViewBoxChange]);

    useEffect(() => {
        if (!panState || !scene || !interactiveViewBox) {
            return undefined;
        }

        const handlePointerMove = (event: PointerEvent) => {
            if (event.pointerId !== panState.pointerId) {
                return;
            }

            const node = elementRef.current;
            if (!node) return;

            const rect = node.getBoundingClientRect();
            if (rect.width <= 0 || rect.height <= 0) return;

            const deltaClientX = event.clientX - panState.startClientX;
            const deltaClientY = event.clientY - panState.startClientY;
            const moved = Math.hypot(deltaClientX, deltaClientY) >= PAN_DRAG_THRESHOLD;

            event.preventDefault();
            setInteractiveViewBox(clampMapShapeEditorViewBox({
                ...panState.originViewBox,
                x: panState.originViewBox.x - (deltaClientX / rect.width) * panState.originViewBox.width,
                y: panState.originViewBox.y - (deltaClientY / rect.height) * panState.originViewBox.height,
            }, scene.canvas));
            setPanState(currentState => (currentState ? {
                ...currentState,
                hasMoved: currentState.hasMoved || moved,
            } : currentState));
        };

        const handlePointerUp = (event: PointerEvent) => {
            if (event.pointerId !== panState.pointerId) {
                return;
            }

            if (panState.hasMoved) {
                suppressPickClickRef.current = true;
            }
            setPanState(null);
        };

        window.addEventListener('pointermove', handlePointerMove);
        window.addEventListener('pointerup', handlePointerUp);
        window.addEventListener('pointercancel', handlePointerUp);

        return () => {
            window.removeEventListener('pointermove', handlePointerMove);
            window.removeEventListener('pointerup', handlePointerUp);
            window.removeEventListener('pointercancel', handlePointerUp);
        };
    }, [elementRef, interactiveViewBox, panState, scene]);

    useEffect(() => {
        const node = elementRef.current;
        if (!node || !scene || !shouldUseInteractiveViewBox) {
            return undefined;
        }

        const handleWheel = (event: WheelEvent) => {
            const currentViewBox = interactiveViewBox ?? createInitialMapShapeEditorViewBox(scene.canvas);
            const rect = node.getBoundingClientRect();
            if (rect.width <= 0 || rect.height <= 0) return;

            event.preventDefault();
            setTooltipState(null);

            const zoomFactor = event.deltaY < 0 ? 0.9 : 1.1;
            const pointer = toViewBoxPoint(event.clientX, event.clientY, rect, currentViewBox);
            const nextWidth = currentViewBox.width * zoomFactor;
            const nextHeight = currentViewBox.height * zoomFactor;
            const widthRatio = nextWidth / currentViewBox.width;
            const heightRatio = nextHeight / currentViewBox.height;

            setInteractiveViewBox(clampMapShapeEditorViewBox({
                width: nextWidth,
                height: nextHeight,
                x: pointer.x - (pointer.x - currentViewBox.x) * widthRatio,
                y: pointer.y - (pointer.y - currentViewBox.y) * heightRatio,
            }, scene.canvas));
        };

        node.addEventListener('wheel', handleWheel, {passive: false});
        return () => {
            node.removeEventListener('wheel', handleWheel);
        };
    }, [elementRef, interactiveViewBox, scene, shouldUseInteractiveViewBox]);
    const resolveTooltip = useCallback((detail: MapPreviewPickDetail) => {
        if (!getTooltip) {
            return getDefaultTooltip(detail);
        }

        const customTooltip = getTooltip(detail);
        if (customTooltip === undefined) {
            return getDefaultTooltip(detail);
        }

        if (customTooltip === null) {
            return null;
        }

        return normalizeTooltip(customTooltip);
    }, [getTooltip]);
    const updateTooltip = useCallback((detail: MapPreviewPickDetail, event: FederatedPointerEvent) => {
        if (disableTooltip) {
            setTooltipState(null);
            return;
        }

        const tooltip = resolveTooltip(detail);
        const point = getEventScreenPoint(event);
        setTooltipState(tooltip ? {
            tooltip,
            x: point.x,
            y: point.y,
        } : null);
    }, [disableTooltip, resolveTooltip]);
    const handlePickHover = useCallback((detail: MapPreviewPickDetail, event: FederatedPointerEvent) => {
        setHoveredDetail(detail);
        updateTooltip(detail, event);
        onPixiHover?.(detail);

        if (detail.kind === 'shape') {
            onShapeHover?.(detail);
        }

        if (detail.kind === 'keyLocation') {
            onKeyLocationHover?.(detail);
        }
    }, [onKeyLocationHover, onPixiHover, onShapeHover, updateTooltip]);
    const handlePickMove = useCallback((detail: MapPreviewPickDetail, event: FederatedPointerEvent) => {
        perfRecorder?.recordPointerMove();
        updateTooltip(detail, event);
    }, [perfRecorder, updateTooltip]);
    const handlePickOut = useCallback(() => {
        setHoveredDetail(null);
        setTooltipState(null);
        onPixiHover?.(null);
        onShapeHover?.(null);
        onKeyLocationHover?.(null);
    }, [onKeyLocationHover, onPixiHover, onShapeHover]);
    const handlePickClick = useCallback((detail: MapPreviewPickDetail) => {
        if (suppressPickClickRef.current) {
            suppressPickClickRef.current = false;
            return;
        }

        onPixiClick?.(detail);

        if (detail.kind === 'shape') {
            onShapeClick?.(detail);
        }

        if (detail.kind === 'keyLocation') {
            onKeyLocationClick?.(detail);
        }
    }, [onKeyLocationClick, onPixiClick, onShapeClick]);
    const handlePointerDown = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
        if (!scene || !shouldUseInteractiveViewBox || (event.button !== 0 && event.button !== 1)) {
            return;
        }

        const currentViewBox = interactiveViewBox ?? createInitialMapShapeEditorViewBox(scene.canvas);
        event.preventDefault();
        setTooltipState(null);
        event.currentTarget.setPointerCapture(event.pointerId);
        setPanState({
            pointerId: event.pointerId,
            startClientX: event.clientX,
            startClientY: event.clientY,
            originViewBox: currentViewBox,
            hasMoved: false,
        });
    }, [interactiveViewBox, scene, shouldUseInteractiveViewBox]);
    const handleContextLost = useCallback(() => {
        setContextLost(true);
        setTooltipState(null);
        setHoveredDetail(null);
        setPanState(null);
        onPixiHover?.(null);
        onShapeHover?.(null);
        onKeyLocationHover?.(null);
    }, [onKeyLocationHover, onPixiHover, onShapeHover]);
    const handleContextRestored = useCallback(() => {
        setContextLost(false);
        setContextRevision(currentRevision => currentRevision + 1);
    }, []);
    const shouldRenderScene = Boolean(scene && transform && !contextLost);
    const statusMessage = !scene
        ? emptyHint
        : contextLost
            ? 'Pixi 渲染上下文已丢失，正在等待浏览器恢复。'
            : shouldMountApplication && !transform
                ? '正在等待 Pixi 预览容器尺寸。'
                : !shouldMountApplication
                    ? '正在初始化 Pixi 预览。'
                    : null;

    return (
        <div
            ref={elementRef}
            className={[
                'fc-map-pixi-preview',
                shouldUseInteractiveViewBox ? 'fc-map-pixi-preview--interactive' : '',
                panState ? 'fc-map-pixi-preview--panning' : '',
                className,
            ].filter(Boolean).join(' ')}
            style={style}
            onPointerDown={handlePointerDown}
        >
            {scene && shouldMountApplication && (
                <Application
                    resizeTo={elementRef}
                    preference="webgl"
                    backgroundAlpha={0}
                    antialias
                    autoDensity
                    resolution={pixiResolution}
                >
                    <MapPixiApplicationGuard
                        onContextLost={handleContextLost}
                        onContextRestored={handleContextRestored}
                    />
                    {shouldRenderScene && transform && (
                        <MapPixiScene
                            key={contextRevision}
                            scene={scene}
                            showLabels={showLabels}
                            transform={transform}
                            size={size}
                            enablePicking={pickingEnabled}
                            polygonLineWidth={resolvedPolygonLineWidth}
                            keyLocationRadius={resolvedKeyLocationRadius}
                            keyLocationStrokeColor={resolvedKeyLocationStrokeColor}
                            keyLocationStrokeWidth={resolvedKeyLocationStrokeWidth}
                            keyLocationRenderMode={resolvedKeyLocationRenderMode}
                            iconSize={resolvedIconSize}
                            labelFontSize={resolvedLabelFontSize}
                            labelColor={resolvedLabelColor}
                            labelFontFamily={resolvedLabelFontFamily}
                            labelFontWeight={resolvedLabelFontWeight}
                            hoveredDetail={hoveredDetail}
                            onPickClick={handlePickClick}
                            onPickHover={handlePickHover}
                            onPickMove={handlePickMove}
                            onPickOut={handlePickOut}
                            sceneFilters={sceneFilters}
                            renderOverlay={renderOverlay}
                            lodLevel={lodLevel}
                            perfRecorder={perfRecorder}
                        />
                    )}
                </Application>
            )}
            {statusMessage && (
                <div className="fc-map-pixi-preview__empty">{statusMessage}</div>
            )}
            {tooltipState && (
                <div
                    ref={tooltipRef}
                    className={`fc-map-pixi-preview__tooltip${tooltipState.tooltip.className ? ` ${tooltipState.tooltip.className}` : ''}`}
                    style={{
                        ...tooltipState.tooltip.style,
                        left: tooltipPosition?.left ?? tooltipState.x + 12,
                        top: tooltipPosition?.top ?? tooltipState.y + 12,
                        transform: 'none',
                    }}
                >
                    {tooltipState.tooltip.html ? (
                        <span dangerouslySetInnerHTML={{__html: tooltipState.tooltip.html}}/>
                    ) : (
                        tooltipState.tooltip.text
                    )}
                </div>
            )}
        </div>
    );
}
