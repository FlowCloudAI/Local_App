import {useEffect, useState} from 'react'
import {listen} from '@tauri-apps/api/event'
import {
    CATEGORY_CASCADE_DELETE_REQUEST,
    CATEGORY_DELETE_REQUEST,
    ENTRY_DELETE_REQUEST,
    type CategoryCascadeDeleteRequestEvent,
    type CategoryDeleteRequestEvent,
    type EntryDeleteRequestEvent,
    confirm_entry_edit,
} from '../api'
import './AiConfirmModal.css'

type ModalState =
    | { kind: 'entry-delete'; data: EntryDeleteRequestEvent }
    | { kind: 'category-move'; data: CategoryDeleteRequestEvent }
    | { kind: 'cascade'; data: CategoryCascadeDeleteRequestEvent }

export default function AiConfirmModal() {
    const [pending, setPending] = useState<ModalState | null>(null)
    const [busy, setBusy] = useState(false)

    useEffect(() => {
        const u1 = listen<EntryDeleteRequestEvent>(ENTRY_DELETE_REQUEST, e =>
            setPending({kind: 'entry-delete', data: e.payload})
        )
        const u2 = listen<CategoryDeleteRequestEvent>(CATEGORY_DELETE_REQUEST, e =>
            setPending({kind: 'category-move', data: e.payload})
        )
        const u3 = listen<CategoryCascadeDeleteRequestEvent>(CATEGORY_CASCADE_DELETE_REQUEST, e =>
            setPending({kind: 'cascade', data: e.payload})
        )
        return () => {
            u1.then(fn => fn())
            u2.then(fn => fn())
            u3.then(fn => fn())
        }
    }, [])

    const respond = async (confirmed: boolean) => {
        if (!pending || busy) return
        setBusy(true)
        await confirm_entry_edit(pending.data.request_id, confirmed).catch(console.error)
        setPending(null)
        setBusy(false)
    }

    if (!pending) return null

    return (
        <div className="acm-overlay">
            <div className={`acm-dialog ${pending.kind === 'cascade' && pending.data.step === 2 ? 'acm-danger' : ''}`}>
                {pending.kind === 'entry-delete' && <EntryDeleteView data={pending.data}/>}
                {pending.kind === 'category-move' && <CategoryMoveView data={pending.data}/>}
                {pending.kind === 'cascade' && <CascadeView data={pending.data}/>}

                <div className="acm-footer">
                    <button className="acm-btn acm-btn-cancel" onClick={() => void respond(false)} disabled={busy}>
                        取消
                    </button>
                    <button
                        className={`acm-btn ${pending.kind === 'cascade' && pending.data.step === 2 ? 'acm-btn-danger' : 'acm-btn-confirm'}`}
                        onClick={() => void respond(true)}
                        disabled={busy}
                    >
                        {pending.kind === 'cascade' && pending.data.step === 2 ? '确认删除' : '确认'}
                    </button>
                </div>
            </div>
        </div>
    )
}

function EntryDeleteView({data}: { data: EntryDeleteRequestEvent }) {
    return (
        <>
            <div className="acm-header">
                <span className="acm-title">AI 请求删除词条</span>
            </div>
            <div className="acm-body">
                <p className="acm-entry-name">「{data.entry_title}」</p>
                {data.entry_summary && (
                    <p className="acm-summary">{data.entry_summary}</p>
                )}
                <p className="acm-warn">此操作不可恢复，确认后词条将被永久删除。</p>
            </div>
        </>
    )
}

function CategoryMoveView({data}: { data: CategoryDeleteRequestEvent }) {
    return (
        <>
            <div className="acm-header">
                <span className="acm-title">AI 请求删除分类</span>
            </div>
            <div className="acm-body">
                <p className="acm-entry-name">「{data.category_name}」</p>
                <p className="acm-note">该分类下的子分类和词条将上移至父分类。</p>
            </div>
        </>
    )
}

function CascadeView({data}: { data: CategoryCascadeDeleteRequestEvent }) {
    const isStep2 = data.step === 2
    return (
        <>
            <div className="acm-header">
                <span className="acm-title">
                    {isStep2 ? '⚠ 二次确认：联级删除' : 'AI 请求联级删除分类'}
                </span>
            </div>
            <div className="acm-body">
                <p className="acm-entry-name">「{data.category_name}」</p>
                <div className="acm-stats">
                    <span className="acm-stat-item">子分类 <strong>{data.subcategory_count}</strong> 个</span>
                    <span className="acm-stat-sep">·</span>
                    <span className="acm-stat-item">词条 <strong>{data.entry_count}</strong> 个</span>
                </div>
                {isStep2 ? (
                    <p className="acm-warn">以上所有内容将被永久删除，无法恢复。请再次确认。</p>
                ) : (
                    <p className="acm-note">以上所有子分类和词条将被一并删除，此操作不可逆。</p>
                )}
            </div>
        </>
    )
}
