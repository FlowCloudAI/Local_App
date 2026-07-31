/**
 * 桌面端词条正文工具栏；只负责命令编排，文本修改仍交给 MarkdownEditor。
 */
import {commands, type ICommand} from '@uiw/react-md-editor'
import {Button} from 'flowcloudai-ui'
import type {ReactNode} from 'react'
import {
    buildBlockStyleEdit,
    buildWikiLinkEdit,
    type MarkdownBlockStyle,
} from './entryMarkdownToolbarCommands'

function createBlockStyleCommand(name: string, prefix: string): ICommand {
    return {
        name,
        keyCommand: name,
        execute: (state, api) => {
            const edit = buildBlockStyleEdit(state.text, state.selection, prefix)
            api.setSelectionRange({start: edit.start, end: edit.end})
            api.replaceSelection(edit.replacement)
            api.setSelectionRange(edit.selection)
        },
    }
}

const BLOCK_STYLE_COMMANDS = [
    {style: 'paragraph', label: '正文', command: createBlockStyleCommand('paragraph', '')},
    {style: 'heading1', label: 'H1', command: createBlockStyleCommand('heading1', '# ')},
    {style: 'heading2', label: 'H2', command: createBlockStyleCommand('heading2', '## ')},
    {style: 'heading3', label: 'H3', command: createBlockStyleCommand('heading3', '### ')},
] as const

const WIKI_LINK_COMMAND: ICommand = {
    name: 'wiki-link',
    keyCommand: 'wiki-link',
    execute: (state, api) => {
        const edit = buildWikiLinkEdit(state.selectedText, state.selection.start)
        api.replaceSelection(edit.replacement)
        api.setSelectionRange(edit.selection)
    },
}

interface EntryMarkdownToolbarProps {
    canUndo: boolean
    canRedo: boolean
    activeBlockStyle: MarkdownBlockStyle
    splitView: boolean
    characterCount: number
    findBar?: ReactNode
    outlinePanel?: ReactNode
    outlineOpen: boolean
    onUndo: () => void
    onRedo: () => void
    onFind: () => void
    onOutline: () => void
    onCommand: (command: ICommand) => void
    onInsertImage: () => void
    onSplitViewChange: (split: boolean) => void
}

interface CommandButtonProps {
    command: ICommand
    label: string
    title?: string
    active?: boolean
    onCommand: (command: ICommand) => void
}

function CommandButton({command, label, title = label, active, onCommand}: CommandButtonProps) {
    return (
        <Button
            type="button"
            variant="ghost"
            size="sm"
            iconOnly
            className={`entry-editor-format-toolbar__command${active ? ' is-active' : ''}`}
            aria-label={label}
            aria-pressed={active}
            title={title}
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => onCommand(command)}
        >
            {command.icon ?? label}
        </Button>
    )
}

