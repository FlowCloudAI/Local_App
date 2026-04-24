import {type CSSProperties, useRef} from 'react'
import {
    MapDeckPreview,
    type MapDeckPreviewProps,
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
    deckProps?: Omit<MapDeckPreviewProps, 'scene'>
    backgroundImageUrl?: string
    style?: CSSProperties
}

export default function WorldMapOverlay({
                                            scene,
                                            canvas,
                                            draft,
                                            viewBox,
                                            onViewBoxChange,
                                            markers = [],
                                            deckProps,
                                            backgroundImageUrl,
                                            style,
                                        }: WorldMapOverlayProps) {
    const containerRef = useRef<HTMLDivElement>(null)

    return (
        <div ref={containerRef} className="world-map-overlay" style={style}>
            <div className="world-map-overlay__deck">
                <MapDeckPreview
                    scene={scene}
                    {...deckProps}
                    style={{width: '100%', height: '100%'}}
                />
            </div>

            <div className="world-map-overlay__svg" style={{pointerEvents: 'none'}}>
                <MapShapeSvgEditor
                    canvas={canvas}
                    draft={draft}
                    selectedShapeId={null}
                    selectedLocationId={null}
                    drawingShape={null}
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
