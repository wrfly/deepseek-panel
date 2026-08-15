// 设置默认值/规范化/旧字段迁移（对应 internal/panel/settings.go）
"use strict";

export function defaultSettings() {
  return {
    refreshIntervalMinutes: 5,
    period: "today",
    displayCurrency: "CNY",
    useMockData: false,
    dailyBudget: 0,
    monthlyBudget: 0,
    keyDailyBudgets: {},
    keyMonthlyBudgets: {},
    heatmapMetric: "tokens",
    trayDisplay: "todayBoth",
  };
}

export function normalizeSettings(s) {
  const out = Object.assign(defaultSettings(), s || {});
  if (!(out.refreshIntervalMinutes > 0)) out.refreshIntervalMinutes = 5;
  out.period = ["today", "last24h", "last7d", "last30d", "thisMonth", "lastMonth"].includes(out.period) ? out.period : "today";
  if (out.displayCurrency !== "USD") out.displayCurrency = "CNY";
  // 旧版单值预算迁移为每日预算
  if (out.budget > 0 && !(out.dailyBudget > 0) && !(out.monthlyBudget > 0)) out.dailyBudget = out.budget;
  delete out.budget;
  // 旧版按 Key 预算迁移为每月预算
  if (out.keyBudgets && Object.keys(out.keyBudgets).length && !(out.keyMonthlyBudgets && Object.keys(out.keyMonthlyBudgets).length)) {
    out.keyMonthlyBudgets = out.keyBudgets;
  }
  delete out.keyBudgets;
  if (!out.keyDailyBudgets || typeof out.keyDailyBudgets !== "object") out.keyDailyBudgets = {};
  if (!out.keyMonthlyBudgets || typeof out.keyMonthlyBudgets !== "object") out.keyMonthlyBudgets = {};
  if (out.dailyBudget < 0) out.dailyBudget = 0;
  if (out.monthlyBudget < 0) out.monthlyBudget = 0;
  for (const k of Object.keys(out.keyDailyBudgets)) if (out.keyDailyBudgets[k] < 0) delete out.keyDailyBudgets[k];
  for (const k of Object.keys(out.keyMonthlyBudgets)) if (out.keyMonthlyBudgets[k] < 0) delete out.keyMonthlyBudgets[k];
  if (out.heatmapMetric !== "cost") out.heatmapMetric = "tokens";
  if (!["todayBoth", "todayCost", "todayTokens", "balance", "none"].includes(out.trayDisplay)) out.trayDisplay = "todayBoth";
  return out;
}
