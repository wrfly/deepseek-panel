/* DeepSeek 用量面板前端 —— 与 macOS 版 UsagePanelView 对应 */
"use strict";

/* ---------------- 格式化（对应 Swift Format.swift） ---------------- */
function formatMoney(value, currency) {
  const symbol = currency === "USD" ? "$" : "\u00a5";
  const decimals = value !== 0 && Math.abs(value) < 0.01 ? 4 : 2;
  return symbol + value.toFixed(decimals);
}
function formatTokens(count) {
  if (count >= 1000000) return (count / 1000000).toFixed(2) + "M";
  if (count >= 1000) return Math.round(count / 1000) + "k";
  return String(count);
}
function formatRate(rate) {
  return rate === null || rate === undefined ? "\u2014" : (rate * 100).toFixed(1) + "%";
}
function formatPercent(share) { return (share * 100).toFixed(1) + "%"; }
function fmtTime(ts, withDate) {
  const d = new Date(ts * 1000);
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  if (withDate) return (d.getMonth() + 1) + "/" + d.getDate() + " " + hh + ":" + mm;
  return hh + ":" + mm;
}

// 趋势图悬停：文档级 mousemove 监听（box 级事件在 WebKitGTK 下不可靠，
// 曾出现只触发一次、鼠标移动不更新文本条的问题）。
const trendHover = {
  active: false,
  box: null,
  points: null,
  values: null,
  isCost: false,
  showHour: true,
  fmt: null,
  currency: "CNY",
  bars: [],
  hoverIndex: -1,
};
function bindTrendHover() {
  document.addEventListener("mousemove", (e) => {
    const st = trendHover;
    if (!st.box || !st.points || !st.points.length) return;
    const rect = st.box.getBoundingClientRect();
    if (!rect.width) return;
    const inside = e.clientX >= rect.left && e.clientX <= rect.right &&
                   e.clientY >= rect.top && e.clientY <= rect.bottom;
    if (!inside) {
      if (st.active) {
        st.active = false;
        if (st.hoverIndex >= 0 && st.bars[st.hoverIndex]) st.bars[st.hoverIndex].classList.remove("hover");
        st.hoverIndex = -1;
        const hv = $("trend-hover");
        if (hv) hv.textContent = "";
      }
      return;
    }
    st.active = true;
    const fraction = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    const index = Math.min(st.points.length - 1, Math.floor(fraction * st.points.length));
    if (index !== st.hoverIndex) {
      if (st.hoverIndex >= 0 && st.bars[st.hoverIndex]) st.bars[st.hoverIndex].classList.remove("hover");
      st.hoverIndex = index;
      if (st.bars[index]) st.bars[index].classList.add("hover");
    }
    const pt = st.points[index];
    const time = st.showHour ? st.fmt(pt.time) : fmtTime(pt.time, true);
    const val = st.isCost ? formatMoney(st.values[index], st.currency)
                         : formatTokens(st.values[index]) + " Token";
    const hv = $("trend-hover");
    if (hv) hv.textContent = time + "  " + val;
  });
}
bindTrendHover();
/* ---------------- CSS 变量取值（ECharts canvas 不认 var()，需取具体值） ---------------- */
function cssVar(name, fallback) {
  try {
    const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
    return v || fallback;
  } catch (_) {
    return fallback;
  }
}

// alpha 混合到深色背景，返回实色 rgb()（WebKitGTK canvas 对 opacity 渲染异常，需预混合）
function withAlpha(hex, alpha) {
  var r = parseInt(hex.slice(1, 3), 16);
  var g = parseInt(hex.slice(3, 5), 16);
  var b = parseInt(hex.slice(5, 7), 16);
  var bgR = 24, bgG = 26, bgB = 32;
  return 'rgb(' + Math.round(r * alpha + bgR * (1 - alpha)) + ',' +
                 Math.round(g * alpha + bgG * (1 - alpha)) + ',' +
                 Math.round(b * alpha + bgB * (1 - alpha)) + ')';
}
/* ---------------- 调色板（对应 Swift palette） ---------------- */
const PALETTE = ["#4f8ef7", "#a78bfa", "#2dd4bf", "#f59e0b", "#f472b6", "#4ade80", "#818cf8", "#22d3ee"];
const paletteColor = (i) => PALETTE[i % PALETTE.length];

/* ---------------- 状态 ---------------- */
const state = {
  snapshot: null,
  trendMode: "cost",        // cost | tokens
  heatmapMetric: "tokens",  // tokens | cost
  heatmapHover: null,       // {row, col, x, y}
  trendChart: null,
  pieChart: null,
};

/* ---------------- DOM ---------------- */
const $ = (id) => document.getElementById(id);
const el = (tag, cls, text) => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
};

/* ---------------- 渲染 ---------------- */
function reportError(e) {
  try {
    if (window.go && window.go.main && window.go.main.App) {
      window.go.main.App.ReportError(String(e && e.stack ? e.stack : e));
    }
  } catch (_) {}
}

function render(snap) {
  state.snapshot = snap;
  if (!snap) return;
  if (snap.settings && snap.settings.heatmapMetric) state.heatmapMetric = snap.settings.heatmapMetric;
  try {
    renderAll(snap);
  } catch (e) {
    reportError(e);
  }
}

