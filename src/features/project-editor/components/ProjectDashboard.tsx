import {
    DashboardBarList,
    type DashboardBarItem,
    DashboardKpiStrip,
    DashboardMetric,
    DashboardPieChart,
    DashboardSignalList,
    DashboardStackedDistribution,
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
        <section className="pe-dashboard-section">
            <div className="pe-dashboard-section__header">
                <div>
                    <h2 className="pe-feature-section__title">项目驾驶舱</h2>
                    <p className="pe-feature-section__desc">
                        从管理视角观察世界观规模、结构化程度和资料配置状态。
                    </p>
                </div>
                <div className="pe-dashboard-section__badge">MIS 视图</div>
            </div>

            <div className="pe-dashboard-status-strip">
                <article className="pe-dashboard-kpi pe-dashboard-kpi--health">
                    <HealthMeter score={dashboard.structureScore}/>
                </article>
                <div className="pe-dashboard-status-strip__kpis">
                    <DashboardKpiStrip items={dashboard.kpiItems}/>
                </div>
            </div>
            <div className="pe-dashboard-checks">
                {dashboard.structureChecks.map(item => (
                    <span
                        key={item.label}
                        className={`pe-dashboard-check ${item.passed ? 'is-passed' : 'is-missing'}`}
                    >
                        {item.label}
                    </span>
                ))}
            </div>

            <div className="pe-dashboard-layout">
                <div className="pe-dashboard-main-column">
                    <article className="pe-dashboard-panel pe-dashboard-panel--primary">
                        <div className="pe-dashboard-panel__header">
                            <h3>创作资产概览</h3>
                            <span>{formatDashboardNumber(assetTotal)} 项资产</span>
                        </div>
                        <div className="pe-dashboard-distribution-grid">
                            <DashboardDistributionBlock
                                title={props.projectStats ? '词条类型分布' : '词条类型配置'}
                                items={dashboard.typeItems}
                                variant="stacked"
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
                            <h3>世界观结构分析</h3>
                            <span>组织深度与连接密度</span>
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
                            <h3>管理信号</h3>
                            <span>资料治理</span>
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
    variant?: 'bar' | 'pie' | 'stacked'
}) {
    const isEmpty = items.length === 0 || items.every(item => item.value === 0)
    return (
        <div
            className={`pe-dashboard-distribution-block pe-dashboard-distribution-block--${variant}`}
            data-empty={isEmpty ? 'true' : undefined}
        >
            <h4>{title}</h4>
            {variant === 'pie' && <DashboardPieChart items={items}/>}
            {variant === 'stacked' && <DashboardStackedDistribution items={items}/>}
            {variant === 'bar' && <DashboardBarList items={items}/>}
        </div>
    )
}

export default ProjectDashboard
