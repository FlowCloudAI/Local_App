/**
 * 开发期浏览器预览 mock 后端的种子数据（仅 dev 生效）。
 *
 * 目标是让预览能走查真实数据流（项目 → 词条 → 编辑 → 保存），
 * 因此数据量刻意做小但结构完整：分类树有层级、词条有类型/标签/摘要、
 * 有跨词条关系，够点出各页的真实布局与空态。
 */
import type {AppSettings} from '../../api/app_settings'
import type {
    Category,
    CustomEntryType,
    Entry,
    EntryRelation,
    EntryTypeView,
    Project,
    TagSchema,
} from '../../api/worldflow'

export interface MockDb {
    projects: Project[]
    categories: Category[]
    entries: Entry[]
    tagSchemas: TagSchema[]
    customEntryTypes: CustomEntryType[]
    relations: EntryRelation[]
}

/** 后端返回的时间格式为 `YYYY-MM-DD HH:mm:ss`（UTC，无时区后缀）。 */
function ts(value: string): string {
    return value
}

export const MOCK_BUILTIN_ENTRY_TYPES: EntryTypeView[] = [
    {kind: 'builtin', key: 'character', name: '角色', description: '登场人物', icon: '', color: '#7c9cff'},
    {kind: 'builtin', key: 'location', name: '地点', description: '地理位置', icon: '', color: '#4fbf8b'},
    {kind: 'builtin', key: 'event', name: '事件', description: '时间线事件', icon: '', color: '#e0894a'},
    {kind: 'builtin', key: 'item', name: '物品', description: '道具与造物', icon: '', color: '#b98cff'},
    {kind: 'builtin', key: 'concept', name: '概念', description: '设定概念', icon: '', color: '#4fb6d4'},
]

export function createMockSettings(): AppSettings {
    return {
        media_dir: '/preview/media',
        db_path: '/preview/world.db',
        plugins_path: '/preview/plugins',
        starred_project_ids: [],
        starred_entry_ids: [],
        theme: 'system',
        language: 'zh-CN',
        editor_font_size: 14,
        theme_color_config: null,
        shell_acrylic_enabled: true,
        auto_save_secs: 0,
        auto_backup_secs: 0,
        backup_dir: null,
        max_backup_count: 5,
        default_entry_type: null,
        llm: {
            plugin_id: null,
            default_model: null,
            temperature: 0.7,
            top_p: 1,
            frequency_penalty: 0,
            presence_penalty: 0,
            max_tokens: 2048,
            stream: true,
            show_reasoning: false,
            app_sense_custom_prompt: '',
            writer_mode_enabled: false,
            auto_compact_enabled: false,
            auto_compact_threshold_ratio: 0.8,
            auto_compact_recent_messages: 10,
            auto_compact_detail: 'balanced',
            token_calibration_factors: {},
        },
        image: {plugin_id: null, default_model: null},
        tts: {plugin_id: null, default_model: null, voice_id: null, auto_play: false},
        search_engine: '',
        search_sources: {
            wikimedia: true,
            technical_wiki: false,
            game_wiki: false,
            fandom_wiki: false,
            esports_wiki: false,
            web: true,
        },
    }
}

