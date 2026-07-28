import type {RefObject} from 'react'
import {useAlert} from 'flowcloudai-ui'
import {
    type HelpModuleKey,
    type HelpTopicGroup,
    type HelpTopicKey,
} from '../../../shared/help/helpCatalog'
import {DockPanelSearchInput} from '../../../shared/ui/layout/DockPanelSidebarControls'
import {HOME_ONBOARDING_TOUR_ID, PROJECT_EDITOR_TOUR_ID, useTour} from '../../onboarding'
import './HelpHome.css'

interface HelpHomeProps {
    groups: HelpTopicGroup[]
    bodyRef: RefObject<HTMLDivElement | null>
    searchText: string
    onSearchTextChange: (value: string) => void
    onSelectModule: (moduleKey: HelpModuleKey) => void
    onSelectTopic: (topicKey: HelpTopicKey, sectionId?: string) => void
}

export default function HelpHome({
    groups,
    bodyRef,
    searchText,
    onSearchTextChange,
    onSelectModule,
    onSelectTopic,
}: HelpHomeProps) {
    const {startRegisteredTour} = useTour()
    const {showAlert} = useAlert()
    const handleStartProjectTour = () => {
        const started = startRegisteredTour(PROJECT_EDITOR_TOUR_ID, {force: true, markCompletedOnSkip: true})
        if (!started) {
            void showAlert('请先打开一个项目，再从帮助中心启动项目页引导。', 'warning', 'nonInvasive', 2200)
        }
    }

    return (
        <div className="help-main__body" ref={bodyRef}>
            <article className="help-index">
                <header className="help-index__header">
                    <h2>你想完成什么？</h2>
                    <p>搜索操作或问题，或按目标浏览帮助文档。</p>
                    <div className="help-index__search">
                        <DockPanelSearchInput
                            value={searchText}
                            onChange={onSearchTextChange}
                            placeholder="例如：创建词条、恢复历史版本"
                            ariaLabel="搜索帮助文档"
                        />
                    </div>
                </header>

                {!searchText.trim() ? (
                    <section className="help-index__section" aria-labelledby="help-index-quick">
                        <h3 id="help-index-quick">从当前页面继续</h3>
                        <div className="help-index__quick-list">
                            <button
                                type="button"
                                className="help-index__quick-item"
                                onClick={() => startRegisteredTour(HOME_ONBOARDING_TOUR_ID, {force: true, markCompletedOnSkip: true})}
                            >
                                <strong>重播首页新手引导</strong>
                                <span>重新熟悉首页和创建第一个世界观的操作。</span>
                            </button>
                            <button
                                type="button"
                                className="help-index__quick-item"
                                onClick={handleStartProjectTour}
                            >
                                <strong>打开项目页引导</strong>
                                <span>了解项目编辑器、概览、结构配置和词条区域。</span>
                            </button>
                        </div>
                    </section>
                ) : null}

                <section className="help-index__section" aria-labelledby="help-index-modules">
                    <h3 id="help-index-modules">{searchText.trim() ? '搜索结果' : '按目标浏览'}</h3>
                    {groups.length > 0 ? (
                        <div className="help-index__module-list">
                            {groups.map(group => (
                                <section className="help-index__module" key={group.module.key}>
                                    <button
                                        type="button"
                                        className="help-index__module-title"
                                        onClick={() => onSelectModule(group.module.key)}
                                    >
                                        <span>{group.module.label}</span>
                                        <em>{group.topics.length} 篇</em>
                                    </button>
                                    <p>{group.module.description}</p>
                                    <div className="help-index__topic-links" aria-label={`${group.module.label} 文档`}>
                                        {group.topics.map(topic => (
                                            <button
                                                key={topic.key}
                                                type="button"
                                                onClick={() => onSelectTopic(topic.key)}
                                            >
                                                {topic.label}
                                            </button>
                                        ))}
                                    </div>
                                </section>
                            ))}
                        </div>
                    ) : (
                        <div className="help-index__empty">
                            <strong>没有匹配内容</strong>
                            <span>换一个关键词试试。</span>
                        </div>
                    )}
                </section>
            </article>
        </div>
    )
}
