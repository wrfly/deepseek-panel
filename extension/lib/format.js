// 格式化与解析（对应 internal/panel/format.go）
"use strict";

export function formatMoney(value, currency) {
  const symbol = currency === "USD" ? "$" : "\u00a5";
  const decimals = value !== 0 && Math.abs(value) < 0.01 ? 4 : 2;
  return symbol + value.toFixed(decimals);
}

export function formatTokens(count) {
  if (count >= 1000000) return (count / 1000000).toFixed(2) + "M";
  if (count >= 1000) return Math.round(count / 1000) + "k";
  return String(count);
}

// badge 用精简格式：不超过 4 字符
export function badgeMoney(value, currency) {
  const symbol = currency === "USD" ? "$" : "\u00a5";
  return symbol + badgeNumber(value);
}

export function badgeTokens(count) {
  if (count >= 1000000) {
    const v = count / 1000000;
    return (v >= 10 ? v.toFixed(0) : v.toFixed(1)) + "M";
  }
  if (count >= 1000) return Math.round(count / 1000) + "k";
  return String(count);
}

function badgeNumber(value) {
  if (value >= 1000) {
    const v = value / 1000;
    return (v >= 10 ? v.toFixed(0) : v.toFixed(1)) + "k";
  }
  if (value !== 0 && Math.abs(value) < 0.01) return value.toFixed(2);
  return (Math.round(value * 100) / 100).toFixed(value >= 100 ? 0 : 2);
}

export function parseDecimal(s) {
  const v = parseFloat(s);
  return isNaN(v) ? 0 : v;
}
