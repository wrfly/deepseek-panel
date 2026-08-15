// 预算统计（对应 app.go budgetStatus/fetchKeyCosts）
"use strict";

import { monthStartUnix, startOfDay } from "./period.js";
import { fetchCost } from "./api.js";

export function sumCost(points, start, end, currency) {
  let total = 0;
  for (const p of points) {
    if (p.time >= start && p.time < end) {
      total += currency === "USD" ? p.costUSD : p.costCNY;
    }
  }
  return total;
}

export function keyNames(keysInfo) {
  const names = (keysInfo || []).map((k) => k.name);
  return names.sort((a, b) => a.toLowerCase() < b.toLowerCase() ? -1 : 1);
}

export async function fetchKeyCosts(token, start, end, tz, currency) {
  const cost = await fetchCost(token, start, end, tz);
  const out = new Map();
  if (!cost || !cost.data) return out;
  for (const cs of cost.data) {
    const isUSD = cs.currency === "USD";
    if ((currency === "USD") !== isUSD) continue;
    for (const series of cs.series || []) {
      let total = 0;
      for (const b of series.buckets || []) total += parseFloat(b.cost) || 0;
      const name = (series.api_key && series.api_key.name) || "";
      out.set(name, (out.get(name) || 0) + total);
    }
  }
  return out;
}

// keyCostsToday/keyCostsMonth: Map<string, number>
export function budgetStatus(snap, settings, keyCostsToday, keyCostsMonth, now) {
  const currency = settings.displayCurrency;
  const todayStart = startOfDay(now);
  const mStart = monthStartUnix(now);
  const points = snap._budgetPoints || [];
  const out = [];

  if (settings.dailyBudget > 0) {
    out.push({ label: "今日", used: sumCost(points, todayStart, Math.floor(now.getTime() / 1000), currency), limit: settings.dailyBudget });
  }
  if (settings.monthlyBudget > 0) {
    out.push({ label: "本月", used: sumCost(points, mStart, Math.floor(now.getTime() / 1000), currency), limit: settings.monthlyBudget });
  }

  const dk = settings.keyDailyBudgets || {};
  const mk = settings.keyMonthlyBudgets || {};
  if (Object.keys(dk).length || Object.keys(mk).length) {
    const names = (snap.allKeys && snap.allKeys.length) ? snap.allKeys : (snap.report.keys || []).map((k) => k.name);
    for (const name of names) {
      if (dk[name] > 0) {
        const used = keyCostsToday ? keyCostsToday.get(name) || 0 : 0;
        out.push({ label: name + " 今日", key: name, period: "day", used, limit: dk[name] });
      }
      if (mk[name] > 0) {
        const used = keyCostsMonth ? keyCostsMonth.get(name) || 0 : 0;
        out.push({ label: name + " 本月", key: name, period: "month", used, limit: mk[name] });
      }
    }
  }
  for (const b of out) {
    if (b.limit > 0) {
      b.ratio = b.used / b.limit;
      b.over = b.ratio > 1;
    }
  }
  return out;
}
