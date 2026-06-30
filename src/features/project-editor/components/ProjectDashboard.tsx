import {
    DashboardBarList,
    type DashboardBarItem,
    DashboardKpiStrip,
    DashboardMetric,
    DashboardPieChart,
    DashboardSignalList,
    HealthMeter,
} from './ProjectDashboardParts'
import {formatDashboardNumber, formatDashboardRatio} from './ProjectDashboardFormat'
import {
    buildProjectDashboardModel,
    type ProjectDashboardModelInput,
} from './ProjectDashboardModel'
import ProjectDashboardRiskPanel from './ProjectDashboardRiskPanel'
import './ProjectDashboard.css'
import './ProjectDashboardControls.css'

type ProjectDashboardProps = ProjectDashboardModelInput

function ProjectDashboard(props: ProjectDashboardProps) {
    const dashboard = buildProjectDashboardModel(props)
    const assetTotal = dashboard.effectiveEntryCount + dashboard.safeImageCount + dashboard.relationCount

    return (
        <section className="pe-dashboard-section" data-tour-id="project-overview-dashboard">
            <div className="pe-dashboard-section__header">
                <div>
                    <h2 className="pe-feature-section__title">项目总览</h2>
                    <p className="pe-feature-section__desc">
                        查看这个世界已经写了多少、资料怎么分布，以及还有哪些地方需要补齐。
                    </p>
                </div>
            </div>

            <div className="pe-dashboard-status-strip">
                <article className="pe-dashboard-kpi pe-dashboard-kpi--health">
                    <HealthMeter score={dashboard.structureScore}/>
                </article>
                <div className="pe-dashboard-status-strip__kpis">
                    <DashboardKpiStrip items={dashboard.kpiItems}/>
                </div>
            </div>

            <div className="pe-dashboard-layout">
                <div className="pe-dashboard-main-column">
                    <article className="pe-dashboard-panel pe-dashboard-panel--primary">
                        <div className="pe-dashboard-panel__header">
                            <h3>资料概览</h3>
                            <span>{formatDashboardNumber(assetTotal)} 项内容</span>
                        </div>
                        <div className="pe-dashboard-distribution-grid">
                            <DashboardDistributionBlock
                                title={props.projectStats ? '词条类型分布' : '词条类型配置'}
                                items={dashboard.typeItems}
                                variant="pie"
                            />
                            <DashboardDistributionBlock
                                title={props.projectStats ? '分类词条分布' : '分类结构'}
                                items={dashboard.categoryItems}
                            />
                            <DashboardDistributionBlock title="标签字段类型" items={dashboard.tagTypeItems} variant="pie"/>
                        </div>
                    </article>

                    <article className="pe-dashboard-panel">
                        <div className="pe-dashboard-panel__header">
                            <h3>资料结构</h3>
                            <span>分类、内链和内容厚度</span>
                        </div>
                        <div className="pe-dashboard-structure-grid">
                            <DashboardMetric
                                label="平均词条字数"
                                value={formatDashboardNumber(dashboard.averageWords)}
                                hint="衡量设定资料的填充厚度"
                                muted={dashboard.averageWords === 0}
                            />
                            <DashboardMetric
                                label="图文资源比"
                                value={formatDashboardRatio(dashboard.assetRatio)}
                                hint="平均每个词条关联图片资源"
                                muted={dashboard.assetRatio === 0}
                            />
                            <DashboardMetric
                                label="内链总数"
                                value={formatDashboardNumber(dashboard.internalLinkCount)}
                                hint="正文中维护的词条链接"
                                muted={dashboard.internalLinkCount === 0}
                            />
                            <DashboardMetric
                                label="分类层级深度"
                                value={`${dashboard.categoryDepth || 0} 层`}
                                hint="观察资料结构的组织深度"
                                muted={!dashboard.categoryDepth}
                            />
                        </div>
                    </article>

                    <article className="pe-dashboard-panel pe-dashboard-panel--signals">
                        <div className="pe-dashboard-panel__header">
                            <h3>需要留意的地方</h3>
                            <span>资料整理</span>
                        </div>
                        <DashboardSignalList items={dashboard.signalItems}/>
                    </article>
                </div>

                <aside className="pe-dashboard-sidebar">
                    <ProjectDashboardRiskPanel projectStats={props.projectStats} riskSummary={props.riskSummary}/>
                </aside>
            </div>
        </section>
    )
}

function DashboardDistributionBlock({title, items, variant = 'bar'}: {
    title: string
    items: DashboardBarItem[]
    variant?: 'bar' | 'pie'
}) {
    const isEmpty = items.length === 0 || items.every(item => item.value === 0)
    return (
        <div
            className={`pe-dashboard-distribution-block pe-dashboard-distribution-block--${variant}`}
            data-empty={isEmpty ? 'true' : undefined}
        >
            <h4>{title}</h4>
            {variant === 'pie' && <DashboardPieChart items={items}/>}
            {variant === 'bar' && <DashboardBarList items={items}/>}
        </div>
    )
}

export default ProjectDashboard
