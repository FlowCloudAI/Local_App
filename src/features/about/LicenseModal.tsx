import {Button, RollingBox} from 'flowcloudai-ui'
import {FloatingPanel} from '../../shared/ui/overlay'
import {LICENSE_INTRO, LICENSE_SECTIONS, LICENSE_TITLE} from './licenseContent'
import './LicenseModal.css'

interface LicenseModalProps {
    open: boolean
    onClose: () => void
}

export default function LicenseModal({open, onClose}: LicenseModalProps) {
    return (
        <FloatingPanel
            open={open}
            onClose={onClose}
            title={LICENSE_TITLE}
            ariaLabel={LICENSE_TITLE}
            className="license-modal-dialog"
        >
            <RollingBox axis="y" className="license-modal-body" thumbSize="thin">
                <p className="license-modal-intro">{LICENSE_INTRO}</p>
                {LICENSE_SECTIONS.map((section) => (
                    <section key={section.heading} className="license-modal-section">
                        <h3 className="license-modal-section-title">{section.heading}</h3>
                        <p className="license-modal-section-body">{section.body}</p>
                    </section>
                ))}
            </RollingBox>

            <div className="license-modal-footer">
                <Button type="button" size="sm" onClick={onClose}>已阅读</Button>
            </div>
        </FloatingPanel>
    )
}
