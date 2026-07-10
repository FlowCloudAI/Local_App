export interface MapEditorCanvas {
    width: number;
    height: number;
}

export interface MapShapeEditorViewBox {
    x: number;
    y: number;
    width: number;
    height: number;
}

export const MAP_SHAPE_PROTOCOL_VERSION = 'map_shape_mvp_v1' as const;

export type MapShapeProtocolVersion = typeof MAP_SHAPE_PROTOCOL_VERSION;

export interface MapShapeExtensible {
    ext?: Record<string, unknown>;
}

export interface MapShapeVertex {
    id: string;
    x: number;
    y: number;
    bizId?: string | null;
}

export interface MapShapeDraft extends MapShapeExtensible {
    id: string;
    name: string;
    vertices: MapShapeVertex[];
    fill?: string;
    stroke?: string;
    bizId?: string | null;
    kind?: 'coastline';
}

export const MAP_MARKER_CLASS_OPTIONS = [
    {value: 'marker', label: '标记点'},
    {value: 'major-city', label: '主要城市'},
    {value: 'city', label: '次要城市'},
    {value: 'town', label: '村镇'},
    {value: 'landmark', label: '地标'},
    {value: 'event', label: '事件点'},
    {value: 'ruin', label: '遗迹'},
    {value: 'harbor', label: '港口'},
] as const;

export type MapMarkerClass = (typeof MAP_MARKER_CLASS_OPTIONS)[number]['value'];

export function inferMapMarkerClass(type: string): MapMarkerClass {
    if (/首都|王都|都城|帝都|京/.test(type)) return 'major-city';
    if (/港|码头|渡口/.test(type)) return 'harbor';
    if (/村|镇|营地|聚落/.test(type)) return 'town';
    if (/遗迹|废墟|神殿/.test(type)) return 'ruin';
    if (/事件|战场|遭遇|任务/.test(type)) return 'event';
    if (/城|要塞/.test(type)) return 'city';
    if (/地标|塔|山|峰/.test(type)) return 'landmark';
    return 'marker';
}

export interface MapKeyLocationDraft extends MapShapeExtensible {
    id: string;
    name: string;
    type: string;
    x: number;
    y: number;
    /** 风格无关的地点显示语义；旧数据缺省时根据 type 推断。 */
    markerClass?: MapMarkerClass | null;
    /** @deprecated 旧数据兼容字段；关键点跟随图形现在按空间包含自动派生。 */
    shapeId?: string | null;
    bizId?: string | null;
}

export type MapTerrainStrokeMode = 'paint' | 'erase';

export type MapTerrainKind = 'grass' | 'mountain' | 'desert';

export interface MapTerrainBrush {
    kind: MapTerrainKind;
    radius: number;
    mode: MapTerrainStrokeMode;
}

export interface MapTerrainStroke {
    id: string;
    /** 地形语义由风格插件解释，协议层保持开放字符串。 */
    kind: string;
    points: [number, number][];
    radius: number;
    mode: MapTerrainStrokeMode;
}

export interface MapShapeEditorDraft {
    shapes: MapShapeDraft[];
    keyLocations: MapKeyLocationDraft[];
    terrainStrokes?: MapTerrainStroke[];
}

export interface MapShapeRequestMeta extends MapShapeExtensible {
    protocolVersion?: MapShapeProtocolVersion;
    scenario?: 'coastline_mvp';
    requestId?: string;
}

export interface MapShapeSaveRequest {
    canvas: MapEditorCanvas;
    shapes: MapShapeDraft[];
    keyLocations: MapKeyLocationDraft[];
    terrainStrokes?: MapTerrainStroke[];
    meta?: MapShapeRequestMeta;
}

import type {CSSProperties} from 'react';

export type MapRgbaColor = [number, number, number, number];

/** @deprecated 使用 {@link MapRgbaColor}。 */
export type DeckColor = MapRgbaColor;

export type MapKeyLocationRenderMode = 'circle' | 'icon' | 'auto';

export interface MapPreviewShapeStyle {
    /** 多边形描边宽度，按屏幕像素计算。 */
    lineWidth?: number;
}

export interface MapPreviewKeyLocationStyle {
    /** 关键地点渲染模式。`auto` 会在存在 icon.url 时渲染图标，否则回退圆点。 */
    renderMode?: MapKeyLocationRenderMode;
    /** 关键地点圆点半径，按屏幕像素计算。 */
    radius?: number;
    /** 关键地点圆点描边颜色。 */
    strokeColor?: MapRgbaColor;
    /** 关键地点圆点描边宽度，按屏幕像素计算。 */
    strokeWidth?: number;
    /** 是否显示关键地点圆点描边。 */
    showStroke?: boolean;
    /** 关键地点图标尺寸，按屏幕像素计算；地点自身的 iconSize 优先。 */
    iconSize?: number;
}

export interface MapPreviewLabelStyle {
    /** 关键地点标签字号，按屏幕像素计算。 */
    fontSize?: number;
    /** 关键地点标签颜色。 */
    color?: MapRgbaColor;
    /** 关键地点标签字体族。 */
    fontFamily?: string;
    /** 关键地点标签字重。 */
    fontWeight?: string;
}

