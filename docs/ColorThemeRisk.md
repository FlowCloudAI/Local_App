# 颜色主题 CSP 风险记录

## 背景

当前颜色主题功能会在运行时创建 `<style id="fc-theme-token-overrides">`，并写入由颜色主题配置生成的 `--fc-color-*` 变量覆盖样式。Release 环境下 WebView 会执行 Tauri CSP，若未显式允许 `style-src-elem` 的 inline style element，动态插入的 `<style>` 会被拦截，表现为设置保存成功但颜色主题不生效。

短期修复是在 Tauri CSP 中加入：

```text
style-src-elem 'self' 'unsafe-inline'
```

这允许当前动态 `<style>` 方案在 release 中生效。

## 当前方案风险

- `style-src-elem 'unsafe-inline'` 会放行运行时插入的 inline `<style>`，不只限于颜色主题模块。
- 如果未来引入插件 UI、远程富文本、第三方渲染组件或未充分净化的 HTML 内容，inline `<style>` 放行会扩大样式注入面。
- 当前主题代码依赖整段 CSS 覆盖，并使用 `!important` 提升权重；这对快速覆盖有效，但也更容易掩盖设计令牌来源问题。
- Release CSP 可能经过 Tauri/WebView 资产协议处理后产生更细粒度指令，调试时需要以 release 日志中的 `CSPViolation` 为准。

## 长期修复建议

长期应考虑将颜色主题覆盖从动态 `<style>` 改为 CSS 变量直写：

```ts
document.documentElement.style.setProperty('--fc-color-primary', value, 'important')
```

建议实现要点：

1. 维护允许写入的 `--fc-color-*` 令牌白名单，只写颜色主题预览生成的变量。
2. 根据当前 `data-theme` 或 `ThemeProvider` 的 `resolvedTheme` 选择 light/dark token，而不是一次性注入两套 CSS。
3. 监听显示模式变化和 `system` 模式下系统亮暗变化，重新应用当前颜色主题变量。
4. 清除默认主题时逐项 `removeProperty`，并记录上一次写过的 token，避免遗留变量。
5. 保留必要的 `important` 优先级，防止再次被 `html.is-tauri` 或基础 `:root` 变量覆盖。
6. 为启动应用、设置页切换、返回设置页、light/dark/system 切换分别补充 release 验证日志。

这个方向可以移除对 `style-src-elem 'unsafe-inline'` 的依赖，把 CSP 收回到更严格的策略。
