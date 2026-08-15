// 聚合报告（对应 internal/panel/aggregator.go + app.go reportJSON）
"use strict";

import { windowContains } from "./period.js";

export function buildReport(keys, amount, cost, window, currency) {
  const byName = new Map();
  for (const k of keys || []) {
    byName.set(k.name, { name: k.name, trackingId: k.tracking_id || "", requests: 0, responseTokens: 0, hitTokens: 0, missTokens: 0, costCNY: 0, costUSD: 0 });
  }
  const modelByName = new Map();
  const trendByTime = new Map();

  for (const series of (amount && amount.series) || []) {
    let u = byName.get(series.api_key && series.api_key.name);
    if (!u) {
      u = { name: (series.api_key && series.api_key.name) || "", trackingId: (series.api_key && series.api_key.tracking_id) || "", requests: 0, responseTokens: 0, hitTokens: 0, missTokens: 0, costCNY: 0, costUSD: 0 };
      byName.set(u.name, u);
    }
    for (const b of series.buckets || []) {
      const t = b.time;
      if (!windowContains(window, t)) continue;
      const usg = b.usage || {};
      const req = usg.REQUEST || 0;
      const resp = usg.RESPONSE_TOKEN || 0;
      const hit = usg.PROMPT_CACHE_HIT_TOKEN || 0;
      const miss = usg.PROMPT_CACHE_MISS_TOKEN || 0;
      u.requests += req;
      u.responseTokens += resp;
      u.hitTokens += hit;
      u.missTokens += miss;
      const toks = resp + hit + miss;
      let pt = trendByTime.get(t);
      if (!pt) { pt = { time: t, tokens: 0, costCNY: 0, costUSD: 0 }; trendByTime.set(t, pt); }
      pt.tokens += toks;
      let m = modelByName.get(series.model);
      if (!m) { m = { name: series.model, tokens: 0, costCNY: 0, costUSD: 0 }; modelByName.set(series.model, m); }
      m.tokens += toks;
    }
  }

  if (cost && cost.data) {
    for (const cs of cost.data) {
      const isUSD = cs.currency === "USD";
      for (const series of cs.series || []) {
        let u = byName.get(series.api_key && series.api_key.name);
        if (!u) {
          u = { name: (series.api_key && series.api_key.name) || "", trackingId: (series.api_key && series.api_key.tracking_id) || "", requests: 0, responseTokens: 0, hitTokens: 0, missTokens: 0, costCNY: 0, costUSD: 0 };
          byName.set(u.name, u);
        }
        for (const b of series.buckets || []) {
          const t = b.time;
          if (!windowContains(window, t)) continue;
          const v = parseFloat(b.cost) || 0;
          if (isUSD) u.costUSD += v; else u.costCNY += v;
          let pt = trendByTime.get(t);
          if (!pt) { pt = { time: t, tokens: 0, costCNY: 0, costUSD: 0 }; trendByTime.set(t, pt); }
          if (isUSD) pt.costUSD += v; else pt.costCNY += v;
          let m = modelByName.get(series.model);
          if (!m) { m = { name: series.model, tokens: 0, costCNY: 0, costUSD: 0 }; modelByName.set(series.model, m); }
          if (isUSD) m.costUSD += v; else m.costCNY += v;
        }
      }
    }
  }

  const costOf = (u) => (currency === "USD" ? u.costUSD : u.costCNY);
  const keysOut = [];
  for (const u of byName.values()) {
    if (u.requests > 0 || u.responseTokens + u.hitTokens + u.missTokens > 0 || u.costCNY > 0 || u.costUSD > 0) {
      const total = u.responseTokens + u.hitTokens + u.missTokens;
      const denom = u.hitTokens + u.missTokens;
      keysOut.push({
        name: u.name,
        requests: u.requests,
        totalTokens: total,
        cacheHitRate: denom > 0 ? u.hitTokens / denom : null,
        cost: costOf(u),
        costCNY: u.costCNY,
        costUSD: u.costUSD,
        promptCacheHitTokens: u.hitTokens,
        promptCacheMissTokens: u.missTokens,
        responseTokens: u.responseTokens,
      });
    }
  }
  keysOut.sort((a, b) => (b.cost !== a.cost ? b.cost - a.cost : a.name.toLowerCase() < b.name.toLowerCase() ? -1 : 1));

  const modelsOut = [];
  for (const m of modelByName.values()) {
    if (m.tokens > 0 || m.costCNY > 0 || m.costUSD > 0) {
      modelsOut.push({ name: m.name, tokens: m.tokens, cost: costOf(m) });
    }
  }
  modelsOut.sort((a, b) => (b.tokens !== a.tokens ? b.tokens - a.tokens : a.name.toLowerCase() < b.name.toLowerCase() ? -1 : 1));

  const trendOut = [...trendByTime.values()].sort((a, b) => a.time - b.time);

  let totalTokens = 0, totalCost = 0, hitTokens = 0, missTokens = 0, totalRequests = 0;
  for (const k of keysOut) {
    hitTokens += k.promptCacheHitTokens;
    missTokens += k.promptCacheMissTokens;
    totalRequests += k.requests;
  }
  for (const m of modelsOut) {
    totalTokens += m.tokens;
    totalCost += m.cost;
  }
  return {
    keys: keysOut,
    models: modelsOut,
    trend: trendOut,
    totalTokens,
    totalCost,
    hitTokens,
    missTokens,
    totalRequests,
  };
}

// mergeRange 把 [start,end) 的 amount+cost 合并为按小时的点，并补齐缺失小时。
export function mergeRange(amount, cost, start, end) {
  const byTime = new Map();
  for (const series of (amount && amount.series) || []) {
    for (const b of series.buckets || []) {
      const t = b.time;
      const usg = b.usage || {};
      const toks = (usg.RESPONSE_TOKEN || 0) + (usg.PROMPT_CACHE_HIT_TOKEN || 0) + (usg.PROMPT_CACHE_MISS_TOKEN || 0);
      let pt = byTime.get(t);
      if (!pt) { pt = { time: t, tokens: 0, costCNY: 0, costUSD: 0 }; byTime.set(t, pt); }
      pt.tokens += toks;
    }
  }
  if (cost && cost.data) {
    for (const cs of cost.data) {
      const isUSD = cs.currency === "USD";
      for (const series of cs.series || []) {
        for (const b of series.buckets || []) {
          const t = b.time;
          const v = parseFloat(b.cost) || 0;
          let pt = byTime.get(t);
          if (!pt) { pt = { time: t, tokens: 0, costCNY: 0, costUSD: 0 }; byTime.set(t, pt); }
          if (isUSD) pt.costUSD += v; else pt.costCNY += v;
        }
      }
    }
  }
  for (let t = start; t < end; t += 3600) {
    if (!byTime.has(t)) byTime.set(t, { time: t, tokens: 0, costCNY: 0, costUSD: 0 });
  }
  return [...byTime.values()].sort((a, b) => a.time - b.time);
}

// combinedTrend 本地小时缓存 + 未缓存日期的远程日粒度点
export function combinedTrend(storePoints, fetched, window) {
  const merged = new Map();
  const coveredDays = new Set();
  for (const p of storePoints) {
    if (windowContains(window, p.time)) {
      merged.set(p.time, p);
      coveredDays.add(Math.floor(p.time / 86400) * 86400);
    }
  }
  for (const p of fetched) {
    if (!coveredDays.has(Math.floor(p.time / 86400) * 86400)) {
      merged.set(p.time, p);
    }
  }
  return [...merged.values()].sort((a, b) => a.time - b.time);
}
