import {type CSSProperties, type RefObject, useCallback, useEffect, useMemo, useRef, useState} from 'react';
import DeckGL, {type DeckGLRef} from '@deck.gl/react';
import {
    type Effect,
    type Layer,
    LayerExtension,
    OrthographicController,
    OrthographicView,
    type PickingInfo
} from '@deck.gl/core';
import {
    BitmapLayer,
    IconLayer,
    type IconLayerProps,
    PolygonLayer,
    type PolygonLayerProps,
    ScatterplotLayer,
    type ScatterplotLayerProps,
    TextLayer,
    type TextLayerProps,
} from '@deck.gl/layers';
import {CanvasContext} from '@luma.gl/core';

import type {
    MapEditorCanvas,
    MapKeyLocationRenderMode,
    MapPreviewEmptyPickDetail,
    MapPreviewKeyLocation,
    MapPreviewKeyLocationPickDetail,
    MapPreviewKeyLocationStyle,
    MapPreviewLabelStyle,
    MapPreviewPickBaseDetail,
    MapPreviewPickDetail,
    MapPreviewScene,
    MapPreviewShape,
    MapPreviewShapePickDetail,
    MapPreviewShapeStyle,
    MapPreviewTooltip,
    MapShapeEditorViewBox,
} from './types';
import {createInitialMapShapeEditorViewBox} from './mapShapeEditorSvgUtils';
import './MapShapeEditor.css';

const PREVIEW_VIEW = new OrthographicView({ id: 'fc-map-deck-preview' });
const MIN_RENDER_SIZE = 2;
const DECK_MIN_VIEWBOX_SCALE = 0.18; // 匹配 SVG 编辑器 — 最大缩放 (~556%)
const DECK_MAX_VIEWBOX_SCALE = 2;    // 匹配 SVG 编辑器 — 最小缩放 (50%)
const CANVAS_CONTEXT_PATCH_FLAG = '__fcMapDeckPreviewCanvasContextPatched__';

// ── Shader 注入 ──────────────────────────────────────────────────────────────

/**
 * 各图层 GLSL 注入映射表。键为 deck.gl shader hook 名称，例如：
 *   'vs:#decl', 'fs:#decl', 'vs:DECKGL_FILTER_COLOR', 'fs:DECKGL_FILTER_COLOR'
 */
export type MapDeckShaderInject = Record<string, string>;

/**
 * 将 `MapDeckShaderInject` 映射表包装在匿名 `LayerExtension` 中，以便
 * 传递给任意图层的 `extensions` prop。
 */
export function makeInjectExtension(inject: MapDeckShaderInject): LayerExtension {
    return new class extends LayerExtension {
        override getShaders() {
            return {inject};
        }
    }();
}

interface DeckViewState {
    target: [number, number, number];
    zoom: number;
}

// ── 内部类型 ─────────────────────────────────────────────────────────────

interface ElementSize {
    width: number;
    height: number;
}

interface ResizeObserverBoxLike {
    inlineSize: number;
    blockSize: number;
}

interface CanvasContextDeviceLike {
    limits?: {
        maxTextureDimension2D?: number;
    };
    props?: {
        onResize?: (canvasContext: CanvasContext, info: { oldPixelSize: [number, number] }) => void;
        onVisibilityChange?: (canvasContext: CanvasContext) => void;
        onDevicePixelRatioChange?: (canvasContext: CanvasContext, info: { oldRatio: number }) => void;
    };
}

type MutableCanvasContext = Omit<CanvasContext, 'device'> & {
    device?: CanvasContextDeviceLike;
    _handleIntersection(entries: IntersectionObserverEntry[]): void;
    _handleResize(entries: ResizeObserverEntry[]): void;
    _observeDevicePixelRatio(): void;
    _updateDrawingBufferSize(): void;
};

type MutableCanvasContextPrototype = MutableCanvasContext & {
    [CANVAS_CONTEXT_PATCH_FLAG]?: boolean;
};

// ── 公开 prop 类型 ──────────────────────────────────────────────────────────

export interface MapDeckPreviewProps {
    scene: MapPreviewScene | null;
    className?: string;
    style?: CSSProperties;
    emptyHint?: string;

    /** 显示/隐藏关键位置上的 TextLayer 标签。默认值: true */
    showLabels?: boolean;

    /** 通用图形样式。建议优先使用，`polygonLayerProps` 仅作为 Deck 高级覆盖口。 */
    shapeStyle?: MapPreviewShapeStyle;

    /** 通用关键地点样式。建议优先使用，Deck layer props 仅作为高级覆盖口。 */
    keyLocationStyle?: MapPreviewKeyLocationStyle;

    /** 通用标签样式。建议优先使用，`textLayerProps` 仅作为 Deck 高级覆盖口。 */
    labelStyle?: MapPreviewLabelStyle;

