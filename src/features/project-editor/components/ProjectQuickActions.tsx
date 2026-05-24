import {memo} from 'react'
import {DashboardActionList} from './ProjectDashboardParts'
import {buildProjectQuickActionItems, type ProjectQuickActionInput} from './ProjectDashboardModel'
import './ProjectDashboard.css'
import './ProjectDashboardControls.css'
import './ProjectQuickActions.css'

function ProjectQuickActions(props: ProjectQuickActionInput) {
    const items = buildProjectQuickActionItems(props)
    return (
        <section className="pe-quick-actions">
            <article className="pe-dashboard-panel">
                <div className="pe-dashboard-panel__header">
                    <h3>核心视图</h3>
                    <span>项目入口</span>
                </div>
                <DashboardActionList items={items}/>
            </article>
        </section>
    )
}

export default memo(ProjectQuickActions)
