/**
 * AI 面板的月度预算告警。
 *
 * 金额来自后端保存的单价快照；组件只监听用量完成事件并刷新，不参与请求阻断。
 */
import {useEffect, useMemo, useState} from 'react'
import {ai_get_usage_daily, type ApiUsageDaily} from '../../../api'
import {listen} from '../../../api/events'
import {useAppSettingsStore} from '../../settings/appSettingsStore'
import {formatUsageAmount, getUsageBudgetWarning} from '../../settings/usageCost'
import './AiBudgetWarning.css'

export default function AiBudgetWarning() {
    const {settings} = useAppSettingsStore()
    const [daily, setDaily] = useState<ApiUsageDaily[]>([])
    const budget = settings?.llm.monthly_budget_amount
    const currency = settings?.llm.monthly_budget_currency ?? 'USD'
    const warnRatio = settings?.llm.budget_warn_ratio ?? 0.8

    useEffect(() => {
        if (!budget || budget <= 0) {
            setDaily([])
            return
        }
        let active = true
        const refresh = () => {
            void ai_get_usage_daily()
                .then(rows => {
                    if (active) setDaily(rows)
                })
                .catch(() => undefined)
        }
        refresh()
        let unlisten: () => void = () => undefined
        void listen('ai:turn_end', refresh).then(dispose => {
            if (active) unlisten = dispose
            else dispose()
        })
        return () => {
            active = false
            unlisten()
        }
    }, [budget])

    const warning = useMemo(
        () => getUsageBudgetWarning(daily, budget, currency, warnRatio),
        [budget, currency, daily, warnRatio],
    )
    if (!warning) return null

    const percent = Math.round((warning.spent / warning.budget) * 100)
    return (
        <div className="ai-budget-warning" role="alert">
            本月 AI 费用已达到预算的 {percent}%：
            {formatUsageAmount(warning.spent, warning.currency)} / {formatUsageAmount(warning.budget, warning.currency)}。
            仅提醒，不会中断服务。
        </div>
    )
}
