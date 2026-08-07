// 统一首页“继续创作”的目标边界，避免把工具页误当成创作内容。

export function findHomeContinueTarget<T extends {type: string}>(
    targets: ReadonlyArray<T | null | undefined>,
): T | null {
    return targets.find(target => target?.type === 'project' || target?.type === 'entry') ?? null
}
