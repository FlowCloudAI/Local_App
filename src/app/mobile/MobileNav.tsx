import './MobileNav.css'

export type MobileTab = 'projects' | 'ai' | 'ideas' | 'settings'

interface MobileNavProps {
    activeTab: MobileTab
    onTabChange: (tab: MobileTab) => void
}

const TAB_CONFIG: Array<{ key: MobileTab; label: string }> = [
    {key: 'projects', label: '项目'},
    {key: 'ai', label: 'AI'},
    {key: 'ideas', label: '灵感'},
    {key: 'settings', label: '设置'},
]

function TabIcon({tab}: { tab: MobileTab }) {
    switch (tab) {
        case 'projects':
            return (
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"
                     strokeLinejoin="round">
                    <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/>
                </svg>
            )
        case 'ai':
            return (
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"
                     strokeLinejoin="round">
                    <path d="M12 3C14 8 16 10 21 12C16 14 14 16 12 21C10 16 8 14 3 12C8 10 10 8 12 3Z"/>
                </svg>
            )
        case 'ideas':
            return (
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"
                     strokeLinejoin="round">
                    <path d="M12 20h9"/>
                    <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/>
                </svg>
            )
        case 'settings':
            return (
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"
                     strokeLinejoin="round">
                    <circle cx="12" cy="12" r="3"/>
                    <path
                        d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68 1.65 1.65 0 0 0 10 3.17V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>
                </svg>
            )
    }
}

export default function MobileNav({activeTab, onTabChange}: MobileNavProps) {
    return (
        <nav className="mobile-nav">
            {TAB_CONFIG.map(({key, label}) => (
                <button
                    key={key}
                    className={`mobile-nav__item${activeTab === key ? ' active' : ''}`}
                    onClick={() => onTabChange(key)}
                >
                    <span className="mobile-nav__icon"><TabIcon tab={key}/></span>
                    <span className="mobile-nav__label">{label}</span>
                </button>
            ))}
        </nav>
    )
}
