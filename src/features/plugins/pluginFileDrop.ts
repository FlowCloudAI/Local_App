// 解析桌面端拖入的插件路径，只接受单个 .fcplug 文件。

export type DroppedPluginPathResult =
    | {ok: true; path: string}
    | {ok: false; error: string}

export function resolveDroppedPluginPath(paths: readonly string[]): DroppedPluginPathResult {
    if (paths.length !== 1) return {ok: false, error: '请一次拖入一个 .fcplug 插件包。'}
    const path = paths[0]?.trim() ?? ''
    if (!path.toLocaleLowerCase().endsWith('.fcplug')) {
        return {ok: false, error: '只能安装 .fcplug 插件包。'}
    }
    return {ok: true, path}
}
