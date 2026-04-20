import {useRef} from 'react'
import {
    MapDeckPreview,
    type MapDeckPreviewRenderOptions,
    type MapEditorCanvas,
    type MapPreviewScene,
    type MapShapeEditorDraft,
    type MapShapeEditorViewBox,
    MapShapeSvgEditor,
} from 'flowcloudai-ui'
import './WorldMapOverlay.css'

export interface WorldMapOverlayMarker {
    id: string
    x: number
    y: number
    label?: string
    color?: string
}

interface WorldMapOverlayProps {
    scene: MapPreviewScene | null
    canvas: MapEditorCanvas
    draft: MapShapeEditorDraft
    viewBox: MapShapeEditorViewBox
    onViewBoxChange: (viewBox: MapShapeEditorViewBox) => void
    markers?: WorldMapOverlayMarker[]
    previewRenderOptions?: MapDeckPreviewRenderOptions
    backgroundImageUrl?: string
    style?: React.CSSProperties
}

export default function WorldMapOverlay({
                                            scene,
                                            canvas,
                                            draft,
                                            viewBox,
                                            onViewBoxChange,
                                            markers = [],
                                            previewRenderOptions,
                                            backgroundImageUrl,
                                            style,
                                        }: WorldMapOverlayProps) {
    const containerRef = useRef<HTMLDivElement>(null)

    const scaleX = viewBox.width > 0 ? (containerRef.current?.clientWidth ?? canvas.width) / viewBox.width : 1
    const scaleY = viewBox.height > 0 ? (containerRef.current?.clientHeight ?? canvas.height) / viewBox.height : 1

    return (
        <div ref={containerRef} className="world-map-overlay" style={style}>
            <div className="world-map-overlay__deck">
                <MapDeckPreview
                    scene={scene}
                    previewRenderOptions={previewRenderOptions}
                    style={{width: '100%', height: '100%'}}
                />
            </div>

            <div className="world-map-overlay__svg" style={{pointerEvents: 'none'}}>
                <MapShapeSvgEditor
                    canvas={canvas}
                    draft={draft}
                    viewBox={viewBox}
                    backgroundImage={backgroundImageUrl}
                    readOnly={true}
                    width="100%"
                    height="100%"
                    onViewBoxChange={onViewBoxChange}
                    onDraftChange={() => {
                    }}
                    onSelectedShapeChange={() => {
                    }}
                    onSelectedLocationChange={() => {
                    }}
                    onDrawingShapeChange={() => {
                    }}
                    onRequestShapeDelete={() => {
                    }}
                    onRequestVertexDelete={() => {
                    }}
                    onRequestLocationDelete={() => {
                    }}
                />
            </div>

            {markers.length > 0 && (
                <svg
                    className="world-map-overlay__markers"
                    viewBox={`${viewBox.x} ${viewBox.y} ${viewBox.width} ${viewBox.height}`}
                    style={{pointerEvents: 'none'}}
                >
                    {markers.map((marker) => (
                        <g key={marker.id} transform={`translate(${marker.x}, ${marker.y})`}>
                            <circle r={6} fill={marker.color ?? 'var(--fc-color-primary, #3b82f6)'} opacity={0.9}/>
                            {marker.label && (
                                <text
                                    x={9}
                                    y={4}
                                    fontSize={12}
                                    fill="var(--fc-color-text, #fff)"
                                    style={{userSelect: 'none'}}
                                >
                                    {marker.label}
                                </text>
                            )}
                        </g>
                    ))}
                </svg>
            )}
        </div>
    )
}
