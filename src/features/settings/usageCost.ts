/**
 * 用量费用的前端展示与月度预算计算。
 *
 * 后端已按币种聚合价格快照；这里不做汇率换算，只比较用户选定的预算币种。
 */
import type {ApiUsageCost, ApiUsageDaily} from '../../api'

export interface UsageBudgetWarning {
    currency: string
    spent: number
    budget: number
    warnRatio: number
}

export function formatUsageAmount(amount: number, currency: string): string {
    const normalizedCurrency = currency.trim().toUpperCase()
    try {
        return new Intl.NumberFormat('zh-CN', {
            style: 'currency',
            currency: normalizedCurrency,
            minimumFractionDigits: 2,
            maximumFractionDigits: 4,
        }).format(amount)
    } catch {
        return `${normalizedCurrency || '未知币种'} ${amount.toFixed(4)}`
    }
}

export function formatUsageCosts(costs: ApiUsageCost[], unknownPriceCount = 0): string {
    if (costs.length === 0) return '—'
    const known = costs.map(cost => formatUsageAmount(cost.amount, cost.currency)).join(' + ')
    return unknownPriceCount > 0 ? `${known}（另 ${unknownPriceCount} 次单价未知）` : known
}

export function currentMonthUsageAmount(
    rows: ApiUsageDaily[],
    currency: string,
    now = new Date(),
): number {
    const month = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
    const normalizedCurrency = currency.trim().toUpperCase()
    return rows
        .filter(row => row.date.startsWith(month))
        .flatMap(row => row.costs)
        .filter(cost => cost.currency.trim().toUpperCase() === normalizedCurrency)
        .reduce((total, cost) => total + cost.amount, 0)
}

export function getUsageBudgetWarning(
    rows: ApiUsageDaily[],
    budget: number | null | undefined,
    currency: string,
    warnRatio: number,
): UsageBudgetWarning | null {
    if (typeof budget !== 'number' || !Number.isFinite(budget) || budget <= 0) return null
    const normalizedRatio = Math.min(1, Math.max(0.01, warnRatio))
    const spent = currentMonthUsageAmount(rows, currency)
    if (spent < budget * normalizedRatio) return null
    return {currency: currency.trim().toUpperCase(), spent, budget, warnRatio: normalizedRatio}
}