    /**
     * @deprecated 常规图形样式请优先使用 `shapeStyle`；该入口仅作为 Deck PolygonLayer 高级覆盖口保留。
     */
    polygonLayerProps?: Omit<PolygonLayerProps<MapPreviewShape>, 'id' | 'data' | 'getPolygon'>;

    /**
     * @deprecated 常规关键地点样式请优先使用 `keyLocationStyle`；该入口仅作为 Deck ScatterplotLayer 高级覆盖口保留。
     */
    scatterplotLayerProps?: Omit<ScatterplotLayerProps<MapPreviewKeyLocation>, 'id' | 'data' | 'getPosition'>;

    /**
     * @deprecated 使用 `keyLocationStyle.renderMode`。
     */
    keyLocationRenderMode?: MapKeyLocationRenderMode;

    /**
     * @deprecated 常规图标样式请优先使用 `keyLocationStyle`；该入口仅作为 Deck IconLayer 高级覆盖口保留。
     */
    iconLayerProps?: Omit<IconLayerProps<MapPreviewKeyLocation>, 'id' | 'data' | 'getPosition' | 'getIcon'>;

    /**
     * @deprecated 常规标签样式请优先使用 `labelStyle`；该入口仅作为 Deck TextLayer 高级覆盖口保留。
     */
    textLayerProps?: Omit<TextLayerProps<MapPreviewKeyLocation>, 'id' | 'data' | 'getText'>;

    /** PolygonLayer 的 GLSL 注入映射表。与 `polygonLayerProps.extensions` 合并。 */
    polygonShaderInject?: MapDeckShaderInject;
    /** ScatterplotLayer 的 GLSL 注入映射表。 */
    scatterplotShaderInject?: MapDeckShaderInject;
    /** IconLayer 的 GLSL 注入映射表。 */
    iconShaderInject?: MapDeckShaderInject;
    /** TextLayer 的 GLSL 注入映射表。 */
    textShaderInject?: MapDeckShaderInject;

    /** 附加在内置图层之后的 deck.gl 图层。 */
    extraLayers?: Layer[];

    /** deck.gl `effects` 数组（例如 PostProcessEffect）。 */
    deckEffects?: Effect[];

    /**
     * 是否启用 luma.gl CanvasContext 兼容补丁。默认启用以保持既有环境兼容；
     * 设为 false 可避免组件修改 luma.gl 原型。
     */
    enableCanvasContextSafetyPatch?: boolean;

    /**
     * 当提供时，视图状态从此 viewBox 派生，而非
     * 自动适应场景。传入 SVG 编辑器的 viewBox 可使两个
     * 图层完美同步。
     */
    syncViewBox?: MapShapeEditorViewBox;

    /** 为 true 时，`getTooltip` 被禁用（无悬停提示）。 */
    disableTooltip?: boolean;

    /**
     * 自定义内置悬停提示。返回 `undefined` 使用默认提示。
     * 返回 `null` 可隐藏当前对象的提示。返回字符串等同于 `{ text: string }`。
     */
    getTooltip?: (detail: MapPreviewPickDetail) => MapPreviewTooltip | string | null | undefined;

    /** @deprecated 使用 `enablePanZoom` 和 `enablePicking` 分别控制预览交互能力。 */
    interactive?: boolean;
    /**
     * 为 true 时，启用 OrthographicController 的缩放（滚轮）和平移（拖拽）。
     * 视图状态在内部管理，并在 `scene` 变化时重置为自动适应。
     * 当设置了 `syncViewBox` 时无效。默认为 `interactive`。
     */
    enablePanZoom?: boolean;
    /** 是否启用 deck picking、hover、click 与 tooltip。未传入时默认启用。 */
    enablePicking?: boolean;

    onDeckClick?: (detail: MapPreviewPickDetail) => void;
    onDeckHover?: (detail: MapPreviewPickDetail) => void;
    onShapeClick?: (detail: MapPreviewShapePickDetail) => void;
    onShapeHover?: (detail: MapPreviewShapePickDetail) => void;
    onKeyLocationClick?: (detail: MapPreviewKeyLocationPickDetail) => void;
    onKeyLocationHover?: (detail: MapPreviewKeyLocationPickDetail) => void;
    /**
     * 预览视口变化回调。仅在 `interactive` 模式下内部管理视口时触发。
     * 若传入了 `syncViewBox`，该回调不会触发（视口由外部控制）。
     */
    onPreviewViewBoxChange?: (viewBox: MapShapeEditorViewBox) => void;
}

/** @deprecated 使用 {@link MapPreviewEmptyPickDetail} */
export type MapDeckPreviewEmptyPickDetail = MapPreviewEmptyPickDetail;
/** @deprecated 使用 {@link MapPreviewShapePickDetail} */
export type MapDeckPreviewShapePickDetail = MapPreviewShapePickDetail;
/** @deprecated 使用 {@link MapPreviewKeyLocationPickDetail} */
export type MapDeckPreviewKeyLocationPickDetail = MapPreviewKeyLocationPickDetail;
/** @deprecated 使用 {@link MapPreviewPickDetail} */
export type MapDeckPreviewPickDetail = MapPreviewPickDetail;
/** @deprecated 使用 {@link MapPreviewTooltip} */
export type MapDeckPreviewTooltip = MapPreviewTooltip;

