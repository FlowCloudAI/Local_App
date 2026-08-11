// 根据插件网格的实际可用高度计算分页容量，供桌面端与移动端插件管理复用。
import {useCallback, useEffect, useState} from 'react'

export function usePluginPageCapacity(active: boolean, contentSize: number, columns = 2) {
    const [viewport, setViewport] = useState<HTMLDivElement | null>(null)
    const [list, setList] = useState<HTMLDivElement | null>(null)
    const [pageSize, setPageSize] = useState(columns)
    const viewportRef = useCallback((node: HTMLDivElement | null) => setViewport(node), [])
    const listRef = useCallback((node: HTMLDivElement | null) => setList(node), [])

    useEffect(() => {
        if (!active || !viewport || !list) return

        let measureFrame = 0
        const measure = () => {
            cancelAnimationFrame(measureFrame)
            measureFrame = requestAnimationFrame(() => {
                const items = Array.from(list.children).filter(
                    (item): item is HTMLElement => item instanceof HTMLElement,
                )
                if (items.length === 0) return

                const rowGap = Number.parseFloat(getComputedStyle(list).rowGap) || 0
                const rowHeight = Math.max(...items.map(item => item.getBoundingClientRect().height))
                const rows = Math.max(1, Math.round((viewport.clientHeight + rowGap) / (rowHeight + rowGap)))
                const nextPageSize = rows * columns
                setPageSize(current => current === nextPageSize ? current : nextPageSize)
            })
        }

        const observer = new ResizeObserver(measure)
        observer.observe(viewport)
        measure()

        return () => {
            observer.disconnect()
            cancelAnimationFrame(measureFrame)
        }
    }, [active, columns, contentSize, list, viewport])

    return {viewportRef, listRef, pageSize}
}
