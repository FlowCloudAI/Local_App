import type {AiToolAccessMode} from '../model/AiControllerTypes'

interface AiToolAccessIconProps {
    mode: AiToolAccessMode
    className?: string
}

export default function AiToolAccessIcon({mode, className}: AiToolAccessIconProps) {
    const svgProps = {
        className,
        viewBox: '0 0 24 24',
        focusable: 'false',
        'aria-hidden': true,
        fill: 'none',
        stroke: 'currentColor',
        strokeWidth: 1.8,
        strokeLinecap: 'round',
        strokeLinejoin: 'round',
    } as const

    if (mode === 'reader') {
        return (
            <svg {...svgProps}>
                <path d="M12 6.5v12.2"/>
                <path d="M12 8.1c-1.35-1.15-3.25-1.75-5.7-1.8A1.3 1.3 0 0 0 5 7.6v9.45c0 .58.45 1.05 1.02 1.07 2.35.08 4.35.62 5.98 1.63"/>
                <path d="M12 8.1c1.35-1.15 3.25-1.75 5.7-1.8A1.3 1.3 0 0 1 19 7.6v9.45c0 .58-.45 1.05-1.02 1.07-2.35.08-4.35.62-5.98 1.63"/>
                <path d="M7.4 9.6c1.25.12 2.28.38 3.1.78"/>
                <path d="M16.6 9.6c-1.25.12-2.28.38-3.1.78"/>
            </svg>
        )
    }

    if (mode === 'assistant') {
        return (
            <svg {...svgProps}>
                <circle cx="8.45" cy="12" r="3.25"/>
                <circle cx="15.55" cy="12" r="3.25"/>
                <path d="M11.7 12h.6"/>
                <path d="M5.2 11.2 4 9.6"/>
                <path d="m18.8 11.2 1.2-1.6"/>
            </svg>
        )
    }

    return (
        <svg {...svgProps}>
            <path d="M18.7 4.9c-5.45.65-9.25 3.55-11.1 8.55"/>
            <path d="M18.7 4.9c.35 5.35-2.25 9.15-7.65 11.05"/>
            <path d="M16.6 7.1 6.1 19.4"/>
            <path d="M11.4 10.2h4.2"/>
            <path d="M9.25 13.05h3.85"/>
            <path d="M7.2 16h3.1"/>
        </svg>
    )
}
