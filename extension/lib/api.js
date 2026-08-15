// 平台 API 客户端（对应 internal/deepseek/client.go）
"use strict";

const BASE = "https://platform.deepseek.com/api/v0/";

export class APIError extends Error {
  constructor(kind, code, message) {
    super(message);
    this.kind = kind;
    this.code = code;
  }
}

async function get(token, path, params) {
  const url = new URL(BASE + path);
  if (params) {
    for (const k of Object.keys(params)) url.searchParams.set(k, String(params[k]));
  }
  let resp;
  try {
    resp = await fetch(url, {
      method: "GET",
      headers: {
        accept: "application/json",
        authorization: "Bearer " + token,
        "x-client-platform": "web",
      },
      credentials: "omit",
    });
  } catch (e) {
    throw new APIError("network", 0, "网络请求失败，请检查网络连接");
  }
  if (!resp.ok) {
    if (resp.status === 401 || resp.status === 403) {
      throw new APIError("unauthorized", resp.status, "Token 无效或已过期，请在“设置”中更新");
    }
    throw new APIError("http", resp.status, "请求失败（HTTP " + resp.status + "）");
  }
  let body;
  try {
    body = await resp.json();
  } catch (e) {
    throw new APIError("decode", 0, "数据解析失败");
  }
  if (!body || body.code !== 0) {
    throw new APIError("server", body ? body.code : 0, "接口返回错误：" + ((body && body.msg) || "未知错误"));
  }
  const data = body.data;
  if (!data) throw new APIError("decode", 0, "空响应数据");
  if (data.bizCode !== 0) {
    throw new APIError("server", data.bizCode, "接口返回错误：" + (data.bizMsg || "未知错误"));
  }
  if (!data.biz_data || data.biz_data === "null") throw new APIError("decode", 0, "空业务数据");
  return data.biz_data;
}

export async function fetchSummary(token) {
  return get(token, "users/get_user_summary");
}

export async function fetchKeys(token) {
  const d = await get(token, "users/get_api_keys");
  return (d && d.api_keys) || [];
}

export async function fetchAmount(token, start, end, tz) {
  return get(token, "usage/by_api_key/amount", { start, end, tz });
}

export async function fetchCost(token, start, end, tz) {
  return get(token, "usage/by_api_key/cost", { start, end, tz });
}
