import {useCallback, useEffect, useState} from 'react'
import {Button, useAlert} from 'flowcloudai-ui'
import {
    dbSnapshot,
    dbListSnapshots,
    dbRollbackTo,
    dbAppendFrom,
    type SnapshotInfo,
    type AppendResult,
} from '../api'
import './SnapshotPanel.css'

function formatSnapshotTime(timestamp: number): string {
    const date = new Date(timestamp * 1000)
    return new Intl.DateTimeFormat('zh-CN', {
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
    }).format(date)
}

function formatSnapshotMessage(message: string): string {
    const parts = message.split(' ')
    if (parts.length >= 2 && (parts[0] === 'auto' || parts[0] === 'manual')) {
        return parts[0] === 'auto' ? '自动保存' : '手动保存'
    }
    return message
}

export default function SnapshotPanel() {
    const {showAlert} = useAlert()
    const [snapshots, setSnapshots] = useState<SnapshotInfo[]>([])
    const [loading, setLoading] = useState(false)
    const [actionId, setActionId] = useState<string | null>(null)

    const load = useCallback(async () => {
        setLoading(true)
        try {
            const list = await dbListSnapshots()
            setSnapshots(list)
        } catch (error) {
            console.error('加载快照列表失败', error)
            void showAlert('加载快照列表失败', 'error')
        } finally {
            setLoading(false)
        }
    }, [showAlert])

    useEffect(() => {
        void load()
    }, [load])

    const handleSnapshot = useCallback(async () => {
        try {
            await dbSnapshot()
            void showAlert('快照已创建', 'success')
            await load()
        } catch (error) {
            console.error('创建快照失败', error)
            void showAlert('创建快照失败', 'error')
        }
    }, [load, showAlert])

    const handleRollback = useCallback(async (snapshot: SnapshotInfo) => {
        const confirmed = await showAlert(
            `确定回退到「${formatSnapshotMessage(snapshot.message)}」？\n当前状态会先自动保存。`,
            'warning',
            'confirm',
        )
        if (confirmed !== 'yes') return

        setActionId(snapshot.id)
        try {
            await dbRollbackTo(snapshot.id)
            void showAlert('回退成功', 'success')
            await load()
        } catch (error) {
            console.error('回退失败', error)
            void showAlert('回退失败', 'error')
        } finally {
            setActionId(null)
        }
    }, [load, showAlert])

    const handleAppend = useCallback(async (snapshot: SnapshotInfo) => {
        const confirmed = await showAlert(
            `确定从「${formatSnapshotMessage(snapshot.message)}」追加恢复缺失记录？`,
            'warning',
            'confirm',
        )
        if (confirmed !== 'yes') return

        setActionId(snapshot.id)
        try {
            const result: AppendResult = await dbAppendFrom(snapshot.id)
            const parts = [
                result.projects && `项目 ${result.projects}`,
                result.categories && `分类 ${result.categories}`,
                result.entries && `词条 ${result.entries}`,
                result.tagSchemas && `标签 ${result.tagSchemas}`,
                result.relations && `关系 ${result.relations}`,
                result.links && `链接 ${result.links}`,
                result.entryTypes && `类型 ${result.entryTypes}`,
                result.ideaNotes && `便签 ${result.ideaNotes}`,
            ].filter(Boolean)
            void showAlert(
                parts.length > 0 ? `已恢复: ${parts.join(', ')}` : '无新增记录',
                'success',
            )
            await load()
        } catch (error) {
            console.error('追加恢复失败', error)
            void showAlert('追加恢复失败', 'error')
        } finally {
            setActionId(null)
        }
    }, [load, showAlert])

    return (
        <div className="snapshot-panel">
            <div className="snapshot-panel__header">
                <h3 className="snapshot-panel__title">版本管理</h3>
                <Button variant="primary" size="sm" onClick={handleSnapshot} disabled={loading}>
                    保存
                </Button>
            </div>

            {loading && snapshots.length === 0 ? (
                <div className="snapshot-panel__empty">正在加载…</div>
            ) : snapshots.length === 0 ? (
                <div className="snapshot-panel__empty">暂无历史版本</div>
            ) : (
                <ul className="snapshot-panel__list">
                    {snapshots.map((snapshot, index) => (
                        <li key={snapshot.id} className="snapshot-panel__item">
                            <div className="snapshot-panel__item-meta">
                                <span className="snapshot-panel__item-index">#{snapshots.length - index}</span>
                                <span className="snapshot-panel__item-type">
                                    {snapshot.message.startsWith('auto') ? '自动' : '手动'}
                                </span>
                            </div>
                            <div className="snapshot-panel__item-time">
                                {formatSnapshotTime(snapshot.timestamp)}
                            </div>
                            <div className="snapshot-panel__item-actions">
                                <Button
                                    variant="ghost"
                                    size="sm"
                                    disabled={actionId === snapshot.id}
                                    onClick={() => void handleRollback(snapshot)}
                                >
                                    回退
                                </Button>
                                <Button
                                    variant="ghost"
                                    size="sm"
                                    disabled={actionId === snapshot.id}
                                    onClick={() => void handleAppend(snapshot)}
                                >
                                    恢复
                                </Button>
                            </div>
                        </li>
                    ))}
                </ul>
            )}
        </div>
    )
}
