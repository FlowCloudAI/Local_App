import {AlertProvider, ContextMenuProvider, ThemeProvider} from 'flowcloudai-ui'
// @ts-expect-error - CSS 导入，无需类型声明
import 'flowcloudai-ui/style'
import type {PlatformInfo} from '../../api'
import {TourProvider} from '../../features/onboarding'
import {resolveDensity} from '../../shared/formFactor'
import AppRoot from './AppRoot'

interface AppShellProps {
    initialTheme: 'system' | 'light' | 'dark'
    platformInfo: PlatformInfo
}

export default function AppShell({initialTheme, platformInfo}: AppShellProps) {
    return (
        <ThemeProvider defaultTheme={initialTheme} density={resolveDensity(platformInfo)}>
            <ContextMenuProvider>
                <AlertProvider>
                    <TourProvider>
                        <AppRoot platformInfo={platformInfo}/>
                    </TourProvider>
                </AlertProvider>
            </ContextMenuProvider>
        </ThemeProvider>
    )
}
