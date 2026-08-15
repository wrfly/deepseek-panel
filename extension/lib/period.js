// 统计周期窗口（对应 internal/panel/stats.go）
"use strict";

export const PeriodToday = "today";
export const PeriodLast24h = "last24h";
export const PeriodLast7d = "last7d";
export const PeriodLast30d = "last30d";
export const PeriodThisMonth = "thisMonth";
export const PeriodLastMonth = "lastMonth";

const ALL = [PeriodToday, PeriodLast24h, PeriodLast7d, PeriodLast30d, PeriodThisMonth, PeriodLastMonth];

export function parsePeriod(raw) {
  return ALL.includes(raw) ? raw : PeriodToday;
}

export function periodTitle(p) {
  switch (p) {
    case PeriodToday: return "今天";
    case PeriodLast24h: return "最近 24 小时";
    case PeriodLast7d: return "最近 7 天";
    case PeriodLast30d: return "最近 30 天";
    case PeriodThisMonth: return "本月";
    case PeriodLastMonth: return "上个月";
  }
  return p;
}

export function localTZOffset(now) {
  return -now.getTimezoneOffset() * 60; // JS 的 getTimezoneOffset 与 Go 相反
}

export function startOfDay(now) {
  const d = new Date(now);
  d.setHours(0, 0, 0, 0);
  return d.getTime() / 1000;
}

// 返回 { filterStart, filterEnd, requestStart, requestEnd }，单位秒
export function statsWindow(p, now) {
  const end = Math.floor(now.getTime() / 1000);
  let start = end - 86400;

  if (p === PeriodToday) {
    start = startOfDay(now);
  } else if (p === PeriodLast24h) {
    start = end - 86400;
  } else if (p === PeriodLast7d) {
    start = end - 7 * 86400;
  } else if (p === PeriodThisMonth) {
    const d = new Date(now);
    start = new Date(d.getFullYear(), d.getMonth(), 1, 0, 0, 0, 0).getTime() / 1000;
  } else if (p === PeriodLast30d) {
    start = end - 30 * 86400;
  } else if (p === PeriodLastMonth) {
    const d = new Date(now);
    const firstThis = new Date(d.getFullYear(), d.getMonth(), 1, 0, 0, 0, 0).getTime() / 1000;
    const firstLast = new Date(d.getFullYear(), d.getMonth() - 1, 1, 0, 0, 0, 0).getTime() / 1000;
    return { filterStart: firstLast, filterEnd: firstThis, requestStart: firstLast, requestEnd: firstThis };
  }

  const hour = 3600;
  const filterStart = Math.floor(start / hour) * hour;
  const filterEnd = Math.floor((end + hour - 1) / hour) * hour;

  // requestStart = filterStart 所在日期的本地 0 点
  const fs = new Date(filterStart * 1000);
  const requestStart = new Date(fs.getFullYear(), fs.getMonth(), fs.getDate(), 0, 0, 0, 0).getTime() / 1000;
  // requestEnd = now 所在日期的次日 0 点
  const requestEnd = startOfDay(now) + 86400;

  return { filterStart, filterEnd, requestStart, requestEnd };
}

export function windowContains(w, t) {
  return t >= w.filterStart && t < w.filterEnd;
}

export function monthStartUnix(now) {
  const d = new Date(now);
  return new Date(d.getFullYear(), d.getMonth(), 1, 0, 0, 0, 0).getTime() / 1000;
}
