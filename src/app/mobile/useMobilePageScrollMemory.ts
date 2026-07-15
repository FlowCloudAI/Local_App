import {type RefObject, useEffect} from 'react'

/**
 * 栈内页面的滚动位置记忆。
 *
 * 背景：MobileApp 用条件渲染，页面被 push 覆盖时会整个卸载；pop 回来时重新挂载并重新拉数据，
 * 于是永远回到顶部。列表浏览场景里这条最招骂——翻到第 40 条点进去、返回，又得从头翻。
 *
 * 位置存在模块级 Map：页面组件本身已被卸载，状态只能活在组件外。key 用栈内页面身份
 * （usePageStack 的 currentPageKey），页面被 pop 出栈后其 key 不会再出现，
 * 因此用 LRU 上限兜住内存，不做精细清理。
 *
 * 两个已被实测确认的坑：
 *
 * 1. **不能在 cleanup 里读 `element.scrollTop`**。React 删除子树时，宿主节点先被摘出 DOM，
 *    之后才执行子树的 effect destroy——实测 cleanup 里 `element.isConnected === false`、
 *    `scrollTop` 恒为 0，存进去的永远是 0。所以改用 passive scroll 监听持续记录到闭包变量，
 *    卸载时存这个值，绝不在 cleanup 里读 DOM。
 * 2. **恢复要等内容长够**。重新挂载那一刻数据可能还没到、容器不够高，直接写会被钳掉。
 *    先同步试一次（数据来自 store 缓存时挂载即已铺满，这条最常见），不够高再等内容到达。
 *    等待用 MutationObserver 而不是 rAF 轮询：内容到达本质上是 DOM 事件而非帧事件，
 *    MO 由变动驱动、命中即断开，比连轮 90 帧省；且回调在渲染前的微任务里跑，恢复不会闪一下 0。
 *
 * 另外：用户一旦自己碰了（touch/wheel）立刻放弃恢复，不跟用户抢滚动条；超时兜底避免空转；
 * 恢复完成前不记录滚动位置，否则加载期的 0 会把存好的目标冲掉。
 */

/** 最多记住多少个页面的位置。移动端栈通常只有 3 层，20 足够覆盖来回切 Tab 的场景。 */
const SCROLL_MEMORY_LIMIT = 20

/** 放弃恢复的兜底时限：超过它仍长不够高，就认为恢复无意义。 */
const RESTORE_TIMEOUT_MS = 1500

const scrollMemory = new Map<string, number>()

function remember(key: string, top: number): void {
    // 先删再插，让 Map 的插入顺序等于 LRU 顺序。
    scrollMemory.delete(key)
    scrollMemory.set(key, top)
    while (scrollMemory.size > SCROLL_MEMORY_LIMIT) {
        const oldest = scrollMemory.keys().next().value
        if (oldest === undefined) break
        scrollMemory.delete(oldest)
    }
}

/** 仅测试/调试用：清空记忆。 */
export function clearMobilePageScrollMemory(): void {
    scrollMemory.clear()
}

/**
 * @param pageKey 栈内页面身份（`pageProps.pageKey`）。为空则不记录（如 Tab 根页）。
 * @param ref 指向该页滚动容器（通常是 `.mobile-page`）的 ref。
 * @param ready 滚动容器是否已渲染。**有加载态的页面必须传**：项目页/世界观列表在加载时
 *   返回的是 `.mobile-page__loading`，真正的 `.mobile-page` 要等数据到了才挂上；
 *   不带这个开关，effect 会在挂载时拿到 null 直接 return，而依赖没变就再也不会重跑。
 */
export function useMobilePageScrollMemory(
    pageKey: string,
    ref: RefObject<HTMLElement | null>,
    ready: boolean = true,
): void {
    useEffect(() => {
        const element = ref.current
        if (!element || !pageKey || !ready) return

        const node = element
        const target = scrollMemory.get(pageKey) ?? 0
        let done = target <= 0
        // 恢复完成前先保留目标值：此刻若被卸载，应原样存回去，而不是存加载中的 0。
        let latestTop = target
        let observer: MutationObserver | null = null

        const giveUp = () => {
            done = true
            observer?.disconnect()
        }

        const handleScroll = () => {
            if (!done) return
            latestTop = node.scrollTop
        }

        /** @returns 是否已无需继续尝试 */
        const tryRestore = (): boolean => {
            if (done) return true
            // 内容还没长到能滚出这个位置，先别写——写了会被钳掉。
            if (node.scrollHeight - node.clientHeight < target) return false
            node.scrollTop = target
            latestTop = target
            giveUp()
            return true
        }

        if (!tryRestore()) {
            observer = new MutationObserver(() => { tryRestore() })
            observer.observe(node, {childList: true, subtree: true})
        }

        const timer = window.setTimeout(giveUp, RESTORE_TIMEOUT_MS)
        node.addEventListener('scroll', handleScroll, {passive: true})
        node.addEventListener('touchstart', giveUp, {passive: true})
        node.addEventListener('wheel', giveUp, {passive: true})

        return () => {
            window.clearTimeout(timer)
            observer?.disconnect()
            node.removeEventListener('scroll', handleScroll)
            node.removeEventListener('touchstart', giveUp)
            node.removeEventListener('wheel', giveUp)
            // 存持续记录的值。此刻节点已被 React 摘离 DOM，读 element.scrollTop 只会得到 0。
            remember(pageKey, latestTop)
        }
    }, [pageKey, ready, ref])
}
