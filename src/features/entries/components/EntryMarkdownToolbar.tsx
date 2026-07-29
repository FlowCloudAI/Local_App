/**
 * 桌面端词条正文工具栏；只负责命令编排，文本修改仍交给 MarkdownEditor。
 */
import {commands, type ICommand} from '@uiw/react-md-editor'
import {Button, Select} from 'flowcloudai-ui'
import {buildBlockStyleEdit, buildWikiLinkEdit} from './entryMarkdownToolbarCommands'

const STYLE_OPTIONS = [
    {value: 'paragraph', label: '正文'},
    {value: 'heading1', label: '标题 1'},
    {value: 'heading2', label: '标题 2'},
    {value: 'heading3', label: '标题 3'},
]

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

const STYLE_COMMANDS: Record<string, ICommand> = {
    paragraph: createBlockStyleCommand('paragraph', ''),
    heading1: createBlockStyleCommand('heading1', '# '),
    heading2: createBlockStyleCommand('heading2', '## '),
    heading3: createBlockStyleCommand('heading3', '### '),
}

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
    splitView: boolean
    onUndo: () => void
    onRedo: () => void
    onCommand: (command: ICommand) => void
    onInsertImage: () => void
    onSplitViewChange: (split: boolean) => void
    onMore: () => void
}

interface CommandButtonProps {
    command: ICommand
    label: string
    onCommand: (command: ICommand) => void
}

function CommandButton({command, label, onCommand}: CommandButtonProps) {
    return (
        <Button
            type="button"
            variant="ghost"
            size="sm"
            iconOnly
            className="entry-editor-format-toolbar__command"
            aria-label={label}
            title={label}
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
    splitView,
    onUndo,
    onRedo,
    onCommand,
    onInsertImage,
    onSplitViewChange,
    onMore,
}: EntryMarkdownToolbarProps) {
    const handleStyleChange = (value: string | number | (string | number)[]) => {
        const styleCommand = STYLE_COMMANDS[String(value)]
        if (styleCommand) onCommand(styleCommand)
    }

    return (
        <div className="entry-editor-format-toolbar" aria-label="正文格式工具栏">
            <Select
                className="entry-editor-format-toolbar__style"
                aria-label="段落样式"
                value="paragraph"
                options={STYLE_OPTIONS}
                onValueChange={handleStyleChange}
                radius="md"
            />

            <div
                className="entry-editor-format-toolbar__viewport"
                data-mobile-horizontal-scroll
            >
                <div className="entry-editor-format-toolbar__commands">
                    <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        disabled={!canUndo}
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
                        onMouseDown={(event) => event.preventDefault()}
                        onClick={onRedo}
                    >
                        重做
                    </Button>
                    <span className="entry-editor-format-toolbar__divider" aria-hidden="true"/>
                    <CommandButton command={commands.bold} label="加粗" onCommand={onCommand}/>
                    <CommandButton command={commands.italic} label="斜体" onCommand={onCommand}/>
                    <CommandButton command={commands.strikethrough} label="删除线" onCommand={onCommand}/>
                    <span className="entry-editor-format-toolbar__divider" aria-hidden="true"/>
                    <CommandButton command={commands.quote} label="引用" onCommand={onCommand}/>
                    <CommandButton command={commands.code} label="行内代码" onCommand={onCommand}/>
                    <CommandButton command={commands.codeBlock} label="代码块" onCommand={onCommand}/>
                    <span className="entry-editor-format-toolbar__divider" aria-hidden="true"/>
                    <CommandButton command={commands.unorderedListCommand} label="无序列表" onCommand={onCommand}/>
                    <CommandButton command={commands.orderedListCommand} label="有序列表" onCommand={onCommand}/>
                    <span className="entry-editor-format-toolbar__divider" aria-hidden="true"/>
                    <CommandButton command={commands.link} label="链接" onCommand={onCommand}/>
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
                </div>
            </div>

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

            <Button
                type="button"
                variant="ghost"
                size="sm"
                className="entry-editor-format-toolbar__more"
                onClick={onMore}
            >
                更多
            </Button>
        </div>
    )
}
