# Settings 保存提示触发页面重绘问题复盘

## 背景现象

`src/pages/Settings.tsx` 中设置项会自动保存。保存成功后页面会弹出 `设置已保存` 的非侵入提示，但在调试中发现每次提示出现后，Settings 页面都会发生额外重绘，严重时会重新触发自动保存调度。

该现象在其他页面不明显，因此最初疑点集中在 Settings 页面自身的自动保存逻辑。

## 初步判断

`Settings` 通过 `useAlert()` 获取 `showAlert`，保存成功后调用：

```ts
void showAlert('设置已保存', 'success', 'nonInvasive', 1200)
```

`flowcloudai-ui` 的 `AlertProvider` 内部使用 `alert` state 管理提示展示。每次提示打开或关闭都会触发 Provider 重新渲染，而当前 Provider 每次渲染都会重新创建 `showAlert` 和 Context value：

```tsx
<AlertContext.Provider value={{ showAlert }}>
```

因此所有 `useAlert()` 消费者都会收到新的 Context value，产生额外重绘。

## 第一次修复尝试

最初发现 `persistSettings` 直接依赖 `showAlert`：

```ts
const persistSettings = useCallback(async (...) => {
    void showAlert(...)
}, [showAlert])
```

自动保存 effect 又依赖 `persistSettings`：

```ts
useEffect(() => {
    void persistSettings(settings)
}, [settings, loading, persistSettings])
```

这意味着 `showAlert` 引用变化会导致 `persistSettings` 引用变化，进而导致自动保存 effect 重新调度。

因此第一步把 `showAlert` 放入 `showAlertRef`，让 `persistSettings` 通过 `showAlertRef.current` 调用提示，并移除 `persistSettings` 对 `showAlert` 的依赖。

该修改降低了耦合，但问题没有完全解决。

## 诊断日志

为了继续定位，在 Settings 页面加入浏览器日志，统一前缀为 `SettingsDebug`，重点记录：

- 页面挂载、卸载。
- 每次渲染提交的变化字段。
- 自动保存调度、取消、触发。
- 保存开始、完成、提示展示和提示关闭。
- `loadData` 的执行来源。
- `mediaDir` 是否真的发生状态变化。

用户反馈的关键日志片段显示：

```text
显示保存成功提示
渲染提交
自动保存已取消
渲染提交 loading: true
自动保存跳过
渲染提交 loading: false
自动保存已调度
```

其中 `loading: true` 是关键证据，因为 Settings 中只有 `loadData()` 会主动设置 `loading`。

## 最终根因

除 `persistSettings` 外，`loadData` 也依赖了 `showAlert`：

```ts
const loadData = useCallback(async () => {
    ...
    await showAlert(...)
}, [showAlert])
```

初始化加载 effect 又依赖 `loadData`：

```ts
useEffect(() => {
    loadData().catch(logger.error)
}, [loadData])
```

完整触发链为：

1. 自动保存成功。
2. 调用 `showAlert('设置已保存', ...)`。
3. `AlertProvider` 更新 `alert` state。
4. `AlertProvider` 重新渲染并创建新的 `showAlert` / Context value。
5. `Settings` 作为 `useAlert()` 消费者收到新的 `showAlert` 引用。
6. `loadData` 因依赖 `showAlert` 而变成新函数。
7. 初始化加载 effect 因 `loadData` 引用变化重新执行。
8. `loadData` 设置 `loading: true`，重新拉取并写入 settings。
9. `settings` 引用变化导致自动保存 effect 再次调度。

这也是问题主要出现在 Settings 页的原因：其他页面虽然也会因 Alert Context 变化而重绘，但通常没有“Context 函数引用变化 -> 初始化加载 effect 重跑 -> 写状态 -> 自动保存再调度”这样的闭环。

开发模式下开头出现的“挂载 -> 卸载 -> 挂载”属于 React `StrictMode` 的双挂载检查，不是该问题的根因。

## 已执行修复

Settings 页面侧做了两处解耦：

1. `persistSettings` 通过 `showAlertRef.current` 调用提示，不再依赖 `showAlert`。
2. `loadData` 也通过 `showAlertRef.current` 调用错误提示，不再依赖 `showAlert`。

这样 `AlertProvider` 的 Context value 变化仍可能导致 Settings 有一次普通重绘，但不会再导致 `loadData` 重新执行，也不会进一步触发自动保存调度。

同时对 `mediaDir` 更新做了检查：只有新旧值不同时才调用 `setMediaDir`，避免保存完成后因为相同值写入制造无意义更新。

## 后续建议

Settings 页面侧修复解决了当前重绘导致自动保存重调度的问题，但 Alert 系统仍有设计隐患。

根治建议在 `flowcloudai-ui` 的 `AlertProvider` 中完成：

- 使用 `useCallback` 稳定 `showAlert`。
- 必要时稳定内部的 `openAlert` 等函数。
- 使用 `useMemo` 稳定 Context value。

示意：

```tsx
const showAlert = useCallback((msg, type, mode = 'alert', duration) => {
    ...
}, [...])

const value = useMemo(() => ({showAlert}), [showAlert])

return (
    <AlertContext.Provider value={value}>
        {children}
        ...
    </AlertContext.Provider>
)
```

完成该修复后，弹窗状态变化只应影响 Alert UI 自身，而不应让所有 `useAlert()` 消费者都因为 Context value 引用变化而重新渲染。