// ── 默认值 ───────────────────────────────────────────────────────────────────

const DEFAULT_LOCATION_STROKE_COLOR: [number, number, number, number] = [255, 255, 255, 255];
const DEFAULT_LABEL_COLOR: [number, number, number, number] = [38, 43, 56, 255];
const DEFAULT_LABEL_FONT_FAMILY = '"Microsoft YaHei UI", sans-serif';

// ── luma.gl canvas context 安全补丁 ───────────────────────────────────────

function normalizeElementSize(width: number, height: number): ElementSize {
    return {
        width: Number.isFinite(width) ? Math.max(0, Math.round(width)) : 0,
        height: Number.isFinite(height) ? Math.max(0, Math.round(height)) : 0,
    };
}

function resolveResizeObserverBox(
    box: readonly ResizeObserverSize[] | ResizeObserverSize | undefined,
): ResizeObserverBoxLike | null {
    if (!box) {
        return null;
    }

    if (Array.isArray(box)) {
        return box[0] ?? null;
    }

    return box as ResizeObserverBoxLike;
}

function getFallbackDrawingBufferSize(canvasContext: MutableCanvasContext): [number, number] {
    const fallbackWidth = Math.max(
        1,
        Math.ceil(canvasContext.canvas.width || canvasContext.htmlCanvas?.clientWidth || canvasContext.cssWidth || 1),
    );
    const fallbackHeight = Math.max(
        1,
        Math.ceil(canvasContext.canvas.height || canvasContext.htmlCanvas?.clientHeight || canvasContext.cssHeight || 1),
    );

    return [fallbackWidth, fallbackHeight];
}

function hasCanvasContextDevice(canvasContext: MutableCanvasContext): boolean {
    return Number.isFinite(canvasContext.device?.limits?.maxTextureDimension2D)
        && Boolean(canvasContext.device?.props);
}

function ensureCanvasContextSafetyPatch() {
    const canvasContextPrototype = CanvasContext.prototype as unknown as MutableCanvasContextPrototype;
    if (canvasContextPrototype[CANVAS_CONTEXT_PATCH_FLAG]) {
        return;
    }

    const originalGetMaxDrawingBufferSize = canvasContextPrototype.getMaxDrawingBufferSize;
    const originalHandleIntersection = canvasContextPrototype._handleIntersection;
    const originalHandleResize = canvasContextPrototype._handleResize;
    const originalObserveDevicePixelRatio = canvasContextPrototype._observeDevicePixelRatio;

    canvasContextPrototype.getMaxDrawingBufferSize = function patchedGetMaxDrawingBufferSize(this: MutableCanvasContext) {
        if (hasCanvasContextDevice(this)) {
            return originalGetMaxDrawingBufferSize.call(this);
        }

        return getFallbackDrawingBufferSize(this);
    };

    canvasContextPrototype._handleIntersection = function patchedHandleIntersection(
        this: MutableCanvasContext,
        entries: IntersectionObserverEntry[],
    ) {
        if (this.device?.props?.onVisibilityChange) {
            originalHandleIntersection.call(this, entries);
            return;
        }

        const entry = entries.find(currentEntry => currentEntry.target === this.canvas);
        if (!entry) {
            return;
        }

        this.isVisible = entry.isIntersecting;
    };

    canvasContextPrototype._handleResize = function patchedHandleResize(
        this: MutableCanvasContext,
        entries: ResizeObserverEntry[],
    ) {
        if (hasCanvasContextDevice(this) && this.device?.props?.onResize) {
            originalHandleResize.call(this, entries);
            return;
        }

        const entry = entries.find(currentEntry => currentEntry.target === this.canvas);
        if (!entry) {
            return;
        }

        const contentBox = resolveResizeObserverBox(entry.contentBoxSize);
        const devicePixelBox = resolveResizeObserverBox(entry.devicePixelContentBoxSize);
        const oldPixelSize = this.getDevicePixelSize();
        const nextCssWidth = contentBox?.inlineSize ?? entry.contentRect.width;
        const nextCssHeight = contentBox?.blockSize ?? entry.contentRect.height;
        const nextDevicePixelRatio = globalThis.devicePixelRatio || 1;
        const nextDevicePixelWidth = Math.round(devicePixelBox?.inlineSize ?? nextCssWidth * nextDevicePixelRatio);
        const nextDevicePixelHeight = Math.round(devicePixelBox?.blockSize ?? nextCssHeight * nextDevicePixelRatio);

        this.cssWidth = nextCssWidth;
        this.cssHeight = nextCssHeight;
        this.devicePixelWidth = Math.max(1, nextDevicePixelWidth);
        this.devicePixelHeight = Math.max(1, nextDevicePixelHeight);

        this._updateDrawingBufferSize();
        this.device?.props?.onResize?.(this as unknown as CanvasContext, {oldPixelSize});
    };

    canvasContextPrototype._observeDevicePixelRatio = function patchedObserveDevicePixelRatio(this: MutableCanvasContext) {
        if (this.device?.props?.onDevicePixelRatioChange) {
            originalObserveDevicePixelRatio.call(this);
            return;
        }

        const oldRatio = this.devicePixelRatio;
        this.devicePixelRatio = globalThis.devicePixelRatio || 1;
        this.updatePosition();

        if (typeof window !== 'undefined' && typeof window.matchMedia === 'function') {
            window
                .matchMedia(`(resolution: ${this.devicePixelRatio}dppx)`)
                .addEventListener('change', () => {
                    (CanvasContext.prototype as unknown as MutableCanvasContextPrototype)._observeDevicePixelRatio.call(this);
                }, {once: true});
        }

        this.device?.props?.onDevicePixelRatioChange?.(this as unknown as CanvasContext, {oldRatio});
    };

    canvasContextPrototype[CANVAS_CONTEXT_PATCH_FLAG] = true;
}

