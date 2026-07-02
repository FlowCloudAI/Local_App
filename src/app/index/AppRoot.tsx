import {lazy, Suspense} from 'react'
import type {PlatformInfo} from '../../api'

interface AppRootProps {
    platformInfo: PlatformInfo
}

const buildPlatform = import.meta.env.TAURI_ENV_PLATFORM
const isMobileBuild = buildPlatform === 'android' || buildPlatform === 'ios'
const isDesktopBuild = buildPlatform === 'windows' || buildPlatform === 'macos' || buildPlatform === 'linux'

const DesktopApp = isMobileBuild ? null : lazy(() => import('../desktop/DesktopApp'))
const MobileApp = isDesktopBuild ? null : lazy(() => import('../mobile/MobileApp'))

function getFormFactor(platformInfo: PlatformInfo) {
    if (isMobileBuild) return 'mobile'
    if (isDesktopBuild) return 'desktop'
    return platformInfo.formFactor
}

export default function AppRoot({platformInfo}: AppRootProps) {
    const formFactor = getFormFactor(platformInfo)
    const AppComponent = formFactor === 'mobile' ? MobileApp : DesktopApp

    return (
        <Suspense fallback={<div className="app-loading">加载中…</div>}>
            {AppComponent && <AppComponent platformInfo={platformInfo}/>}
        </Suspense>
    )
}
