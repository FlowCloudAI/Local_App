/**
 * 开发期浏览器预览的内存 mock 后端（仅 dev 生效）。
 *
 * 背景：浏览器没有 Tauri 运行时，`db_*` / `setting_*` 等 IPC 全部失败，
 * 预览里每一页都停在「加载失败」，只能验证布局，验不了数据流——
 * 这导致「编辑态切 Tab 弹未保存确认」这类逻辑长期只能挂着等安卓机。
 * 装上这层后，预览能走真实读写路径：项目 → 词条 → 编辑 → 保存 → 再读。
 *
 * 边界与设计约束：
 * - **只在 `command()` 这一层拦截**，不去 shim `window.__TAURI_INTERNALS__`：
 *   后者会让 `isTauriRuntime()` 变 true，进而 `isBrowserPreview()` 变 false，
 *   带出 `is-tauri` 类名、真实 `listen()` 等一串副作用，与真机和真预览都不一样。
 * - 数据只在内存里，刷新即回到种子状态；不落 localStorage，避免走查时状态发霉。
 * - **不是后端的等价实现**，只覆盖核心创作闭环。未实现的命令一律显式 reject，
 *   让页面走它自己的错误态——宁可暴露「这块没 mock」，也不要静默返回假数据骗人。
 * - 生产构建下 `import.meta.env.DEV` 为 false，调用方分支被 DCE，本模块不进产物。
 */
import {setDevCommandHandler} from '../../api/base'
import type {PlatformInfo, PlatformOs} from '../../api/platform'
import type {Entry, EntryBrief, EntryTypeView, ProjectStats} from '../../api/worldflow'
import {getFormFactorOverride} from '../devPreview'
import {logger} from '../logger'
import {createMockDb, createMockSettings, MOCK_BUILTIN_ENTRY_TYPES, type MockDb} from './seed'

/** 刻意留一点延迟：让 loading 态、竞态和「点完就切走」这类时序问题在预览里也能复现。 */
const LATENCY_MS = 40

type Args = Record<string, unknown> | undefined

let db: MockDb = createMockDb()
let settings = createMockSettings()
let seq = 0

function nextId(prefix: string): string {
    seq += 1
    return `${prefix}-preview-${seq}`
}

function nowTs(): string {
    return new Date().toISOString().replace('T', ' ').slice(0, 19)
}

function readString(args: Args, key: string): string {
    const value = args?.[key]
    return typeof value === 'string' ? value : ''
}

function readOptString(args: Args, key: string): string | null {
    const value = args?.[key]
    return typeof value === 'string' && value ? value : null
}

function readNumber(args: Args, key: string, fallback: number): number {
    const value = args?.[key]
    return typeof value === 'number' ? value : fallback
}

function toEntryBrief(entry: Entry): EntryBrief {
    const images = entry.images ?? []
    const cover = images.find(image => image.is_cover) ?? null
    return {
        id: entry.id,
        project_id: entry.project_id,
        category_id: entry.category_id ?? null,
        title: entry.title,
        summary: entry.summary ?? null,
        type: entry.type ?? null,
        cover: cover?.path ?? cover?.url ?? null,
        updated_at: entry.updated_at ?? '',
    }
}

function listEntryTypes(projectId: string): EntryTypeView[] {
    const custom: EntryTypeView[] = db.customEntryTypes
        .filter(type => type.project_id === projectId)
        .map(type => ({kind: 'custom', ...type}))
    return [...MOCK_BUILTIN_ENTRY_TYPES, ...custom]
}

function filterEntries(args: Args): Entry[] {
    const projectId = readString(args, 'projectId')
    const categoryId = readOptString(args, 'categoryId')
    const entryType = readOptString(args, 'entryType')
    return db.entries.filter(entry => (
        entry.project_id === projectId
        && (!categoryId || (entry.category_id ?? null) === categoryId)
        && (!entryType || (entry.type ?? null) === entryType)
    ))
}

function requireEntry(id: string): Entry {
    const entry = db.entries.find(item => item.id === id)
    if (!entry) throw new Error(`预览 mock：词条不存在 (${id})`)
    return entry
}

function countWords(entry: Entry): number {
    return (entry.content ?? '').replace(/\s+/g, '').length
}