// ── 背景图片支持 ───────────────────────────────────────────────────

type BackgroundBounds = [number, number, number, number];

function computeBackgroundBounds(
    canvasW: number,
    canvasH: number,
    imgW: number,
    imgH: number,
    fit: 'cover' | 'contain',
): BackgroundBounds {
    if (imgW === 0 || imgH === 0) return [0, 0, canvasW, canvasH];

    const canvasRatio = canvasW / canvasH;
    const imgRatio = imgW / imgH;
    let renderW: number;
    let renderH: number;

    if (fit === 'cover') {
        if (imgRatio > canvasRatio) {
            renderH = canvasH;
            renderW = imgRatio * canvasH;
        } else {
            renderW = canvasW;
            renderH = canvasW / imgRatio;
        }
    } else {
        if (imgRatio > canvasRatio) {
            renderW = canvasW;
            renderH = canvasW / imgRatio;
        } else {
            renderH = canvasH;
            renderW = imgRatio * canvasH;
        }
    }

    const ox = (canvasW - renderW) / 2;
    const oy = (canvasH - renderH) / 2;
    return [ox, oy, ox + renderW, oy + renderH];
}

function useImageNaturalSize(url: string | undefined): { w: number; h: number } | null {
    const [naturalSize, setNaturalSize] = useState<{ w: number; h: number } | null>(null);

    useEffect(() => {
        if (!url) {
            setNaturalSize(null);
            return;
        }
        let cancelled = false;
        const img = new Image();
        img.onload = () => {
            if (!cancelled) setNaturalSize({w: img.naturalWidth, h: img.naturalHeight});
        };
        img.onerror = () => {
            if (!cancelled) setNaturalSize(null);
        };
        img.src = url;
        return () => {
            cancelled = true;
        };
    }, [url]);

    return naturalSize;
}

// ── Hooks ──────────────────────────────────────────────────────────────────────

function useElementSize<T extends HTMLElement>() {
    const elementRef = useRef<T | null>(null);
    const [size, setSize] = useState<ElementSize>({ width: 0, height: 0 });

    useEffect(() => {
        const node = elementRef.current;
        if (!node) return;

        let frameId: number | null = null;
        let visibleFrameId: number | null = null;

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

        const measure = () => {
            const rect = node.getBoundingClientRect();
            scheduleSizeUpdate(rect.width, rect.height);
        };

        const observer = new ResizeObserver(entries => {
            const entry = entries[0];
            if (!entry) return;

            scheduleSizeUpdate(entry.contentRect.width, entry.contentRect.height);
        });

        observer.observe(node);

        const handleVisibilityChange = () => {
            if (typeof document === 'undefined' || document.visibilityState === 'hidden') {
                return;
            }

            if (typeof window === 'undefined' || typeof window.requestAnimationFrame !== 'function') {
                measure();
                return;
            }

            if (visibleFrameId !== null) {
                window.cancelAnimationFrame(visibleFrameId);
            }

            visibleFrameId = window.requestAnimationFrame(() => {
                visibleFrameId = window.requestAnimationFrame(() => {
                    visibleFrameId = null;
                    measure();
                });
            });
        };

        measure();

        if (typeof document !== 'undefined') {
            document.addEventListener('visibilitychange', handleVisibilityChange);
        }

        return () => {
            observer.disconnect();

            if (typeof document !== 'undefined') {
                document.removeEventListener('visibilitychange', handleVisibilityChange);
            }

            if (typeof window !== 'undefined' && typeof window.cancelAnimationFrame === 'function') {
                if (frameId !== null) {
                    window.cancelAnimationFrame(frameId);
                }

                if (visibleFrameId !== null) {
                    window.cancelAnimationFrame(visibleFrameId);
                }
            }
        };
    }, []);

    return { elementRef, size };
}

