// DeepSeek 用量面板 — Chrome 扩展后台（对应 app.go + 各 lib 移植）
"use strict";

import { defaultSettings, normalizeSettings } from "./lib/settings.js";
import {
  PeriodToday, PeriodThisMonth, parsePeriod, periodTitle, statsWindow, localTZOffset, startOfDay, monthStartUnix,
} from "./lib/period.js";
import { fetchSummary, fetchKeys, fetchAmount, fetchCost } from "./lib/api.js";
import { buildReport, mergeRange, combinedTrend } from "./lib/aggregate.js";
import { buildHeatmap } from "./lib/heatmap.js";
import { budgetStatus, fetchKeyCosts, keyNames, sumCost } from "./lib/budgets.js";
import { mockFetch, mockTrendPoints, mockKeyCosts } from "./lib/mock.js";
import { TrendStore } from "./lib/trendstore.js";
import { badgeMoney, badgeTokens, formatMoney, formatTokens } from "./lib/format.js";

const store = chrome.storage.local;
const trend = new TrendStore(store);
const STATE_KEY = "panelState";

let refreshing = false;
let lastHourlyFetch = 0;

// ---- 状态存取 ----

async function loadState() {
  const r = await store.get(STATE_KEY);
  return r[STATE_KEY] || {};
}

async function saveState(s) {
  await store.set({ [STATE_KEY]: s });
}

function settingsJSON(settings, token) {
  return {
    refreshIntervalMinutes: settings.refreshIntervalMinutes,
    period: settings.period,
    displayCurrency: settings.displayCurrency,
    useMockData: settings.useMockData,
    dailyBudget: settings.dailyBudget,
    monthlyBudget: settings.monthlyBudget,
    keyDailyBudgets: settings.keyDailyBudgets,
    keyMonthlyBudgets: settings.keyMonthlyBudgets,
    heatmapMetric: settings.heatmapMetric,
    trayDisplay: settings.trayDisplay,
    hasToken: !!token,
    launchAtLogin: false,
  };
}

// ---- 数据拉取 ----

async function fetchAll(token, window) {
  const [summary, keys, amount, cost] = await Promise.all([
    fetchSummary(token),
    fetchKeys(token),
    fetchAmount(token, window.requestStart, window.requestEnd, localTZOffset(new Date())),
    fetchCost(token, window.requestStart, window.requestEnd, localTZOffset(new Date())),
  ]);
  return { summary, keys, amount, cost };
}

async function fetchAndMergeRange(token, start, end) {
  const tz = localTZOffset(new Date());
  try {
    const [amount, cost] = await Promise.all([
      fetchAmount(token, start, end, tz),
      fetchCost(token, start, end, tz),
    ]);
    await trend.replaceRange(mergeRange(amount, cost, start, end), start, end);
  } catch (e) {
    console.warn("backfill", start, end, e.message);
  }
}

// 168 天回填（每批 28 天），今天最多每 15 分钟补一次
async function ensureHourlyHistory(token, now) {
  const todayStart = startOfDay(now);
  const totalDays = 168;
  let earliestOffset = totalDays - 1;
  while (earliestOffset > 0) {
    const batchDays = Math.min(earliestOffset, 28);
    const startDay = todayStart - earliestOffset * 86400;
    const endDay = todayStart - (earliestOffset - batchDays + 1) * 86400;
    const start = startDay;
    const end = endDay + 86400;
    const covered = await trend.coverageCount(start, end);
    if (covered < batchDays * 24) {
      await fetchAndMergeRange(token, start, end);
    }
    earliestOffset -= batchDays;
  }
  if (Date.now() - lastHourlyFetch >= 15 * 60000) {
    lastHourlyFetch = Date.now();
    await fetchAndMergeRange(token, todayStart, todayStart + 86400);
  }
}

async function fetchKeyCostsBoth(token, now, settings) {
  const needToday = Object.keys(settings.keyDailyBudgets || {}).length > 0;
  const needMonth = Object.keys(settings.keyMonthlyBudgets || {}).length > 0;
  if (!needToday && !needMonth) return { today: null, month: null };
  const todayW = statsWindow(PeriodToday, now);
  const monthW = statsWindow(PeriodThisMonth, now);
  const tz = localTZOffset(now);
  const currency = settings.displayCurrency;
  const jobs = [];
  if (needToday) jobs.push(fetchKeyCosts(token, todayW.requestStart, todayW.requestEnd, tz, currency));
  else jobs.push(Promise.resolve(null));
  if (needMonth) jobs.push(fetchKeyCosts(token, monthW.requestStart, monthW.requestEnd, tz, currency));
  else jobs.push(Promise.resolve(null));
  const [today, month] = await Promise.all(jobs.map((p) => p.catch(() => null)));
  return { today, month };
}

