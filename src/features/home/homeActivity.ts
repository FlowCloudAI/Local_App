const HOME_ACTIVITY_STORAGE_KEY = 'flowcloudai.home.activity.v1'
const HOME_SESSION_STORAGE_KEY = 'flowcloudai.home.last-session.v1'
const MAX_ACTIVITY_RECORDS = 80

export const HOME_ACTIVITY_CHANGED_EVENT = 'fc:home-activity-changed'

export type HomeActivityTargetType = 'project' | 'entry' | 'tool' | 'idea' | 'conversation' | 'snapshot' | 'help'
export type HomeProjectToolPanel = 'relation-graph' | 'timeline' | 'contradiction' | 'world-map'

export interface HomeActivityTarget {
    type: HomeActivityTargetType
    id: string
    title: string
    projectId?: string | null
    entryId?: string | null
    panel?: HomeProjectToolPanel | null
    subtitle?: string | null
    description?: string | null
    updatedAt?: string | null
}

export interface HomeActivityRecord extends HomeActivityTarget {
    key: string
    firstOpenedAt: string
    lastOpenedAt: string
    openCount: number
    pinned?: boolean
}

export interface HomeLastSession {
    target: HomeActivityTarget | null
    mainContentKey: string
    activeTabKey: string | null
    savedAt: string
    sidePanel: {
        contentKey: string
        collapsed: boolean
        mode: string
    }
}

export interface HomeHelpLink {
    key: string
    title: string
    description: string
    target: HomeActivityTarget
}

export interface HomeDashboardData {
    lastSession: HomeLastSession | null
    continueItem: HomeActivityTarget | null
    recentItems: HomeActivityRecord[]
    recentProjects: HomeActivityRecord[]
    recentEntries: HomeActivityRecord[]
    pinnedItems: HomeActivityRecord[]
    helpLinks: HomeHelpLink[]
    updatedAt: string
}

const HOME_HELP_LINKS: HomeHelpLink[] = [
    {
        key: 'getting-started',
        title: '新手指南',
        description: '了解世界观、词条、关系和 AI 助手的基础流程。',
        target: {
            type: 'help',
            id: 'getting-started',
            title: '新手指南',
        },
    },
    {
        key: 'ai-guide',
        title: 'AI 功能说明',
        description: '查看对话、总结、矛盾检测和工具调用的使用方式。',
        target: {
            type: 'help',
            id: 'ai-guide',
            title: 'AI 功能说明',
        },
    },
    {
        key: 'plugins',
        title: '插件说明',
        description: '了解模型插件、API Key 和本地插件安装。',
        target: {
            type: 'help',
            id: 'plugins',
            title: '插件说明',
        },
    },
]

function canUseStorage() {
    return typeof window !== 'undefined' && typeof window.localStorage !== 'undefined'
}

function dispatchHomeActivityChanged() {
    if (typeof window === 'undefined') return
    window.dispatchEvent(new CustomEvent(HOME_ACTIVITY_CHANGED_EVENT))
}

function readJson<T>(key: string, fallback: T): T {
    if (!canUseStorage()) return fallback
    try {
        const raw = window.localStorage.getItem(key)
        if (!raw) return fallback
        return JSON.parse(raw) as T
    } catch {
        return fallback
    }
}

function writeJson<T>(key: string, value: T) {
    if (!canUseStorage()) return
    try {
        window.localStorage.setItem(key, JSON.stringify(value))
    } catch {
        // 本地存储不可写时保留内存流程，首页最多缺少最近记录。
    }
}

function getActivityTargetKey(target: Pick<HomeActivityTarget, 'type' | 'id' | 'projectId' | 'panel'>) {
    const projectPart = target.projectId ?? ''
    const panelPart = target.panel ?? ''
    return `${target.type}:${projectPart}:${target.id}:${panelPart}`
}

function sortByRecentActivity(records: HomeActivityRecord[]) {
    return [...records].sort((a, b) => {
        const pinnedOrder = Number(Boolean(b.pinned)) - Number(Boolean(a.pinned))
        if (pinnedOrder) return pinnedOrder
        return new Date(b.lastOpenedAt).getTime() - new Date(a.lastOpenedAt).getTime()
    })
}

function readHomeActivityRecords() {
    const records = readJson<HomeActivityRecord[]>(HOME_ACTIVITY_STORAGE_KEY, [])
    if (!Array.isArray(records)) return []
    return records.filter(record => (
        record
        && typeof record.key === 'string'
        && typeof record.id === 'string'
        && typeof record.title === 'string'
        && typeof record.type === 'string'
    ))
}

export function recordHomeActivity(target: HomeActivityTarget) {
    const id = target.id.trim()
    const title = target.title.trim()
    if (!id || !title) return

    const now = new Date().toISOString()
    const key = getActivityTargetKey({...target, id})
    const records = readHomeActivityRecords()
    const existing = records.find(record => record.key === key)
    const nextRecord: HomeActivityRecord = {
        ...existing,
        ...target,
        id,
        title,
        key,
        firstOpenedAt: existing?.firstOpenedAt ?? now,
        lastOpenedAt: now,
        openCount: (existing?.openCount ?? 0) + 1,
        pinned: existing?.pinned,
    }
    const nextRecords = [
        nextRecord,
        ...records.filter(record => record.key !== key),
    ].slice(0, MAX_ACTIVITY_RECORDS)

    writeJson(HOME_ACTIVITY_STORAGE_KEY, nextRecords)
    dispatchHomeActivityChanged()
}

export function setHomeActivityPinned(target: Pick<HomeActivityTarget, 'type' | 'id' | 'projectId' | 'panel'>, pinned: boolean) {
    const key = getActivityTargetKey(target)
    const records = readHomeActivityRecords()
    const nextRecords = records.map(record => (
        record.key === key ? {...record, pinned} : record
    ))
    writeJson(HOME_ACTIVITY_STORAGE_KEY, nextRecords)
    dispatchHomeActivityChanged()
}

export function saveHomeLastSession(session: Omit<HomeLastSession, 'savedAt'>) {
    writeJson<HomeLastSession>(HOME_SESSION_STORAGE_KEY, {
        ...session,
        savedAt: new Date().toISOString(),
    })
    dispatchHomeActivityChanged()
}

export function loadHomeLastSession() {
    const session = readJson<HomeLastSession | null>(HOME_SESSION_STORAGE_KEY, null)
    if (!session || typeof session.mainContentKey !== 'string') return null
    return session
}

export function loadHomeDashboardData(): HomeDashboardData {
    const records = sortByRecentActivity(readHomeActivityRecords())
    const pinnedItems = records.filter(record => record.pinned)
    const recentProjects = records.filter(record => record.type === 'project').slice(0, 6)
    const recentEntries = records.filter(record => record.type === 'entry').slice(0, 8)
    const recentItems = records.slice(0, 12)
    const lastSession = loadHomeLastSession()
    const continueItem = lastSession?.target ?? recentItems[0] ?? null

    return {
        lastSession,
        continueItem,
        recentItems,
        recentProjects,
        recentEntries,
        pinnedItems,
        helpLinks: HOME_HELP_LINKS,
        updatedAt: new Date().toISOString(),
    }
}
