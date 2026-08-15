// 本地模拟数据（对应 internal/panel/mockdata.go），确定性生成
"use strict";

import { startOfDay } from "./period.js";

const MOCK_KEYS = [
  { tracking_id: "mock-claude", sensitive_id: "sk-mock-1***", name: "claude" },
  { tracking_id: "mock-codex", sensitive_id: "sk-mock-2***", name: "codex" },
  { tracking_id: "mock-cursor", sensitive_id: "sk-mock-3***", name: "cursor" },
  { tracking_id: "mock-wechat", sensitive_id: "sk-mock-4***", name: "wechat filter" },
];

const MODELS = ["deepseek-chat & deepseek-reasoner", "deepseek-v4-flash", "deepseek-v4-pro"];

function keyModels(name) {
  switch (name) {
    case "claude": return ["deepseek-v4-flash", "deepseek-v4-pro"];
    case "codex": return ["deepseek-chat & deepseek-reasoner", "deepseek-v4-pro"];
    case "wechat filter": return ["deepseek-v4-flash"];
    default: return [];
  }
}

function fnv1a(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h >>> 0;
}

function mockRand(time, salt, scale) {
  let x = BigInt(time) * 0x9E3779B97F4A7C15n;
  x += BigInt(salt);
  x ^= x >> 30n;
  x *= 0xBF58476D1CE4E5B9n;
  x ^= x >> 27n;
  x *= 0x94D049BB133111EBn;
  x ^= x >> 31n;
  if (scale <= 1) return 0;
  return Number(x % BigInt(scale));
}

function mockUsage(time, keyName, model) {
  const hour = Math.floor(((time % 86400) + 86400) % 86400 / 3600);
  let busy = 0.2;
  if (hour >= 9 && hour <= 22) busy = 1.0;
  let keyFactor = 1.0;
  if (keyName === "wechat filter") keyFactor = 0.04;
  let modelFactor = 1.0;
  if (model === "deepseek-v4-pro") modelFactor = 2.0;
  const base = Math.floor(2000000 * busy * keyFactor * modelFactor);
  const salt = fnv1a(keyName);
  return {
    REQUEST: mockRand(time, salt + 4, Math.max(Math.floor(base / 6000), 1)),
    RESPONSE_TOKEN: mockRand(time, salt + 3, Math.max(Math.floor(base / 20), 100)),
    PROMPT_CACHE_HIT_TOKEN: mockRand(time, salt + 1, Math.max(base, 1)),
    PROMPT_CACHE_MISS_TOKEN: mockRand(time, salt + 2, Math.max(Math.floor(base / 8), 500)),
  };
}

function mockCostUSD(usage, model) {
  const hit = usage.PROMPT_CACHE_HIT_TOKEN || 0;
  const miss = usage.PROMPT_CACHE_MISS_TOKEN || 0;
  const output = usage.RESPONSE_TOKEN || 0;
  let pHit = 0.02, pMiss = 1.0, pOut = 2.0;
  if (model === "deepseek-v4-pro") { pHit = 0.025; pMiss = 3.0; pOut = 6.0; }
  return (hit * pHit + miss * pMiss + output * pOut) / 1000000;
}

export function mockSummary() {
  return {
    normal_wallets: [
      { currency: "USD", balance: "8.4200000000", token_estimation: "0" },
      { currency: "CNY", balance: "3.1400000000", token_estimation: "0" },
    ],
    bonus_wallets: [{ currency: "USD", balance: "0", token_estimation: "0" }],
    total_costs: [
      { currency: "USD", amount: "0.8800000000" },
      { currency: "CNY", amount: "1.2300000000" },
    ],
  };
}

// mockFetch 返回 { summary, keys, amount, cost }，与真实接口结构一致
export function mockFetch(window) {
  const amountSeries = [];
  const cnySeries = [];
  const usdSeries = [];
  for (const key of MOCK_KEYS) {
    for (const model of keyModels(key.name)) {
      const amountBuckets = [];
      const cnyBuckets = [];
      const usdBuckets = [];
      for (let t = window.requestStart; t < window.requestEnd; t += 3600) {
        const usage = mockUsage(t, key.name, model);
        amountBuckets.push({ time: t, usage });
        const usd = mockCostUSD(usage, model);
        cnyBuckets.push({ time: t, cost: usd * 7.2 });
        usdBuckets.push({ time: t, cost: usd });
      }
      const seriesKey = { tracking_id: key.tracking_id, name: key.name, sensitive_id: key.sensitive_id, valid: true };
      amountSeries.push({ api_key: seriesKey, model, buckets: amountBuckets });
      cnySeries.push({ api_key: seriesKey, model, buckets: cnyBuckets });
      usdSeries.push({ api_key: seriesKey, model, buckets: usdBuckets });
    }
  }
  return {
    summary: mockSummary(),
    keys: MOCK_KEYS,
    amount: { start: window.requestStart, end: window.requestEnd, bucket: 3600, models: MODELS, series: amountSeries },
    cost: { start: window.requestStart, end: window.requestEnd, bucket: 3600, models: MODELS, data: [
      { currency: "CNY", series: cnySeries },
      { currency: "USD", series: usdSeries },
    ] },
  };
}

// mockTrendPoints 生成最近 168 天的按小时趋势点（供热力图/预算/今日统计）
export function mockTrendPoints(now) {
  const today = startOfDay(now);
  const points = [];
  for (let offset = 167; offset >= 0; offset--) {
    const dayStart = today - offset * 86400;
    for (let h = 0; h < 24; h++) {
      const t = dayStart + h * 3600;
      let tokens = 0, costCNY = 0, costUSD = 0;
      for (const key of MOCK_KEYS) {
        for (const model of keyModels(key.name)) {
          const usage = mockUsage(t, key.name, model);
          tokens += (usage.RESPONSE_TOKEN || 0) + (usage.PROMPT_CACHE_HIT_TOKEN || 0) + (usage.PROMPT_CACHE_MISS_TOKEN || 0);
          const usd = mockCostUSD(usage, model);
          costUSD += usd;
          costCNY += usd * 7.2;
        }
      }
      points.push({ time: t, tokens, costCNY, costUSD });
    }
  }
  return points;
}

export function mockKeyCosts(report) {
  const today = new Map();
  const month = new Map();
  for (const k of report.keys || []) {
    today.set(k.name, k.cost);
    month.set(k.name, k.cost);
  }
  return { today, month };
}
