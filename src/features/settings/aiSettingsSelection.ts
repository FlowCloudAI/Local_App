export function resolveApiKeyPluginId(
    requestedPluginId: string | undefined,
    currentPluginId: string,
    plugins: Array<{id: string}>,
    fallbackPluginId: string,
): string {
    if (requestedPluginId && plugins.some(plugin => plugin.id === requestedPluginId)) return requestedPluginId
    if (currentPluginId && plugins.some(plugin => plugin.id === currentPluginId)) return currentPluginId
    if (fallbackPluginId && plugins.some(plugin => plugin.id === fallbackPluginId)) return fallbackPluginId
    return plugins[0]?.id ?? ''
}
