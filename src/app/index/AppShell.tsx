import {AlertProvider, ContextMenuProvider, ThemeProvider} from 'flowcloudai-ui'
// @ts-expect-error - CSS 导入，无需类型声明
import 'flowcloudai-ui/style'
import type {PlatformInfo} from '../../api'
import AppRoot from './AppRoot'

interface AppShellProps {
    initialTheme: 'system' | 'light' | 'dark'
    platformInfo: PlatformInfo
}

export default function AppShell({initialTheme, platformInfo}: AppShellProps) {
    return (
        <ThemeProvider defaultTheme={initialTheme}>
            <ContextMenuProvider>
                <AlertProvider>
                    <AppRoot platformInfo={platformInfo}/>
                </AlertProvider>
            </ContextMenuProvider>
        </ThemeProvider>
    )
}
