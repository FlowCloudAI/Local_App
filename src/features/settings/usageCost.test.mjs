/** 用 Node 内置断言锁定月度预算与未知金额的最小行为。 */
import assert from 'node:assert/strict'
import test from 'node:test'

import {currentMonthUsageAmount, formatUsageCosts, getUsageBudgetWarning} from './usageCost.ts'

const rows = [
    {
        date: '2026-08-01',
        prompt_tokens: 1,
        completion_tokens: 1,
        total_tokens: 2,
        call_count: 1,
        costs: [{currency: 'USD', amount: 40}],
        unknown_price_count: 0,
    },
    {
        date: '2026-07-31',
        prompt_tokens: 1,
        completion_tokens: 1,
        total_tokens: 2,
        call_count: 1,
        costs: [{currency: 'USD', amount: 99}],
        unknown_price_count: 0,
    },
]

test('预算只统计当前月份与指定币种', () => {
    const now = new Date(2026, 7, 1)
    assert.equal(currentMonthUsageAmount(rows, 'usd', now), 40)
    assert.equal(getUsageBudgetWarning(rows, 50, 'USD', 0.8)?.spent, 40)
    assert.equal(getUsageBudgetWarning(rows, 100, 'USD', 0.8), null)
})

test('未知单价显示为破折号而不是零金额', () => {
    assert.equal(formatUsageCosts([], 1), '—')
})
