// 趋势缓存（对应 internal/panel/trendstore.go），存 chrome.storage.local
"use strict";

const KEY = "trendStore";

export class TrendStore {
  constructor(storageArea) {
    this.storage = storageArea;
    this.cache = null;
    this.sorted = null;
  }

  async load() {
    if (!this.cache) {
      const r = await this.storage.get(KEY);
      this.cache = (r && r[KEY]) || {};
      this.sorted = null;
    }
    return this.cache;
  }

  async points() {
    const c = await this.load();
    if (!this.sorted) {
      this.sorted = Object.keys(c)
        .map(Number)
        .sort((a, b) => a - b)
        .map((t) => ({ time: t, tokens: c[t].tokens || 0, costCNY: c[t].costCNY || 0, costUSD: c[t].costUSD || 0 }));
    }
    return this.sorted;
  }

  async replaceRange(points, start, end) {
    const c = await this.load();
    for (const p of points) {
      c[p.time] = { tokens: p.tokens, costCNY: p.costCNY, costUSD: p.costUSD };
    }
    this.sorted = null;
    await this.save();
  }

  async coverageCount(start, end) {
    const c = await this.load();
    let n = 0;
    for (let t = start; t < end; t += 3600) {
      if (c[t]) n++;
    }
    return n;
  }

  async save() {
    await this.storage.set({ [KEY]: this.cache });
  }

  async clear() {
    this.cache = {};
    this.sorted = null;
    await this.storage.remove(KEY);
  }
}