function renderAll(snap) {
  // 设置页与预算页状态同步
  syncSettingsForm(snap);
  syncBudgetForm(snap);
  renderKeyBudgetInputs(snap);

  const loading = $("loading"), content = $("panel-content");
  if (snap.isLoading) { loading.hidden = false; content.hidden = true; return; }
  loading.hidden = true; content.hidden = false;

  // 错误条
  const banner = $("error-banner");
  if (snap.errorMessage) {
    banner.textContent = "\u26a0\ufe0f " + snap.errorMessage;
    banner.hidden = false;
  } else { banner.hidden = true; }

  // 今天 ↔ 24小时 循环按钮状态
  const todayBtn = $("period-today");
  if (todayBtn) {
    const is24h = snap.period === "last24h";
    todayBtn.dataset.period = is24h ? "last24h" : "today";
    todayBtn.textContent = is24h ? "24小时" : "今天";
  }

  // 周期标签
  const moreLabels = { thisMonth: "本月", last30d: "30天", lastMonth: "上个月" };
  const more = $("period-more");
  if (more) {
    const cur = snap.period;
    more.dataset.period = (cur === "last30d" || cur === "lastMonth") ? cur : "thisMonth";
    more.textContent = moreLabels[more.dataset.period];
  }
  document.querySelectorAll("#period-tabs button").forEach((b) => {
    b.classList.toggle("selected", b.dataset.period === snap.period);
  });

  // 各区块独立渲染，单块异常不影响其余部分。
  [renderHero, renderBudget, renderModels, renderRequests, renderTrend, renderKeys, renderFooter, renderHeatmap].forEach((fn) => {
    try { fn(snap); } catch (e) { reportError(fn.name + ": " + e); }
  });
}

function renderHero(snap) {
  const r = snap.report || {};
  $("hero-tokens").textContent = formatTokens(r.totalTokens);
  $("hero-cost").textContent = formatMoney(r.totalCost, snap.currency);

  let leftSub = "\u547d\u4e2d\u7f13\u5b58 " + formatTokens(r.hitTokens);
  if (r.hitTokens + r.missTokens > 0) {
    const rate = Math.round((r.hitTokens / (r.hitTokens + r.missTokens)) * 100);
    leftSub += " \u00b7 \u547d\u4e2d\u7387 " + rate + "%";
  }
  $("hero-left-sub").textContent = leftSub;

  let rightSub = "";
  const wallets = (snap.summary && snap.summary.normal_wallets) || [];
  const wallet = wallets.find((w) => w.currency === snap.currency) || wallets[0];
  if (wallet) rightSub += "\u4f59\u989d " + formatMoney(parseFloat(wallet.balance), wallet.currency);
  $("hero-right-sub").textContent = rightSub;
}

// 预算进度条：每日 / 每月 / 各 API Key，每行一条
function renderBudget(snap) {
  const rows = $("budget-rows");
  if (!rows) return;
  rows.innerHTML = "";
  (snap.budgets || []).forEach((b) => {
    const row = el("div", "budget-row");
    row.appendChild(el("span", "budget-name", b.label));
    const bar = el("div", "budget-bar");
    const fill = el("div", "budget-fill");
    fill.style.width = Math.min(Math.max(b.ratio, 0), 1) * 100 + "%";
    fill.classList.toggle("over", b.over);
    bar.appendChild(fill);
    row.appendChild(bar);
    const label = el("span", "budget-label");
    label.textContent = Math.round(b.ratio * 100) + "%";
    label.classList.toggle("over", b.over);
    row.appendChild(label);
    rows.appendChild(row);
  });
}