export default function EntryMarkdownToolbar({
    canUndo,
    canRedo,
    activeBlockStyle,
    splitView,
    characterCount,
    findBar,
    outlinePanel,
    outlineOpen,
    onUndo,
    onRedo,
    onFind,
    onOutline,
    onCommand,
    onInsertImage,
    onSplitViewChange,
}: EntryMarkdownToolbarProps) {
    return (
        <div className="entry-editor-format-toolbar" aria-label="正文格式工具栏">
            <div className="entry-editor-format-toolbar__viewport">
                <div className="entry-editor-format-toolbar__commands">
                    {BLOCK_STYLE_COMMANDS.map(({style, label, command}) => (
                        <CommandButton
                            key={command.name}
                            command={command}
                            label={label}
                            active={activeBlockStyle === style}
                            onCommand={onCommand}
                        />
                    ))}
                    <span className="entry-editor-format-toolbar__divider" aria-hidden="true"/>
                    <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        disabled={!canUndo}
                        title="撤销（Ctrl+Z）"
                        onMouseDown={(event) => event.preventDefault()}
                        onClick={onUndo}
                    >
                        撤销
                    </Button>
                    <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        disabled={!canRedo}
                        title="重做（Ctrl+Shift+Z 或 Ctrl+Y）"
                        onMouseDown={(event) => event.preventDefault()}
                        onClick={onRedo}
                    >
                        重做
                    </Button>
                    <span className="entry-editor-format-toolbar__divider" aria-hidden="true"/>
                    <CommandButton command={commands.bold} label="加粗" title="加粗（Ctrl+B）" onCommand={onCommand}/>
                    <CommandButton command={commands.italic} label="斜体" title="斜体（Ctrl+I）" onCommand={onCommand}/>
                    <CommandButton command={commands.strikethrough} label="删除线" onCommand={onCommand}/>
                    <span className="entry-editor-format-toolbar__divider" aria-hidden="true"/>
                    <CommandButton command={commands.quote} label="引用" onCommand={onCommand}/>
                    <CommandButton command={commands.code} label="行内代码" onCommand={onCommand}/>
                    <CommandButton command={commands.codeBlock} label="代码块" onCommand={onCommand}/>
                    <span className="entry-editor-format-toolbar__divider" aria-hidden="true"/>
                    <CommandButton command={commands.unorderedListCommand} label="无序列表" onCommand={onCommand}/>
                    <CommandButton command={commands.orderedListCommand} label="有序列表" onCommand={onCommand}/>
                    <span className="entry-editor-format-toolbar__divider" aria-hidden="true"/>
                    <CommandButton command={commands.link} label="链接" title="链接（Ctrl+L）" onCommand={onCommand}/>
                    <CommandButton command={WIKI_LINK_COMMAND} label="双链" onCommand={onCommand}/>
                    <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        iconOnly
                        className="entry-editor-format-toolbar__command"
                        aria-label="插入图片"
                        title="插入图片"
                        onMouseDown={(event) => event.preventDefault()}
                        onClick={onInsertImage}
                    >
                        {commands.image.icon}
                    </Button>
                    <span className="entry-editor-format-toolbar__divider" aria-hidden="true"/>
                    <CommandButton
                        command={commands.checkedListCommand}
                        label="任务列表"
                        onCommand={onCommand}
                    />
                    <CommandButton command={commands.table} label="表格" onCommand={onCommand}/>
                    <CommandButton command={commands.hr} label="分割线" onCommand={onCommand}/>
                </div>
            </div>

            <span
                className="entry-editor-format-toolbar__count"
                aria-label={`正文共 ${characterCount} 个字符`}
                title="去掉 Markdown 标记后的字符数"
            >
                {characterCount} 字
            </span>
            <Button
                type="button"
                variant="ghost"
                size="sm"
                className="entry-editor-format-toolbar__find"
                title="查找替换（Ctrl+F）"
                onClick={onFind}
            >
                查找
            </Button>
            <Button
                type="button"
                variant="ghost"
                size="sm"
                className={`entry-editor-format-toolbar__outline${outlineOpen ? ' is-active' : ''}`}
                aria-pressed={outlineOpen}
                onClick={onOutline}
            >
                大纲
            </Button>

            <div className="entry-editor-format-toolbar__view" role="group" aria-label="编辑器视图">
                <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className={!splitView ? 'is-active' : undefined}
                    aria-pressed={!splitView}
                    onClick={() => onSplitViewChange(false)}
                >
                    编辑
                </Button>
                <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className={splitView ? 'is-active' : undefined}
                    aria-pressed={splitView}
                    onClick={() => onSplitViewChange(true)}
                >
                    双栏
                </Button>
            </div>

            {findBar && (
                <div className="entry-editor-format-toolbar__find-slot">
                    {findBar}
                </div>
            )}
            {outlinePanel}
        </div>
    )
}

interface EntryMarkdownSelectionToolbarProps {
    left: number
    top: number
    placement: 'above' | 'below'
    onCommand: (command: ICommand) => void
}

export function EntryMarkdownSelectionToolbar({
    left,
    top,
    placement,
    onCommand,
}: EntryMarkdownSelectionToolbarProps) {
    return (
        <div
            className={`entry-editor-selection-toolbar is-${placement}`}
            role="toolbar"
            aria-label="选中文本格式"
            style={{left, top}}
        >
            <CommandButton command={commands.bold} label="加粗" onCommand={onCommand}/>
            <CommandButton command={commands.italic} label="斜体" onCommand={onCommand}/>
            <CommandButton command={commands.strikethrough} label="删除线" onCommand={onCommand}/>
            <CommandButton command={commands.code} label="行内代码" onCommand={onCommand}/>
            <CommandButton command={commands.link} label="链接" onCommand={onCommand}/>
        </div>
    )
}