function buildProjectStats(projectId: string): ProjectStats {
    const entries = db.entries.filter(entry => entry.project_id === projectId)
    const relations = db.relations.filter(relation => relation.project_id === projectId)
    const byType = new Map<string | null, {count: number; wordCount: number}>()
    const byCategory = new Map<string | null, {count: number; wordCount: number}>()

    for (const entry of entries) {
        const typeKey = entry.type ?? null
        const categoryKey = entry.category_id ?? null
        const typeStat = byType.get(typeKey) ?? {count: 0, wordCount: 0}
        const categoryStat = byCategory.get(categoryKey) ?? {count: 0, wordCount: 0}
        typeStat.count += 1
        typeStat.wordCount += countWords(entry)
        categoryStat.count += 1
        categoryStat.wordCount += countWords(entry)
        byType.set(typeKey, typeStat)
        byCategory.set(categoryKey, categoryStat)
    }

    const linkedIds = new Set(relations.flatMap(relation => [relation.a_id, relation.b_id]))

    return {
        entryCount: entries.length,
        imageCount: entries.reduce((sum, entry) => sum + (entry.images?.length ?? 0), 0),
        wordCount: entries.reduce((sum, entry) => sum + countWords(entry), 0),
        relationCount: relations.length,
        internalLinkCount: 0,
        entriesByType: [...byType].map(([entryType, stat]) => ({entryType, ...stat})),
        entriesByCategory: [...byCategory].map(([categoryId, stat]) => ({categoryId, ...stat})),
        uncategorizedEntryCount: entries.filter(entry => !entry.category_id).length,
        emptyContentEntryCount: entries.filter(entry => !(entry.content ?? '').trim()).length,
        shortContentEntryCount: entries.filter(entry => countWords(entry) > 0 && countWords(entry) < 50).length,
        missingSummaryEntryCount: entries.filter(entry => !(entry.summary ?? '').trim()).length,
        isolatedEntryCount: entries.filter(entry => !linkedIds.has(entry.id)).length,
        createdLast7Days: 0,
        updatedLast7Days: entries.length,
        governanceScore: {score: 72, checks: [], dimensions: []},
    }
}

function mockPlatformInfo(): PlatformInfo {
    // 预览移动端时报 android：让 MobileApp 里那条「Esc 兜底返回」的开发用途分支生效。
    const formFactor = getFormFactorOverride() ?? 'desktop'
    const os: PlatformOs = formFactor === 'mobile' ? 'android' : 'windows'
    return {os, formFactor, windowControls: false}
}

