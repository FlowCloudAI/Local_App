/**
 * 词条详情按需加载的去重规则；并发请求复用同一个 Promise，失败后允许重试。
 */
export function ensureEntryDetailLoaded(
    id: string,
    loadedIds: Set<string>,
    pendingLoads: Map<string, Promise<void>>,
    load: () => Promise<void>,
): Promise<void> {
    const pending = pendingLoads.get(id)
    if (pending) return pending
    if (loadedIds.has(id)) return Promise.resolve()

    loadedIds.add(id)
    const next = load()
        .catch((error) => {
            loadedIds.delete(id)
            throw error
        })
        .finally(() => {
            if (pendingLoads.get(id) === next) pendingLoads.delete(id)
        })
    pendingLoads.set(id, next)
    return next
}
