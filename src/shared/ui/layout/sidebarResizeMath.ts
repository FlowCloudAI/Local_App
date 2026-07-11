export function resolveSidebarDrag(
    rawWidth: number,
    minWidth: number,
    maxWidth: number,
    collapseThreshold: number,
) {
    return {
        width: Math.min(maxWidth, Math.max(minWidth, rawWidth)),
        shouldCollapse: rawWidth <= collapseThreshold,
    }
}