function usePageVisibility() {
    const [isVisible, setIsVisible] = useState(
        typeof document === 'undefined' ? true : document.visibilityState !== 'hidden',
    );

    useEffect(() => {
        if (typeof document === 'undefined') {
            return undefined;
        }

        const handleVisibilityChange = () => {
            setIsVisible(document.visibilityState !== 'hidden');
        };

        document.addEventListener('visibilitychange', handleVisibilityChange);
        return () => document.removeEventListener('visibilitychange', handleVisibilityChange);
    }, []);

    return isVisible;
}

function requestDeckRedraw(deckRef: RefObject<DeckGLRef | null>, reason: string) {
    if (typeof window === 'undefined' || typeof window.requestAnimationFrame !== 'function') {
        deckRef.current?.deck?.redraw(reason);
        return () => undefined;
    }

    const frameId = window.requestAnimationFrame(() => {
        deckRef.current?.deck?.redraw(reason);
    });

    return () => window.cancelAnimationFrame(frameId);
}

// ── 视图状态 ─────────────────────────────────────────────────────────────────

function buildAutoViewState(canvas: MapEditorCanvas, size: ElementSize) {
    return buildSyncedViewState(createInitialMapShapeEditorViewBox(canvas), size.width);
}

function buildSyncedViewState(viewBox: MapShapeEditorViewBox, containerWidth: number) {
    const zoom = Math.log2(Math.max(containerWidth / Math.max(viewBox.width, 1), 0.01));
    return {
        target: [viewBox.x + viewBox.width / 2, viewBox.y + viewBox.height / 2, 0] as [number, number, number],
        zoom,
    };
}

/**
 * 限制交互式 deck 视图状态，使缩放和平移保持在
 * 与 SVG 编辑器的 clampMapShapeEditorViewBox 相同的范围内。
 *
 * 平移公式与 SVG 编辑器一致：
 *   viewBox.x ∈ [min(0, xMargin), max(0, xMargin)] 其中 xMargin = canvas.width - vw
 *   → target.x ∈ [min(vw/2, canvas.width − vw/2), max(vw/2, canvas.width − vw/2)]
 */
function clampDeckViewState(
    state: DeckViewState,
    canvas: MapEditorCanvas,
    containerWidth: number,
    containerHeight: number,
): DeckViewState {
    const baseZoom = Math.log2(Math.max(containerWidth / Math.max(canvas.width, 1), 0.01));
    const minZoom = baseZoom - Math.log2(DECK_MAX_VIEWBOX_SCALE);
    const maxZoom = baseZoom - Math.log2(DECK_MIN_VIEWBOX_SCALE);
    const zoom = Math.min(Math.max(state.zoom, minZoom), maxZoom);
    const scale = Math.pow(2, zoom);
    const vw = Math.max(containerWidth / scale, 1);
    const vh = Math.max(containerHeight / scale, 1);
    const tx = Math.min(
        Math.max(state.target[0], Math.min(vw / 2, canvas.width - vw / 2)),
        Math.max(vw / 2, canvas.width - vw / 2),
    );
    const ty = Math.min(
        Math.max(state.target[1], Math.min(vh / 2, canvas.height - vh / 2)),
        Math.max(vh / 2, canvas.height - vh / 2),
    );
    return {...state, target: [tx, ty, state.target[2]], zoom};
}

// ── 图层构建器 ──────────────────────────────────────────────────────────────

interface BuildLayersOptions {
    scene: MapPreviewScene;
    showLabels: boolean;
    shapeStyle?: MapPreviewShapeStyle;
    polygonLayerProps?: Omit<PolygonLayerProps<MapPreviewShape>, 'id' | 'data' | 'getPolygon'>;
    keyLocationStyle?: MapPreviewKeyLocationStyle;
    scatterplotLayerProps?: Omit<ScatterplotLayerProps<MapPreviewKeyLocation>, 'id' | 'data' | 'getPosition'>;
    keyLocationRenderMode: MapKeyLocationRenderMode;
    iconLayerProps?: Omit<IconLayerProps<MapPreviewKeyLocation>, 'id' | 'data' | 'getPosition' | 'getIcon'>;
    labelStyle?: MapPreviewLabelStyle;
    textLayerProps?: Omit<TextLayerProps<MapPreviewKeyLocation>, 'id' | 'data' | 'getText'>;
    polygonShaderInject?: MapDeckShaderInject;
    scatterplotShaderInject?: MapDeckShaderInject;
    iconShaderInject?: MapDeckShaderInject;
    textShaderInject?: MapDeckShaderInject;
    extraLayers?: Layer[];
    backgroundBounds?: BackgroundBounds;
}

function mergeExtensions(userProps: {
    extensions?: LayerExtension[]
} | undefined, inject: MapDeckShaderInject | undefined): LayerExtension[] {
    return [
        ...(userProps?.extensions ?? []),
        ...(inject ? [makeInjectExtension(inject)] : []),
    ];
}

