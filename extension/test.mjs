// 移植逻辑单元测试:node extension/test.mjs
import assert from "node:assert";
import { statsWindow, startOfDay, parsePeriod, periodTitle, monthStartUnix, PeriodLastMonth } from "./lib/period.js";
import { mockFetch, mockTrendPoints, mockKeyCosts } from "./lib/mock.js";
import { buildReport } from "./lib/aggregate.js";
import { buildHeatmap } from "./lib/heatmap.js";
import { budgetStatus, sumCost } from "./lib/budgets.js";
import { TrendStore } from "./lib/trendstore.js";

const now = new Date();

// 1. 周期窗口
const wToday = statsWindow("today", now);
assert.strictEqual(wToday.filterStart, startOfDay(now), "today filterStart 应为今天0点");
assert.strictEqual(wToday.filterEnd % 3600, 0, "today filterEnd 小时对齐");
assert.ok(wToday.requestStart <= wToday.filterStart, "requestStart <= filterStart");
assert.strictEqual(wToday.requestEnd - wToday.requestStart, 86400, "today 请求窗口 24h");

const wMonth = statsWindow("thisMonth", now);
const ms = monthStartUnix(now);
assert.strictEqual(wMonth.filterStart, ms, "本月 filterStart = 本月1号");

const wLast = statsWindow(PeriodLastMonth, now);
const d = new Date(now);
const firstThis = new Date(d.getFullYear(), d.getMonth(), 1).getTime() / 1000;
const firstLast = new Date(d.getFullYear(), d.getMonth() - 1, 1).getTime() / 1000;
assert.strictEqual(wLast.filterStart, firstLast, "上月 start");
assert.strictEqual(wLast.filterEnd, firstThis, "上月 end");
assert.strictEqual(periodTitle(parsePeriod("last30d")), "最近 30 天");

// 2. mock + 聚合
const m = mockFetch(wToday);
const report = buildReport(m.keys, m.amount, m.cost, wToday, "CNY");
assert.ok(report.totalTokens > 0, "totalTokens > 0");
assert.strictEqual(report.keys.length, 3, "claude/codex/wechat 有量, cursor 无");
assert.ok(report.models.length >= 3, "models");
assert.ok(report.trend.length >= 1, "trend 非空");
assert.strictEqual(report.hitTokens + report.missTokens > 0, true);
assert.strictEqual(report.totalCost > 0, true);
assert.ok(report.keys.every((k) => typeof k.cacheHitRate === "number" || k.cacheHitRate === null));
const costSum = report.models.reduce((s, x) => s + x.cost, 0);
assert.ok(Math.abs(costSum - report.totalCost) < 1e-9, "models cost 汇总 = totalCost");

// 3. 热力图
const pts = mockTrendPoints(now);
assert.strictEqual(pts.length, 168 * 24, "168天小时点");
const hm = buildHeatmap(pts, "CNY", now);
assert.strictEqual(hm.rows.length, 7, "7 行");
assert.strictEqual(hm.rows[0].length, 24, "24 列");
assert.strictEqual(new Date(hm.start * 1000).getDay(), 1, "起始为周一");
assert.ok(hm.rows.some((r) => r.some((c) => c.tokens > 0)), "有数据");

// 4. 预算
const snap = { allKeys: ["claude", "codex", "cursor", "wechat filter"], report: { keys: report.keys } };
const settings = {
  displayCurrency: "CNY",
  dailyBudget: 10,
  monthlyBudget: 100,
  keyDailyBudgets: { claude: 5 },
  keyMonthlyBudgets: { codex: 20 },
};
snap._budgetPoints = pts;
const kc = mockKeyCosts(report);
const budgets = budgetStatus(snap, settings, kc.today, kc.month, now);
assert.strictEqual(budgets.length, 4, "今日/本月/claude今日/codex本月");
assert.strictEqual(budgets[0].label, "今日");
assert.ok(budgets[0].used > 0 && budgets[0].limit === 10);
assert.ok(budgets.every((b) => b.ratio !== undefined));
const todayCost = sumCost(pts, startOfDay(now), Math.floor(now.getTime() / 1000), "CNY");
assert.ok(Math.abs(budgets[0].used - todayCost) < 1e-9, "今日预算 used = todayCost");

// 5. trendstore
const fakeStorage = (() => {
  const data = {};
  return {
    get: async (k) => ({ [k]: data[k] }),
    set: async (o) => Object.assign(data, o),
    remove: async (k) => { delete data[k]; },
  };
})();
const ts = new TrendStore(fakeStorage);
await ts.replaceRange([{ time: 100, tokens: 5, costCNY: 1, costUSD: 0.1 }], 100, 3600);
assert.strictEqual(await ts.coverageCount(100, 3600), 1);
assert.strictEqual((await ts.points()).length, 1);
await ts.clear();
assert.strictEqual((await ts.points()).length, 0);

console.log("ALL TESTS PASSED");
