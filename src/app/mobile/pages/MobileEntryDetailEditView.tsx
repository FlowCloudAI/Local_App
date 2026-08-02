/* eslint-disable react-hooks/refs -- 仅透传父组件 refs 与组件 props，不读取 ref.current */
/* 移动端词条编辑视图：保留标题与正文主链路，低频属性统一收口。 */
import type {ComponentProps, RefObject} from 'react'
import {Input, Select} from 'flowcloudai-ui'
import type {Category, EntryTypeView} from '../../../api'
import {entryTypeKey} from '../../../api'
import EntryTypeCreator from '../../../features/entries/components/EntryTypeCreator'
import TagCreator from '../../../features/entries/components/TagCreator'
import EntryImageAddModal from '../../../features/entries/components/EntryImageAddModal'
import EntryImageLightbox from '../../../features/entries/components/EntryImageLightbox'
import {MarkdownEditor, type MarkdownEditorRef} from '../../../features/entries/components/MarkdownEditor/MarkdownEditor'
import {MobileAddIcon, MobileBackIcon, MobilePageTopBar, MobileTopActionPill} from '../components/MobileTopControls'
import {MobileEntryDetailActionIcon} from './MobileEntryDetailActionIcon'
import {MobileEntryImmersiveEditor} from './MobileEntryImmersiveEditor'
import {MobileEntryImagesSection} from './MobileEntryImagesSection'
import {MobileEntryRelationsSection} from './MobileEntryRelationsSection'
import {MobileEntryTagsSection} from './MobileEntryTagsSection'

export type MobileWikiDraft = {start: number; end: number; query: string}
export type MobileWikiOption = {kind: 'entry'; id: string; title: string; categoryId: string | null} | {kind: 'create'; title: string}

interface Props {
    saving: boolean; isDirty: boolean; error: string | null; onCancel: () => void; onSave: () => void
    title: string; onTitle: (value: string) => void; summary: string; onSummary: (value: string) => void
    entryType: string | null; onEntryType: (value: string | null) => void; categoryId: string | null; onCategory: (value: string | null) => void
    categories: Category[]; entryTypes: EntryTypeView[]; onOpenTypeCreator: () => void
    content: string; editorRef: RefObject<MarkdownEditorRef | null>; onContentChange: (value: string) => void
    textareaProps: ComponentProps<typeof MarkdownEditor>['textareaProps']; immersiveOpen: boolean; onOpenImmersive: () => void
    wikiDraft: MobileWikiDraft | null; wikiOptions: MobileWikiOption[]; activeWikiIndex: number; categoryNameById: Map<string, string>; creatingLinkedEntry: boolean
    onWikiIndex: (index: number) => void; onWikiCommit: (option: MobileWikiOption) => void
    imagesProps: ComponentProps<typeof MobileEntryImagesSection>
    tagsProps: ComponentProps<typeof MobileEntryTagsSection>
    relationsProps: ComponentProps<typeof MobileEntryRelationsSection>
    immersiveProps: Omit<ComponentProps<typeof MobileEntryImmersiveEditor>, 'wikiPanel'>
    typeCreatorProps: ComponentProps<typeof EntryTypeCreator>
    tagCreatorProps: ComponentProps<typeof TagCreator>
    lightboxProps: ComponentProps<typeof EntryImageLightbox>
    imageAddProps: ComponentProps<typeof EntryImageAddModal>
}