function renderModels(snap) {
  const r = snap.report || {};
  // Token 行
  const tokenBox = $("model-token-rows");
  tokenBox.innerHTML = "";
  if (!(r.models || []).length) { tokenBox.appendChild(el("div", "empty-tip", "\u6682\u65e0\u6570\u636e")); }
  else {
    const total = (r.models || []).reduce((s, m) => s + m.tokens, 0);
    (r.models || []).forEach((m, i) => {
      const row = el("div", "model-row");
      row.appendChild(el("span", "dot", "")).style.background = paletteColor(i);
      row.appendChild(el("span", "name", m.name));
      const share = total > 0 ? m.tokens / total : 0;
      row.appendChild(el("span", "stat", formatTokens(m.tokens) + " \u00b7 " + formatPercent(share)));
      tokenBox.appendChild(row);
    });
  }
  // 费用行（按费用降序）
  const costBox = $("model-cost-rows");
  costBox.innerHTML = "";
  const costSorted = [...(r.models || [])].sort((a, b) => b.cost - a.cost || (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  costSorted.forEach((m, i) => {
    const row = el("div", "model-row");
    row.appendChild(el("span", "dot", "")).style.background = paletteColor(i);
    row.appendChild(el("span", "name", m.name));
    row.appendChild(el("span", "money", formatMoney(m.cost, snap.currency)));
    costBox.appendChild(row);
  });
}

function renderRequests(snap) {
  const r = snap.report || {};
  $("requests-value").textContent = formatTokens(r.totalRequests) + " \u00b7 " + (r.keys || []).length + " \u4e2a Key";
}

function renderTrend(snap) {
  const r = snap.report || {};
  const isCost = state.trendMode === "cost";
  $("trend-title").textContent = isCost ? "\u8d39\u7528\u8d8b\u52bf" : "Token \u8d8b\u52bf";
  $("pill-cost").classList.toggle("selected", isCost);
  $("pill-token").classList.toggle("selected", !isCost);

  const points = r.trend || [];
  const first = points.length ? points[0].time : 0;
  const last = points.length ? points[points.length - 1].time : 0;
  const spanHours = (last - first) / 3600;
  // 跨度 > 24 小时（7天/本月）时按天聚合，避免数百根细柱几乎不可见。
  const byDay = spanHours > 24;
  const dayKey = (ts) => {
    const d = new Date(ts * 1000);
    return d.getFullYear() + "-" + (d.getMonth() + 1) + "-" + d.getDate();
  };
  let dispPoints = points;
  if (byDay && points.length) {
    const map = {};
    const order = [];
    points.forEach((p) => {
      const k = dayKey(p.time);
      if (!map[k]) { map[k] = { time: p.time, tokens: 0, costCNY: 0, costUSD: 0 }; order.push(k); }
      map[k].tokens += p.tokens;
      map[k].costCNY += p.costCNY;
      map[k].costUSD += p.costUSD;
    });
    dispPoints = order.map((k) => map[k]);
  }
  const dayFmt = (ts) => {
    const d = new Date(ts * 1000);
    return (d.getMonth() + 1) + "/" + d.getDate();
  };
  const hourFmt = (ts) => {
    const d = new Date(ts * 1000);
    return String(d.getHours()).padStart(2, "0") + ":00";
  };

  // 纯 DOM 柱状图：WebKitGTK 的 canvas 颜色渲染不可靠，ECharts 渲染异常。
  const values = dispPoints.map((p) => isCost ? (snap.currency === "USD" ? p.costUSD : p.costCNY) : p.tokens);
  const maxV = Math.max.apply(null, values.concat([0]));
  const box = $("trend-bars");
  const empty = $("trend-empty");
  box.innerHTML = "";

  if (!points.length || maxV <= 0) {
    empty.textContent = "\u6682\u65e0\u8d8b\u52bf\u6570\u636e";
    empty.hidden = false;
  } else {
    empty.hidden = true;
    const bars = [];
    values.forEach((v, i) => {
      const bar = el("div", "bar");
      const h = v > 0 ? Math.max((v / maxV) * 100, 3) : 0;
      bar.style.height = h + "%";
      if (v <= 0) bar.style.opacity = "0.15";
      bars.push(bar);
      box.appendChild(bar);
    });

    // 填充浮停状态（文档级 mousemove 统一处理）
    trendHover.box = box;
    trendHover.points = dispPoints;
    trendHover.values = values;
    trendHover.isCost = isCost;
    trendHover.showHour = !byDay;
    trendHover.fmt = byDay ? dayFmt : hourFmt;
    trendHover.currency = snap.currency || "CNY";
    trendHover.bars = bars;
    trendHover.hoverIndex = -1;
    trendHover.active = false;
    const hv = $("trend-hover");
    if (hv) hv.textContent = "";
  }


  // 轴标签：与每根柱子等宽对齐（相同 flex 布局，不再集中在左侧）
  const axisRow = $("axis-row");
  if (axisRow) {
    axisRow.innerHTML = "";
    // 柱子足够宽（点数少，如今天）时每根柱子都显示小时数字；
    // 点数多（跨天）时按间隔显示日期时间。
    const barW = box.clientWidth / Math.max(dispPoints.length, 1);
    const showEvery = barW >= 16 ? 1 : Math.max(Math.floor(dispPoints.length / 4), 1);
    const hourNum = (ts) => String(new Date(ts * 1000).getHours());
    dispPoints.forEach((p, i) => {
      const isLast = i === dispPoints.length - 1;
      const show = isLast || (i % showEvery === 0);
      let label = "";
      if (isLast) label = "现在";
      else if (show) label = byDay ? dayFmt(p.time) : hourNum(p.time);
      axisRow.appendChild(el("span", "axis-tick", label));
    });
  }
}

function renderKeys(snap) {
  const r = snap.report || {};
  const box = $("key-rows");
  box.innerHTML = "";

  // meta
  let meta = (r.keys || []).length + " \u4e2a Key";
  if (snap.lastUpdated) meta += " \u00b7 " + fmtTime(snap.lastUpdated) + " \u66f4\u65b0";
  $("keys-meta").textContent = meta;

  if (!(r.keys || []).length) {
    box.appendChild(el("div", "empty-tip", "\u8be5\u5468\u671f\u6682\u65e0\u7528\u91cf\u6570\u636e"));
  } else {
    (r.keys || []).forEach((key, i) => {
      const row = el("div", "key-row");
      row.appendChild(el("span", "dot", "")).style.background = paletteColor(i);
      const main = el("div", "key-main");
      const line1 = el("div", "key-line1");
      line1.appendChild(el("span", "key-name", key.name));
      if (key.cacheHitRate !== null && key.cacheHitRate !== undefined) {
        const pct = key.cacheHitRate * 100;
        const cls = pct >= 80 ? "good" : pct >= 40 ? "mid" : "bad";
        line1.appendChild(el("span", "hit-pill " + cls, Math.round(pct) + "% \u547d\u4e2d"));
      }
      main.appendChild(line1);
      main.appendChild(el("div", "key-line2",
        formatTokens(key.totalTokens) + " Token \u00b7 " + formatTokens(key.requests) + " \u8bf7\u6c42"));
      row.appendChild(main);
      row.appendChild(el("span", "key-cost", formatMoney(key.cost, snap.currency)));
      box.appendChild(row);
    });
  }

  // 饼图
  const pieBox = $("key-pie");
  const costs = (r.keys || []).map((k) => k.cost);
  const useCosts = costs.reduce((s, v) => s + v, 0) > 0;
  const values = (r.keys || []).map((k) => useCosts ? k.cost : k.totalTokens);
  const total = values.reduce((s, v) => s + v, 0);
  if (!state.pieChart) state.pieChart = echarts.init(pieBox);
  if (total <= 0) {
    state.pieChart.setOption({
      animation: false,
      series: [{
        type: "pie", radius: ["58%", "78%"], silent: true,
        data: [{ value: 1, itemStyle: { color: cssVar("--pill-bg", "rgba(255,255,255,0.08)") } }],
        label: { show: false }, labelLine: { show: false },
      }],
      graphic: [{ type: "text", left: "center", top: "middle", style: { text: "\u2014", fill: cssVar("--fg-faint", "#5f6368"), fontSize: 10 } }],
    }, true);
    return;
  }
  state.pieChart.setOption({
    animation: false,
    tooltip: {
      confine: true,
      backgroundColor: cssVar("--tooltip-bg", "rgba(30, 33, 41, 0.97)"),
      borderColor: cssVar("--hairline", "#2a2e37"),
      textStyle: { color: cssVar("--fg", "#e8eaed"), fontSize: 10 },
      formatter: (p) => p.name + "&nbsp;&nbsp;" + (useCosts ? formatMoney(p.value, snap.currency) : formatTokens(p.value) + " Token") + " \u00b7 " + formatPercent(p.value / total),
    },
    series: [{
      type: "pie",
      radius: ["58%", "78%"],
      data: (r.keys || []).map((k, i) => ({ name: k.name, value: values[i], itemStyle: { color: paletteColor(i) } })),
      label: { show: false }, labelLine: { show: false },
      emphasis: { scale: false, itemStyle: { shadowBlur: 4, shadowColor: "rgba(0,0,0,0.3)" } },
    }],
    graphic: [{
      type: "text", left: "center", top: "middle",
      style: { text: useCosts ? formatMoney(total, snap.currency) : formatTokens(total),
               fill: cssVar("--fg", "#e8eaed"), fontSize: 9, fontWeight: 600 },
    }],
  }, true);
}

function renderFooter(snap) {
  const r = snap.report || {};
  $("footer-total").textContent =
    formatMoney(r.totalCost, snap.currency) + "  \u00b7  " + formatTokens(r.totalTokens) + " Token  \u00b7  " +
    formatTokens(r.totalRequests) + " \u8bf7\u6c42";
}

/* ---------------- 热力图 ---------------- */
const WEEKDAY_LABELS = ["\u4e00", "\u4e8c", "\u4e09", "\u56db", "\u4e94", "\u516d", "\u65e5"];

function renderHeatmap(snap) {
  const cells = snap.heatmap || [];
  const useCost = state.heatmapMetric === "cost";
  $("heatmap-meta").textContent = "\u6700\u8fd1 24 \u5468 \u00b7 " + (useCost ? "\u6309\u6d88\u8017" : "\u6309 Token");

  const grid = $("heatmap-grid");
  grid.innerHTML = "";
  const hv0 = $("heat-hover");
  if (hv0) hv0.textContent = "";
  // 计算格子尺寸铺满可用宽度（不用 aspect-ratio，WebKitGTK 下会高度塌陷）。
  // 可用宽 = 容器宽 - 星期标签宽 - wrap 间距(4px)；grid 内部 23 个 2px 间隙。
  const wrap = grid.parentElement;
  const labelsEl = $("heatmap-labels");
  const avail = (wrap ? wrap.clientWidth : 300) - (labelsEl ? labelsEl.offsetWidth : 14) - 4;
  const cellSize = Math.max(8, Math.floor((avail - 23 * 2) / 24));
  grid.style.setProperty("--cell", cellSize + "px");
  let maxValue = 0;
  cells.forEach((row) => row.forEach((c) => {
    const v = useCost ? c.cost : c.tokens;
    if (v > maxValue) maxValue = v;
  }));

  const labels = $("heatmap-labels");
  labels.innerHTML = "";
  WEEKDAY_LABELS.forEach((w) => labels.appendChild(el("span", "", w)));

  const hoverTooltip = getHeatTip();
  // GitHub 样式：列 = 周（24 列，最近 24 周，最左为最早），行 = 星期（7 行，周一~周日）。
  for (let w = 0; w < 24; w++) {
    const col = el("div", "heatmap-col");
    for (let r = 0; r < 7; r++) {
      const c = cells[r] ? cells[r][w] : null;
      const cell = el("div", "heatmap-cell");
      if (c) {
        const v = useCost ? c.cost : c.tokens;
        if (v > 0 && maxValue > 0) {
          const alpha = 0.3 + 0.7 * (v / maxValue);
          cell.style.background = "rgba(74, 222, 128, " + alpha + ")";
        }
        cell.addEventListener("mouseenter", (e) => {
          cell.classList.add("hover");
          showHeatmapTooltip(hoverTooltip, c, r, w, snap, e);
        });
        cell.addEventListener("mousemove", (e) => showHeatmapTooltip(hoverTooltip, c, r, w, snap, e));
        cell.addEventListener("mouseleave", () => {
        cell.classList.remove("hover");
        const hv = $("heat-hover");
        if (hv) hv.textContent = "";
      });
      }
      col.appendChild(cell);
    }
    grid.appendChild(col);
  }
  // 起始日期
  if (snap.heatmapStart) {
    const d = new Date(snap.heatmapStart * 1000);
    $("heatmap-start").textContent = (d.getMonth() + 1) + "/" + d.getDate();
  } else { $("heatmap-start").textContent = ""; }
}

// tooltip 必须在页面加载时就创建并放入容器：WebKitGTK 不绘制页面渲染后
// 动态插入的 DOM 元素（ECharts 的 tooltip 能显示正是因为它在 init 时创建）。
// 趋势图与热力图各自持有静态 tooltip，hover 时只更新内容与位置。
function makeTip(container, className) {
  const tip = el("div", className);
  tip.style.cssText = "position:absolute;pointer-events:none;background:" + cssVar("--tooltip-bg", "rgba(30, 33, 41, 0.97)") + ";" +
    "border:1px solid " + cssVar("--accent", "#4f8ef7") + ";border-radius:4px;padding:4px 9px;font-size:11px;" +
    "color:" + cssVar("--fg", "#e8eaed") + ";z-index:99;white-space:nowrap;font-variant-numeric:tabular-nums;" +
    "box-shadow:0 2px 8px rgba(0,0,0,0.4);display:none;";
  container.appendChild(tip);
  return tip;
}

let trendTip = null;
let heatTip = null;

// 页面加载时静态创建 tooltip 并放入容器：WebKitGTK 不绘制页面渲染后
// 动态插入的 DOM 元素（ECharts 的 tooltip 能显示正因为它在 init 时创建）。
(function () {
  var c1 = document.getElementById("trend-chart");
  if (c1) trendTip = makeTip(c1, "trend-tip");
  var c2 = document.getElementById("heatmap-wrap");
  if (c2) heatTip = makeTip(c2, "heatmap-tip");
})();

function getTrendTip() {
  if (!trendTip) {
    var c = document.getElementById("trend-chart");
    if (c) trendTip = makeTip(c, "trend-tip");
  }
  return trendTip;
}

function getHeatTip() {
  if (!heatTip) {
    var c = document.getElementById("heatmap-wrap");
    if (c) heatTip = makeTip(c, "heatmap-tip");
  }
  return heatTip;
}

function showHeatmapTooltip(tip, cell, row, col, snap, e) {
  if (!snap.heatmapStart) return;
  const d = new Date((snap.heatmapStart + (col * 7 + row) * 86400) * 1000);
  const dateText = (d.getMonth() + 1) + "/" + d.getDate();
  const hv = $("heat-hover");
  if (hv) hv.textContent = dateText + " \u00b7 " + formatTokens(cell.tokens) + " Token \u00b7 " +
    formatMoney(cell.cost, snap.currency);
}

/* ---------------- 设置页 ---------------- */
function syncSettingsForm(snap) {
  const s = snap.settings;
  $("set-interval").value = String(s.refreshIntervalMinutes);
  $("set-period").value = s.period;
  $("set-currency").value = s.displayCurrency;
  $("set-heatmap").value = s.heatmapMetric;
  $("set-tray").value = s.trayDisplay || "todayBoth";
  $("set-mock").checked = s.useMockData;
  $("set-autostart").checked = s.launchAtLogin;
  if (!$("set-token").dataset.loaded) {
    $("set-token").value = s.hasToken ? "\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022" : "";
    $("set-token").dataset.loaded = "1";
  }
}

// 预算页：全局每日/每月输入 + 当前消耗摘要
function syncBudgetForm(snap) {
  const s = snap.settings;
  if (!$("set-budget-daily")) return;
  $("set-budget-daily").value = s.dailyBudget > 0 ? s.dailyBudget : "";
  $("set-budget-monthly").value = s.monthlyBudget > 0 ? s.monthlyBudget : "";
  const sum = $("budget-summary");
  if (sum) {
    sum.textContent = "今日已用 " + formatMoney(snap.todayCost || 0, snap.currency) +
      " \u00b7 本月已用 " + formatMoney(snap.monthCost || 0, snap.currency);
  }
}

// API Key 预算输入行：按快照中的 key 列表动态补齐（已存在的行不覆盖，避免刷新时打断输入）。
// 每个 Key 一行：每日 + 每月 两个输入框。
function renderKeyBudgetInputs(snap) {
  const box = $("key-budget-fields");
  if (!box) return;
  const s = snap.settings || {};
  const daily = s.keyDailyBudgets || {};
  const monthly = s.keyMonthlyBudgets || {};
  const names = snap.allKeys && snap.allKeys.length
    ? snap.allKeys
    : ((snap.report && snap.report.keys) || []).map((k) => k.name);
  // 移除已不存在的 key 输入行
  Array.prototype.slice.call(box.children).forEach((row) => {
    const input = row.querySelector("input");
    if (input && names.indexOf(input.dataset.key) < 0) row.remove();
  });
  // 补齐缺失的 key 输入行
  names.forEach((name) => {
    const inputs = box.querySelectorAll("input");
    let found = null;
    for (let i = 0; i < inputs.length; i++) {
      if (inputs[i].dataset.key === name) { found = inputs[i]; break; }
    }
    if (found) return;
    const row = el("div", "key-budget-field");
    row.appendChild(el("label", "kb-name", name));
    const col1 = el("div", "kb-col");
    col1.appendChild(el("span", "kb-cap", "每日"));
    const inD = el("input");
    inD.type = "number"; inD.min = "0"; inD.step = "0.01"; inD.placeholder = "不设上限";
    inD.dataset.key = name; inD.dataset.period = "day";
    const vd = daily[name];
    if (vd > 0) inD.value = String(vd);
    col1.appendChild(inD);
    row.appendChild(col1);
    const col2 = el("div", "kb-col");
    col2.appendChild(el("span", "kb-cap", "每月"));
    const inM = el("input");
    inM.type = "number"; inM.min = "0"; inM.step = "0.01"; inM.placeholder = "不设上限";
    inM.dataset.key = name; inM.dataset.period = "month";
    const vm = monthly[name];
    if (vm > 0) inM.value = String(vm);
    col2.appendChild(inM);
    row.appendChild(col2);
    box.appendChild(row);
  });
}

function showView(view) {
  $("view-panel").hidden = view !== "panel";
  $("view-settings").hidden = view !== "settings";
  $("view-budget").hidden = view !== "budget";
}

/* ---------------- 事件与绑定 ---------------- */
async function saveSettings() {
  const msg = $("save-msg");
  msg.textContent = "\u4fdd\u5b58\u4e2d\u2026";
  try {
    const cur = (state.snapshot && state.snapshot.settings) || {};
    const s = {
      refreshIntervalMinutes: parseInt($("set-interval").value, 10),
      period: $("set-period").value,
      displayCurrency: $("set-currency").value,
      useMockData: $("set-mock").checked,
      dailyBudget: cur.dailyBudget || 0,
      monthlyBudget: cur.monthlyBudget || 0,
      keyDailyBudgets: cur.keyDailyBudgets || {},
      keyMonthlyBudgets: cur.keyMonthlyBudgets || {},
      heatmapMetric: $("set-heatmap").value,
      trayDisplay: $("set-tray").value,
      launchAtLogin: $("set-autostart").checked,
    };
    const token = $("set-token").value;
    if (token && !token.startsWith("\u2022")) {
      await window.go.main.App.SaveToken(token);
    }
    try {
      const updated = await window.go.main.App.SaveSettings(s);
      msg.textContent = "\u5df2\u4fdd\u5b58";
      state.heatmapMetric = updated.heatmapMetric;
    } catch (e) {
      msg.textContent = "\u5df2\u4fdd\u5b58\uff0c\u4f46\u81ea\u52a8\u542f\u52a8\u8bbe\u7f6e\u5931\u8d25\uff1a" + e;
    }
    setTimeout(() => { msg.textContent = ""; }, 3000);
  } catch (e) {
    msg.textContent = "\u4fdd\u5b58\u5931\u8d25\uff1a" + e;
  }
}

// 预算管理页保存
async function saveBudget() {
  const msg = $("budget-save-msg");
  msg.textContent = "保存中…";
  try {
    const cur = (state.snapshot && state.snapshot.settings) || {};
    const budgetDaily = parseFloat($("set-budget-daily").value);
    const budgetMonthly = parseFloat($("set-budget-monthly").value);
    const keyDailyBudgets = {};
    const keyMonthlyBudgets = {};
    document.querySelectorAll("#key-budget-fields input").forEach((inp) => {
      const v = parseFloat(inp.value);
      if (isNaN(v) || v <= 0) return;
      if (inp.dataset.period === "day") keyDailyBudgets[inp.dataset.key] = v;
      else keyMonthlyBudgets[inp.dataset.key] = v;
    });
    const s = {
      refreshIntervalMinutes: cur.refreshIntervalMinutes || 5,
      period: cur.period || "today",
      displayCurrency: cur.displayCurrency || "CNY",
      useMockData: !!cur.useMockData,
      dailyBudget: isNaN(budgetDaily) ? 0 : budgetDaily,
      monthlyBudget: isNaN(budgetMonthly) ? 0 : budgetMonthly,
      keyDailyBudgets: keyDailyBudgets,
      keyMonthlyBudgets: keyMonthlyBudgets,
      heatmapMetric: cur.heatmapMetric || "tokens",
      trayDisplay: cur.trayDisplay || "todayBoth",
      launchAtLogin: !!cur.launchAtLogin,
    };
    try {
      const updated = await window.go.main.App.SaveSettings(s);
      msg.textContent = "已保存";
      state.heatmapMetric = updated.heatmapMetric;
    } catch (e) {
      msg.textContent = "已保存，但自动启动设置失败：" + e;
    }
    setTimeout(() => { msg.textContent = ""; }, 3000);
  } catch (e) {
    msg.textContent = "保存失败：" + e;
  }
}

function bindUI() {
  // 周期标签（今天/本月 为循环按钮，单独绑定）
  document.querySelectorAll("#period-tabs button").forEach((b) => {
    if (b.id === "period-more" || b.id === "period-today") return;
    b.addEventListener("click", () => {
      window.go.main.App.SetPeriod(b.dataset.period);
    });
  });

  // 今天 → 24小时 → 今天 循环切换
  $("period-today").addEventListener("click", () => {
    const next = $("period-today").dataset.period === "last24h" ? "today" : "last24h";
    window.go.main.App.SetPeriod(next);
  });

  // 本月 → 30天 → 上个月 → 本月 循环切换
  $("period-more").addEventListener("click", () => {
    const order = ["thisMonth", "last30d", "lastMonth"];
    const cur = $("period-more").dataset.period;
    const idx = order.indexOf(cur);
    const next = order[(idx + 1) % order.length];
    window.go.main.App.SetPeriod(next);
  });
  $("btn-refresh").addEventListener("click", () => window.go.main.App.RefreshNow());
  $("btn-settings").addEventListener("click", () => showView("settings"));
  $("btn-budget").addEventListener("click", () => showView("budget"));
  $("btn-back").addEventListener("click", () => showView("panel"));
  $("btn-budget-back").addEventListener("click", () => showView("panel"));
  $("btn-save").addEventListener("click", saveSettings);
  $("btn-budget-save").addEventListener("click", saveBudget);

  // 趋势切换
  $("pill-cost").addEventListener("click", () => { state.trendMode = "cost"; if (state.snapshot) renderTrend(state.snapshot); });
  $("pill-token").addEventListener("click", () => { state.trendMode = "tokens"; if (state.snapshot) renderTrend(state.snapshot); });

  // 托盘导航
  window.runtime.EventsOn("nav", (page) => showView(page === "settings" ? "settings" : "panel"));

  // 快照事件
  window.runtime.EventsOn("snapshot", (snap) => render(snap));
}

async function init() {
  bindUI();
  try {
    const snap = await window.go.main.App.GetSnapshot();
    render(snap);
  } catch (e) {
    console.error("GetSnapshot failed:", e);
  }
}

window.addEventListener("resize", () => {
  if (state.pieChart) state.pieChart.resize();
  if (state.snapshot) {
    try { renderHeatmap(state.snapshot); } catch (e) { reportError(e); }
  }
});

if (window.runtime && window.go) {
  init();
}
/* ---------------- 演示模式（无 wails 运行时，浏览器直接打开时） ---------------- */
function mulberry32(seed) {
  return function () {
    seed |= 0; seed = (seed + 0x6D2B79F5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function mockSnapshot() {
  const rnd = mulberry32(42);
  const now = Math.floor(Date.now() / 1000);
  const hourStart = now - (now % 3600);
  const dayStart = hourStart - (hourStart % 86400);
  const baseHours = Math.max(Math.floor((hourStart - dayStart) / 3600), 1);

  const keys = [
    { name: "claude", trackingId: "mock-claude", requests: 0, totalTokens: 0, cacheHitRate: 0.955, cost: 1.56, costCNY: 11.27, costUSD: 1.56, promptCacheHitTokens: 0, promptCacheMissTokens: 0, responseTokens: 0 },
    { name: "codex", trackingId: "mock-codex", requests: 0, totalTokens: 0, cacheHitRate: 0.804, cost: 4.34, costCNY: 31.23, costUSD: 4.34, promptCacheHitTokens: 0, promptCacheMissTokens: 0, responseTokens: 0 },
    { name: "cursor", trackingId: "mock-cursor", requests: 0, totalTokens: 0, cacheHitRate: null, cost: 0, costCNY: 0, costUSD: 0, promptCacheHitTokens: 0, promptCacheMissTokens: 0, responseTokens: 0 },
    { name: "wechat filter", trackingId: "mock-wechat", requests: 0, totalTokens: 0, cacheHitRate: 0.943, cost: 0.02, costCNY: 0.13, costUSD: 0.02, promptCacheHitTokens: 0, promptCacheMissTokens: 0, responseTokens: 0 },
  ];
  const models = [
    { name: "deepseek-v4-pro", tokens: 6542145, cost: 4.94 },
    { name: "deepseek-v4-flash", tokens: 2296735, cost: 0.43 },
    { name: "deepseek-chat & deepseek-reasoner", tokens: 1779985, cost: 0.56 },
  ];
  const trend = [];
  for (let i = 0; i < baseHours; i++) {
    const t = dayStart + i * 3600;
    const busy = (i >= 9 && i <= 22) ? 1 : 0.2;
    const tokens = Math.floor((200000 + rnd() * 3000000) * busy);
    const usd = tokens / 1000000 * (1.2 + rnd() * 2);
    trend.push({ time: t, tokens: tokens, costCNY: usd * 7.2, costUSD: usd });
  }
  const heatmap = [];
  const firstMonday = dayStart - 86400 * 7 * 23 - 86400 * 2;
  for (let row = 0; row < 7; row++) {
    const line = [];
    for (let col = 0; col < 24; col++) {
      const busy = (row === 5 || row === 6) ? 0.3 : 0.9;
      line.push({ tokens: Math.floor(rnd() * 8000000 * busy), cost: Math.floor(rnd() * 300 * busy) });
    }
    heatmap.push(line);
  }
  keys.forEach((k) => {
    k.requests = Math.floor(rnd() * 900);
    k.totalTokens = Math.floor(rnd() * 4000000);
    k.promptCacheHitTokens = Math.floor(k.totalTokens * 0.8);
    k.promptCacheMissTokens = k.totalTokens - k.promptCacheHitTokens;
    k.responseTokens = Math.floor(k.totalTokens * 0.06);
  });
  const totalTokens = models.reduce((s, m) => s + m.tokens, 0);
  const totalCost = models.reduce((s, m) => s + m.cost, 0);
  return {
    summary: {
      normal_wallets: [
        { currency: "USD", balance: "8.4200000000", token_estimation: "0" },
        { currency: "CNY", balance: "3.1400000000", token_estimation: "0" },
      ],
      bonus_wallets: [{ currency: "USD", balance: "0", token_estimation: "0" }],
      total_costs: [
        { currency: "USD", amount: "0.8800000000" },
        { currency: "CNY", amount: "1.2300000000" },
      ],
    },
    report: {
      keys: keys,
      models: models,
      trend: trend,
      totalTokens: totalTokens,
      totalCost: totalCost,
      hitTokens: Math.floor(totalTokens * 0.82),
      missTokens: Math.floor(totalTokens * 0.12),
      totalRequests: keys.reduce((s, k) => s + k.requests, 0),
    },
    currency: "CNY",
    period: "today",
    periodTitle: "今天",
    lastUpdated: now,
    errorMessage: "",
    isLoading: false,
    heatmap: heatmap,
    heatmapStart: firstMonday,
    budgets: [
      { label: "今日", used: 3.52, limit: 10, ratio: 0.352, over: false },
      { label: "本月", used: 62.1, limit: 200, ratio: 0.3105, over: false },
      { label: "claude 今日", key: "claude", period: "day", used: 0.9, limit: 20, ratio: 0.045, over: false },
      { label: "claude 本月", key: "claude", period: "month", used: 11.27, limit: 50, ratio: 0.2254, over: false },
      { label: "codex 今日", key: "codex", period: "day", used: 2.1, limit: 20, ratio: 0.105, over: false },
      { label: "codex 本月", key: "codex", period: "month", used: 31.23, limit: 40, ratio: 0.7808, over: false },
    ],
    allKeys: keys.map((k) => k.name),
    todayCost: 3.52,
    monthCost: 62.1,
    settings: {
      refreshIntervalMinutes: 5, period: "today", displayCurrency: "CNY",
      useMockData: true, dailyBudget: 10, monthlyBudget: 200,
      keyDailyBudgets: { claude: 20, codex: 20 },
      keyMonthlyBudgets: { claude: 50, codex: 40 },
      heatmapMetric: "tokens", trayDisplay: "todayBoth",
      hasToken: true, launchAtLogin: false,
    },
    trayTitle: "\ud83d\udc0b \u00a53.14", trayTooltip: "DeepSeek 用量面板",
  };
}

if (!window.runtime || !window.go) {
  // 演示模式：浏览器里直接查看 UI
  bindUI_light();
  render(mockSnapshot());
}

function bindUI_light() {
  document.querySelectorAll("#period-tabs button").forEach((b) => {
    b.addEventListener("click", () => { render(mockSnapshot()); });
  });
  $("btn-refresh").addEventListener("click", () => render(mockSnapshot()));
  $("btn-settings").addEventListener("click", () => showView("settings"));
  $("btn-budget").addEventListener("click", () => showView("budget"));
  $("btn-back").addEventListener("click", () => showView("panel"));
  $("btn-budget-back").addEventListener("click", () => showView("panel"));
  $("btn-save").addEventListener("click", () => { $("save-msg").textContent = "演示模式：设置不会真正保存"; });
  $("btn-budget-save").addEventListener("click", () => { $("budget-save-msg").textContent = "演示模式：设置不会真正保存"; });
  $("pill-cost").addEventListener("click", () => { state.trendMode = "cost"; if (state.snapshot) renderTrend(state.snapshot); });
  $("pill-token").addEventListener("click", () => { state.trendMode = "tokens"; if (state.snapshot) renderTrend(state.snapshot); });
  $("set-mock").addEventListener("change", () => { state.heatmapMetric = $("set-heatmap").value; });
}

/* ---------------- 自测钩子（selftest） ---------------- */
window.__selftest = function () {
  const grid = document.querySelector(".heatmap-grid");
  const col = document.querySelector(".heatmap-col");
  const cols = document.querySelectorAll(".heatmap-col");
  return {
    keys: document.querySelectorAll(".key-row").length,
    models: document.querySelectorAll(".model-row").length,
    heatmapCells: document.querySelectorAll(".heatmap-cell").length,
    heatmapCols: cols.length,
    heatmapGridWidth: grid ? grid.offsetWidth : 0,
    heatmapColHeight: col ? col.offsetHeight : 0,
    heatmapIsHorizontal: !!(grid && col && grid.offsetWidth > col.offsetHeight && cols.length === 24),
    bodyHeight: document.body ? document.body.scrollHeight : 0,
    trendBars: document.querySelectorAll("#trend-bars .bar").length,
    pieCanvas: !!state.pieChart,
    heroTokens: $("hero-tokens") ? $("hero-tokens").textContent : "",
    heroCost: $("hero-cost") ? $("hero-cost").textContent : "",
    keysMeta: $("keys-meta") ? $("keys-meta").textContent : "",
    footerTotal: $("footer-total") ? $("footer-total").textContent : "",
    viewPanelHidden: $("view-panel") ? $("view-panel").hidden : true,
    hoverText: (function () {
      const box = $("trend-bars");
      if (!box || !box.children.length) return "no-bars";
      const rect = box.getBoundingClientRect();
      box.dispatchEvent(new MouseEvent("mousemove", { clientX: rect.left + rect.width * 0.3, clientY: rect.top + 10 }));
      const hv = $("trend-hover");
      return hv ? hv.textContent : "no-element";
    })(),
  };
};
if (typeof window.__selftest === "function") {
  setTimeout(() => { console.log("SELFTEST:" + JSON.stringify(window.__selftest())); }, 800);
}