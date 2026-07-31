/**
 * 词条详情按需加载的去重规则；只负责预留本轮尚未加载的 ID。
 */
export function reserveMissingEntryDetailIds(
    ids: string[],
    loadedIds: Set<string>,
    currentEntryId: string,
): string[] {
    const missingIds = [...new Set(ids)].filter((id) => (
        id !== currentEntryId && !loadedIds.has(id)
    ))
    missingIds.forEach((id) => loadedIds.add(id))
    return missingIds
}
