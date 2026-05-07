import {type CSSProperties, useState} from 'react';

import type {
    MapEditorCanvas,
    MapPreviewKeyLocationStyle,
    MapPreviewLabelStyle,
    MapPreviewScene,
    MapPreviewShapeStyle,
    MapShapeEditorViewBox,
} from './types';
import type {MapDeckPreviewProps} from './MapDeckPreview';
import {MapDeckPreview} from './MapDeckPreview';
import type {MapPixiPreviewProps} from './MapPixiPreview';
import {MapPixiPreview} from './MapPixiPreview';
import type {MapShapeSvgEditorProps} from './MapShapeSvgEditor';
import {MapShapeSvgEditor} from './MapShapeSvgEditor';
import {createInitialMapShapeEditorViewBox} from './mapShapeEditorSvgUtils';
import './MapShapeEditor.css';

export type MapShapeViewportMode = 'edit' | 'preview';
export type MapShapeViewportRenderer = 'deck' | 'pixi';

export interface MapShapeViewportProps {
    mode: MapShapeViewportMode;
    renderer?: MapShapeViewportRenderer;
    canvas: MapEditorCanvas;
    scene: MapPreviewScene | null;
    /**
     * 编辑图层的受控 viewBox。编辑模式下必需，以使
     * SVG 编辑器与 deck 预览保持同步。预览模式下忽略。
     * 编辑模式下若省略，视口将在内部管理 viewBox。
     */
    viewBox?: MapShapeEditorViewBox;
    onViewBoxChange?: (viewBox: MapShapeEditorViewBox) => void;
    /**
     * 转发给 `MapShapeSvgEditor` 的 props。`canvas`、`viewBox` 和
     * `onViewBoxChange` 由视口控制，不可在此设置。
     */
    svgProps?: Omit<MapShapeSvgEditorProps, 'canvas' | 'viewBox' | 'onViewBoxChange'>;
    /** 通用图形样式，会转发给当前预览渲染器。 */
    shapeStyle?: MapPreviewShapeStyle;
    /** 通用关键地点样式，会转发给当前预览渲染器。 */
    keyLocationStyle?: MapPreviewKeyLocationStyle;
    /** 通用标签样式，会转发给当前预览渲染器。 */
    labelStyle?: MapPreviewLabelStyle;
    /**
     * Props forwarded to `MapDeckPreview`. `scene`、`syncViewBox`、`disableTooltip`、
     * `interactive`、交互开关、`onPreviewViewBoxChange` 和通用样式由 viewport 托管，不能在这里设置。
     */
    deckProps?: Omit<
        MapDeckPreviewProps,
        'scene' | 'syncViewBox' | 'disableTooltip' | 'interactive' | 'enablePanZoom' | 'enablePicking' | 'shapeStyle' | 'keyLocationStyle' | 'labelStyle' | 'onPreviewViewBoxChange'
    >;
    /**
     * Props forwarded to `MapPixiPreview`. `scene`、`syncViewBox`、`interactive`、
     * 交互开关、`onPreviewViewBoxChange` 和通用样式由 viewport 托管，不能在这里设置。
     */
    pixiProps?: Omit<
        MapPixiPreviewProps,
        'scene' | 'syncViewBox' | 'interactive' | 'enablePanZoom' | 'enablePicking' | 'shapeStyle' | 'keyLocationStyle' | 'labelStyle' | 'onPreviewViewBoxChange'
    >;
    /**
     * 预览视口变化回调。仅在预览渲染器处于 `interactive` 模式时触发。
     * 编辑模式下视口由 `viewBox` / `onViewBoxChange` 控制，不会触发此回调。
     */
    onPreviewViewBoxChange?: (viewBox: MapShapeEditorViewBox) => void;
    /** 是否启用预览态滚轮缩放和拖拽平移；默认仅预览模式启用。 */
    enablePreviewPanZoom?: boolean;
    /** 是否启用预览态 picking、hover、click 与 tooltip；默认仅预览模式启用。 */
    enablePreviewPicking?: boolean;
    className?: string;
    style?: CSSProperties;
}

