import {memo, type ReactNode} from 'react'
import {type EntryTypeView} from '../../../api'

function getBuiltinEntryTypeIcon(typeKey: string): ReactNode {
    const commonProps = {
        viewBox: '0 0 24 24',
        fill: 'none',
        stroke: 'currentColor',
        strokeWidth: 1.75,
        strokeLinecap: 'round' as const,
        strokeLinejoin: 'round' as const,
    }

    switch (typeKey) {
        case 'character':
            return (
                <svg {...commonProps}>
                    <circle cx="12" cy="8" r="3.25"/>
                    <path d="M5.5 19.25c1.7-3 4.1-4.5 6.5-4.5s4.8 1.5 6.5 4.5"/>
                </svg>
            )
        case 'organization':
            return (
                <svg {...commonProps}>
                    <path d="M4.5 19.5h15"/>
                    <path d="M6.5 19.5V6.5h11v13"/>
                    <path d="M9 9.5h1.5M13.5 9.5H15M9 13h1.5M13.5 13H15"/>
                </svg>
            )
        case 'location':
            return (
                <svg {...commonProps}>
                    <path d="M12 20.25s5.25-5.22 5.25-10a5.25 5.25 0 10-10.5 0c0 4.78 5.25 10 5.25 10z"/>
                    <circle cx="12" cy="10.25" r="1.75"/>
                </svg>
            )
        case 'item':
            return (
                <svg {...commonProps}>
                    <path d="M12 3.75l7 4v8.5l-7 4-7-4v-8.5l7-4z"/>
                    <path d="M5 8l7 4 7-4M12 12v8"/>
                </svg>
            )
        case 'creature':
            return (
                <svg {...commonProps}>
                    <circle cx="8" cy="8" r="1.2"/>
                    <circle cx="12" cy="6.75" r="1.2"/>
                    <circle cx="16" cy="8" r="1.2"/>
                    <path
                        d="M8.25 18.25c-1.9 0-3.25-1.47-3.25-3.2 0-2.2 1.95-4.05 4.35-4.05.92 0 1.84.28 2.65.82.81-.54 1.73-.82 2.65-.82 2.4 0 4.35 1.85 4.35 4.05 0 1.73-1.35 3.2-3.25 3.2-.98 0-1.88-.37-2.55-1.03A3.69 3.69 0 0112 18.25a3.7 3.7 0 01-1.65-.39 3.63 3.63 0 01-2.1.39z"/>
                </svg>
            )
        case 'event':
            return (
                <svg {...commonProps}>
                    <rect x="4.5" y="5.5" width="15" height="14" rx="2"/>
                    <path d="M8 3.75v3.5M16 3.75v3.5M4.5 9.25h15"/>
                    <path
                        d="M12 12l.75 1.55 1.75.26-1.25 1.22.3 1.72L12 15.9l-1.55.85.3-1.72-1.25-1.22 1.75-.26L12 12z"/>
                </svg>
            )
        case 'concept':
            return (
                <svg {...commonProps}>
                    <path
                        d="M12 4.25a5.25 5.25 0 00-3.27 9.36c.74.59 1.27 1.4 1.52 2.31h3.5c.25-.91.78-1.72 1.52-2.31A5.25 5.25 0 0012 4.25z"/>
                    <path d="M9.75 19h4.5M10.5 16.75h3"/>
                </svg>
            )
        case 'culture':
            return (
                <svg {...commonProps}>
                    <path d="M5.5 6.5a2 2 0 012-2H11v15H7.5a2 2 0 00-2 2V6.5z"/>
                    <path d="M18.5 6.5a2 2 0 00-2-2H13v15h3.5a2 2 0 012 2V6.5z"/>
                </svg>
            )
        case 'else':
            return (
                <svg {...commonProps}>
                    <circle cx="6.5" cy="12" r="1.25"/>
                    <circle cx="12" cy="12" r="1.25"/>
                    <circle cx="17.5" cy="12" r="1.25"/>
                    <path d="M4 19.25h16"/>
                </svg>
            )
        default:
            return null
    }
}

interface EntryTypeIconProps {
    entryType: EntryTypeView
    className: string
}

function EntryTypeIcon({entryType, className}: EntryTypeIconProps) {
    let icon: ReactNode = null

    if (entryType.kind === 'builtin') {
        icon = getBuiltinEntryTypeIcon(entryType.key)
    }

    if (!icon && entryType.icon) {
        icon = entryType.icon
    }

    if (!icon) return null

    return (
        <span className={className} aria-hidden="true">
            {icon}
        </span>
    )
}

export default memo(EntryTypeIcon)
