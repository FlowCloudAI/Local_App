/* 词条地图位置入口：仅在词条存在地点绑定时显示，并用统一地图视口承载定位预览。 */
import {Button} from 'flowcloudai-ui'
import {useEffect, useState} from 'react'
import {map_list_project_maps} from '../../../api'
import {FloatingPanel} from '../../../shared/ui/overlay'
import {MapShapeViewport} from './MapShapeEditor'
import {findEntryMapBinding, type EntryMapBinding} from './entryMapBinding'
import './EntryMapLocationOverlay.css'

interface EntryMapLocationOverlayProps {
    active: boolean
    projectId: string
    entryId: string
    onEnterMap: (target: {mapId: string; locationId: string}) => void
}

export default function EntryMapLocationOverlay({
                                                    active,
                                                    projectId,
                                                    entryId,
                                                    onEnterMap,
                                                }: EntryMapLocationOverlayProps) {
    const [binding, setBinding] = useState<EntryMapBinding | null>(null)
    const [open, setOpen] = useState(false)

    useEffect(() => {
        if (!active) {
            setOpen(false)
            return undefined
        }

        let cancelled = false
        setBinding(null)
        void map_list_project_maps(projectId).then((maps) => {
            if (!cancelled) setBinding(findEntryMapBinding(maps, entryId))
        }).catch(() => {
            if (!cancelled) setBinding(null)
        })
        return () => {
            cancelled = true
        }
    }, [active, entryId, projectId])

    if (!binding) return null

    return (
        <>
            <Button type="button" variant="outline" size="sm" radius="full" onClick={() => setOpen(true)}>
                地图位置
            </Button>
            <FloatingPanel
                open={open}
                onClose={() => setOpen(false)}
                title={`${binding.mapName} · ${binding.locationName}`}
                className="entry-map-location-overlay"
            >
                <div className="entry-map-location-overlay__viewport">
                    <MapShapeViewport
                        mode="preview"
                        canvas={binding.scene.canvas}
                        scene={binding.scene}
                        markers={[binding.marker]}
                        enablePreviewPicking={false}
                        keyLocationStyle={{radius: 8}}
                        labelStyle={{fontSize: 13}}
                    />
                </div>
                <div className="entry-map-location-overlay__footer">
                    <div className="entry-map-location-overlay__meta">
                        <strong>{binding.locationName}</strong>
                        <span>
                            坐标 {binding.marker.position[0].toFixed(1)} / {binding.marker.position[1].toFixed(1)}
                        </span>
                    </div>
                    <Button
                        type="button"
                        size="sm"
                        onClick={() => {
                            setOpen(false)
                            onEnterMap({mapId: binding.mapId, locationId: binding.locationId})
                        }}
                    >
                        进入地图
                    </Button>
                </div>
            </FloatingPanel>
        </>
    )
}
