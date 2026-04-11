import { convertFileSrc } from '@tauri-apps/api/core'
import type { RelationEdgeInput, RelationNodeInput } from 'flowcloudai-ui'
import type { EntryBrief, EntryRelation, RelationDirection } from '../api'

const DEMO_PROJECT_ID = 'project-silver-harbor'
const SVG_SIZE = 96

export type RelationDemoNode = RelationNodeInput & {
    title: string
    summary: string
    cover_image: string
}

function toEntryCoverSrc(cover?: string | null): string | undefined {
    if (!cover) return undefined
    if (/^(https?:|data:|blob:|asset:|fcimg:)/i.test(cover)) return cover
    return convertFileSrc(String(cover), 'fcimg')
}

function createCoverImage(seed: string, accent: string, text: string): string {
    const svg = `
      <svg xmlns="http://www.w3.org/2000/svg" width="${SVG_SIZE}" height="${SVG_SIZE}" viewBox="0 0 ${SVG_SIZE} ${SVG_SIZE}">
        <defs>
          <linearGradient id="g-${seed}" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stop-color="${accent}" />
            <stop offset="100%" stop-color="#111827" />
          </linearGradient>
        </defs>
        <rect width="${SVG_SIZE}" height="${SVG_SIZE}" rx="18" fill="url(#g-${seed})" />
        <circle cx="68" cy="26" r="14" fill="rgba(255,255,255,0.18)" />
        <path d="M10 74C23 55 43 44 61 41C75 38 85 29 92 18V96H4C3 88 5 81 10 74Z" fill="rgba(255,255,255,0.12)" />
        <text x="14" y="78" fill="white" font-size="18" font-family="Segoe UI, Microsoft YaHei, sans-serif" font-weight="700">${text}</text>
      </svg>
    `.trim()

    return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`
}

function entry(
    id: string,
    category_id: string,
    title: string,
    summary: string,
    type: string,
    accent: string,
    mark: string,
): EntryBrief {
    return {
        id,
        project_id: DEMO_PROJECT_ID,
        category_id,
        title,
        summary,
        type,
        cover: createCoverImage(id, accent, mark),
        updated_at: '2026-04-09T08:00:00Z',
    }
}

function relation(
    id: string,
    a_id: string,
    b_id: string,
    relation: RelationDirection,
    content: string,
): EntryRelation {
    return {
        id,
        project_id: DEMO_PROJECT_ID,
        a_id,
        b_id,
        relation,
        content,
        created_at: '2026-04-09T08:00:00Z',
        updated_at: '2026-04-09T08:00:00Z',
    }
}

export const DEMO_ENTRIES: EntryBrief[] = [
    entry('entry-ailin', '人物', '艾琳', '自由调查员，负责追索失踪船队和旧航线档案，擅长把口供、星图和禁运清单拼成完整故事。', 'character', '#0ea5e9', '艾'),
    entry('entry-baili', '人物', '白砾', '灰塔档案馆整理员，记忆力极强，会把每一份航运记录重新标注时间层级和证词来源。', 'character', '#14b8a6', '白'),
    entry('entry-canglan', '人物', '苍澜', '银港公会的委托协调人，熟悉港区里的中介、船主与议会秘书体系。', 'character', '#f97316', '苍'),
    entry('entry-daoling', '人物', '代号零', '专做外海渗透与信号截获的灰色行动者，只接受与密钥穹库有关的工作。', 'character', '#ef4444', '零'),
    entry('entry-wuyi', '人物', '雾医', '长期为舰队和黑市两边提供急救与封存处理，对回声岛病症有独门判断。', 'character', '#ec4899', '雾'),
    entry('entry-jingya', '人物', '镜鸦', '情报掮客，习惯通过集市、船坞和祭坛周边的耳目网络打包贩卖消息。', 'character', '#f59e0b', '鸦'),
    entry('entry-nuoya', '人物', '诺雅', '星图会的年轻制图师，负责修复断裂航线和残缺星象，判断信标塔异常频率。', 'character', '#6366f1', '诺'),
    entry('entry-guanchezhe', '人物', '观测者', '只在关键节点现身的旁观者，长期监视信标塔与外海祭坛之间的共振变化。', 'character', '#475569', '观'),
    entry('entry-shoukuren', '人物', '守库人', '密钥穹库现任看守，熟知旧制度留下的封签和权限印记。', 'character', '#84cc16', '守'),
    entry('entry-linghangyuan', '人物', '领航员赫洛', '前舰队领航官，脱离编制后依旧掌握雾海边界和多条失落航路的标记。', 'character', '#3b82f6', '航'),
    entry('entry-huibi', '人物', '灰笔', '以伪造文书闻名的书记官，能把真假委任和航运许可混写到几乎无法区分。', 'character', '#78716c', '灰'),
    entry('entry-zhichaozhe', '人物', '织潮者', '行踪不明的旧时代接口解释者，能把不同碎片连接成关于黑潮密钥的完整预言。', 'character', '#8b5cf6', '潮'),
    entry('entry-yingang', '组织', '银港公会', '港区最活跃的任务与调度组织，表面维护秩序，实则也经营大量灰色关系。', 'faction', '#7c3aed', '公'),
    entry('entry-yihui', '组织', '十三席议会', '银港的最高治理机构，控制舰队、税制和多数密钥启用权限。', 'faction', '#a855f7', '议'),
    entry('entry-jiandui', '组织', '雾海舰队', '负责巡航、封锁和远海威慑的武装力量，内部对议会命令并不完全一致。', 'faction', '#2563eb', '舰'),
    entry('entry-xingtuhui', '组织', '星图会', '掌握旧星图、航线模型和信号校准技术的研究团体。', 'faction', '#06b6d4', '图'),
    entry('entry-yujin', '组织', '余烬商团', '一边经营正当海贸，一边低调收购遗迹组件和封存文件。', 'faction', '#fb7185', '商'),
    entry('entry-chaoxihanghui', '组织', '潮汐行会', '盘踞在集市和船坞之间的搬运与中介网络，擅长把人货和消息一起转手。', 'faction', '#10b981', '行'),
    entry('entry-huita', '地点', '灰塔档案馆', '收藏旧航运账本、审讯副本和海图抄录，是几乎所有调查的情报起点。', 'location', '#64748b', '馆'),
    entry('entry-huishengdao', '地点', '回声岛', '不断出现在失踪者记录里的海雾孤岛，夜间会出现与信标塔同频的闪烁。', 'location', '#22c55e', '岛'),
    entry('entry-chaoxijishi', '地点', '潮汐集市', '港区白天最热闹的交易地，夜里则变成情报与债务交换的临时中枢。', 'location', '#06b6d4', '市'),
    entry('entry-qiongku', '地点', '密钥穹库', '封存旧权限印记、航标签章和禁运协议的地下设施。', 'location', '#84cc16', '库'),
    entry('entry-xinbiaota', '地点', '信标塔', '负责对外海航线进行频率校准，一旦异常会直接影响整片雾海的通行。', 'location', '#38bdf8', '塔'),
    entry('entry-gudaifeixu', '地点', '古代废墟', '被多方争夺的遗迹群落，内部存在与旧信标网络相连的接口层。', 'location', '#78716c', '墟'),
    entry('entry-beiwanchuanwu', '地点', '北湾船坞', '舰队修整与走私货转运经常重叠发生的区域，派系耳目极多。', 'location', '#0f766e', '坞'),
    entry('entry-wuxianzhan', '地点', '雾线站', '负责记录海雾边界变化和航线偏移，是领航员和制图师的重要会合点。', 'location', '#0ea5e9', '站'),
    entry('entry-waihaijitan', '地点', '外海祭坛', '远海裂缝附近的旧时代遗址，被认为是黑潮密钥第一次被启用的地点。', 'location', '#7c2d12', '坛'),
    entry('entry-jingchitingyuan', '地点', '镜池庭院', '议会秘密会面场所之一，水面会映出被改写过的旧命令与封签。', 'location', '#1d4ed8', '庭'),
    entry('entry-jiuri', '物件', '旧日星图', '残缺但精度惊人的航海星图，能揭示普通地图看不见的信号偏移。', 'artifact', '#9333ea', '图'),
    entry('entry-heichao', '物件', '黑潮密钥', '被多方争抢的旧时代权限物件，据说可以重写某些航标系统的响应逻辑。', 'artifact', '#dc2626', '钥'),
    entry('entry-jingxiang', '物件', '镜像航标', '能在短时内复制合法航标信号的设备，也是多起错航事故的源头。', 'artifact', '#0f766e', '标'),
    entry('entry-qingchu', '事件', '清除令', '议会曾对回声岛周边发布的封锁命令，至今仍影响数条补给路线。', 'event', '#b91c1c', '令'),
]

export const DEMO_RELATIONS: EntryRelation[] = [
    relation('rel-001', 'entry-ailin', 'entry-baili', 'two_way', '互相校验线索'),
    relation('rel-002', 'entry-baili', 'entry-ailin', 'two_way', '互相校验线索'),
    relation('rel-003', 'entry-ailin', 'entry-canglan', 'one_way', '接受委托'),
    relation('rel-004', 'entry-canglan', 'entry-yingang', 'one_way', '隶属'),
    relation('rel-005', 'entry-baili', 'entry-huita', 'one_way', '查阅'),
    relation('rel-006', 'entry-yingang', 'entry-huita', 'two_way', '共享档案'),
    relation('rel-007', 'entry-huita', 'entry-yingang', 'two_way', '共享档案'),
    relation('rel-008', 'entry-ailin', 'entry-jiuri', 'one_way', '持有抄本'),
    relation('rel-009', 'entry-jiuri', 'entry-xingtuhui', 'two_way', '被研究'),
    relation('rel-010', 'entry-xingtuhui', 'entry-jiuri', 'two_way', '被研究'),
    relation('rel-011', 'entry-nuoya', 'entry-xingtuhui', 'one_way', '任职'),
    relation('rel-012', 'entry-nuoya', 'entry-wuxianzhan', 'one_way', '长期驻留'),
    relation('rel-013', 'entry-linghangyuan', 'entry-wuxianzhan', 'two_way', '共享航线'),
    relation('rel-014', 'entry-wuxianzhan', 'entry-linghangyuan', 'two_way', '共享航线'),
    relation('rel-015', 'entry-linghangyuan', 'entry-jiandui', 'one_way', '前隶属'),
    relation('rel-016', 'entry-yihui', 'entry-jiandui', 'one_way', '调度'),
    relation('rel-017', 'entry-jiandui', 'entry-beiwanchuanwu', 'one_way', '驻泊'),
    relation('rel-018', 'entry-chaoxihanghui', 'entry-beiwanchuanwu', 'one_way', '转运'),
    relation('rel-019', 'entry-chaoxijishi', 'entry-chaoxihanghui', 'two_way', '依赖客流'),
    relation('rel-020', 'entry-chaoxihanghui', 'entry-chaoxijishi', 'two_way', '依赖客流'),
    relation('rel-021', 'entry-jingya', 'entry-chaoxijishi', 'one_way', '散布消息'),
    relation('rel-022', 'entry-jingya', 'entry-yujin', 'one_way', '倒卖情报'),
    relation('rel-023', 'entry-yujin', 'entry-chaoxijishi', 'one_way', '采购'),
    relation('rel-024', 'entry-yujin', 'entry-heichao', 'one_way', '秘密收购'),
    relation('rel-025', 'entry-daoling', 'entry-heichao', 'one_way', '追索'),
    relation('rel-026', 'entry-shoukuren', 'entry-qiongku', 'one_way', '看守'),
    relation('rel-027', 'entry-qiongku', 'entry-heichao', 'one_way', '封存'),
    relation('rel-028', 'entry-qiongku', 'entry-xinbiaota', 'one_way', '授权'),
    relation('rel-029', 'entry-xinbiaota', 'entry-huishengdao', 'one_way', '频率共振'),
    relation('rel-030', 'entry-xinbiaota', 'entry-gudaifeixu', 'one_way', '指向接口'),
    relation('rel-031', 'entry-gudaifeixu', 'entry-waihaijitan', 'one_way', '延伸至'),
    relation('rel-032', 'entry-waihaijitan', 'entry-heichao', 'one_way', '首次启用地'),
    relation('rel-033', 'entry-guanchezhe', 'entry-xinbiaota', 'one_way', '观测'),
    relation('rel-034', 'entry-guanchezhe', 'entry-waihaijitan', 'one_way', '记录异动'),
    relation('rel-035', 'entry-zhichaozhe', 'entry-heichao', 'two_way', '解释与唤醒'),
    relation('rel-036', 'entry-heichao', 'entry-zhichaozhe', 'two_way', '解释与唤醒'),
    relation('rel-037', 'entry-zhichaozhe', 'entry-ailin', 'one_way', '提供预言'),
    relation('rel-038', 'entry-huibi', 'entry-yihui', 'one_way', '代写文书'),
    relation('rel-039', 'entry-huibi', 'entry-qingchu', 'one_way', '伪造版本'),
    relation('rel-040', 'entry-qingchu', 'entry-huishengdao', 'one_way', '封锁'),
    relation('rel-041', 'entry-qingchu', 'entry-jiandui', 'one_way', '执行'),
    relation('rel-042', 'entry-wuyi', 'entry-jiandui', 'one_way', '随船治疗'),
    relation('rel-043', 'entry-wuyi', 'entry-huishengdao', 'one_way', '研究病症'),
    relation('rel-044', 'entry-wuyi', 'entry-daoling', 'one_way', '处理后遗症'),
    relation('rel-045', 'entry-jingya', 'entry-daoling', 'two_way', '交换线索'),
    relation('rel-046', 'entry-daoling', 'entry-jingya', 'two_way', '交换线索'),
    relation('rel-047', 'entry-canglan', 'entry-chaoxijishi', 'one_way', '发布悬赏'),
    relation('rel-048', 'entry-canglan', 'entry-jingchitingyuan', 'one_way', '暗中会面'),
    relation('rel-049', 'entry-yihui', 'entry-jingchitingyuan', 'one_way', '秘密会址'),
    relation('rel-050', 'entry-jingchitingyuan', 'entry-qiongku', 'one_way', '通向'),
    relation('rel-051', 'entry-yingang', 'entry-chaoxihanghui', 'one_way', '雇佣'),
    relation('rel-052', 'entry-yingang', 'entry-jiandui', 'one_way', '申请护航'),
    relation('rel-053', 'entry-yingang', 'entry-yujin', 'one_way', '竞争'),
    relation('rel-054', 'entry-yujin', 'entry-jiuri', 'one_way', '竞拍'),
    relation('rel-055', 'entry-baili', 'entry-huibi', 'one_way', '怀疑篡改'),
    relation('rel-056', 'entry-ailin', 'entry-jingya', 'one_way', '购买情报'),
    relation('rel-057', 'entry-ailin', 'entry-linghangyuan', 'one_way', '借用航线'),
    relation('rel-058', 'entry-nuoya', 'entry-xinbiaota', 'one_way', '校准'),
    relation('rel-059', 'entry-nuoya', 'entry-jingxiang', 'one_way', '拆解研究'),
    relation('rel-060', 'entry-jingxiang', 'entry-xinbiaota', 'one_way', '伪装信号'),
    relation('rel-061', 'entry-jingxiang', 'entry-chaoxijishi', 'one_way', '流入黑市'),
    relation('rel-062', 'entry-shoukuren', 'entry-huibi', 'one_way', '警惕'),
    relation('rel-063', 'entry-shoukuren', 'entry-yihui', 'one_way', '接受监管'),
    relation('rel-064', 'entry-guanchezhe', 'entry-zhichaozhe', 'two_way', '互相观测'),
    relation('rel-065', 'entry-zhichaozhe', 'entry-guanchezhe', 'two_way', '互相观测'),
    relation('rel-066', 'entry-heichao', 'entry-gudaifeixu', 'one_way', '唤醒接口'),
    relation('rel-067', 'entry-heichao', 'entry-jingxiang', 'one_way', '兼容'),
    relation('rel-068', 'entry-chaoxihanghui', 'entry-yujin', 'one_way', '承接货运'),
    relation('rel-069', 'entry-beiwanchuanwu', 'entry-chaoxijishi', 'one_way', '物资流动'),
    relation('rel-070', 'entry-huita', 'entry-qingchu', 'one_way', '保存副本'),
]

export function toRelationNodes(entries: EntryBrief[]): RelationDemoNode[] {
    return entries.map((entry) => ({
        id: entry.id,
        label: entry.title,
        title: entry.title,
        summary: entry.summary ?? '暂无摘要',
        cover_image: toEntryCoverSrc(entry.cover) ?? createCoverImage(entry.id, '#64748b', entry.title.slice(0, 2)),
    }))
}

export function toRelationEdges(relations: EntryRelation[], validNodeIds: Set<string>): RelationEdgeInput[] {
    return relations
        .filter((relation) => validNodeIds.has(relation.a_id) && validNodeIds.has(relation.b_id))
        .map((relation) => ({
            id: relation.id,
            source: relation.a_id,
            target: relation.b_id,
            label: relation.content,
            kind: relation.relation,
        }))
}

export function countTwoWayRelations(relations: EntryRelation[]): number {
    return relations.filter((relation) => relation.relation === 'two_way').length
}
