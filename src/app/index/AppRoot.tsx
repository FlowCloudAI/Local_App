import {lazy, Suspense} from 'react'
import type {PlatformInfo} from '../../api'

interface AppRootProps {
    platformInfo: PlatformInfo
}

const DesktopApp = lazy(() => import('../desktop/DesktopApp'))
const MobileApp = lazy(() => import('../mobile/MobileApp'))

export default function AppRoot({platformInfo}: AppRootProps) {
    return (
        <Suspense fallback={<div className="app-loading">加载中…</div>}>
            {platformInfo.formFactor === 'mobile'
                ? <MobileApp platformInfo={platformInfo}/>
                : <DesktopApp/>}
        </Suspense>
    )
}