function shouldRenderKeyLocationAsIcon(
    location: MapPreviewKeyLocation,
    renderMode: MapKeyLocationRenderMode,
): boolean {
    if (!location.icon?.url) {
        return false;
    }

    return renderMode === 'icon' || renderMode === 'auto';
}

function buildLayers({
                         scene,
                         showLabels,
                         shapeStyle,
                         polygonLayerProps,
                         keyLocationStyle,
                         scatterplotLayerProps,
                         keyLocationRenderMode,
                         iconLayerProps,
                         labelStyle,
                         textLayerProps,
                         polygonShaderInject,
                         scatterplotShaderInject,
                         iconShaderInject,
                         textShaderInject,
                         extraLayers,
                         backgroundBounds,
                     }: BuildLayersOptions): Layer[] {
    const layers: Layer[] = [];
    const circleKeyLocations = scene.keyLocations.filter(location => (
        keyLocationRenderMode === 'circle'
        || !shouldRenderKeyLocationAsIcon(location, keyLocationRenderMode)
    ));
    const iconKeyLocations = scene.keyLocations.filter(location => shouldRenderKeyLocationAsIcon(location, keyLocationRenderMode));

    if (scene.backgroundImage?.url && backgroundBounds) {
        layers.push(
            new BitmapLayer({
                id: 'fc-map-preview-background',
                image: scene.backgroundImage.url,
                bounds: backgroundBounds,
                opacity: scene.backgroundImage.opacity ?? 1,
                pickable: false,
            }),
        );
    }

    layers.push(
        new PolygonLayer<MapPreviewShape>({
            pickable: true,
            filled: true,
            stroked: true,
            wireframe: false,
            lineWidthMinPixels: shapeStyle?.lineWidth ?? 2,
            getFillColor: item => item.fillColor,
            getLineColor: item => item.lineColor,
            ...polygonLayerProps,
            id: 'fc-map-preview-polygons',
            data: scene.shapes,
            getPolygon: item => item.polygon,
            extensions: mergeExtensions(polygonLayerProps, polygonShaderInject),
        }),
    );

    if (circleKeyLocations.length > 0) {
        layers.push(
            new ScatterplotLayer<MapPreviewKeyLocation>({
                pickable: true,
                radiusMinPixels: 6,
                radiusMaxPixels: 14,
                stroked: keyLocationStyle?.showStroke ?? true,
                lineWidthMinPixels: keyLocationStyle?.strokeWidth ?? 2,
                getRadius: keyLocationStyle?.radius ?? 8,
                getFillColor: item => item.color,
                getLineColor: () => keyLocationStyle?.strokeColor ?? DEFAULT_LOCATION_STROKE_COLOR,
                ...scatterplotLayerProps,
                id: 'fc-map-preview-key-locations',
                data: circleKeyLocations,
                getPosition: item => item.position,
                extensions: mergeExtensions(scatterplotLayerProps, scatterplotShaderInject),
            }),
        );
    }

    if (iconKeyLocations.length > 0) {
        layers.push(
            new IconLayer<MapPreviewKeyLocation>({
                pickable: true,
                sizeUnits: 'pixels',
                sizeBasis: 'height',
                getSize: item => item.iconSize ?? keyLocationStyle?.iconSize ?? 28,
                getColor: () => [255, 255, 255, 255],
                ...iconLayerProps,
                id: 'fc-map-preview-key-location-icons',
                data: iconKeyLocations,
                getPosition: item => item.position,
                getIcon: item => {
                    const icon = item.icon;
                    const fallbackSize = Math.max(1, Math.round(item.iconSize ?? keyLocationStyle?.iconSize ?? 28));
                    return {
                        url: icon?.url ?? '',
                        width: Math.max(1, Math.round(icon?.width ?? fallbackSize)),
                        height: Math.max(1, Math.round(icon?.height ?? fallbackSize)),
                        anchorX: Math.round(icon?.anchorX ?? ((icon?.width ?? fallbackSize) / 2)),
                        anchorY: Math.round(icon?.anchorY ?? ((icon?.height ?? fallbackSize) / 2)),
                        mask: icon?.mask ?? false,
                    };
                },
                extensions: mergeExtensions(iconLayerProps, iconShaderInject),
            }),
        );
    }

    if (showLabels) {
        layers.push(
            new TextLayer<MapPreviewKeyLocation>({
                pickable: false,
                characterSet: 'auto',
                getPosition: item => {
                    const labelOffset = shouldRenderKeyLocationAsIcon(item, keyLocationRenderMode)
                        ? Math.max((item.iconSize ?? keyLocationStyle?.iconSize ?? 28) / 2 + 8, 18)
                        : 18;
                    return [item.position[0], item.position[1] - labelOffset];
                },
                getSize: labelStyle?.fontSize ?? 13,
                getColor: () => labelStyle?.color ?? DEFAULT_LABEL_COLOR,
                getTextAnchor: () => 'middle',
                getAlignmentBaseline: () => 'bottom',
                fontFamily: labelStyle?.fontFamily ?? DEFAULT_LABEL_FONT_FAMILY,
                fontWeight: labelStyle?.fontWeight ?? '600',
                ...textLayerProps,
                id: 'fc-map-preview-key-location-labels',
                data: scene.keyLocations,
                getText: item => item.name,
                extensions: mergeExtensions(textLayerProps, textShaderInject),
            }),
        );
    }

    if (extraLayers?.length) {
        layers.push(...extraLayers);
    }

    return layers;
}

