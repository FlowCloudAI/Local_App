export interface TimelineGeometryEvent {
    startTime: number
    endTime?: number
}

export interface TimelineRowEvent {
    layoutStartX: number
    layoutCardWidth: number
}

export interface TimelineRowPlacement {
    rowIndex: number
}

export const LEFT_OFFSET = 50
export const MIN_CARD_WIDTH = 160
export const MAX_CARD_WIDTH = 360
const MIN_ZOOM = 0.05

function getCardWidth(event: TimelineGeometryEvent, range: number, trackWidth: number, zoom: number) {
    if (typeof event.endTime !== 'number') return MIN_CARD_WIDTH

    const durationWidth = ((event.endTime - event.startTime) / range) * trackWidth * zoom
    if (durationWidth <= 0) return MIN_CARD_WIDTH
    return Math.min(Math.max(durationWidth, MIN_CARD_WIDTH), MAX_CARD_WIDTH)
}

export function calculateTimelineFitZoom(
    events: TimelineGeometryEvent[],
    yearStart: number,
    yearEnd: number,
    viewportWidth: number,
    trackWidth: number,
) {
    if (viewportWidth <= 0) return MIN_ZOOM

    const range = Math.max(yearEnd - yearStart, 1)
    const availableWidth = viewportWidth - LEFT_OFFSET * 2
    const fits = (zoom: number) => events.every((event) => {
        const startX = ((event.startTime - yearStart) / range) * trackWidth * zoom
        return startX + getCardWidth(event, range, trackWidth, zoom) <= availableWidth
    })

    if (fits(1)) return 1
    if (!fits(MIN_ZOOM)) return MIN_ZOOM

    let lower = MIN_ZOOM
    let upper = 1
    for (let index = 0; index < 24; index += 1) {
        const middle = (lower + upper) / 2
        if (fits(middle)) lower = middle
        else upper = middle
    }
    return lower
}

export function calculateTimelineRowCapacity(viewportHeight: number, singleRowHeight: number, rowGap: number) {
    if (viewportHeight <= singleRowHeight || rowGap <= 0) return 1
    return 1 + Math.floor((viewportHeight - singleRowHeight) / rowGap)
}

export function placeTimelineRows(events: TimelineRowEvent[], maxRows: number, cardGap = 30) {
    const rowCapacity = Number.isFinite(maxRows) ? Math.max(1, Math.floor(maxRows)) : 1
    const rows: number[] = []
    const placements: TimelineRowPlacement[] = []

    for (const event of events) {
        const rightX = event.layoutStartX + event.layoutCardWidth
        const availableRow = rows.findIndex(rowRightX => rowRightX + cardGap <= event.layoutStartX)

        if (availableRow >= 0) {
            rows[availableRow] = rightX
            placements.push({rowIndex: availableRow})
        } else if (rows.length < rowCapacity) {
            placements.push({rowIndex: rows.length})
            rows.push(rightX)
        } else {
            let leastOverlappingRow = 0
            for (let index = 1; index < rows.length; index += 1) {
                if (rows[index] < rows[leastOverlappingRow]) leastOverlappingRow = index
            }
            rows[leastOverlappingRow] = Math.max(rows[leastOverlappingRow], rightX)
            placements.push({rowIndex: leastOverlappingRow})
        }
    }

    return placements
}
