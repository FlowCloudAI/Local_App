import {useEffect} from 'react'
import {createPortal} from 'react-dom'
import {Button, RollingBox} from 'flowcloudai-ui'
import {LICENSE_INTRO, LICENSE_SECTIONS, LICENSE_TITLE} from './licenseContent'
import './LicenseModal.css'

interface LicenseModalProps {
    open: boolean
    onClose: () => void
}

export default function LicenseModal({open, onClose}: LicenseModalProps) {
    useEffect(() => {
        if (!open) return
        const handler = (e: KeyboardEvent) => {
            if (e.key === 'Escape') onClose()
        }
        window.addEventListener('keydown', handler)
        return () => window.removeEventListener('keydown', handler)
    }, [open, onClose])

    if (!open) return null

    return createPortal(
        <div
            className="license-modal-backdrop"
            onClick={(e) => {
                if (e.target === e.currentTarget) onClose()
            }}
        >
            <div className="license-modal-dialog" role="dialog" aria-modal="true" aria-label={LICENSE_TITLE}>
                <div className="license-modal-header">
                    <span className="license-modal-title">{LICENSE_TITLE}</span>
                    <button
                        className="license-modal-close"
                        onClick={onClose}
                        aria-label="关闭"
                    >
                        <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
                            <path d="M1 1l10 10M11 1L1 11" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round"/>
                        </svg>
                    </button>
                </div>

                <RollingBox className="license-modal-body" thumbSize="thin">
                    <p className="license-modal-intro">{LICENSE_INTRO}</p>
                    {LICENSE_SECTIONS.map((section) => (
                        <section key={section.heading} className="license-modal-section">
                            <h3 className="license-modal-section-title">{section.heading}</h3>
                            <p className="license-modal-section-body">{section.body}</p>
                        </section>
                    ))}
                </RollingBox>

                <div className="license-modal-footer">
                    <Button size="sm" onClick={onClose}>已阅读</Button>
                </div>
            </div>
        </div>,
        document.body,
    )
}
