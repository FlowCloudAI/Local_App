import {
    formatMobileIdeaDate,
    getMobileIdeaPreview,
    getMobileIdeaTitle,
    MOBILE_IDEA_STATUS_OPTIONS,
    type MobileIdeaController,
    type MobileIdeaProjectFilter,
} from '../hooks/useMobileIdeaController'
import './MobileIdeaDrawer.css'

interface Props {
    controller: MobileIdeaController
    onClose?: () => void
}

function SearchIcon() {
    return (
        <svg className="mobile-idea-drawer__svg" viewBox="0 0 24 24" focusable="false">
            <circle cx="11" cy="11" r="6.5"/>
            <path d="m16 16 4 4"/>
        </svg>
    )
}

function PinIcon() {
    return (
        <svg className="mobile-idea-drawer__pin" viewBox="0 0 24 24" focusable="false">
            <path d="M12 17v5"/>
            <path d="M8.5 10.8 6.2 13.1A1.7 1.7 0 0 0 7.4 16h9.2a1.7 1.7 0 0 0 1.2-2.9l-2.3-2.3V6.5l1.5-1.5H7l1.5 1.5Z"/>
        </svg>
    )
}

export default function MobileIdeaDrawer({controller, onClose}: Props) {
    const {
        visibleIdeas,
        ideas,
        projects,
        loading,
        statusFilter,
        setStatusFilter,
        projectFilter,
        setProjectFilter,
        searchText,
        setSearchText,
        selectedIdeaId,
        projectNameById,
        selectIdea,
        startNewIdea,
    } = controller

    const handleProjectFilterChange = (value: string) => {
        setProjectFilter(value as MobileIdeaProjectFilter)
    }

    return (
        <aside className="mobile-idea-drawer" aria-label="灵感列表">
            <div className="mobile-idea-drawer__header">
                <span>灵感列表</span>
                <small>{visibleIdeas.length}/{ideas.length} 条</small>
            </div>

            <label className="mobile-idea-drawer__search">
                <SearchIcon/>
                <input
                    value={searchText}
                    onChange={event => setSearchText(event.target.value)}
                    placeholder="搜索灵感…"
                    aria-label="搜索灵感"
                />
            </label>

            <div className="mobile-idea-drawer__filters">
                <div className="mobile-idea-drawer__filter-group">
                    <span>状态</span>
                    <div className="mobile-idea-drawer__segmented">
                        {MOBILE_IDEA_STATUS_OPTIONS.map(option => (
                            <button
                                key={option.key}
                                type="button"
                                className={statusFilter === option.key ? 'active' : ''}
                                onClick={() => setStatusFilter(option.key)}
                            >
                                {option.label}
                            </button>
                        ))}
                    </div>
                </div>
                <div className="mobile-idea-drawer__filter-group">
                    <span>范围</span>
                    <select
                        value={projectFilter}
                        onChange={event => handleProjectFilterChange(event.target.value)}
                        aria-label="筛选灵感所属项目"
                    >
                        <option value="all">全部灵感</option>
                        <option value="global">全局灵感</option>
                        {projects.map(project => (
                            <option key={project.id} value={project.id}>{project.name}</option>
                        ))}
                    </select>
                </div>
            </div>

            <button
                type="button"
                className="mobile-idea-drawer__new"
                onClick={() => {
                    startNewIdea()
                    onClose?.()
                }}
            >
                + 新灵感
            </button>

            <div className="mobile-idea-drawer__list" aria-busy={loading}>
                {loading ? (
                    <div className="mobile-idea-drawer__empty">加载中…</div>
                ) : visibleIdeas.length === 0 ? (
                    <div className="mobile-idea-drawer__empty">没有匹配的灵感</div>
                ) : visibleIdeas.map(idea => {
                    const active = idea.id === selectedIdeaId
                    const projectName = idea.project_id ? projectNameById.get(idea.project_id) ?? '未知项目' : '全局'
                    return (
                        <button
                            key={idea.id}
                            type="button"
                            className={`mobile-idea-drawer__item${active ? ' active' : ''}${idea.pinned ? ' is-pinned' : ''}`}
                            aria-current={active ? 'true' : undefined}
                            onClick={() => {
                                selectIdea(idea)
                                onClose?.()
                            }}
                        >
                            <span className="mobile-idea-drawer__item-main">
                                <strong>{getMobileIdeaTitle(idea)}</strong>
                                <small>{getMobileIdeaPreview(idea)}</small>
                            </span>
                            <span className="mobile-idea-drawer__item-meta">
                                {idea.pinned ? <PinIcon/> : null}
                                <span>{projectName}</span>
                                <span>{formatMobileIdeaDate(idea.updated_at)}</span>
                            </span>
                        </button>
                    )
                })}
            </div>
        </aside>
    )
}