// ---- 今日统计（与 app.go todayTotals 一致，数据源为趋势缓存） ----

function todayTotalsFrom(points, currency, now) {
  const ts = startOfDay(now);
  let tokens = 0, cost = 0;
  for (const p of points) {
    if (p.time >= ts) {
      tokens += p.tokens;
      cost += currency === "USD" ? p.costUSD : p.costCNY;
    }
  }
  return { tokens, cost };
}

function pickWallet(summary, currency) {
  if (!summary || !summary.normal_wallets) return null;
  for (const w of summary.normal_wallets) if (w.currency === currency) return w;
  return summary.normal_wallets[0] || null;
}

// ---- badge 与标题 ----

async function updateBadge(snap, settings, hasToken, points) {
  const action = chrome.action;
  if (!hasToken || (snap.errorMessage && !snap.report)) {
    await action.setBadgeText({ text: "" });
    return;
  }
  const currency = settings.displayCurrency;
  const today = todayTotalsFrom(points, currency, new Date());
  let text = "";
  switch (settings.trayDisplay) {
    case "todayCost":
      text = badgeMoney(today.cost, currency);
      break;
    case "todayTokens":
      text = badgeTokens(today.tokens);
      break;
    case "both":
      text = today.cost > 0 ? badgeMoney(today.cost, currency) : badgeTokens(today.tokens);
      break;
    case "balance": {
      const w = pickWallet(snap.summary, currency);
      if (w) text = badgeMoney(parseFloat(w.balance), w.currency);
      break;
    }
    case "none":
    default:
      text = "";
  }
  await action.setBadgeText({ text: text.slice(0, 4) });
  let title = "DeepSeek 用量面板";
  if (today.tokens > 0 || today.cost > 0) {
    title += " — 今日 " + formatMoney(today.cost, currency) + " · " + formatTokens(today.tokens) + " Token";
  }
  await action.setTitle({ title });
}

// ---- 预算超支通知 ----

async function notifyOverBudget(budgets, state) {
  const over = (budgets || []).filter((b) => b.over);
  const notified = state.notified || {};
  for (const b of over) {
    if (!notified[b.label]) {
      chrome.notifications.create("budget-" + b.label, {
        type: "basic",
        iconUrl: "icons/icon128.png",
        title: "DeepSeek 预算超支",
        message: b.label + " 已用 " + formatMoney(b.used, "CNY") + "，预算 " + formatMoney(b.limit, "CNY") + "（按显示币种）",
      }).catch(() => {});
      notified[b.label] = Date.now();
    }
  }
  for (const k of Object.keys(notified)) {
    if (!over.some((b) => b.label === k)) delete notified[k];
  }
  state.notified = notified;
}

// ---- 刷新主流程（对应 app.go refresh） ----

