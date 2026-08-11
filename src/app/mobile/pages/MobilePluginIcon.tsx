// 移动端插件图标：统一处理本地资源、远程资源与插件类型回退图标。
import {convertFileSrc} from '../../../api/assets'

function PluginKindIcon({kind}: {kind: string}) {
    if (kind.includes('image')) {
        return (
            <svg viewBox="0 0 24 24" aria-hidden="true">
                <rect x="3" y="3" width="18" height="18" rx="2"/>
                <circle cx="8.5" cy="8.5" r="1.5"/>
                <path d="M21 15l-5-5L5 21"/>
            </svg>
        )
    }
    if (kind.includes('tts')) {
        return (
            <svg viewBox="0 0 24 24" aria-hidden="true">
                <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/>
                <path d="M19 10v2a7 7 0 0 1-14 0v-2M12 19v4M8 23h8"/>
            </svg>
        )
    }
    return (
        <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
        </svg>
    )
}

export default function MobilePluginIcon({
    kind,
    iconUrl,
    local,
}: {
    kind: string
    iconUrl?: string
    local?: boolean
}) {
    const src = iconUrl ? (local ? convertFileSrc(iconUrl, 'fcimg') : iconUrl) : ''
    return (
        <div className="mobile-settings-plugin-icon">
            {src ? (
                <img
                    src={src}
                    alt=""
                    className="mobile-settings-plugin-icon__image"
                    onError={event => {
                        event.currentTarget.style.display = 'none'
                    }}
                />
            ) : (
                <PluginKindIcon kind={kind}/>
            )}
        </div>
    )
}
