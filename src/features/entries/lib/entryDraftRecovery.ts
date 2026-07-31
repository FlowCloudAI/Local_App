/**
 * 使用浏览器原生 IndexedDB 保存词条恢复快照；正式词条数据库仍是唯一持久化事实源。
 */
import type {EntryRelationDraft} from '../../project-editor/components/EntryRelations/EntryRelationCreator'
import type {EntryImage} from './entryImage'

const DATABASE_NAME = 'flowcloudai-entry-recovery'
const DATABASE_VERSION = 1
const STORE_NAME = 'entry-drafts'

export interface EntryDraftRecoverySnapshot {
    title?: string
    summary?: string
    content?: string
    type?: string | null
    categoryId?: string | null
    tags?: Record<string, string | number | boolean | null>
    images?: EntryImage[]
    relationDrafts?: EntryRelationDraft[]
}

export type EntryDraftRecoveryField = keyof EntryDraftRecoverySnapshot
const RECOVERY_FIELD_ORDER: EntryDraftRecoveryField[] = [
    'title',
    'summary',
    'content',
    'type',
    'categoryId',
    'tags',
    'images',
    'relationDrafts',
]

export interface EntryDraftRecoveryRecord {
    key: string
    version: 2
    projectId: string
    entryId: string
    baseUpdatedAt: string
    savedAt: number
    draft: EntryDraftRecoverySnapshot
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

function isRecoveryRecordBase(value: unknown): value is {
    key: string
    projectId: string
    entryId: string
    baseUpdatedAt: string
    savedAt: number
} {
    if (!value || typeof value !== 'object') return false
    const record = value as Partial<EntryDraftRecoveryRecord>
    return typeof record.key === 'string'
        && typeof record.projectId === 'string'
        && typeof record.entryId === 'string'
        && typeof record.baseUpdatedAt === 'string'
        && typeof record.savedAt === 'number'
        && Number.isFinite(record.savedAt)
}

function isRecoverySnapshot(value: unknown): value is EntryDraftRecoverySnapshot {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return false
    const draft = value as EntryDraftRecoverySnapshot
    const isOptionalString = (item: unknown) => item === undefined || typeof item === 'string'
    const isOptionalNullableString = (item: unknown) => (
        item === undefined || item === null || typeof item === 'string'
    )
    const tagsValid = draft.tags === undefined || (
        draft.tags !== null
        && typeof draft.tags === 'object'
        && !Array.isArray(draft.tags)
        && Object.values(draft.tags).every((item) => (
            item === null
            || typeof item === 'string'
            || typeof item === 'number'
            || typeof item === 'boolean'
        ))
    )
    const relationsValid = draft.relationDrafts === undefined || (
        Array.isArray(draft.relationDrafts)
        && draft.relationDrafts.every((item) => (
            item
            && typeof item === 'object'
            && (item.id === undefined || typeof item.id === 'string')
            && (item.otherEntryId === null || typeof item.otherEntryId === 'string')
            && (item.direction === 'outgoing' || item.direction === 'incoming' || item.direction === 'two_way')
            && typeof item.content === 'string'
        ))
    )
    return isOptionalString(draft.title)
        && isOptionalString(draft.summary)
        && isOptionalString(draft.content)
        && isOptionalNullableString(draft.type)
        && isOptionalNullableString(draft.categoryId)
        && tagsValid
        && (draft.images === undefined || Array.isArray(draft.images))
        && relationsValid
}

export function normalizeEntryDraftRecoveryRecord(value: unknown): EntryDraftRecoveryRecord | null {
    if (!isRecoveryRecordBase(value)) return null
    const versioned = value as {
        version?: unknown
        draft?: unknown
        content?: unknown
    }
    if (versioned.version === 2 && isRecoverySnapshot(versioned.draft)) {
        return value as EntryDraftRecoveryRecord
    }
    if (versioned.version === 1 && typeof versioned.content === 'string') {
        return {
            key: value.key,
            version: 2,
            projectId: value.projectId,
            entryId: value.entryId,
            baseUpdatedAt: value.baseUpdatedAt,
            savedAt: value.savedAt,
            draft: {content: versioned.content},
        }
    }
    return null
}

function areRecoveryValuesEqual(left: unknown, right: unknown): boolean {
    if (Object.is(left, right)) return true
    if (Array.isArray(left) || Array.isArray(right)) {
        return Array.isArray(left)
            && Array.isArray(right)
            && left.length === right.length
            && left.every((item, index) => areRecoveryValuesEqual(item, right[index]))
    }
    if (!left || !right || typeof left !== 'object' || typeof right !== 'object') return false
    const leftRecord = left as Record<string, unknown>
    const rightRecord = right as Record<string, unknown>
    const leftKeys = Object.keys(leftRecord)
    const rightKeys = Object.keys(rightRecord)
    return leftKeys.length === rightKeys.length
        && leftKeys.every((key) => (
            Object.hasOwn(rightRecord, key)
            && areRecoveryValuesEqual(leftRecord[key], rightRecord[key])
        ))
}

export function getEntryDraftRecoveryFields(
    record: EntryDraftRecoveryRecord,
    baseline: EntryDraftRecoverySnapshot,
): EntryDraftRecoveryField[] {
    return RECOVERY_FIELD_ORDER.filter((field) => (
        record.draft[field] !== undefined
        && !areRecoveryValuesEqual(record.draft[field], baseline[field])
    ))
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
    return normalizeEntryDraftRecoveryRecord(result)
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
            version: 2,
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
