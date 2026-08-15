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
  // 设置页状态同步
  syncSettingsForm(snap);

  const loading = $("loading"), content = $("panel-content");
  if (snap.isLoading) { loading.hidden = false; content.hidden = true; return; }
  loading.hidden = true; content.hidden = false;

  // 错误条
  const banner = $("error-banner");
  if (snap.errorMessage) {
    banner.textContent = "\u26a0\ufe0f " + snap.errorMessage;
    banner.hidden = false;
  } else { banner.hidden = true; }

  // 周期标签
  document.querySelectorAll("#period-tabs button").forEach((b) => {
    b.classList.toggle("selected", b.dataset.period === snap.period);
  });

  // 各区块独立渲染，单块异常不影响其余部分。
  [renderHero, renderModels, renderRequests, renderTrend, renderKeys, renderFooter, renderHeatmap].forEach((fn) => {
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
  const wallets = (snap.summary && snap.summary.normalWallets) || [];
  const wallet = wallets.find((w) => w.currency === snap.currency) || wallets[0];
  if (wallet) rightSub += "\u4f59\u989d " + formatMoney(parseFloat(wallet.balance), wallet.currency);
  const totals = (snap.summary && snap.summary.totalCosts) || [];
  const spent = totals.find((t) => t.currency === snap.currency);
  if (spent) {
    if (rightSub) rightSub += " \u00b7 ";
    rightSub += "\u5df2\u6d88\u8d39 " + formatMoney(parseFloat(spent.amount), spent.currency);
  }
  $("hero-right-sub").textContent = rightSub;

  // 预算条
  const budgetRow = $("budget-row");
  if (snap.budget > 0) {
    budgetRow.hidden = false;
    const ratio = snap.budgetRatio || 0;
    const pct = Math.round(ratio * 100);
    const fill = $("budget-fill");
    fill.style.width = Math.min(Math.max(ratio, 0), 1) * 100 + "%";
    fill.classList.toggle("over", ratio > 1);
    const label = $("budget-label");
    label.textContent = pct + "%";
    label.classList.toggle("over", ratio > 1);
  } else { budgetRow.hidden = true; }
}

function renderModels(snap) {
  const r = snap.report || {};
  // Token 行
  const tokenBox = $("model-token-rows");
  tokenBox.innerHTML = "";
  if (!r.models.length) { tokenBox.appendChild(el("div", "empty-tip", "\u6682\u65e0\u6570\u636e")); }
  else {
    const total = r.models.reduce((s, m) => s + m.tokens, 0);
    r.models.forEach((m, i) => {
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
  const costSorted = [...r.models].sort((a, b) => b.cost - a.cost || (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
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
  $("requests-value").textContent = formatTokens(r.totalRequests) + " \u00b7 " + r.keys.length + " \u4e2a Key";
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
  const showHour = spanHours <= 24;
  const hourFmt = (ts) => {
    const d = new Date(ts * 1000);
    return String(d.getHours()).padStart(2, "0") + ":00";
  };

  // 纯 DOM 柱状图：WebKitGTK 的 canvas 颜色渲染不可靠，ECharts 渲染异常。
  const values = points.map((p) => isCost ? (snap.currency === "USD" ? p.costUSD : p.costCNY) : p.tokens);
  const maxV = Math.max.apply(null, values.concat([0]));
  const box = $("trend-bars");
  const empty = $("trend-empty");
  box.innerHTML = "";

  if (!points.length || maxV <= 0) {
    empty.textContent = "\u6682\u65e0\u8d8b\u52bf\u6570\u636e";
    empty.hidden = false;
  } else {
    empty.hidden = true;
    const tooltip = getTrendTip();
    const bars = [];
    let hoverIndex = -1;
    values.forEach((v, i) => {
      const bar = el("div", "bar");
      const h = v > 0 ? Math.max((v / maxV) * 100, 3) : 0;
      bar.style.height = h + "%";
      if (v <= 0) bar.style.opacity = "0.15";
      bars.push(bar);
      box.appendChild(bar);
    });

    // 整个图表区域响应鼠标移动，自动定位最近柱子并展示具体数字
    // （柱子太矮时直接悬停柱子几乎不可能命中）。
    const showTip = (i, clientX, clientY) => {
      if (i !== hoverIndex) {
        if (hoverIndex >= 0) bars[hoverIndex].classList.remove("hover");
        hoverIndex = i;
        bars[i].classList.add("hover");
      }
      const pt = points[i];
      const time = showHour ? hourFmt(pt.time) : fmtTime(pt.time, true);
      const val = isCost ? formatMoney(values[i], snap.currency) : formatTokens(values[i]) + " Token";
      // 可靠方案：更新图表下方的文档流文本条（浮动层在 WebKitGTK 下不绘制）。
      const hv = $("trend-hover");
      if (hv) hv.textContent = time + "  " + val;
    };
    const clearTip = () => {
      if (hoverIndex >= 0) bars[hoverIndex].classList.remove("hover");
      hoverIndex = -1;
      const hv = $("trend-hover");
      if (hv) hv.textContent = "";
    };
    box.addEventListener("mousemove", (e) => {
      const rect = box.getBoundingClientRect();
      if (!rect.width) return;
      const fraction = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
      const index = Math.min(points.length - 1, Math.floor(fraction * points.length));
      showTip(index, e.clientX, e.clientY);

    });
    box.addEventListener("mouseleave", clearTip);

  }

  // 轴标签
  if (points.length > 1 && showHour) {
    const step = Math.max(Math.floor(points.length / 4), 1);
    const labels = [];
    for (let i = 0; i < points.length; i += step) labels.push(hourFmt(points[i].time));
    $("axis-start").textContent = labels.join(" ");
  } else if (points.length) {
    $("axis-start").textContent = spanHours <= 48 ? fmtTime(first) : fmtTime(first, true);
  } else {
    $("axis-start").textContent = "";
  }
}

function renderKeys(snap) {
  const r = snap.report || {};
  const box = $("key-rows");
  box.innerHTML = "";

  // meta
  let meta = r.keys.length + " \u4e2a Key";
  if (snap.lastUpdated) meta += " \u00b7 " + fmtTime(snap.lastUpdated) + " \u66f4\u65b0";
  $("keys-meta").textContent = meta;

  if (!r.keys.length) {
    box.appendChild(el("div", "empty-tip", "\u8be5\u5468\u671f\u6682\u65e0\u7528\u91cf\u6570\u636e"));
  } else {
    r.keys.forEach((key, i) => {
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
  const costs = r.keys.map((k) => k.cost);
  const useCosts = costs.reduce((s, v) => s + v, 0) > 0;
  const values = r.keys.map((k) => useCosts ? k.cost : k.totalTokens);
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
      data: r.keys.map((k, i) => ({ name: k.name, value: values[i], itemStyle: { color: paletteColor(i) } })),
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
  $("set-budget").value = s.budget > 0 ? s.budget : "";
  $("set-heatmap").value = s.heatmapMetric;
  $("set-tray").value = s.trayDisplay || "todayBoth";
  $("set-mock").checked = s.useMockData;
  $("set-autostart").checked = s.launchAtLogin;
  if (!$("set-token").dataset.loaded) {
    $("set-token").value = s.hasToken ? "\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022" : "";
    $("set-token").dataset.loaded = "1";
  }
}

function showView(view) {
  $("view-panel").hidden = view !== "panel";
  $("view-settings").hidden = view !== "settings";
}

/* ---------------- 事件与绑定 ---------------- */
async function saveSettings() {
  const msg = $("save-msg");
  msg.textContent = "\u4fdd\u5b58\u4e2d\u2026";
  try {
    const budget = parseFloat($("set-budget").value);
    const s = {
      refreshIntervalMinutes: parseInt($("set-interval").value, 10),
      period: $("set-period").value,
      displayCurrency: $("set-currency").value,
      useMockData: $("set-mock").checked,
      budget: isNaN(budget) ? 0 : budget,
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

function bindUI() {
  // 周期标签
  document.querySelectorAll("#period-tabs button").forEach((b) => {
    b.addEventListener("click", () => {
      window.go.main.App.SetPeriod(b.dataset.period);
    });
  });
  $("btn-refresh").addEventListener("click", () => window.go.main.App.RefreshNow());
  $("btn-settings").addEventListener("click", () => showView("settings"));
  $("btn-back").addEventListener("click", () => showView("panel"));
  $("btn-save").addEventListener("click", saveSettings);

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
      normalWallets: [
        { currency: "USD", balance: "8.4200000000", tokenEstimation: "0" },
        { currency: "CNY", balance: "3.1400000000", tokenEstimation: "0" },
      ],
      bonusWallets: [{ currency: "USD", balance: "0", tokenEstimation: "0" }],
      totalCosts: [
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
    budget: 100,
    budgetRatio: 0.51,
    settings: {
      refreshIntervalMinutes: 5, period: "today", displayCurrency: "CNY",
      useMockData: true, budget: 100, heatmapMetric: "tokens", trayDisplay: "todayBoth",
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
  $("btn-back").addEventListener("click", () => showView("panel"));
  $("btn-save").addEventListener("click", () => { $("save-msg").textContent = "演示模式：设置不会真正保存"; });
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