export interface MapPreviewShape extends MapShapeExtensible {
    id: string;
    name: string;
    polygon: [number, number][];
    fillColor: MapRgbaColor;
    lineColor: MapRgbaColor;
    bizId?: string | null;
    kind?: 'coastline';
}

export interface MapPreviewKeyLocation extends MapShapeExtensible {
    id: string;
    name: string;
    type: string;
    position: [number, number];
    markerClass?: MapMarkerClass | null;
    /** @deprecated 旧数据兼容字段；渲染与编辑不再要求显式关联。 */
    shapeId?: string | null;
    color: MapRgbaColor;
    icon?: MapPreviewKeyLocationIcon | null;
    iconSize?: number;
    bizId?: string | null;
}

export interface MapPreviewKeyLocationIcon extends MapShapeExtensible {
    url: string;
    width?: number;
    height?: number;
    anchorX?: number;
    anchorY?: number;
    mask?: boolean;
}

export interface MapPreviewBackgroundImage {
    url: string;
    /**
     * 生成型纹理的 canvas 直通源：存在时优先于 url（url 可为空串），
     * 免去 dataURL 的 PNG 编解码往返。仅 Pixi 渲染器消费；Deck 侧忽略。
     */
    source?: HTMLCanvasElement;
    /** 0–1，默认 1 */
    opacity?: number;
    /** 图片适配模式，默认 'fill' */
    fit?: 'fill' | 'cover' | 'contain';
}

export interface MapPreviewScene extends MapShapeExtensible {
    canvas: MapEditorCanvas;
    shapes: MapPreviewShape[];
    keyLocations: MapPreviewKeyLocation[];
    terrainStrokes?: MapTerrainStroke[];
    backgroundImage?: MapPreviewBackgroundImage;
}

export interface MapShapeResponseMeta extends MapShapeExtensible {
    protocolVersion?: MapShapeProtocolVersion;
    scenario?: 'coastline_mvp';
    requestId?: string;
    persisted?: boolean;
}

export interface MapShapeSaveResponse {
    scene: MapPreviewScene;
    savedAt: string;
    message?: string;
    meta?: MapShapeResponseMeta;
}

export interface MapShapeEditorApi {
    saveScene: (request: MapShapeSaveRequest) => Promise<MapShapeSaveResponse>;
}

export type MapValidationSeverity = 'error';

export type MapValidationSource = 'shape' | 'keyLocation' | 'draft';

export type MapValidationCode =
    | 'shape_too_few_vertices'
    | 'shape_duplicate_vertices'
    | 'shape_close_vertices'
    | 'shape_self_intersection'
    | 'key_location_name_required'
    | 'key_location_type_required'
    | 'draft_no_shape'
    | 'draft_shape_drawing_in_progress';

export interface MapValidationIssue {
    code: MapValidationCode;
    severity: MapValidationSeverity;
    source: MapValidationSource;
    message: string;
    shapeId?: string;
    keyLocationId?: string;
}

export interface MapShapeValidationResult {
    shapeId: string;
    issues: MapValidationIssue[];
    isValid: boolean;
}

export interface MapKeyLocationValidationResult {
    keyLocationId: string;
    issues: MapValidationIssue[];
    isValid: boolean;
}

export interface MapDraftValidationResult {
    issues: MapValidationIssue[];
    isValid: boolean;
}

export interface MapValidationResult {
    issues: MapValidationIssue[];
    shapeResults: MapShapeValidationResult[];
    keyLocationResults: MapKeyLocationValidationResult[];
    draftResult: MapDraftValidationResult;
    isValid: boolean;
}

export type MapShapeSubmitErrorKind = 'timeout' | 'transport' | 'invalid_response';

export type MapShapeServiceErrorCode =
    | 'MAP_SHAPE_VALIDATION_FAILED'
    | 'MAP_SHAPE_PERMISSION_DENIED'
    | 'MAP_SHAPE_NOT_FOUND'
    | 'MAP_SHAPE_CONFLICT'
    | 'MAP_SHAPE_INTERNAL_ERROR'
    | (string & {});

export interface MapShapeFieldError extends MapShapeExtensible {
    field: string;
    code: string;
    message: string;
}

export interface MapShapeSaveErrorResponse extends MapShapeExtensible {
    code: MapShapeServiceErrorCode;
    message: string;
    requestId?: string;
    retryable?: boolean;
    fieldErrors?: MapShapeFieldError[];
}

// ── 渲染器无关的预览类型 ────────────────────────────────────────────

export interface MapPreviewPickBaseDetail {
    index: number;
    layerId?: string;
    x: number;
    y: number;
    coordinate?: number[];
}

export interface MapPreviewEmptyPickDetail extends MapPreviewPickBaseDetail {
    kind: 'empty';
    object: null;
}

export interface MapPreviewShapePickDetail extends MapPreviewPickBaseDetail {
    kind: 'shape';
    object: MapPreviewShape;
}

export interface MapPreviewKeyLocationPickDetail extends MapPreviewPickBaseDetail {
    kind: 'keyLocation';
    object: MapPreviewKeyLocation;
}

export type MapPreviewPickDetail =
    | MapPreviewEmptyPickDetail
    | MapPreviewShapePickDetail
    | MapPreviewKeyLocationPickDetail;

export interface MapPreviewTooltip {
    text?: string;
    html?: string;
    className?: string;
    style?: CSSProperties;
}
