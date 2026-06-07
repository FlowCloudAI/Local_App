import {useEffect, useState} from 'react'
import {Button, Input} from 'flowcloudai-ui'
import FloatingPanel from './FloatingPanel'
import './RenameDialog.css'

export interface RenameDialogProps {
    open: boolean
    /** 标题，如「重命名项目」。 */
    title?: string
    /** 输入框上方的说明。 */
    label?: string
    /** 打开时填入的初始值。 */
    initialValue: string
    placeholder?: string
    confirmText?: string
    /** 提交进行中：禁用交互、背板不可关。 */
    busy?: boolean
    onClose: () => void
    onConfirm: (value: string) => void | Promise<void>
}

/**
 * 单行文本编辑浮层（重命名通用）。Alert 只能放字符串，承不了输入框，故单独做一个。
 * 基于 FloatingPanel；项目/分类/词条重命名均可复用。
 */
export default function RenameDialog({
    open,
    title = '重命名',
    label,
    initialValue,
    placeholder,
    confirmText = '确定',
    busy = false,
    onClose,
    onConfirm,
}: RenameDialogProps) {
    const [value, setValue] = useState(initialValue)

    // 每次打开同步初始值。
    useEffect(() => {
        if (open) setValue(initialValue)
    }, [open, initialValue])

    const trimmed = value.trim()
    const canConfirm = trimmed.length > 0 && !busy

    return (
        <FloatingPanel open={open} onClose={onClose} dismissible={!busy} ariaLabel={title} className="fc-rename-dialog">
            <div className="fc-rename-dialog__title">{title}</div>
            {label && <div className="fc-rename-dialog__label">{label}</div>}
            <Input
                value={value}
                onValueChange={setValue}
                placeholder={placeholder}
                disabled={busy}
                className="fc-rename-dialog__input"
            />
            <div className="fc-rename-dialog__actions">
                <Button type="button" variant="ghost" size="sm" onClick={onClose} disabled={busy}>取消</Button>
                <Button type="button" size="sm" disabled={!canConfirm} onClick={() => void onConfirm(trimmed)}>
                    {busy ? '处理中…' : confirmText}
                </Button>
            </div>
        </FloatingPanel>
    )
}
