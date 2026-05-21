function StatCard({label, value}: { label: string; value: number | string }) {
    return (
        <div className="pe-stat-card">
            <span className="pe-stat-label">{label}</span>
            <span className="pe-stat-value">{value}</span>
        </div>
    )
}

interface ProjectOverviewStatsProps {
    entryCount: number
    categoryCount: number
    entryTypeCount: number
    tagCount: number
    imageCount?: number | null
    wordCount?: number | null
}

function ProjectOverviewStats({
                                  entryCount,
                                  categoryCount,
                                  entryTypeCount,
                                  tagCount,
                                  imageCount,
                                  wordCount,
                              }: ProjectOverviewStatsProps) {
    return (
        <div className="pe-stats-grid">
            <StatCard label="词条数" value={entryCount}/>
            <StatCard label="分类数" value={categoryCount}/>
            <StatCard label="词条类型" value={entryTypeCount}/>
            <StatCard label="标签数" value={tagCount}/>
            <StatCard label="图片数" value={imageCount ?? '--'}/>
            <StatCard label="总字数" value={wordCount ?? '--'}/>
        </div>
    )
}

export default ProjectOverviewStats
