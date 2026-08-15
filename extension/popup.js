// wails-shim：把 app.js 的 window.go / window.runtime 桥接到 chrome.runtime，
// 让现有前端（frontend-dist/app.js）零修改运行在扩展 popup 里。
"use strict";
(function () {
  const listeners = {};

  window.runtime = {
    EventsOn: (name, cb) => {
      if (!listeners[name]) listeners[name] = [];
      listeners[name].push(cb);
    },
    EventsEmit: () => {},
  };

  async function call(type, payload) {
    const res = await chrome.runtime.sendMessage(Object.assign({ type: type }, payload || {}));
    if (res && res.error) throw new Error(res.error);
    return res ? res.result : undefined;
  }

  window.go = {
    main: {
      App: {
        GetSnapshot: async () => (await call("getSnapshot")) || null,
        RefreshNow: () => { call("refresh").catch(() => {}); },
        SetPeriod: (p) => { call("setPeriod", { period: p }).catch(() => {}); },
        SaveSettings: async (s) => (await call("saveSettings", { settings: s })) || {},
        SaveToken: async (t) => { await call("saveToken", { token: t }); },
        ReportError: (m) => console.error("JS-ERROR:", m),
      },
    },
  };

  chrome.runtime.onMessage.addListener((msg) => {
    if (!msg) return;
    if (msg.type === "snapshot" && listeners.snapshot) {
      listeners.snapshot.forEach((cb) => { try { cb(msg.snapshot); } catch (e) { console.error(e); } });
    } else if (msg.type === "nav" && listeners.nav) {
      listeners.nav.forEach((cb) => { try { cb(msg.page); } catch (e) { console.error(e); } });
    }
  });
})();
