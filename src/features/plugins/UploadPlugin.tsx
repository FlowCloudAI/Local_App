import {useEffect, useState} from 'react'
import {createPortal} from 'react-dom'
import {open as openDialog} from '@tauri-apps/plugin-dialog'
import {Button, Input, useAlert} from 'flowcloudai-ui'
import {plugin_market_upload} from '../../api'
import './UploadPlugin.css'

interface UploadPluginProps {
    open: boolean
    onClose: () => void
    onUploaded?: () => void
}

export default function UploadPlugin({open, onClose, onUploaded}: UploadPluginProps) {
    const {showAlert} = useAlert()
    const [filePath, setFilePath] = useState('')
    const [password, setPassword] = useState('')
    const [submitting, setSubmitting] = useState(false)
    const [apiError, setApiError] = useState<string | null>(null)

    useEffect(() => {
        if (!open) return
        queueMicrotask(() => {
            setFilePath('')
            setPassword('')
            setSubmitting(false)
            setApiError(null)
        })
    }, [open])

    useEffect(() => {
        if (!open) return
        const handler = (event: KeyboardEvent) => {
            if (event.key === 'Escape' && !submitting) onClose()
        }
        window.addEventListener('keydown', handler)
        return () => window.removeEventListener('keydown', handler)
    }, [open, submitting, onClose])

    const canSubmit = filePath.trim().length > 0 && password.trim().length > 0 && !submitting

    const handlePickFile = async () => {
        const selected = await openDialog({
            multiple: false,
            directory: false,
            title: '选择要上传的插件包',
            filters: [
                {
                    name: 'FlowCloudAI 插件包',
                    extensions: ['fcplug'],
                },
            ],
        })
        if (!selected || Array.isArray(selected)) return
        setFilePath(selected)
        setApiError(null)
    }

    const handleSubmit = async () => {
        if (!canSubmit) return
        setSubmitting(true)
        setApiError(null)
        try {
            await plugin_market_upload(filePath.trim(), password)
            void showAlert('插件已上传', 'success', 'toast', 1200)
            onUploaded?.()
            onClose()
        } catch (e) {
            setApiError(e instanceof Error ? e.message : String(e))
            setSubmitting(false)
        }
    }

    if (!open) return null

    return createPortal(
        <div
            className="upload-plugin-backdrop"
            onClick={event => {
                if (event.target === event.currentTarget && !submitting) onClose()
            }}
        >
            <div className="upload-plugin-dialog" role="dialog" aria-modal="true" aria-label="上传本地插件">
                <div className="upload-plugin-header">
                    <span className="upload-plugin-title">上传本地插件</span>
                    <button
                        className="upload-plugin-close"
                        onClick={onClose}
                        disabled={submitting}
                        aria-label="关闭"
                    >
                        <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
                            <path d="M1 1l10 10M11 1L1 11" stroke="currentColor" strokeWidth="1.75"
                                  strokeLinecap="round"/>
                        </svg>
                    </button>
                </div>

                <div className="upload-plugin-body">
                    <div className="upload-plugin-field">
                        <label className="upload-plugin-label">
                            插件文件
                            <span className="upload-plugin-required" aria-hidden="true"> *</span>
                        </label>
                        <div className="upload-plugin-file-row">
                            <Input
                                value={filePath}
                                readOnly
                                placeholder="请选择 .fcplug 文件"
                                className="upload-plugin-file-input"
                            />
                            <Button
                                variant="outline"
                                size="sm"
                                onClick={() => void handlePickFile()}
                                disabled={submitting}
                            >
                                选择文件
                            </Button>
                        </div>
                    </div>

                    <div className="upload-plugin-field">
                        <label className="upload-plugin-label">
                            上传密码
                            <span className="upload-plugin-required" aria-hidden="true"> *</span>
                        </label>
                        <Input
                            type="password"
                            value={password}
                            onChange={value => setPassword(String(value))}
                            placeholder="请输入上传密码"
                            disabled={submitting}
                        />
                    </div>

                    {apiError && (
                        <p className="upload-plugin-api-error">上传失败：{apiError}</p>
                    )}
                </div>

                <div className="upload-plugin-footer">
                    <Button variant="ghost" size="sm" onClick={onClose} disabled={submitting}>
                        取消
                    </Button>
                    <Button size="sm" onClick={() => void handleSubmit()} disabled={!canSubmit}>
                        {submitting ? '上传中…' : '上传'}
                    </Button>
                </div>
            </div>
        </div>,
        document.body
    )
}