export default function MobileEntryDetailEditView(p: Props) {
    const categoryOptions = [{value: '', label: '无分类'}, ...p.categories.map(category => ({value: category.id, label: category.name}))]
    const typeOptions = [{value: '', label: '无类型'}, ...p.entryTypes.map(type => ({value: entryTypeKey(type), label: type.name}))]
    const additionalSummary = [
        p.summary.trim() ? '摘要已填' : '无摘要',
        `图片 ${p.imagesProps.images.length}`,
        `标签 ${p.tagsProps.editTagSchemas.length}`,
        `关系 ${p.relationsProps.relationDrafts.length}`,
    ].join(' · ')
    const wikiPanel = p.wikiDraft ? <div className="mobile-entry-detail__wiki-panel" role="listbox" aria-label="词条链接候选">
        <div className="mobile-entry-detail__wiki-panel-title">插入词条链接</div>
        {p.wikiOptions.length > 0 ? <div className="mobile-entry-detail__wiki-options">{p.wikiOptions.map((option, index) => {
            const active = index === p.activeWikiIndex
            const creating = option.kind === 'create'
            const categoryName = option.kind === 'entry' && option.categoryId ? p.categoryNameById.get(option.categoryId) : null
            return <button type="button" key={option.kind === 'entry' ? `entry-${option.id}` : `create-${option.title}`} role="option" aria-selected={active} className={`mobile-entry-detail__wiki-option${active ? ' is-active' : ''}${creating ? ' mobile-entry-detail__wiki-option--create' : ''}`} disabled={creating && p.creatingLinkedEntry} onMouseDown={event => event.preventDefault()} onMouseEnter={() => p.onWikiIndex(index)} onFocus={() => p.onWikiIndex(index)} onClick={() => p.onWikiCommit(option)}><span className="mobile-entry-detail__wiki-option-title">{option.kind === 'entry' ? option.title : `创建「${option.title}」`}</span><span className="mobile-entry-detail__wiki-option-meta">{option.kind === 'entry' ? (categoryName ?? '未分类') : (p.creatingLinkedEntry ? '创建中…' : '新词条')}</span></button>
        })}</div> : <div className="mobile-entry-detail__wiki-empty">没有匹配词条</div>}
    </div> : null

    return <div className="mobile-page mobile-entry-detail mobile-entry-detail--edit">
        <MobilePageTopBar className="mobile-entry-detail__edit-topbar" sticky edgeToEdge ariaLabel="词条编辑操作"
            left={<MobileTopActionPill actions={[{key: 'cancel', label: '取消编辑', icon: <MobileBackIcon/>, disabled: p.saving, onClick: p.onCancel}]}/>} center={<div className="mobile-entry-detail__edit-heading"><span>编辑词条</span><small>{p.saving ? '保存中…' : p.isDirty ? '有未保存修改' : '已同步'}</small></div>} right={<MobileTopActionPill actions={[{key: 'save', label: p.saving ? '保存中' : '保存词条', icon: <MobileEntryDetailActionIcon type={p.saving ? 'more' : 'save'}/>, kind: 'add', disabled: p.saving, onClick: p.onSave}]}/>}/>
        {p.error && <div className="mobile-page__error-banner" role="alert"><span>{p.error}</span></div>}
        <section className="mobile-entry-detail__form-section mobile-entry-detail__form-section--identity">
            <label className="mobile-entry-detail__title-field">
                <span>标题</span>
                <Input placeholder="词条标题" value={p.title} onValueChange={p.onTitle} className="mobile-entry-detail__title-input"/>
            </label>
            <div className="mobile-entry-detail__meta-row"><label className="mobile-entry-detail__field"><span>类型</span><Select value={p.entryType ?? ''} onValueChange={value => p.onEntryType(value ? String(value) : null)} options={typeOptions} placeholder="类型" className="mobile-entry-detail__meta-select"/></label><label className="mobile-entry-detail__field"><span>分类</span><Select value={p.categoryId ?? ''} onValueChange={value => p.onCategory(value ? String(value) : null)} options={categoryOptions} placeholder="分类" className="mobile-entry-detail__meta-select"/></label></div>
            <button type="button" className="mobile-entry-detail__add-type" onClick={p.onOpenTypeCreator}><MobileAddIcon className="mobile-top-control-svg--inline"/>新建类型</button>
        </section>
        <section className="mobile-entry-detail__form-section mobile-entry-detail__form-section--content">
            <div className="mobile-entry-detail__section-header"><span>正文</span><button type="button" className="mobile-entry-detail__section-action" onClick={p.onOpenImmersive}>沉浸</button></div>
            <div className="mobile-entry-detail__content-field"><MarkdownEditor ref={p.editorRef} value={p.content} onValueChange={p.onContentChange} placeholder="正文内容…输入 [[ 插入词条双链" minHeight={260} maxHeight={560} showSplitToggle={false} hideFullscreen toolbarCommands={[]} extraCommands={[]} textareaProps={p.textareaProps} tokens={{background: 'transparent', toolbarBackground: 'transparent', borderColor: 'transparent', editorTextBackground: 'transparent', previewBackground: 'transparent', textColor: 'var(--fc-color-text)', mutedTextColor: 'var(--fc-color-text-secondary)'}} className="mobile-entry-detail__content-input"/>{!p.immersiveOpen && wikiPanel}</div>
        </section>
        <details className="mobile-entry-detail__additional">
            <summary className="mobile-entry-detail__additional-summary">
                <strong>附加内容</strong>
                <span>{additionalSummary}</span>
            </summary>
            <div className="mobile-entry-detail__additional-body">
                <label className="mobile-entry-detail__summary-field">
                    <span>摘要</span>
                    <textarea placeholder="摘要（可选）" value={p.summary} onChange={event => p.onSummary(event.target.value)} className="mobile-entry-detail__summary-input" rows={2}/>
                </label>
                <MobileEntryImagesSection {...p.imagesProps}/>
                <MobileEntryTagsSection {...p.tagsProps}/>
                <MobileEntryRelationsSection {...p.relationsProps}/>
            </div>
        </details>
        {p.immersiveOpen && <MobileEntryImmersiveEditor {...p.immersiveProps} wikiPanel={wikiPanel}/>}<EntryTypeCreator {...p.typeCreatorProps}/><TagCreator {...p.tagCreatorProps}/><EntryImageLightbox {...p.lightboxProps}/><EntryImageAddModal {...p.imageAddProps}/>
    </div>
}