// ── 提示 ────────────────────────────────────────────────────────────────────

function getTooltipText(object: unknown): string | null {
    if (!object || typeof object !== 'object') return null;

    if ('polygon' in object) {
        const shape = object as MapPreviewShape;
        return `图形：${shape.name}`;
    }

    if ('position' in object) {
        const location = object as MapPreviewKeyLocation;
        return `关键地点：${location.name}\n类型：${location.type}`;
    }

    return null;
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

function toDeckTooltip(tooltip: MapPreviewTooltip | null): any {
    if (!tooltip) {
        return null;
    }

    return {
        text: tooltip.text,
        html: tooltip.html,
        className: tooltip.className,
        style: tooltip.style as Partial<CSSStyleDeclaration>,
    };
}

function getDefaultTooltip(detail: MapPreviewPickDetail): MapPreviewTooltip | null {
    if (detail.kind === 'empty') {
        return null;
    }

    const text = getTooltipText(detail.object);
    return text ? {text} : null;
}

function toPickDetail(info: PickingInfo): MapPreviewPickDetail {
    const baseDetail: MapPreviewPickBaseDetail = {
        index: info.index,
        layerId: info.layer?.id,
        x: info.x,
        y: info.y,
        coordinate: Array.isArray(info.coordinate) ? [...info.coordinate] : undefined,
    };

    if (!info.object || typeof info.object !== 'object') {
        return {
            kind: 'empty',
            object: null,
            ...baseDetail,
        };
    }

    if ('polygon' in info.object) {
        return {
            kind: 'shape',
            object: info.object as MapPreviewShape,
            ...baseDetail,
        };
    }

    if ('position' in info.object) {
        return {
            kind: 'keyLocation',
            object: info.object as MapPreviewKeyLocation,
            ...baseDetail,
        };
    }

    return {
        kind: 'empty',
        object: null,
        ...baseDetail,
    };
}

// ── 组件 ──────────────────────────────────────────────────────────────────

export function MapDeckPreview({
    scene,
    className,
    style,
    emptyHint = '提交后将在这里显示后端回传的 deck 结果。',
                                   showLabels = true,
                                   shapeStyle,
                                   polygonLayerProps,
                                   keyLocationStyle,
                                   scatterplotLayerProps,
                                   keyLocationRenderMode = 'auto',
                                   iconLayerProps,
                                   labelStyle,
                                   textLayerProps,
                                   polygonShaderInject,
                                   scatterplotShaderInject,
                                   iconShaderInject,
                                   textShaderInject,
                                   extraLayers,
                                   deckEffects,
                                   enableCanvasContextSafetyPatch = true,
                                   syncViewBox,
                                   disableTooltip = false,
                                   getTooltip,
                                   interactive = false,
                                   enablePanZoom,
                                   enablePicking = true,
                                   onDeckClick,
                                   onDeckHover,
                                   onShapeClick,
                                   onShapeHover,
                                   onKeyLocationClick,
                                   onKeyLocationHover,
                                   onPreviewViewBoxChange,
}: MapDeckPreviewProps) {
    if (enableCanvasContextSafetyPatch) {
        ensureCanvasContextSafetyPatch();
    }

    const { elementRef, size } = useElementSize<HTMLDivElement>();
    const deckRef = useRef<DeckGLRef | null>(null);
    const isPageVisible = usePageVisibility();
    const [isDeviceReady, setIsDeviceReady] = useState(false);
    const [interactiveViewState, setInteractiveViewState] = useState<DeckViewState | null>(null);
    const panZoomEnabled = enablePanZoom ?? interactive;
    const pickingEnabled = enablePicking;

    useEffect(() => {
        setInteractiveViewState(null);
    }, [scene, panZoomEnabled]);
    const hasRenderableSize = size.width >= MIN_RENDER_SIZE && size.height >= MIN_RENDER_SIZE;
    const shouldRenderDeck = Boolean(scene && hasRenderableSize && isPageVisible);

    const bgImage = scene?.backgroundImage;
    const bgFit = bgImage?.fit ?? 'fill';
    const imageNaturalSize = useImageNaturalSize(
        bgImage?.url && bgFit !== 'fill' ? bgImage.url : undefined,
    );
    const backgroundBounds = useMemo<BackgroundBounds | undefined>(() => {
        if (!scene || !bgImage?.url) return undefined;
        if (bgFit === 'fill' || !imageNaturalSize) {
            return [0, 0, scene.canvas.width, scene.canvas.height];
        }
        return computeBackgroundBounds(
            scene.canvas.width, scene.canvas.height,
            imageNaturalSize.w, imageNaturalSize.h,
            bgFit,
        );
    }, [bgFit, bgImage?.url, imageNaturalSize, scene]);

    useEffect(() => {
        if (!shouldRenderDeck) {
            setIsDeviceReady(false);
        }
    }, [shouldRenderDeck]);

    useEffect(() => {
        if (!shouldRenderDeck || !isDeviceReady) {
            return undefined;
        }

        return requestDeckRedraw(deckRef, 'MapDeckPreview resized');
    }, [isDeviceReady, scene, shouldRenderDeck, size.height, size.width]);

    const isControlled = panZoomEnabled && !syncViewBox;
    const viewState = scene
        ? (syncViewBox
            ? buildSyncedViewState(syncViewBox, size.width)
            : (interactiveViewState ?? (hasRenderableSize ? buildAutoViewState(scene.canvas, size) : null)))
        : null;

    const deckViewStateToViewBox = useCallback((
        state: DeckViewState,
        containerWidth: number,
        containerHeight: number,
    ): MapShapeEditorViewBox => {
        const scale = Math.pow(2, state.zoom);
        const vw = containerWidth / scale;
        const vh = containerHeight / scale;

        return {
            x: state.target[0] - vw / 2,
            y: state.target[1] - vh / 2,
            width: vw,
            height: vh,
        };
    }, []);

    useEffect(() => {
        if (!isControlled || !interactiveViewState || !onPreviewViewBoxChange) {
            return;
        }

        onPreviewViewBoxChange(deckViewStateToViewBox(
            interactiveViewState,
            size.width,
            size.height,
        ));
    }, [isControlled, interactiveViewState, onPreviewViewBoxChange, size.width, size.height, deckViewStateToViewBox]);

    return (
        <div
            ref={elementRef}
            className={`fc-map-deck-preview${className ? ` ${className}` : ''}`}
            style={style}
        >
            {shouldRenderDeck && scene && viewState ? (
                <DeckGL
                    ref={deckRef}
                    layers={buildLayers({
                        scene,
                        showLabels,
                        shapeStyle,
                        polygonLayerProps,
                        keyLocationStyle,
                        scatterplotLayerProps,
                        keyLocationRenderMode: keyLocationStyle?.renderMode ?? keyLocationRenderMode,
                        iconLayerProps,
                        labelStyle,
                        textLayerProps,
                        polygonShaderInject,
                        scatterplotShaderInject,
                        iconShaderInject,
                        textShaderInject,
                        extraLayers,
                        backgroundBounds,
                    })}
                    views={PREVIEW_VIEW}
                    controller={isControlled ? {type: OrthographicController} : false}
                    viewState={viewState}
                    onViewStateChange={isControlled ? ({viewState: next}) => {
                        const nextViewState = next as DeckViewState;
                        const clamped = hasRenderableSize
                            ? clampDeckViewState(nextViewState, scene.canvas, size.width, size.height)
                            : nextViewState;
                        setInteractiveViewState(clamped);
                    } : undefined}
                    effects={deckEffects ?? []}
                    onDeviceInitialized={() => {
                        setIsDeviceReady(true);
                    }}
                    onLoad={() => {
                        requestDeckRedraw(deckRef, 'MapDeckPreview loaded');
                    }}
                    onClick={pickingEnabled ? info => {
                        const detail = toPickDetail(info);
                        onDeckClick?.(detail);

                        if (detail.kind === 'shape') {
                            onShapeClick?.(detail);
                        }

                        if (detail.kind === 'keyLocation') {
                            onKeyLocationClick?.(detail);
                        }
                    } : undefined}
                    onHover={pickingEnabled ? info => {
                        const detail = toPickDetail(info);
                        onDeckHover?.(detail);

                        if (detail.kind === 'shape') {
                            onShapeHover?.(detail);
                        }

                        if (detail.kind === 'keyLocation') {
                            onKeyLocationHover?.(detail);
                        }
                    } : undefined}
                    getTooltip={disableTooltip || !pickingEnabled ? undefined : info => {
                        const detail = toPickDetail(info);
                        if (!getTooltip) {
                            return toDeckTooltip(getDefaultTooltip(detail));
                        }

                        const customTooltip = getTooltip(detail);
                        if (customTooltip === undefined) {
                            return toDeckTooltip(getDefaultTooltip(detail));
                        }

                        if (customTooltip === null) {
                            return null;
                        }

                        return toDeckTooltip(normalizeTooltip(customTooltip));
                    }}
                />
            ) : (
                <div className="fc-map-deck-preview__empty">{emptyHint}</div>
            )}
        </div>
    );
}
