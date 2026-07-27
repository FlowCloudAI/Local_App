import {lazy, Suspense} from 'react'
import type {PlatformInfo} from '../../api'
import {isDesktopBuild, isMobileBuild, resolveFormFactor} from '../../shared/formFactor'

interface AppRootProps {
    platformInfo: PlatformInfo
}

const DesktopApp = isMobileBuild ? null : lazy(() => import('../desktop/DesktopApp'))
const MobileApp = isDesktopBuild ? null : lazy(() => import('../mobile/MobileApp'))

export default function AppRoot({platformInfo}: AppRootProps) {
    const formFactor = resolveFormFactor(platformInfo)
    const AppComponent = formFactor === 'mobile' ? MobileApp : DesktopApp

    return (
        <Suspense fallback={<div className="app-loading">加载中…</div>}>
            {AppComponent && <AppComponent platformInfo={platformInfo}/>}
        </Suspense>
    )
}