export function createMockDb(): MockDb {
    const projects: Project[] = [
        {
            id: 'prj-lumen',
            name: '流明纪元',
            description: '一个以光为货币的架空世界，用于预览走查。',
            cover_image: null,
            cover_path: null,
            created_at: ts('2026-05-02 09:12:00'),
            updated_at: ts('2026-07-14 21:05:00'),
        },
        {
            id: 'prj-empty',
            name: '空白世界观',
            description: '刻意留空，用于走查空态。',
            cover_image: null,
            cover_path: null,
            created_at: ts('2026-07-10 14:00:00'),
            updated_at: ts('2026-07-10 14:00:00'),
        },
    ]

    const categories: Category[] = [
        {
            id: 'cat-people',
            project_id: 'prj-lumen',
            parent_id: null,
            name: '人物',
            sort_order: 0,
            created_at: ts('2026-05-02 09:20:00'),
            updated_at: ts('2026-05-02 09:20:00'),
        },
        {
            id: 'cat-people-guild',
            project_id: 'prj-lumen',
            parent_id: 'cat-people',
            name: '灯火公会',
            sort_order: 0,
            created_at: ts('2026-05-02 09:22:00'),
            updated_at: ts('2026-05-02 09:22:00'),
        },
        {
            id: 'cat-places',
            project_id: 'prj-lumen',
            parent_id: null,
            name: '地理',
            sort_order: 1,
            created_at: ts('2026-05-02 09:25:00'),
            updated_at: ts('2026-05-02 09:25:00'),
        },
        {
            id: 'cat-lore',
            project_id: 'prj-lumen',
            parent_id: null,
            name: '设定',
            sort_order: 2,
            created_at: ts('2026-05-03 10:00:00'),
            updated_at: ts('2026-05-03 10:00:00'),
        },
    ]

    const tagSchemas: TagSchema[] = [
        {
            id: 'tag-status',
            project_id: 'prj-lumen',
            name: '状态',
            description: '角色当前状态',
            type: 'enum',
            target: ['character'],
            default_val: '在世',
            range_min: null,
            range_max: null,
            sort_order: 0,
        },
        {
            id: 'tag-danger',
            project_id: 'prj-lumen',
            name: '危险度',
            description: '地点危险等级',
            type: 'number',
            target: ['location'],
            default_val: null,
            range_min: 0,
            range_max: 10,
            sort_order: 1,
        },
    ]

    const customEntryTypes: CustomEntryType[] = [
        {
            id: 'ctype-relic',
            project_id: 'prj-lumen',
            name: '遗物',
            description: '前纪元留下的造物',
            icon: null,
            color: '#d4695f',
            created_at: ts('2026-05-04 11:00:00'),
            updated_at: ts('2026-05-04 11:00:00'),
        },
    ]

    const entries: Entry[] = [
        {
            id: 'ent-kael',
            project_id: 'prj-lumen',
            category_id: 'cat-people-guild',
            title: '凯尔·维恩',
            summary: '灯火公会最年轻的执灯人，据说能徒手握住冷光。',
            content: '## 生平\n\n凯尔在流明历 812 年生于下城区，十四岁那年通过执灯人考核。\n\n## 能力\n\n- 冷光凝聚\n- 光债计算（心算）\n',
            type: 'character',
            tags: [{schema_id: 'tag-status', name: '状态', value: '在世'}],
            images: null,
            created_at: ts('2026-05-05 08:00:00'),
            updated_at: ts('2026-07-14 21:05:00'),
        },
        {
            id: 'ent-mira',
            project_id: 'prj-lumen',
            category_id: 'cat-people-guild',
            title: '米拉·索恩',
            summary: '公会档案管理员，掌握着全城的光债账本。',
            content: '沉默寡言，但记得每一笔光债。\n',
            type: 'character',
            tags: [{schema_id: 'tag-status', name: '状态', value: '在世'}],
            images: null,
            created_at: ts('2026-05-06 08:00:00'),
            updated_at: ts('2026-07-12 16:40:00'),
        },
        {
            id: 'ent-lowcity',
            project_id: 'prj-lumen',
            category_id: 'cat-places',
            title: '下城区',
            summary: '终年不见日光的城区，靠公会配给的余光维生。',
            content: '光照配给制的最底层。夜里能看见管道里流动的余光。\n',
            type: 'location',
            tags: [{schema_id: 'tag-danger', name: '危险度', value: 7}],
            images: null,
            created_at: ts('2026-05-07 08:00:00'),
            updated_at: ts('2026-07-09 11:20:00'),
        },
        {
            id: 'ent-lampfall',
            project_id: 'prj-lumen',
            category_id: 'cat-places',
            title: '落灯塔',
            summary: '公会总部，也是全城唯一的恒光源。',
            content: '塔高九百阶，每一阶都刻着一个还不起光债的名字。\n',
            type: 'location',
            tags: [{schema_id: 'tag-danger', name: '危险度', value: 2}],
            images: null,
            created_at: ts('2026-05-08 08:00:00'),
            updated_at: ts('2026-07-01 09:00:00'),
        },
        {
            id: 'ent-lightdebt',
            project_id: 'prj-lumen',
            category_id: 'cat-lore',
            title: '光债',
            summary: '本世界的核心货币机制：借光要还，还不起就被抽走影子。',
            content: '## 规则\n\n1. 光可借、可存、可继承\n2. 逾期未还者失去影子\n3. 失去影子者不可再借光\n',
            type: 'concept',
            tags: null,
            images: null,
            created_at: ts('2026-05-09 08:00:00'),
            updated_at: ts('2026-06-28 19:30:00'),
        },
        {
            id: 'ent-firstlamp',
            project_id: 'prj-lumen',
            category_id: null,
            title: '初灯',
            summary: '前纪元遗物，被认为是所有光的源头。还没归类。',
            content: '',
            type: 'ctype-relic',
            tags: null,
            images: null,
            created_at: ts('2026-06-15 08:00:00'),
            updated_at: ts('2026-06-15 08:00:00'),
        },
    ]

    // 手写的 6 条撑不起分页 / 长列表滚动 / 性能走查，补一批「路人」词条。
    // 时间戳逐条递减且都早于手写词条，保证 updated_at DESC 下顺序确定、可断言。
    const fillerTypes = ['character', 'location', 'item', 'event', 'concept']
    const fillerCategories = ['cat-people', 'cat-places', 'cat-lore', null]
    const filler: Entry[] = Array.from({length: 50}, (_, index) => {
        const seq = index + 1
        const at = new Date(Date.UTC(2026, 5, 14, 12, 0, 0) - index * 60_000)
            .toISOString()
            .replace('T', ' ')
            .slice(0, 19)
        return {
            id: `ent-filler-${String(seq).padStart(2, '0')}`,
            project_id: 'prj-lumen',
            category_id: fillerCategories[index % fillerCategories.length],
            title: `流明居民 ${String(seq).padStart(2, '0')}`,
            summary: `第 ${seq} 位登记在册的居民，用于预览分页与长列表走查。`,
            content: `编号 ${seq}。`,
            type: fillerTypes[index % fillerTypes.length],
            tags: null,
            images: null,
            created_at: at,
            updated_at: at,
        }
    })
    entries.push(...filler)

    const relations: EntryRelation[] = [
        {
            id: 'rel-kael-mira',
            project_id: 'prj-lumen',
            a_id: 'ent-kael',
            b_id: 'ent-mira',
            relation: 'two_way',
            content: '同属灯火公会，互为搭档',
            created_at: ts('2026-05-10 08:00:00'),
            updated_at: ts('2026-05-10 08:00:00'),
        },
        {
            id: 'rel-kael-lowcity',
            project_id: 'prj-lumen',
            a_id: 'ent-kael',
            b_id: 'ent-lowcity',
            relation: 'one_way',
            content: '出生地',
            created_at: ts('2026-05-11 08:00:00'),
            updated_at: ts('2026-05-11 08:00:00'),
        },
    ]

    return {projects, categories, entries, tagSchemas, customEntryTypes, relations}
}
