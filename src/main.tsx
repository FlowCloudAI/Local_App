import {StrictMode} from 'react'
import {createRoot} from 'react-dom/client'

import App from './App.tsx'
import {showWindow, setting_get_settings} from './api'
import {AlertProvider, ThemeProvider, ContextMenuProvider} from 'flowcloudai-ui'
// @ts-expect-error - CSS import, no types needed
import 'flowcloudai-ui/style';
import './index.css'
import './i18n' // 初始化 i18n


// 异步初始化主题
const initApp = async () => {
    let initialTheme = 'system'
    try {
        const settings = await setting_get_settings()
        if (settings.theme) {
            initialTheme = settings.theme
        }
    } catch (error) {
        console.warn('Failed to load settings, using default theme:', error)
    }

    createRoot(document.getElementById('root')!).render(
        <StrictMode>
            <ThemeProvider defaultTheme={initialTheme as 'system' | 'light' | 'dark'}>
                <ContextMenuProvider>
                    <AlertProvider>
                        <App/>
                    </AlertProvider>
                </ContextMenuProvider>
            </ThemeProvider>
        </StrictMode>,
    )

    const result = showWindow().then()
    result.then(console.log)
    result.catch(console.error)
}

initApp().catch(console.error)