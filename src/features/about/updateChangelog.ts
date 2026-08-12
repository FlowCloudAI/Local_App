// 应用更新日志：随客户端发布，用于离线展示当前版本与历史版本说明。

export interface UpdateChangelogEntry {
    version: string
    date: string
    notes: string
}

export const UPDATE_CHANGELOG: readonly UpdateChangelogEntry[] = [
    {
        version: '0.1.4',
        date: '2026-07-03',
        notes: [
            '世界项目改为独立数据库存储，统一词条、关系、快照与导入导出链路。',
            '改进桌面端与移动端的项目界面、封面展示、浮层交互与滚动性能。',
            '修复版本管理、AI 对话与项目数据迁移中的多项问题。',
        ].join('\n'),
    },
    {
        version: '0.1.3',
        date: '2026-06-28',
        notes: '首个纳入应用内版本记录的测试版本；更早的更新内容尚未完成结构化归档。',
    },
]
