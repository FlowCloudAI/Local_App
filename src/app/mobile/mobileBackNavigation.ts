type MobileBackTab = 'home' | 'ai' | 'ideas' | 'settings'

export type MobileBackTarget = 'page' | 'home' | 'exit'

export function resolveMobileBackTarget(activeTab: MobileBackTab, canGoBack: boolean): MobileBackTarget {
    if (canGoBack) return 'page'
    return activeTab === 'home' ? 'exit' : 'home'
}