async function refresh() {
  if (refreshing) return;
  refreshing = true;
  try {
    const state = await loadState();
    const settings = normalizeSettings(state.settings);
    const useMock = settings.useMockData;
    const token = state.token || "";
    const now = new Date();
    const period = parsePeriod(settings.period);
    const window = statsWindow(period, now);

    const snap = {
      currency: settings.displayCurrency,
      period,
      periodTitle: periodTitle(period),
      settings: settingsJSON(settings, token),
      report: { keys: [], models: [], trend: [], totalTokens: 0, totalCost: 0, hitTokens: 0, missTokens: 0, totalRequests: 0 },
      budgets: [],
      allKeys: [],
      heatmap: [],
      heatmapStart: 0,
      todayCost: 0,
      monthCost: 0,
    };

    let keyCostsToday = null;
    let keyCostsMonth = null;

    if (useMock) {
      const m = mockFetch(window);
      const report = buildReport(m.keys, m.amount, m.cost, window, settings.displayCurrency);
      snap.summary = m.summary;
      snap.allKeys = keyNames(m.keys);
      snap.report = report;
      await trend.clear();
      const mp = mockTrendPoints(now);
      await trend.replaceRange(mp, mp[0].time, mp[mp.length - 1].time + 3600);
      const kc = mockKeyCosts(report);
      keyCostsToday = kc.today;
      keyCostsMonth = kc.month;
      snap.lastUpdated = Math.floor(now.getTime() / 1000);
    } else if (!token) {
      snap.errorMessage = "尚未配置 Token，请在“设置”中填写。";
    } else {
      try {
        await ensureHourlyHistory(token, now);
        const fetched = await fetchAll(token, window);
        const report = buildReport(fetched.keys, fetched.amount, fetched.cost, window, settings.displayCurrency);
        let trendPoints = report.trend;
        if (period === PeriodToday) {
          await trend.replaceRange(trendPoints, window.requestStart, window.requestEnd);
        }
        report.trend = combinedTrend(await trend.points(), trendPoints, window);
        snap.summary = fetched.summary;
        snap.allKeys = keyNames(fetched.keys);
        snap.report = report;
        snap.lastUpdated = Math.floor(now.getTime() / 1000);
        const kc = await fetchKeyCostsBoth(token, now, settings);
        keyCostsToday = kc.today;
        keyCostsMonth = kc.month;
      } catch (e) {
        snap.errorMessage = (e && e.message) || String(e);
        const prev = state.snapshot || {};
        snap.summary = prev.summary;
        snap.report = prev.report;
        snap.allKeys = prev.allKeys;
        snap.heatmap = prev.heatmap;
        snap.heatmapStart = prev.heatmapStart;
        snap.lastUpdated = prev.lastUpdated;
      }
      const hm = buildHeatmap(await trend.points(), settings.displayCurrency, now);
      snap.heatmap = hm.rows;
      snap.heatmapStart = hm.start;
    }

    // 预算与今日/本月统计
    const budgetPoints = (await trend.points()).length ? await trend.points() : ((snap.report && snap.report.trend) || []);
    const nowSec = Math.floor(now.getTime() / 1000);
    snap.todayCost = sumCost(budgetPoints, startOfDay(now), nowSec, settings.displayCurrency);
    snap.monthCost = sumCost(budgetPoints, monthStartUnix(now), nowSec, settings.displayCurrency);
    snap.budgets = budgetStatus(snap, settings, keyCostsToday, keyCostsMonth, now);
    if (!snap.summary && !snap.errorMessage && (!snap.report || snap.report.totalTokens === 0)) {
      snap.isLoading = true;
    }

    const hasToken = !!token;
    const badgeText = await updateBadge(snap, settings, hasToken, budgetPoints);
    snap.trayTitle = "";
    snap.trayTooltip = "";

    state.snapshot = snap;
    await saveState(state);
    await notifyOverBudget(snap.budgets, state);
    await saveState(state);

    chrome.runtime.sendMessage({ type: "snapshot", snapshot: snap }).catch(() => {});
    console.log("refresh done:", period, snap.report ? snap.report.totalTokens : 0, snap.errorMessage || "ok");
  } catch (e) {
    console.error("refresh failed:", e);
  } finally {
    refreshing = false;
  }
}

// ---- 定时与生命周期 ----

async function scheduleAlarm(settings) {
  const minutes = Math.max(settings.refreshIntervalMinutes || 5, 1);
  await chrome.alarms.create("refresh", { periodInMinutes: minutes });
}

chrome.runtime.onInstalled.addListener(async () => {
  const state = await loadState();
  if (!state.settings) {
    state.settings = defaultSettings();
    await saveState(state);
  }
  await scheduleAlarm(normalizeSettings(state.settings));
  await chrome.action.setBadgeBackgroundColor({ color: "#4f8ef7" });
  refresh();
});

chrome.runtime.onStartup.addListener(() => {
  refresh();
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === "refresh") refresh();
});

// ---- 消息路由（popup 调用） ----

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  (async () => {
    switch (msg && msg.type) {
      case "getSnapshot": {
        const state = await loadState();
        return { result: state.snapshot || null };
      }
      case "refresh": {
        await refresh();
        return { result: true };
      }
      case "setPeriod": {
        const state = await loadState();
        state.settings = normalizeSettings(Object.assign({}, state.settings, { period: msg.period }));
        await saveState(state);
        await refresh();
        return { result: true };
      }
      case "saveSettings": {
        const state = await loadState();
        state.settings = normalizeSettings(msg.settings);
        await saveState(state);
        await scheduleAlarm(state.settings);
        await refresh();
        return { result: settingsJSON(state.settings, state.token || "") };
      }
      case "saveToken": {
        const state = await loadState();
        state.token = msg.token || "";
        await saveState(state);
        await refresh();
        return { result: true };
      }
      default:
        return { error: "unknown message: " + (msg && msg.type) };
    }
  })().then(sendResponse).catch((e) => sendResponse({ error: String(e) }));
  return true;
});