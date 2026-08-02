/* 移动端沉浸正文编辑器：跟随可视视口避让系统键盘，并承载常用 Markdown 工具。 */
import {MarkdownEditor, type MarkdownEditorRef} from '../../../features/entries/components/MarkdownEditor/MarkdownEditor'
import {type ComponentProps, type ReactNode, type RefObject, useEffect, useRef} from 'react'
import {
    MobileBackIcon,
    MobilePageTopBar,
    MobileTopActionPill,
} from '../components/MobileTopControls'
import {MobileEntryDetailActionIcon} from './MobileEntryDetailActionIcon'
import {MOBILE_MARKDOWN_TOOLS, type MobileMarkdownTool} from './MobileEntryMarkdownToolModel'
import {MobileMarkdownToolIcon} from './MobileEntryMarkdownTools'

type MobileMarkdownEditorTextareaProps = NonNullable<ComponentProps<typeof MarkdownEditor>['textareaProps']>

interface MobileEntryImmersiveEditorProps {
    editorRef: RefObject<MarkdownEditorRef | null>
    content: string
    textareaProps: MobileMarkdownEditorTextareaProps
    wikiPanel: ReactNode
    isDirty: boolean
    saving: boolean
    onContentChange: (value: string) => void
    onClose: () => void
    onSave: () => void
    onMarkdownTool: (tool: MobileMarkdownTool) => void
}

export function MobileEntryImmersiveEditor({
    editorRef,
    content,
    textareaProps,
    wikiPanel,
    isDirty,
    saving,
    onContentChange,
    onClose,
    onSave,
    onMarkdownTool,
}: MobileEntryImmersiveEditorProps) {
    const viewportRootRef = useRef<HTMLDivElement>(null)

    useEffect(() => {
        const viewport = window.visualViewport
        if (!viewport) return undefined

        const syncViewport = () => {
            const root = viewportRootRef.current
            if (!root) return
            root.style.setProperty('--mobile-entry-viewport-height', `${viewport.height}px`)
            root.style.setProperty('--mobile-entry-viewport-offset-top', `${viewport.offsetTop}px`)
            root.toggleAttribute('data-keyboard-visible', viewport.height < window.innerHeight - 80)
        }

        syncViewport()
        viewport.addEventListener('resize', syncViewport)
        viewport.addEventListener('scroll', syncViewport)
        return () => {
            viewport.removeEventListener('resize', syncViewport)
            viewport.removeEventListener('scroll', syncViewport)
        }
    }, [])

    return (
        <div ref={viewportRootRef} className="mobile-entry-detail__immersive" role="dialog" aria-label="沉浸正文编辑">
            <MobilePageTopBar
                className="mobile-entry-detail__immersive-topbar"
                ariaLabel="沉浸正文编辑操作"
                left={<MobileTopActionPill
                    actions={[{
                        key: 'close',
                        label: '退出沉浸编辑',
                        icon: <MobileBackIcon/>,
                        onClick: onClose,
                    }]}
                />}
                center={<div className="mobile-entry-detail__edit-heading">
                    <span>正文编辑</span>
                    <small>{isDirty ? '有未保存修改' : '已同步'}</small>
                </div>}
                right={<MobileTopActionPill
                    actions={[{
                        key: 'save',
                        label: saving ? '保存中' : '保存词条',
                        icon: saving ? <MobileEntryDetailActionIcon type="more"/> : <MobileEntryDetailActionIcon type="save"/>,
                        kind: 'add',
                        disabled: saving,
                        onClick: onSave,
                    }]}
                />}
            />
            <div className="mobile-entry-detail__immersive-body">
                <MarkdownEditor
                    ref={editorRef}
                    value={content}
                    onValueChange={onContentChange}
                    placeholder="正文内容…输入 [[ 插入词条双链"
                    autoHeight={false}
                    height="100%"
                    minHeight={420}
                    showSplitToggle={false}
                    hideFullscreen
                    toolbarCommands={[]}
                    extraCommands={[]}
                    textareaProps={textareaProps}
                    tokens={{
                        background: 'transparent',
                        toolbarBackground: 'transparent',
                        borderColor: 'transparent',
                        editorTextBackground: 'transparent',
                        previewBackground: 'transparent',
                        textColor: 'var(--fc-color-text)',
                        mutedTextColor: 'var(--fc-color-text-secondary)',
                    }}
                    className="mobile-entry-detail__immersive-editor"
                />
                {wikiPanel}
            </div>
            <div
                className="mobile-entry-detail__markdown-toolbar"
                role="toolbar"
                aria-label="Markdown 常用工具"
                data-mobile-horizontal-scroll="true"
            >
                {MOBILE_MARKDOWN_TOOLS.map(item => (
                    <button
                        key={item.tool}
                        type="button"
                        className="mobile-entry-detail__markdown-tool"
                        aria-label={item.label}
                        title={item.label}
                        onMouseDown={(event) => event.preventDefault()}
                        onClick={() => onMarkdownTool(item.tool)}
                    >
                        <MobileMarkdownToolIcon tool={item.tool}/>
                    </button>
                ))}
            </div>
        </div>
    )
}
