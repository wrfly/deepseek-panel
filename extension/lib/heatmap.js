// 热力图（对应 internal/panel/heatmap.go）
"use strict";

export const HeatmapCols = 24;
export const HeatmapRows = 7;

export function heatmapStartMonday(now) {
  const d = new Date(now);
  const day = new Date(d.getFullYear(), d.getMonth(), d.getDate(), 0, 0, 0, 0);
  const weekday = day.getDay(); // 0=周日
  const daysSinceMonday = (weekday + 6) % 7;
  const thisMonday = day.getTime() / 1000 - daysSinceMonday * 86400;
  return thisMonday - 7 * (HeatmapCols - 1) * 86400;
}

export function buildHeatmap(points, currency, now) {
  const byDay = new Map();
  for (const p of points) {
    const d = new Date(p.time * 1000);
    const dayStart = new Date(d.getFullYear(), d.getMonth(), d.getDate(), 0, 0, 0, 0).getTime() / 1000;
    let cell = byDay.get(dayStart);
    if (!cell) { cell = { tokens: 0, cost: 0 }; byDay.set(dayStart, cell); }
    cell.tokens += p.tokens;
    cell.cost += currency === "USD" ? p.costUSD : p.costCNY;
  }
  const firstMonday = heatmapStartMonday(now);
  const rows = [];
  for (let row = 0; row < HeatmapRows; row++) {
    const line = [];
    for (let col = 0; col < HeatmapCols; col++) {
      const day = firstMonday + (col * 7 + row) * 86400;
      line.push(byDay.get(day) || { tokens: 0, cost: 0 });
    }
    rows.push(line);
  }
  return { rows, start: firstMonday };
}
