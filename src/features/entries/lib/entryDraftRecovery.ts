/**
 * 使用浏览器原生 IndexedDB 保存正文恢复快照；正式词条数据库仍是唯一持久化事实源。
 */
const DATABASE_NAME = 'flowcloudai-entry-recovery'
const DATABASE_VERSION = 1
const STORE_NAME = 'entry-drafts'

export interface EntryDraftRecoveryRecord {
    key: string
    version: 1
    projectId: string
    entryId: string
    baseUpdatedAt: string
    savedAt: number
    content: string
}

export type EntryDraftRecoveryKind = 'current' | 'stale'

let databasePromise: Promise<IDBDatabase> | null = null

export function buildEntryDraftRecoveryKey(projectId: string, entryId: string): string {
    return JSON.stringify([projectId, entryId])
}

export function resolveEntryDraftRecoveryKind(
    record: EntryDraftRecoveryRecord,
    currentUpdatedAt: string,
): EntryDraftRecoveryKind {
    return record.baseUpdatedAt === currentUpdatedAt ? 'current' : 'stale'
}

function isEntryDraftRecoveryRecord(value: unknown): value is EntryDraftRecoveryRecord {
    if (!value || typeof value !== 'object') return false
    const record = value as Partial<EntryDraftRecoveryRecord>
    return record.version === 1
        && typeof record.key === 'string'
        && typeof record.projectId === 'string'
        && typeof record.entryId === 'string'
        && typeof record.baseUpdatedAt === 'string'
        && typeof record.savedAt === 'number'
        && Number.isFinite(record.savedAt)
        && typeof record.content === 'string'
}

function openRecoveryDatabase(): Promise<IDBDatabase> {
    if (databasePromise) return databasePromise
    const opening = new Promise<IDBDatabase>((resolve, reject) => {
        const request = window.indexedDB.open(DATABASE_NAME, DATABASE_VERSION)
        request.onupgradeneeded = () => {
            const database = request.result
            if (!database.objectStoreNames.contains(STORE_NAME)) {
                database.createObjectStore(STORE_NAME, {keyPath: 'key'})
            }
        }
        request.onsuccess = () => {
            const database = request.result
            database.onversionchange = () => database.close()
            resolve(database)
        }
        request.onerror = () => reject(request.error ?? new Error('打开正文恢复存储失败'))
        request.onblocked = () => reject(new Error('正文恢复存储被其他窗口占用'))
    }).catch((error) => {
        databasePromise = null
        throw error
    })
    databasePromise = opening
    return opening
}

async function runRequest<T>(
    mode: IDBTransactionMode,
    requestFactory: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
    const database = await openRecoveryDatabase()
    return new Promise<T>((resolve, reject) => {
        const transaction = database.transaction(STORE_NAME, mode)
        const request = requestFactory(transaction.objectStore(STORE_NAME))
        let result!: T
        request.onsuccess = () => {
            result = request.result
        }
        request.onerror = () => reject(request.error ?? new Error('正文恢复存储操作失败'))
        transaction.oncomplete = () => resolve(result)
        transaction.onabort = () => reject(transaction.error ?? new Error('正文恢复存储事务已取消'))
    })
}

function canUseIndexedDb(): boolean {
    return typeof window !== 'undefined' && typeof window.indexedDB !== 'undefined'
}

export async function getEntryDraftRecovery(
    projectId: string,
    entryId: string,
): Promise<EntryDraftRecoveryRecord | null> {
    if (!canUseIndexedDb()) return null
    const result = await runRequest<unknown>(
        'readonly',
        (store) => store.get(buildEntryDraftRecoveryKey(projectId, entryId)),
    )
    return isEntryDraftRecoveryRecord(result) ? result : null
}

export async function saveEntryDraftRecovery(
    record: Omit<EntryDraftRecoveryRecord, 'key' | 'version'>,
): Promise<void> {
    if (!canUseIndexedDb()) return
    await runRequest(
        'readwrite',
        (store) => store.put({
            ...record,
            key: buildEntryDraftRecoveryKey(record.projectId, record.entryId),
            version: 1,
        } satisfies EntryDraftRecoveryRecord),
    )
}

export async function deleteEntryDraftRecovery(projectId: string, entryId: string): Promise<void> {
    if (!canUseIndexedDb()) return
    await runRequest(
        'readwrite',
        (store) => store.delete(buildEntryDraftRecoveryKey(projectId, entryId)),
    )
}