/** 已实现的命令。未列出的一律 reject，页面走自身错误态。 */
const handlers: Record<string, (args: Args) => unknown> = {
    // ── 基础 ────────────────────────────────────────────────────────────────
    log_message: () => undefined,
    get_platform_info: () => mockPlatformInfo(),
    setting_is_backend_ready: () => true,
    setting_get_backend_status: () => ({phase: 'ready', message: null}),
    setting_get_settings: () => settings,
    setting_get_media_dir: () => '/preview/media',
    setting_update_settings: (args) => {
        const next = args?.newSettings
        if (next && typeof next === 'object') settings = next as typeof settings
        return 'ok'
    },

    // ── 项目 ────────────────────────────────────────────────────────────────
    db_list_projects: () => db.projects,
    db_get_project: (args) => {
        const id = readString(args, 'id')
        const project = db.projects.find(item => item.id === id)
        if (!project) throw new Error(`预览 mock：项目不存在 (${id})`)
        return project
    },
    db_get_project_stats: (args) => buildProjectStats(readString(args, 'projectId')),

    // ── 分类 ────────────────────────────────────────────────────────────────
    db_list_categories: (args) => {
        const projectId = readString(args, 'projectId')
        return db.categories.filter(category => category.project_id === projectId)
    },

    // ── 词条 ────────────────────────────────────────────────────────────────
    db_list_entries: (args) => {
        const offset = readNumber(args, 'offset', 0)
        const limit = readNumber(args, 'limit', 200)
        return filterEntries(args).slice(offset, offset + limit).map(toEntryBrief)
    },
    db_search_entries: (args) => {
        const query = readString(args, 'query').trim().toLowerCase()
        const limit = readNumber(args, 'limit', 200)
        return filterEntries(args)
            .filter(entry => !query
                || entry.title.toLowerCase().includes(query)
                || (entry.summary ?? '').toLowerCase().includes(query)
                || (entry.content ?? '').toLowerCase().includes(query))
            .slice(0, limit)
            .map(toEntryBrief)
    },
    db_count_entries: (args) => filterEntries(args).length,
    db_get_entry: (args) => requireEntry(readString(args, 'id')),
    db_create_entry: (args) => {
        const created: Entry = {
            id: nextId('ent'),
            project_id: readString(args, 'projectId'),
            category_id: readOptString(args, 'categoryId'),
            title: readString(args, 'title') || '未命名词条',
            summary: readOptString(args, 'summary'),
            content: readOptString(args, 'content'),
            type: readOptString(args, 'type'),
            tags: (args?.tags as Entry['tags']) ?? null,
            images: (args?.images as Entry['images']) ?? null,
            created_at: nowTs(),
            updated_at: nowTs(),
        }
        db.entries = [created, ...db.entries]
        return created
    },
    db_save_entry_bundle: (args) => {
        const input = (args?.input ?? {}) as Record<string, unknown>
        const id = readString(input, 'id')
        const entry = requireEntry(id)
        const saved: Entry = {
            ...entry,
            category_id: readOptString(input, 'categoryId'),
            title: readString(input, 'title') || entry.title,
            summary: readOptString(input, 'summary'),
            content: readOptString(input, 'content'),
            type: readOptString(input, 'type'),
            tags: (input.tags as Entry['tags']) ?? null,
            images: (input.images as Entry['images']) ?? null,
            updated_at: nowTs(),
        }
        db.entries = db.entries.map(item => (item.id === id ? saved : item))
        return {
            entry: saved,
            outgoingLinks: [],
            incomingLinks: [],
            relations: db.relations.filter(relation => relation.a_id === id || relation.b_id === id),
        }
    },
    db_delete_entry: (args) => {
        const id = readString(args, 'id')
        db.entries = db.entries.filter(entry => entry.id !== id)
        db.relations = db.relations.filter(relation => relation.a_id !== id && relation.b_id !== id)
        return undefined
    },

    // ── 关系 / 双链 ─────────────────────────────────────────────────────────
    db_list_outgoing_links: () => [],
    db_list_incoming_links: () => [],
    db_list_relations_for_entry: (args) => {
        const entryId = readString(args, 'entryId')
        return db.relations.filter(relation => relation.a_id === entryId || relation.b_id === entryId)
    },
    db_list_relations_for_project: (args) => {
        const projectId = readString(args, 'projectId')
        return db.relations.filter(relation => relation.project_id === projectId)
    },

    // ── 类型 / 标签 ─────────────────────────────────────────────────────────
    db_list_all_entry_types: (args) => listEntryTypes(readString(args, 'projectId')),
    db_list_custom_entry_types: (args) => {
        const projectId = readString(args, 'projectId')
        return db.customEntryTypes.filter(type => type.project_id === projectId)
    },
    db_create_entry_type: (args) => {
        const created = {
            id: nextId('ctype'),
            project_id: readString(args, 'projectId'),
            name: readString(args, 'name'),
            description: readOptString(args, 'description'),
            icon: readOptString(args, 'icon'),
            color: readOptString(args, 'color'),
            created_at: nowTs(),
            updated_at: nowTs(),
        }
        db.customEntryTypes = [...db.customEntryTypes, created]
        return created
    },
    db_list_tag_schemas: (args) => {
        const projectId = readString(args, 'projectId')
        return db.tagSchemas.filter(schema => schema.project_id === projectId)
    },
}

async function dispatch<T>(name: string, args?: Record<string, unknown>): Promise<T> {
    const handler = handlers[name]
    if (!handler) {
        // 显式失败：让「这块没 mock」在预览里可见，而不是返回假数据。
        throw new Error(`[devPreviewBackend] 未实现的命令：${name}（预览 mock 只覆盖核心创作闭环）`)
    }
    await new Promise(resolve => setTimeout(resolve, LATENCY_MS))
    return handler(args) as T
}

/** 装上 mock 后端。仅应在 `isBrowserPreview()` 为真时调用。 */
export function installDevPreviewBackend(): void {
    db = createMockDb()
    settings = createMockSettings()
    setDevCommandHandler(dispatch)
    logger.info('[devPreviewBackend] 已装载内存 mock 后端（仅开发预览）', {
        projects: db.projects.length,
        entries: db.entries.length,
        commands: Object.keys(handlers).length,
    })
}

/** 卸载，恢复真实 IPC。留给调试用。 */
export function uninstallDevPreviewBackend(): void {
    setDevCommandHandler(null)
}

export type {MockDb}
