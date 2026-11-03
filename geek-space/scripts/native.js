/* ============================================================
   极客空间 Geek Space — 原生桥
   ------------------------------------------------------------
   在 Tauri 壳内运行时，通过 invoke 调用 Rust 侧真实硬件采集；
   在普通浏览器打开时 available === false，前端自动回退到内置模拟引擎。
   两套数据源字段完全同构，视图层无需区分。
   ============================================================ */
(function () {
  'use strict';

  const T = window.__TAURI__;
  const core = T && (T.core || T);
  const available = !!(core && typeof core.invoke === 'function');
  const call = available ? core.invoke.bind(core) : null;

  async function safeInvoke(cmd) {
    if (!call) return null;
    try {
      return await call(cmd);
    } catch (e) {
      console.warn('[native] invoke failed:', cmd, e);
      return null;
    }
  }

  window.NativeBridge = {
    available,
    caps: null,

    async init() {
      if (!available) return false;
      const caps = await safeInvoke('capabilities');
      if (!caps) return false;
      this.caps = caps;
      return true;
    },
    profile() { return safeInvoke('device_profile'); },
    live() { return safeInvoke('live_snapshot'); },
    sensors() { return safeInvoke('sensor_list'); },
    startup() { return safeInvoke('startup_items'); },
    drivers() { return safeInvoke('driver_list'); },
    processes() { return safeInvoke('top_processes'); }
  };
})();