export function MapShapeViewport({
                                     mode,
                                     renderer = 'deck',
                                     canvas,
                                     scene,
                                     viewBox: viewBoxProp,
                                     onViewBoxChange,
                                     svgProps,
                                     shapeStyle,
                                     keyLocationStyle,
                                     labelStyle,
                                     deckProps,
                                     pixiProps,
                                     onPreviewViewBoxChange,
                                     enablePreviewPanZoom,
                                     enablePreviewPicking,
                                     className,
                                     style,
                                 }: MapShapeViewportProps) {
    const [internalViewBox, setInternalViewBox] = useState<MapShapeEditorViewBox>(
        () => createInitialMapShapeEditorViewBox(canvas),
    );

    const isEditMode = mode === 'edit';
    const panZoomEnabled = !isEditMode && (enablePreviewPanZoom ?? true);
    const pickingEnabled = !isEditMode && (enablePreviewPicking ?? true);
    const viewBox = viewBoxProp ?? internalViewBox;
    const svgEditorClassName = [
        'fc-map-shape-viewport__svg-editor',
        svgProps?.className,
    ].filter(Boolean).join(' ');
    const deckPreviewClassName = [
        'fc-map-shape-viewport__deck-preview',
        deckProps?.className,
    ].filter(Boolean).join(' ');
    const pixiPreviewClassName = [
        'fc-map-shape-viewport__pixi-preview',
        pixiProps?.className,
    ].filter(Boolean).join(' ');

    const handleViewBoxChange = (next: MapShapeEditorViewBox) => {
        if (viewBoxProp === undefined) {
            setInternalViewBox(next);
        }
        onViewBoxChange?.(next);
    };

    return (
        <div
            className={`fc-map-shape-viewport${className ? ` ${className}` : ''}`}
            style={{
                position: 'relative',
                width: '100%',
                aspectRatio: `${canvas.width} / ${canvas.height}`,
                overflow: 'hidden',
                ...style,
            }}
        >
            {/* 预览层始终渲染，编辑模式下位于 SVG 下方。 */}
            <div className="fc-map-shape-viewport__layer fc-map-shape-viewport__preview-layer">
                {renderer === 'pixi' ? (
                    <MapPixiPreview
                        {...pixiProps}
                        scene={scene}
                        syncViewBox={isEditMode ? viewBox : undefined}
                        enablePanZoom={panZoomEnabled}
                        enablePicking={pickingEnabled}
                        shapeStyle={shapeStyle}
                        keyLocationStyle={keyLocationStyle}
                        labelStyle={labelStyle}
                        onPreviewViewBoxChange={onPreviewViewBoxChange}
                        className={pixiPreviewClassName}
                    />
                ) : (
                    <MapDeckPreview
                        {...deckProps}
                        scene={scene}
                        syncViewBox={isEditMode ? viewBox : undefined}
                        disableTooltip={isEditMode}
                        enablePanZoom={panZoomEnabled}
                        enablePicking={pickingEnabled}
                        shapeStyle={shapeStyle}
                        keyLocationStyle={keyLocationStyle}
                        labelStyle={labelStyle}
                        onPreviewViewBoxChange={onPreviewViewBoxChange}
                        className={deckPreviewClassName}
                    />
                )}
            </div>

            {/* SVG 编辑层仅在编辑模式下显示，始终覆盖在预览层上方。 */}
            {isEditMode && (
                <div className="fc-map-shape-viewport__layer fc-map-shape-viewport__svg-layer">
                    <MapShapeSvgEditor
                        {...(svgProps as MapShapeSvgEditorProps)}
                        canvas={canvas}
                        viewBox={viewBox}
                        onViewBoxChange={handleViewBoxChange}
                        className={svgEditorClassName}
                        width="100%"
                        height="100%"
                    />
                </div>
            )}
        </div>
    );
}
