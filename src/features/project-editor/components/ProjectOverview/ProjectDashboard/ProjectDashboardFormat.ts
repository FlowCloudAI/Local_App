const numberFormatter = new Intl.NumberFormat('zh-CN')

export function formatDashboardNumber(value: number | null | undefined): string {
    if (value == null || Number.isNaN(value)) return '--'
    return numberFormatter.format(value)
}

export function formatDashboardRatio(value: number): string {
    if (!Number.isFinite(value)) return '--'
    return `${Math.round(value * 100)}%`
}
