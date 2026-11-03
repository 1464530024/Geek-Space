/* ============================================================
   极客空间 Geek Space — 应用层
   路由 / 视图 / 引导流程 / 事件绑定
   ============================================================ */
(function () {
  'use strict';

  const $ = (s, r) => (r || document).querySelector(s);
  const $$ = (s, r) => Array.prototype.slice.call((r || document).querySelectorAll(s));
  const t = (k, v) => window.I18N.t(k, v);
  const esc = window.UI.escapeHtml;

  /* 拼接展示串：过滤空值与「—」占位，避免界面出现「— · —」这种残缺组合 */
  const jn = (...a) => a
    .filter(x => x !== null && x !== undefined && String(x).trim() !== '' && String(x).trim() !== '—')
    .join(' ');
  const jd = (...a) => a
    .filter(x => x !== null && x !== undefined && String(x).trim() !== '' && String(x).trim() !== '—')
    .join(' · ');
  const showOr = (v, fallback) => (v === null || v === undefined || String(v).trim() === '' || v === '—')
    ? (fallback || '—') : v;

  const NAV = [
    { id: 'dashboard', icon: 'overview', key: 'nav.dashboard' },
    { id: 'monitor', icon: 'cpu', key: 'nav.monitor' },
    { id: 'link', icon: 'phone', key: 'nav.link' },
    { id: 'tools', icon: 'wrench', key: 'nav.tools' },
    { id: 'settings', icon: 'gear', key: 'nav.settings' }
  ];

  const VIEWS = {
    dashboard: viewDashboard,
    monitor: viewMonitor,
    link: viewLink,
    tools: viewTools,
    settings: viewSettings
  };

  const LS_KEY = 'geekspace.ui.v1';
  const ui = Object.assign({
    view: 'dashboard',
    monitorTab: 'cpu',
    linkTab: 'apps',
    toolsTab: 'bench',
    appFilter: 'all',
    appQuery: '',
    phonePath: ['/sdcard'],
    bench: { running: false, progress: 0, scores: null, history: [] }
  }, safeRead());

  let benchTimer = null;

  function safeRead() {
    try { const r = localStorage.getItem(LS_KEY); return r ? JSON.parse(r) : {}; } catch (e) { return {}; }
  }
  function persistUI() {
    try {
      const { view, monitorTab, linkTab, toolsTab, appFilter, bench } = ui;
      localStorage.setItem(LS_KEY, JSON.stringify({ view, monitorTab, linkTab, toolsTab, appFilter, bench }));
    } catch (e) { /* ignore */ }
  }

  const profile = window.Monitor.profile;

  /* ============================================================
     设备档案解析层
     ------------------------------------------------------------
     关键：系统盘不等于 disks[0]。装机常见「HDD + SSD」组合，
     第 0 块可能是数据盘，系统实际装在另一块上。原生采集会给出
     systemDisk 下标与带 system 标记的 volumes，这里优先采用。
     ============================================================ */
  /** 系统盘（安装了系统的物理盘） */
  function sysDisk() {
    const P = profile;
    if (!Array.isArray(P.disks) || !P.disks.length) return null;
    const i = (typeof P.systemDisk === 'number' && P.systemDisk >= 0 && P.systemDisk < P.disks.length)
      ? P.systemDisk
      : 0;
    return P.disks[i];
  }
  /** 归一化卷结构（原生返回 sizeGb，视图层统一用 capGb） */
  function normVolume(v) {
    if (!v) return null;
    return {
      letter: v.letter,
      label: v.label || '',
      fs: v.fs,
      capGb: v.sizeGb,
      usedGb: v.usedGb,
      freeGb: v.freeGb,
      usedPct: v.usedPct,
      kind: v.kind,
      system: !!v.system
    };
  }
  /** 系统卷（安装了系统的那一个），返回归一化结构 */
  function sysVolume() {
    const P = profile;
    if (!Array.isArray(P.volumes) || !P.volumes.length) return null;
    return normVolume(P.volumes.find(v => v.system) || P.volumes[0]);
  }
  /** 系统盘标签：优先真实系统卷盘符 */
  function svVolumeLetter() {
    const sv = sysVolume();
    return sv && sv.letter ? sv.letter : 'C:';
  }

  /* 分区 / 卷：原生模式用真实数据，演示模式按磁盘确定性推算 */
  function volumes() {
    const P = profile;
    if (Array.isArray(P.volumes) && P.volumes.length) {
      return P.volumes.map(normVolume);
    }
    const letters = ['C:', 'D:', 'E:', 'F:'];
    const out = [];
    let li = 0;
    P.disks.forEach(d => {
      if (d.system) {
        const cCap = Math.round(d.capGb * 0.48);
        const cUsed = Math.round(d.usedGb * 0.68);
        out.push({ letter: letters[li++], label: 'Windows', fs: 'NTFS', capGb: cCap, usedGb: cUsed, freeGb: cCap - cUsed, usedPct: cUsed / cCap * 100, system: true });
        out.push({ letter: letters[li++], label: 'Data', fs: 'NTFS', capGb: d.capGb - cCap, usedGb: Math.max(1, d.usedGb - cUsed), freeGb: d.capGb - cCap - Math.max(1, d.usedGb - cUsed), usedPct: 0, system: false });
      } else {
        out.push({ letter: letters[li++], label: d.type === 'ssd' ? 'Games' : 'Backup', fs: 'NTFS', capGb: d.capGb, usedGb: d.usedGb, freeGb: d.capGb - d.usedGb, usedPct: d.usedGb / d.capGb * 100, system: false });
      }
    });
    return out;
  }

  /* ============================================================
     数值解析层：把 data-live 键映射到数据源
     ============================================================ */
  function lv(key) {
    const L = window.Monitor.live, P = profile;
    const sv = sysVolume();
    const sd = sysDisk();
    const diskPct = sv && sv.sizeGb > 0 ? sv.usedPct
      : (sd && sd.capGb > 0 ? sd.usedGb / sd.capGb * 100 : 0);
    switch (key) {
      case 'cpuUsage': return L.cpuUsage;
      case 'cpuTemp': return L.cpuTemp;
      case 'cpuClock': return L.cpuClock;
      case 'cpuPower': return L.cpuPower;
      case 'gpuUsage': return L.gpuUsage ?? null;
      case 'gpuTemp': return L.gpuTemp ?? null;
      case 'gpuClock': return L.gpuClock ?? null;
      case 'gpuPower': return L.gpuPower ?? null;
      case 'gpuVramUsed': return L.gpuVramUsedMb ?? null;
      case 'memPercent': return L.memPercent;
      case 'memUsed': return L.memUsedGb;
      case 'memFree': return Math.max(0, P.mem.totalGb - L.memUsedGb);
      case 'sysPower': return L.systemPower;
      case 'cpuFan': return (P.fans && P.fans[0] && P.fans[0].rpm) || 0;
      case 'diskUsedPct': return diskPct;
      case 'diskUsedGb': return sv ? sv.usedGb : (sd ? sd.usedGb : 0);
      case 'diskFreeGb': return sv ? sv.freeGb : 0;
      case 'diskTemp': return sd && sd.temp != null ? sd.temp : null;
      case 'diskRead': return L.diskRead;
      case 'diskWrite': return L.diskWrite;
      case 'netDown': return L.netDown;
      case 'netUp': return L.netUp;
      case 'uptime': return L.uptimeSec;
      case 'batteryPct': return batteryLevel();
      case 'batTemp': return L.batteryTemp ?? null;
      case 'batPower': return L.systemPower ?? null;
      /* 功耗分解条：换算为百分比，供 data-bar 直接消费 */
      case 'cpuPowerRaw': return Math.min(100, (L.cpuPower || 0) / 200 * 100);
      case 'gpuPowerRaw': return Math.min(100, (L.gpuPower || 0) / 350 * 100);
      case 'batPowerRaw': return Math.min(100, (L.cpuPower || 0) / 200 * 100);
      default: return 0;
    }
  }
  function batteryLevel() {
    const M = window.Monitor;
    if (M.native) return M.nativeBat.known ? M.nativeBat.pct : null;
    // 演示模式：缓慢放电 / 插电维持
    const s = M.live.uptimeSec % 10800;
    return 62 + Math.sin(s / 1700) * 26;
  }
  function batteryState() {
    const M = window.Monitor;
    if (M.native) {
      const st = (M.nativeBat.state || 'unknown').toLowerCase();
      return st === 'none' ? 'none' : st;
    }
    const p = batteryLevel();
    if (p > 92) return 'full';
    return M.live.uptimeSec % 10800 < 5400 ? 'charging' : 'discharging';
  }

  /** 采集不到的字段统一显示为「—」，不伪造数字 */
  const guard = fn => v => (v === null || v === undefined || (typeof v === 'number' && !isFinite(v)))
    ? '—' : fn(v);

  const FMT = {
    pct: guard(v => Math.round(v) + '%'),
    pct1: guard(v => v.toFixed(1) + '%'),
    int: guard(v => String(Math.round(v))),
    temp: guard(v => String(UI.tempVal(v))),
    tempFull: guard(v => UI.temp(v)),
    clock: guard(v => v.toFixed(2)),
    mhz: guard(v => String(Math.round(v))),
    watt: guard(v => String(Math.round(v))),
    gb: guard(v => v.toFixed(1)),
    gb0: guard(v => String(Math.round(v))),
    rpm: guard(v => String(Math.round(v))),
    speed: guard(v => UI.speed(v)),
    uptime: guard(v => UI.uptime(v))
  };

  /* ============================================================
     实时刷新
     ============================================================ */
  let sparkCanvases = [];
  let updaters = [];

  /* Canvas 无法解析 CSS 变量，这里按主题给出等价的十六进制色板 */
  const THEME_PALETTE = {
    dark: { accent: '#2ee08a', accent2: '#ff4d5e', info: '#4c9aff', warn: '#f2a93b', danger: '#ef5350', grid: 'rgba(240,243,247,0.10)', dark: true },
    'light-green': { accent: '#0b8f4f', accent2: '#d92b3f', info: '#2f6fed', warn: '#c47b12', danger: '#c0392b', grid: 'rgba(12,26,19,0.12)', dark: false },
    cyber: { accent: '#00e5ff', accent2: '#ff2fb9', info: '#7c7cff', warn: '#ffd166', danger: '#ff5470', grid: 'rgba(160,160,255,0.14)', dark: true },
    ember: { accent: '#ff8a3d', accent2: '#ff3b3b', info: '#5aa9ff', warn: '#ffc14d', danger: '#ff4d4d', grid: 'rgba(247,241,234,0.10)', dark: true },
    ice: { accent: '#1668dc', accent2: '#d92b3f', info: '#0ea5c6', warn: '#c47b12', danger: '#c0392b', grid: 'rgba(11,21,36,0.12)', dark: false },
    sand: { accent: '#a86f1f', accent2: '#bb3a2c', info: '#2f6fed', warn: '#b8871c', danger: '#b03a2e', grid: 'rgba(28,23,16,0.12)', dark: false }
  };

  function palette() {
    return THEME_PALETTE[Store.state.theme] || THEME_PALETTE.dark;
  }

  function refreshLive() {
    $$('[data-live]').forEach(el => {
      const f = FMT[el.getAttribute('data-fmt') || 'int'] || FMT.int;
      el.textContent = f(lv(el.getAttribute('data-live')));
    });
    $$('[data-bar]').forEach(el => {
      const key = el.getAttribute('data-bar');
      const v = Math.max(0, Math.min(100, lv(key)));
      el.style.width = v.toFixed(1) + '%';
      const warn = Number(el.getAttribute('data-warn') || 999);
      const danger = Number(el.getAttribute('data-danger') || 999);
      el.classList.toggle('warn', v >= warn && v < danger);
      el.classList.toggle('danger', v >= danger);
    });
    const coreGrid = $('#coreGrid');
    if (coreGrid) coreGrid.innerHTML = coreCells();
    const senBody = $('#sensorsBody');
    if (senBody) senBody.innerHTML = sensorRows();
    const chart = $('#procBody');
    if (chart) { /* 进程表低频刷新，此处不动避免跳动 */ }
    sparkCanvases.forEach(s => s());
    updaters.forEach(u => { try { u(); } catch (e) { /* ignore */ } });
  }

  function coreCells() {
    const P = profile;
    return window.Monitor.live.perCore.map((c, i) => {
      const lvl = UI.level(c.usage, 70, 88);
      const col = lvl === 'danger' ? 'var(--st-danger)' : lvl === 'warn' ? 'var(--st-warn)' : 'var(--c-accent)';
      const label = P.cpu.threads > P.cpu.cores ? 'T' : 'C';
      return `<div class="core-cell">
        <div class="cc-top"><span class="cc-id">${label}${String(i).padStart(2, '0')}</span>
          <span class="cc-pct" style="color:${col}">${Math.round(c.usage)}</span></div>
        <div class="bar thin"><i class="bar-fill" style="width:${c.usage.toFixed(1)}%;background:${col}"></i></div>
        <div class="cc-top" style="margin:6px 0 0"><span class="cc-id">${UI.tempVal(c.temp)}${UI.tempUnit()}</span><span class="cc-id">${c.clock.toFixed(1)}G</span></div>
      </div>`;
    }).join('');
  }

  /**
   * 传感器行。原生数据只有 name/type/unit/value（无 min/max），
   * 演示样本才有 base/min/max —— 两种形状在这里统一，缺失项显示「—」。
   */
  function sensorRows() {
    return (window.Monitor.sensors || []).map(s => {
      const raw = s.value == null ? (s.base == null ? null : s.base) : s.value;
      const fmt = x => {
        if (x === null || x === undefined || !isFinite(x)) return '—';
        if (s.unit === '°C') return UI.tempVal(x);
        if (s.unit === 'V') return Number(x).toFixed(3);
        return String(Math.round(x));
      };
      return `<tr>
        <td>${esc(s.name)}</td>
        <td class="dim">${esc(s.type || s.kind || '—')}</td>
        <td class="num right">${fmt(raw)} <span class="dim">${esc(s.unit || '')}</span></td>
        <td class="num right dim">${fmt(s.min)}</td>
        <td class="num right dim">${fmt(s.max)}</td>
      </tr>`;
    }).join('');
  }

  /* ============================================================
     视图渲染
     ============================================================ */
  const PROC = [
    { n: 'GeekSpace.exe', c: 3.4, m: 268 }, { n: 'chrome.exe', c: 8.6, m: 1842 },
    { n: 'MsMpEng.exe', c: 5.1, m: 412 }, { n: 'Code.exe', c: 6.8, m: 964 },
    { n: 'steamwebhelper.exe', c: 1.9, m: 388 }, { n: 'explorer.exe', c: 1.1, m: 176 },
    { n: 'nvcontainer.exe', c: 0.9, m: 132 }, { n: 'Discord.exe', c: 2.2, m: 356 }
  ];

  /* 由磁盘推导分区/卷（仅演示模式使用，原生模式见上方 volumes()） */
  function volumesDemo() {
    const letters = ['C:', 'D:', 'E:', 'F:'];
    const out = [];
    let li = 0;
    profile.disks.forEach(d => {
      if (d.system) {
        const cCap = Math.round(d.capGb * 0.48);
        const cUsed = Math.round(d.usedGb * 0.68);
        out.push({ letter: letters[li++], label: 'Windows', fs: 'NTFS', capGb: cCap, usedGb: cUsed, freeGb: cCap - cUsed, usedPct: cUsed / cCap * 100, system: true });
        out.push({ letter: letters[li++], label: 'Data', fs: 'NTFS', capGb: d.capGb - cCap, usedGb: Math.max(1, d.usedGb - cUsed), freeGb: 0, usedPct: 0, system: false });
      } else {
        out.push({ letter: letters[li++], label: d.type === 'ssd' ? 'Games' : 'Backup', fs: 'NTFS', capGb: d.capGb, usedGb: d.usedGb, freeGb: d.capGb - d.usedGb, usedPct: d.usedGb / d.capGb * 100, system: false });
      }
    });
    return out;
  }

  function cardHead(titleKey, iconName, right) {    return `<div class="card-head">
      <div class="card-title">${UI.icon(iconName, 16)}<h2>${esc(t(titleKey))}</h2></div>
      ${right || ''}
    </div>`;
  }

  function tile(labelKey, valueKey, fmt, unit, sub) {
    return `<div class="metric">
      <div class="metric-label label">${esc(t(labelKey))}</div>
      <div class="metric-value num"><span data-live="${valueKey}" data-fmt="${fmt}">0</span><span class="unit">${unit || ''}</span></div>
      <div class="metric-foot"><span>${sub || ''}</span></div>
    </div>`;
  }

  /* ---------- 概览 ---------- */
  function viewDashboard() {
    const P = profile;
    const L = window.Monitor.live;
    const p = palette();
    // 系统盘 / 系统卷：不再想当然地取 disks[0]
    const sd = sysDisk();
    const sv = sysVolume();
    const d0 = sd || { model: '—', health: null, usedGb: 0, capGb: 0 };
    const sysUsed = sv ? sv.usedGb : d0.usedGb;
    const sysCap = sv ? sv.capGb : d0.capGb;
    const sysFree = sv ? sv.freeGb : Math.max(0, d0.capGb - d0.usedGb);
    const sys = P.system || {};
    const hasBattery = !!(P.battery && P.battery.present);
    const hasFan = !!(P.fans && P.fans.length);
    const budget = (P.cpu.tdp + P.gpu.tdp) > 0 ? (P.cpu.tdp + P.gpu.tdp + 120) + ' W' : '—';
    const fmtGb = v => (Math.round(v * 10) / 10).toFixed(1);
    const plat = P.platform || 'windows';
    // GPU 实时读数可能整体缺失（GeForce 老卡不开放查询），此时不展示空壳模块
    const hasGpuLive = L.gpuUsage != null || L.gpuTemp != null;

    // 无数据项统一给出明确原因，不再显示空洞的「— · —」
    const naCell = (key) => `<span class="na-hint">${UI.icon('warn', 13)}${esc(t(key))}</span>`;

    return `<div class="content-inner stack">

      <!-- 顶部速览条 -->
      <div class="stat-strip">
        <div class="stat-cell">
          <div class="sk">${esc(t('dashboard.cpuUsage'))}</div>
          <div class="sv"><span data-live="cpuUsage" data-fmt="pct">0</span></div>
          <div class="sd"><span data-live="cpuClock" data-fmt="clock">0</span> GHz</div>
        </div>
        <div class="stat-cell">
          <div class="sk">${esc(t('dashboard.cpuTemp'))}</div>
          <div class="sv"><span data-live="cpuTemp" data-fmt="temp">0</span><span class="su">${UI.tempUnit()}</span></div>
          <div class="sd">${esc(t('monitor.power'))} <span data-live="cpuPower" data-fmt="watt">0</span> W</div>
        </div>
        <div class="stat-cell">
          <div class="sk">${esc(t('dashboard.gpuUsage'))}</div>
          <div class="sv"><span data-live="gpuUsage" data-fmt="pct">—</span></div>
          <div class="sd"><span data-live="gpuTemp" data-fmt="temp">—</span>${hasFan || true ? '' : ''}</div>
        </div>
        <div class="stat-cell">
          <div class="sk">${esc(t('dashboard.memUsage'))}</div>
          <div class="sv"><span data-live="memPercent" data-fmt="pct">0</span></div>
          <div class="sd"><span data-live="memUsed" data-fmt="gb">0</span> / ${P.mem.totalGb} GB</div>
        </div>
        <div class="stat-cell">
          <div class="sk">${esc(t('dashboard.overallPower'))}</div>
          <div class="sv"><span data-live="sysPower" data-fmt="watt">0</span><span class="su">W</span></div>
          <div class="sd">${esc(t('dashboard.powerBudget'))} ${budget}</div>
        </div>
        <div class="stat-cell">
          <div class="sk">${esc(t('dashboard.netDown'))}</div>
          <div class="sv"><span data-live="netDown" data-fmt="speed">0</span></div>
          <div class="sd">↑ <span data-live="netUp" data-fmt="speed">0</span></div>
        </div>
        <div class="stat-cell">
          <div class="sk">${esc(t('dashboard.diskUsage'))}${sv ? ' ' + esc(sv.letter) : ''}</div>
          <div class="sv"><span data-live="diskUsedPct" data-fmt="pct">—</span></div>
          <div class="sd">${fmtGb(sysUsed)} / ${fmtGb(sysCap)} GB · ${esc(t('dashboard.free'))} ${fmtGb(sysFree)}</div>
        </div>
        <div class="stat-cell">
          <div class="sk">${esc(t('dashboard.uptime'))}</div>
          <div class="sv" style="font-size:var(--fs-base)"><span data-live="uptime" data-fmt="uptime">—</span></div>
          <div class="sd">${esc(sys.chassis || '—')} · ${P.os.arch || '—'}</div>
        </div>
      </div>

      <div class="split">
        <section class="card">
          ${cardHead('dashboard.liveTrend', 'activity', `<div class="flex gap-2 wrap">
            <span class="chip accent"><span class="d"></span>CPU</span>
            <span class="chip info"><span class="d"></span>GPU</span>
            <span class="chip warn"><span class="d"></span>${esc(t('dashboard.memUsage'))}</span>
            <span class="chip accent2"><span class="d"></span>${esc(t('dashboard.overallPower'))}</span>
          </div>`)}
          <div class="chart-box" style="height:210px">
            <canvas id="trendChart" class="spark" style="height:210px" role="img" aria-label="CPU GPU 内存 功耗实时趋势曲线"></canvas>
          </div>
          <div class="grid g-3 keep" style="margin-top:14px;gap:10px">
            <div class="flex between" style="padding:0 2px">
              <span class="label">${esc(t('dashboard.loadLevel'))}</span>
              <span class="chip accent" id="loadChip">${esc(t('dashboard.normal'))}</span>
            </div>
            <div class="flex between" style="padding:0 2px">
              <span class="label">${esc(t('monitor.cores'))}</span>
              <span class="chip">${P.cpu.cores}C / ${P.cpu.threads}T</span>
            </div>
            <div class="flex between" style="padding:0 2px">
              <span class="label">${esc(t('monitor.temp'))}</span>
              <span class="chip ${UI.tempLevel(L.cpuTemp) === 'danger' ? 'danger' : UI.tempLevel(L.cpuTemp) === 'warn' ? 'warn' : 'ok'}">
                <span class="d"></span><span data-live="cpuTemp" data-fmt="tempv">0</span>${UI.tempUnit()}
              </span>
            </div>
          </div>
        </section>

        <section class="card bracket accent-edge">
          ${cardHead('dashboard.overallPower', 'bolt', `<span class="card-sub">${esc(t('dashboard.fromWall'))}</span>`)}
          <div class="flex center gap-4" style="margin-bottom:18px">
            ${UI.ring({ value: 0, max: 800, size: 138, thickness: 11, unit: 'W', label: t('dashboard.overallPower'), color: p.accent })}
            <div class="grow stack" style="gap:12px">
              <div>
                <div class="flex between" style="margin-bottom:6px"><span class="label">CPU</span><span class="num"><span data-live="cpuPower" data-fmt="watt">0</span> W</span></div>
                <div class="bar"><i class="bar-fill" data-bar="cpuPowerRaw" style="width:20%"></i></div>
              </div>
              <div>
                <div class="flex between" style="margin-bottom:6px"><span class="label">GPU</span><span class="num"><span data-live="gpuPower" data-fmt="watt">—</span></span></div>
                <div class="bar"><i class="bar-fill info" data-bar="gpuPowerRaw" style="width:12%"></i></div>
              </div>
              <div>
                <div class="flex between" style="margin-bottom:6px"><span class="label">${esc(t('monitor.tabStorage'))}</span><span class="num"><span data-live="diskRead" data-fmt="speed">0</span></span></div>
                <div class="bar"><i class="bar-fill alt" data-bar="diskReadRaw" style="width:8%"></i></div>
              </div>
            </div>
          </div>
          <div class="kv">
            <dt>${esc(t('dashboard.powerBudget'))}</dt><dd class="num">${budget}</dd>
            <dt>${esc(t('dashboard.cpuFan'))}</dt>
            <dd class="num">${hasFan ? `<span data-live="cpuFan" data-fmt="rpm">0</span> RPM` : naCell('na.noSensor')}</dd>
          </div>
        </section>
      </div>

      <div class="grid g-4 keep">
        <div class="metric">
          <div class="metric-label label">${esc(t('dashboard.cpuUsage'))}</div>
          <div class="flex center gap-3">
            ${UI.ring({ value: 0, max: 100, size: 86, thickness: 8, unit: '%', label: t('dashboard.cpuUsage') })}
            <div class="grow">
              <div class="metric-foot" style="margin:0 0 8px"><span>${esc(t('monitor.curClock'))}</span></div>
              <div class="num" style="font-size:var(--fs-lg);font-weight:700"><span data-live="cpuClock" data-fmt="clock">0</span> <span class="dim" style="font-size:var(--fs-sm)">GHz</span></div>
            </div>
          </div>
        </div>
        <div class="metric">
          <div class="metric-label label">${esc(t('dashboard.cpuTemp'))}</div>
          <div class="flex center gap-3">
            ${UI.ring({ value: 0, max: 100, size: 86, thickness: 8, unit: UI.tempUnit(), label: t('dashboard.cpuTemp'), color: 'var(--st-warn)' })}
            <div class="grow">
              <div class="metric-foot" style="margin:0 0 8px"><span>${esc(t('monitor.l3'))}</span></div>
              <div class="num" style="font-size:var(--fs-lg);font-weight:700">${P.cpu.l3 ? P.cpu.l3 + ' <span class="dim" style="font-size:var(--fs-sm)">MB</span>' : '—'}</div>
            </div>
          </div>
        </div>
        <div class="metric">
          <div class="metric-label label">${esc(t('dashboard.gpuUsage'))}</div>
          <div class="flex center gap-3">
            ${UI.ring({ value: 0, max: 100, size: 86, thickness: 8, unit: '%', label: t('dashboard.gpuUsage'), color: 'var(--st-info)' })}
            <div class="grow">
              <div class="metric-foot" style="margin:0 0 8px"><span>${esc(t('monitor.vram'))}</span></div>
              <div class="num" style="font-size:var(--fs-lg);font-weight:700">${P.gpu.vram ? P.gpu.vram + ' <span class="dim" style="font-size:var(--fs-sm)">GB</span>' : '—'}</div>
            </div>
          </div>
        </div>
        <div class="metric">
          <div class="metric-label label">${esc(t('dashboard.memUsage'))}</div>
          <div class="flex center gap-3">
            ${UI.ring({ value: 0, max: 100, size: 86, thickness: 8, unit: '%', label: t('dashboard.memUsage'), color: 'var(--st-warn)' })}
            <div class="grow">
              <div class="metric-foot" style="margin:0 0 8px"><span>${esc(P.mem.type || '—')}-${P.mem.speedMhz || '—'}</span></div>
              <div class="num" style="font-size:var(--fs-lg);font-weight:700"><span data-live="memUsed" data-fmt="gb">0</span> <span class="dim" style="font-size:var(--fs-sm)">/ ${P.mem.totalGb} GB</span></div>
            </div>
          </div>
        </div>
      </div>

      <div class="split">
        <section class="card">
          ${cardHead('dashboard.deviceInfo', 'board', `<span class="card-sub">${esc(jd(sys.manufacturer, sys.chassis))}</span>`)}
          <div class="kv">
            <dt>${esc(t('dashboard.hostname'))}</dt><dd>${esc(P.host)}</dd>
            <dt>${esc(t('dashboard.os'))}</dt><dd>${esc(jd(P.os.name, P.os.build))}</dd>
            ${P.osInstall ? `<dt>${esc(t('dashboard.osInstall'))}</dt><dd class="num">${esc(P.osInstall)}</dd>` : ''}
            <dt>${esc(t('monitor.systemModel'))}</dt><dd>${esc(jn(sys.manufacturer, sys.model) || '—')}</dd>
            <dt>${esc(t('dashboard.cpu'))}</dt><dd>${esc(showOr(P.cpu.model))}</dd>
            <dt>${esc(t('dashboard.gpu'))}</dt><dd>${esc(showOr(P.gpu.model))}</dd>
            <dt>${esc(t('dashboard.memory'))}</dt><dd class="num">${jn(P.mem.totalGb ? P.mem.totalGb + ' GB' : '', P.mem.type, P.mem.speedMhz ? P.mem.speedMhz + ' MT/s' : '') || '—'}</dd>
            <dt>${esc(t('dashboard.board'))}</dt><dd>${esc(jn(P.board.vendor, P.board.model) || '—')}</dd>
            <dt>${esc(t('monitor.biosVer'))}</dt><dd class="num">${esc(jd(P.board.bios, P.biosDate) || '—')}</dd>
            <dt>${esc(t('monitor.tabDisplay'))}</dt><dd>${esc(jd(jn(P.display.vendor, P.display.model), P.display.res) || '—')}</dd>
            <dt>${esc(t('dashboard.uptime'))}</dt><dd class="num" data-live="uptime" data-fmt="uptime">—</dd>
          </div>
        </section>

        <section class="card">
          ${cardHead('dashboard.quickStatus', 'shieldCheck',
            `<span class="card-sub">${esc(jd(sys.chassis, plat === 'android' ? t('common.mobile') : t('common.desktop')))}</span>`)}
          <div class="row-list">
            <!-- 电池：无电池机型明确说明，不再留空洞占位 -->
            <div class="row">
              <span class="row-main"><span class="row-t1">${esc(t('dashboard.battery'))}</span>
                <span class="row-t2">${hasBattery
                  ? (jd(P.battery.designWh ? P.battery.designWh + ' Wh' : '', P.battery.cycles ? t('monitor.cycles') + ' ' + P.battery.cycles : '') || '—')
                  : esc(t('na.noBattery'))}</span></span>
              ${hasBattery
                ? `<span class="chip ok"><span class="d"></span><span data-live="batteryPct" data-fmt="pct">—</span></span>`
                : `<span class="chip"><span class="d"></span>${esc(showOr(sys.chassis, t('na.unknown')))}</span>`}
            </div>
            <!-- 系统盘：用真实系统卷（可能是 C:，也可能在第二块盘上） -->
            <div class="row">
              <span class="row-main"><span class="row-t1">${esc(t('dashboard.diskUsage'))}${sv ? ' ' + esc(sv.letter) : ''}</span>
                <span class="row-t2">${sysCap > 0
                  ? `${fmtGb(sysUsed)} / ${fmtGb(sysCap)} GB · ${esc(t('dashboard.free'))} ${fmtGb(sysFree)} GB`
                  : esc(t('na.noVolume'))}</span></span>
              ${sysCap > 0
                ? `<div style="width:130px"><div class="bar"><i class="bar-fill" data-bar="diskUsedPct" data-warn="78" data-danger="92" style="width:0%"></i></div></div>`
                : `<span class="chip warn"><span class="d"></span>${esc(t('na.unknown'))}</span>`}
            </div>
            <!-- 硬盘健康：读不到 SMART 就说读不到 -->
            <div class="row">
              <span class="row-main"><span class="row-t1">${esc(t('dashboard.diskHealth'))}</span>
                <span class="row-t2">${esc(showOr(d0.model))}</span></span>
              ${d0.health == null
                ? `<span class="chip warn">${UI.icon('warn', 12)}${esc(t('na.noSmart'))}</span>`
                : `<span class="chip ${d0.health >= 90 ? 'ok' : d0.health >= 70 ? 'warn' : 'danger'}"><span class="d"></span>${d0.health}%</span>`}
            </div>
            <!-- 风扇：消费级主板与移动端普遍不开放 -->
            <div class="row">
              <span class="row-main"><span class="row-t1">${esc(t('dashboard.cpuFan'))}</span>
                <span class="row-t2">${hasFan ? esc(P.fans[0].name) : esc(t('na.noFan'))}</span></span>
              ${hasFan
                ? `<span class="chip"><span class="d"></span><span data-live="cpuFan" data-fmt="rpm">0</span> RPM</span>`
                : `<span class="chip warn">${UI.icon('warn', 12)}${esc(plat === 'windows' ? t('na.noSensor') : t('na.notSupported'))}</span>`}
            </div>
            <div class="row">
              <span class="row-main"><span class="row-t1">${esc(t('monitor.tabDisplay'))}</span>
                <span class="row-t2">${esc(jd(jn(P.display.vendor, P.display.model), P.display.res, P.display.size ? P.display.size + '"' : '') || '—')}${P.displayCount > 1 ? ` · ${P.displayCount}` : ''}</span></span>
              <span class="chip info">${P.display.refresh ? P.display.refresh + ' Hz' : '—'}</span>
            </div>
            <div class="row">
              <span class="row-main"><span class="row-t1">${esc(t('dashboard.network'))}</span>
                <span class="row-t2">↓ <span data-live="netDown" data-fmt="speed">0</span> · ↑ <span data-live="netUp" data-fmt="speed">0</span></span></span>
              <span class="chip accent"><span class="d"></span>${esc(t('dashboard.online'))}</span>
            </div>
          </div>
        </section>
      </div>

      <article class="card flush">
        <div style="padding:16px 16px 0">${cardHead('dashboard.processes', 'server',
          `<span class="card-sub">${window.Monitor.native ? esc(t('source.native')) : esc(t('source.demo'))} · CPU / MEM</span>`)}</div>
        <table class="table">
          <thead><tr><th>${esc(t('dashboard.processName'))}</th><th class="right">${esc(t('dashboard.pCpu'))}</th><th class="right">${esc(t('dashboard.pMem'))}</th><th style="width:32%"></th></tr></thead>
          <tbody id="procBody">${processRows()}</tbody>
        </table>
      </article>

    </div>`;
  }

  /**
   * 进程行渲染。原生数据形如 { pid, name, cpu, memMb }，
   * 演示样本形如 { n, c, m }，这里统一处理，视图层不必区分。
   */
  function procRow(p) {
    const isNative = p.pid !== undefined;
    const name = isNative ? p.name : p.n;
    const cpu = isNative ? p.cpu : p.c * (0.85 + Math.random() * 0.5);
    const mem = isNative ? p.memMb : p.m * (0.94 + Math.random() * 0.12);
    const pidTag = isNative ? ` <span class="dim tnum" style="font-size:var(--fs-xs)">${p.pid}</span>` : '';
    const memTxt = mem >= 1024 ? (mem / 1024).toFixed(2) + ' GB' : Math.round(mem) + ' MB';
    return `<tr>
      <td>${esc(name)}${pidTag}</td>
      <td class="num right">${cpu.toFixed(1)}%</td>
      <td class="num right">${memTxt}</td>
      <td><div class="bar thin"><i class="bar-fill" style="width:${Math.min(100, cpu * 5).toFixed(0)}%"></i></div></td>
    </tr>`;
  }

  /** 当前应展示的进程列表：原生优先，演示模式退回内置样本 */
  function processRows() {
    const M = window.Monitor;
    if (M.native && Array.isArray(M.processes) && M.processes.length) {
      return M.processes.map(procRow).join('');
    }
    return PROC.map(procRow).join('');
  }

  /* ---------- 硬件监控 ---------- */
  function viewMonitor() {
    const tabs = [
      ['cpu', 'monitor.tabCpu', 'cpu'], ['mem', 'monitor.tabMem', 'ram'],
      ['gpu', 'monitor.tabGpu', 'gpu'], ['board', 'monitor.tabBoard', 'board'],
      ['display', 'monitor.tabDisplay', 'display'], ['storage', 'monitor.tabStorage', 'disk'],
      ['battery', 'monitor.tabBattery', 'battery']
    ];
    return `<div class="content-inner">
      <div class="tabs">${tabs.map(x => `<button class="tab${ui.monitorTab === x[0] ? ' active' : ''}" data-mtab="${x[0]}">${esc(t(x[1]))}</button>`).join('')}</div>
      <div id="monitorPane">${MONITOR_PANES[ui.monitorTab]()}</div>
    </div>`;
  }

  const MONITOR_PANES = {
    cpu() {
      const P = profile;
      return `<div class="stack">
        <div class="split">
          <section class="card">
            ${cardHead('monitor.cpuSpec', 'cpu')}
            <div class="kv">
              <dt>${esc(t('monitor.cpuModel'))}</dt><dd>${esc(P.cpu.model)}</dd>
              <dt>${esc(t('monitor.cpuVendor'))}</dt><dd>${esc(P.cpu.vendor || '—')}</dd>
              <dt>${esc(t('monitor.codename'))}</dt><dd>${esc(P.cpu.codename || '—')}</dd>
              <dt>${esc(t('monitor.process'))}</dt><dd>${esc(P.cpu.node || '—')}</dd>
              <dt>${esc(t('monitor.cores'))} / ${esc(t('monitor.threads'))}</dt><dd class="num">${P.cpu.cores}C / ${P.cpu.threads}T</dd>
              <dt>${esc(t('monitor.baseClock'))}</dt><dd class="num">${P.cpu.base > 0 ? P.cpu.base.toFixed(2) + ' GHz' : '—'}</dd>
              <dt>${esc(t('monitor.boostClock'))}</dt><dd class="num">${P.cpu.boost > 0 ? P.cpu.boost.toFixed(2) + ' GHz' : '—'}</dd>
              <dt>${esc(t('monitor.l1l2'))}</dt><dd class="num">${P.cpu.l2 ? P.cpu.l2 + ' MB' : '—'}</dd>
              <dt>${esc(t('monitor.l3'))}</dt><dd class="num">${P.cpu.l3 ? P.cpu.l3 + ' MB' : '—'}</dd>
              <dt>${esc(t('monitor.dataWidth'))}</dt><dd class="num">${P.cpu.dataWidth ? P.cpu.dataWidth + '-bit' : '—'}</dd>
              <dt>${esc(t('monitor.virtualization'))}</dt><dd>${P.cpu.virtualization ? esc(t('monitor.supported')) : '—'}</dd>
              <dt>TDP</dt><dd class="num">${P.cpu.tdp ? P.cpu.tdp + ' W' : '—'}</dd>
              <dt>${esc(t('monitor.socket'))}</dt><dd>${esc(P.cpu.socket || '—')}</dd>
            </div>
          </section>
          <section class="card">
            ${cardHead('dashboard.cpuUsage', 'activity')}
            <div class="flex between gap-3" style="justify-content:space-around">
              ${UI.ring({ value: 0, max: 100, size: 108, thickness: 9, unit: '%', label: t('monitor.usage') })}
              ${UI.ring({ value: 0, max: 100, size: 108, thickness: 9, unit: UI.tempUnit(), label: t('monitor.temp'), color: 'var(--st-warn)' })}
            </div>
            <div class="grid g-2" style="margin-top:16px">
              <div class="metric"><div class="metric-label label">${esc(t('monitor.curClock'))}</div>
                <div class="metric-value num"><span data-live="cpuClock" data-fmt="clock">0</span><span class="unit">GHz</span></div></div>
              <div class="metric"><div class="metric-label label">${esc(t('monitor.power'))}</div>
                <div class="metric-value num"><span data-live="cpuPower" data-fmt="watt">0</span><span class="unit">W</span></div></div>
            </div>
          </section>
        </div>
        <section class="card">
          ${cardHead('monitor.perCore', 'grid', `<span class="card-sub">${P.cpu.threads} ${esc(t('monitor.threads'))}</span>`)}
          <div class="core-grid" id="coreGrid">${coreCells()}</div>
        </section>
      </div>`;
    },
    mem() {
      const P = profile, M = P.mem;
      return `<div class="stack">
        <div class="split">
          <section class="card">
            ${cardHead('monitor.tabMem', 'ram', `<span class="card-sub">${M.totalGb} GB</span>`)}
            <div class="flex between" style="margin-bottom:14px">
              <div>
                <div class="label">${esc(t('monitor.memUsed'))}</div>
                <div class="num" style="font-size:var(--fs-3xl);font-weight:600"><span data-live="memUsed" data-fmt="gb">0</span> <span class="dim" style="font-size:var(--fs-md)">GB</span></div>
              </div>
              <div style="text-align:right">
                <div class="label">${esc(t('monitor.memAvail'))}</div>
                <div class="num" style="font-size:var(--fs-3xl);font-weight:600"><span data-live="memFree" data-fmt="gb">0</span> <span class="dim" style="font-size:var(--fs-md)">GB</span></div>
              </div>
            </div>
            <div class="bar thick"><i class="bar-fill warn" data-bar="memPercent" data-warn="80" data-danger="92" style="width:0%"></i></div>
            <div class="kv" style="margin-top:18px">
              <dt>${esc(t('monitor.memType'))}</dt><dd>${esc(M.type)}</dd>
              <dt>${esc(t('monitor.memSpeed'))}</dt><dd class="num">${M.speedMhz} MT/s</dd>
              <dt>${esc(t('monitor.channels'))}</dt><dd class="num">${M.channels} × ${M.totalGb / M.channels} GB</dd>
              <dt>${esc(t('monitor.memTotal'))}</dt><dd class="num">${M.totalGb} GB</dd>
              <dt>${esc(t('monitor.swap'))}</dt><dd class="num">4.0 / 8.0 GB</dd>
            </div>
          </section>
          <section class="card">
            ${cardHead('monitor.slots', 'server')}
            <table class="table">
              <thead><tr><th>${esc(t('monitor.slots'))}</th><th class="right">${esc(t('monitor.diskCap'))}</th><th class="right">${esc(t('monitor.memSpeed'))}</th><th>${esc(t('monitor.dispModel'))}</th></tr></thead>
              <tbody>${M.slots.map((s, i) => `<tr>
                <td class="num">${esc(s.name)}</td><td class="num right">${s.sizeGb} GB</td>
                <td class="num right">${s.speedMhz}</td><td class="dim">${esc(i === 0 ? M.vendor : M.vendor)}</td></tr>`).join('')}</tbody>
            </table>
            <div class="empty" style="padding:18px">
              ${UI.icon('ram', 26)}
              <div class="et">${esc(t('monitor.channels'))}: ${M.channels} / ${M.slots.length}</div>
            </div>
          </section>
        </div>
      </div>`;
    },
    gpu() {
      const G = profile.gpu;
      const hasLive = window.Monitor.live.gpuUsage != null || window.Monitor.live.gpuTemp != null;
      return `<div class="stack">
        <div class="split">
          <section class="card">
            ${cardHead('monitor.tabGpu', 'gpu', `<span class="card-sub">${esc(showOr(G.vendor))}</span>`)}
            <div class="kv">
              <dt>${esc(t('monitor.gpuModel'))}</dt><dd>${esc(showOr(G.model))}</dd>
              <dt>${esc(t('monitor.vram'))}</dt><dd class="num">${G.vram ? G.vram + ' GB' : '—'}</dd>
              <dt>${esc(t('monitor.vramUsed'))}</dt><dd class="num">${hasLive && window.Monitor.live.gpuVramUsedMb != null ? window.Monitor.live.gpuVramUsedMb + ' MB' : '—'}</dd>
              <dt>${esc(t('monitor.driver'))}</dt><dd class="num">${esc(showOr(G.driver))}</dd>
              <dt>${esc(t('monitor.videoProcessor'))}</dt><dd>${esc(showOr(G.videoProcessor))}</dd>
              <dt>${esc(t('monitor.colorDepth'))}</dt><dd class="num">${G.bits ? G.bits + '-bit' : '—'}</dd>
              <dt>${esc(t('monitor.coreClock'))}</dt><dd class="num"><span data-live="gpuClock" data-fmt="mhz">—</span> MHz</dd>
              <dt>${esc(t('monitor.memClock'))}</dt><dd class="num">${G.mem ? G.mem + ' MHz' : '—'}</dd>
              <dt>${esc(t('monitor.iface'))}</dt><dd class="num">${G.bus ? 'PCIe x' + (G.bus / 8) : '—'}</dd>
              <dt>TDP</dt><dd class="num">${G.tdp ? G.tdp + ' W' : '—'}</dd>
            </div>
          </section>
          <section class="card">
            ${cardHead('monitor.gpuLoad', 'activity',
              hasLive ? '' : `<span class="card-sub">${esc(t('na.notSupported'))}</span>`)}
            <div class="flex between gap-3" style="justify-content:space-around">
              ${UI.ring({ value: 0, max: 100, size: 108, thickness: 9, unit: '%', label: t('monitor.gpuLoad'), color: 'var(--st-info)' })}
              ${UI.ring({ value: 0, max: 100, size: 108, thickness: 9, unit: UI.tempUnit(), label: t('monitor.temp'), color: 'var(--st-warn)' })}
            </div>
            ${hasLive ? '' : `<p class="muted" style="margin-top:12px;font-size:var(--fs-xs);line-height:1.6">${esc(t('monitor.gpuNoLive'))}</p>`}
            <div class="grid g-2" style="margin-top:16px">
              <div class="metric"><div class="metric-label label">${esc(t('monitor.gpuPower'))}</div>
                <div class="metric-value num"><span data-live="gpuPower" data-fmt="watt">—</span><span class="unit">W</span></div></div>
              <div class="metric"><div class="metric-label label">${esc(t('monitor.memClock'))}</div>
                <div class="metric-value num">${G.mem || '—'}<span class="unit">MHz</span></div></div>
            </div>
          </section>
        </div>
      </div>`;
    },
    board() {
      const B = profile.board;
      const sys = profile.system || {};
      return `<div class="stack">
      <div class="split-even">
        <section class="card">
          ${cardHead('monitor.tabBoard', 'board')}
          <div class="kv">
            <dt>${esc(t('monitor.boardMfr'))}</dt><dd>${esc(showOr(B.vendor))}</dd>
            <dt>${esc(t('monitor.boardModel'))}</dt><dd>${esc(showOr(B.model))}</dd>
            <dt>${esc(t('monitor.chipset'))}</dt><dd>${esc(showOr(B.chipset))}</dd>
            <dt>${esc(t('monitor.boardRev'))}</dt><dd>${esc(showOr(B.revision))}</dd>
            <dt>${esc(t('monitor.serial'))}</dt><dd class="num">${esc(showOr(B.serial))}</dd>
          </div>
        </section>
        <section class="card">
          ${cardHead('monitor.biosVer', 'server')}
          <div class="kv">
            <dt>${esc(t('monitor.biosVer'))}</dt><dd class="num">${esc(showOr(B.bios))}</dd>
            <dt>${esc(t('monitor.biosDate'))}</dt><dd class="num">${esc(showOr(profile.biosDate))}</dd>
            <dt>${esc(t('monitor.biosVendor'))}</dt><dd>${esc(showOr(B.biosVendor))}</dd>
          </div>
        </section>
      </div>
      <section class="card">
        ${cardHead('monitor.systemModel', 'server')}
        <div class="kv">
          <dt>${esc(t('monitor.machineType'))}</dt><dd>${esc(showOr(sys.chassis))}</dd>
          <dt>${esc(t('monitor.systemModel'))}</dt><dd>${esc(jn(sys.manufacturer, sys.model) || '—')}</dd>
          <dt>${esc(t('monitor.dataWidth'))}</dt><dd class="num">${sys.archBits || 64}-bit</dd>
          <dt>${esc(t('monitor.memTotal'))}</dt><dd class="num">${profile.mem.totalGb} GB</dd>
          <dt>${esc(t('monitor.displayCount'))}</dt><dd class="num">${profile.displayCount || 1}</dd>
        </div>
      </section>
      </div>`;
    },
    display() {
      const D = profile.display;
      return `<div class="split-even">
        <section class="card">
          ${cardHead('monitor.tabDisplay', 'display')}
          <div class="kv">
            <dt>${esc(t('monitor.dispModel'))}</dt><dd>${esc(jn(D.vendor, D.model) || '—')}</dd>
            <dt>${esc(t('monitor.resolution'))}</dt><dd class="num">${esc(showOr(D.res))}</dd>
            <dt>${esc(t('monitor.refreshRate'))}</dt><dd class="num">${D.refresh ? D.refresh + ' Hz' : '—'}</dd>
            <dt>${esc(t('monitor.iface'))}</dt><dd>${esc(showOr(D.connection))}</dd>
            <dt>${esc(t('monitor.serial'))}</dt><dd class="num">${esc(showOr(D.serial))}</dd>
            <dt>${esc(t('monitor.displayCount'))}</dt><dd class="num">${profile.displayCount || 1}</dd>
          </div>
        </section>
        <section class="card">
          ${cardHead('monitor.panel', 'display')}
          <div class="kv">
            <dt>${esc(t('monitor.size'))}</dt><dd class="num">${D.size > 0 ? D.size + '"' : '—'}</dd>
            <dt>${esc(t('monitor.panel'))}</dt><dd>${esc(showOr(D.panel, t('na.unknown')))}</dd>
            <dt>${esc(t('monitor.hdr'))}</dt><dd>${esc(showOr(D.hdr, t('na.unknown')))}</dd>
          </div>
        </section>
      </div>`;
    },
    storage() {
      const vols = volumes();
      const fmt = v => (Math.round(v * 10) / 10).toFixed(1);
      const healthChip = h => h == null
        ? `<span class="chip warn">${UI.icon('warn', 12)}${esc(t('na.noSmart'))}</span>`
        : `<span class="chip ${h >= 90 ? 'ok' : h >= 70 ? 'warn' : 'danger'}"><span class="d"></span>${h}%</span>`;
      return `<div class="stack">
      <section class="card flush">
        <div style="padding:16px 16px 0">${cardHead('monitor.tabStorage', 'disk', `<span class="card-sub">${profile.disks.length} ${esc(t('common.items'))}</span>`)}</div>
        <table class="table">
          <thead><tr>
            <th>${esc(t('monitor.diskModel'))}</th><th>${esc(t('monitor.iface'))}</th>
            <th class="right">${esc(t('monitor.diskCap'))}</th><th>${esc(t('monitor.used'))}</th>
            <th class="right">${esc(t('monitor.health'))}</th><th class="right">${esc(t('monitor.diskTemp'))}</th>
            <th class="right">${esc(t('monitor.readSpeed'))}</th><th class="right">${esc(t('monitor.writeSpeed'))}</th>
          </tr></thead>
          <tbody>${profile.disks.map(d => `<tr>
            <td>${esc(d.model)}${d.system ? ` <span class="chip accent" style="margin-left:4px">${esc(svVolumeLetter())}</span>` : ''}</td>
            <td class="dim">${esc(showOr(d.iface))}</td>
            <td class="num right">${d.capGb} GB</td>
            <td style="min-width:150px">
              <div class="num dim" style="font-size:var(--fs-xs);margin-bottom:4px">${d.usedGb} / ${d.capGb} GB</div>
              <div class="bar"><i class="bar-fill" style="width:${d.capGb ? (d.usedGb / d.capGb * 100).toFixed(0) : 0}%"></i></div>
            </td>
            <td class="right">${healthChip(d.health)}</td>
            <td class="num right">${d.temp == null ? '—' : d.temp}</td>
            <td class="num right">${d.readMB == null ? '—' : UI.speed(d.readMB)}</td>
            <td class="num right">${d.writeMB == null ? '—' : UI.speed(d.writeMB)}</td>
          </tr>`).join('')}</tbody>
        </table>
      </section>

      <div class="split">
        <section class="card flush">
          <div style="padding:16px 16px 0">${cardHead('monitor.volumes', 'folder', `<span class="card-sub">${vols.length} ${esc(t('common.items'))}</span>`)}</div>
          <table class="table">
            <thead><tr>
              <th>${esc(t('monitor.volume'))}</th><th>${esc(t('monitor.fsType'))}</th>
              <th class="right">${esc(t('monitor.diskCap'))}</th><th>${esc(t('monitor.used'))}</th>
            </tr></thead>
            <tbody>${vols.length ? vols.map(v => `<tr>
              <td><span class="chip ${v.system ? 'accent' : ''}">${esc(v.letter)}</span>${v.label ? ` <span class="dim" style="margin-left:6px">${esc(v.label)}</span>` : ''}</td>
              <td class="dim">${esc(showOr(v.fs))}</td>
              <td class="num right">${fmt(v.capGb)} GB</td>
              <td style="min-width:140px">
                <div class="num dim" style="font-size:var(--fs-xs);margin-bottom:4px">${fmt(v.usedGb)} / ${fmt(v.capGb)} GB · ${esc(t('dashboard.free'))} ${fmt(v.freeGb)}</div>
                <div class="bar"><i class="bar-fill${v.usedPct > 90 ? ' danger' : v.usedPct > 78 ? ' warn' : ''}" style="width:${v.capGb ? v.usedPct.toFixed(0) : 0}%"></i></div>
              </td>
            </tr>`).join('') : `<tr><td colspan="4"><div class="empty">${UI.icon('warn', 24)}<div class="et">${esc(t('na.noVolume'))}</div></div></td></tr>`}</tbody>
          </table>
        </section>

        <section class="card">
          ${cardHead('monitor.throughput', 'activity')}
          <div class="grid g-2 keep">
            <div class="metric"><div class="metric-label label">${esc(t('monitor.realRead'))}</div>
              <div class="metric-value num"><span data-live="diskRead" data-fmt="speed">0</span></div></div>
            <div class="metric"><div class="metric-label label">${esc(t('monitor.realWrite'))}</div>
              <div class="metric-value num"><span data-live="diskWrite" data-fmt="speed">0</span></div></div>
            <div class="metric"><div class="metric-label label">${esc(t('monitor.netDown'))}</div>
              <div class="metric-value num"><span data-live="netDown" data-fmt="speed">0</span></div></div>
            <div class="metric"><div class="metric-label label">${esc(t('monitor.netUp'))}</div>
              <div class="metric-value num"><span data-live="netUp" data-fmt="speed">0</span></div></div>
          </div>
          <div class="chart-box" style="height:96px;margin-top:14px">
            <canvas id="diskChart" class="spark" style="height:96px" role="img" aria-label="磁盘与网络吞吐趋势"></canvas>
          </div>
          <div class="flex gap-3" style="margin-top:10px">
            <span class="chip accent"><span class="d"></span>${esc(t('monitor.realRead'))}</span>
            <span class="chip info"><span class="d"></span>${esc(t('monitor.netDown'))}</span>
          </div>
        </section>
      </div>

      <section class="card">
        ${cardHead('monitor.smart', 'shieldCheck')}
        <div class="row-list">
          ${profile.disks.map(d => `<div class="row">
            <span class="row-main"><span class="row-t1">${esc(d.model)}</span>
            <span class="row-t2">${d.powerOn != null
              ? `${esc(t('monitor.powerOn'))} ${d.powerOn} · ${d.hours} h`
              : esc(t('na.noPowerOn'))}</span></span>
            ${d.health == null
              ? `<span class="chip warn">${UI.icon('warn', 12)}${esc(t('na.noSmart'))}</span>`
              : `<span class="chip ok"><span class="d"></span>${esc(t('monitor.good'))}</span>`}
          </div>`).join('')}
        </div>
      </section>
      </div>`;
    },
    battery() {
      const B = profile.battery;
      const st = batteryState();
      const stKey = st === 'charging' ? 'monitor.charging'
        : st === 'full' ? 'monitor.full'
          : st === 'none' ? 'monitor.noBattery'
            : st === 'unknown' ? 'common.unknown'
              : 'monitor.discharging';
      // 无电池机型（台式机 / 迷你主机）：明确说明，而不是摆一堆 0
      if (!B.present) {
        return `<section class="card">
          ${cardHead('monitor.tabBattery', 'battery')}
          <div class="empty" style="padding:var(--sp-7) var(--sp-5)">
            ${UI.icon('battery', 38)}
            <h2 style="font-size:var(--fs-xl)">${esc(t('na.noBattery'))}</h2>
            <p class="muted" style="max-width:46ch;line-height:1.7">${esc(t('monitor.noBatteryDesc'))}</p>
            <div class="flex gap-3 wrap" style="margin-top:var(--sp-4);justify-content:center">
              <span class="chip">${esc(showOr(profile.system && profile.system.chassis))}</span>
              <span class="chip info">${esc(showOr(profile.os && profile.os.name))}</span>
            </div>
          </div>
        </section>`;
      }
      const hasCap = B.designWh > 0;
      const health = hasCap ? Math.round(B.fullWh / B.designWh * 100) : null;
      const healthChipCls = health == null ? 'warn' : health >= 85 ? 'ok' : health >= 65 ? 'warn' : 'danger';
      return `<div class="split">
        <section class="card">
          ${cardHead('monitor.tabBattery', 'battery', `<span class="chip ${st === 'charging' ? 'ok' : 'info'}"><span class="d"></span>${esc(t(stKey))}</span>`)}
          <div class="flex center gap-5">
            ${UI.ring({ value: 0, max: 100, size: 148, thickness: 11, unit: '%', label: t('monitor.tabBattery') })}
            <div class="grow">
              <div class="label">${esc(t('dashboard.batHealth'))}</div>
              ${health == null
                ? `<div class="na-hint" style="margin-top:10px">${UI.icon('warn', 14)}${esc(t('na.unknown'))}</div>`
                : `<div class="score-big" style="font-size:var(--fs-4xl)">${health}<span class="score-den">%</span></div>
                   <div class="bar" style="margin-top:10px"><i class="bar-fill" style="width:${health}%"></i></div>`}
            </div>
          </div>
        </section>
        <section class="card">
          ${cardHead('monitor.batStatus', 'bolt', `<span class="chip ${healthChipCls}"><span class="d"></span>${hasCap ? esc(t('na.detected')) : esc(t('na.notSupported'))}</span>`)}
          <div class="kv">
            <dt>${esc(t('monitor.designCap'))}</dt><dd class="num">${hasCap ? B.designWh + ' Wh' : '—'}</dd>
            <dt>${esc(t('monitor.fullCap'))}</dt><dd class="num">${B.fullWh > 0 ? B.fullWh + ' Wh' : '—'}</dd>
            <dt>${esc(t('monitor.cycles'))}</dt><dd class="num">${B.cycles > 0 ? B.cycles : '—'}</dd>
            <dt>${esc(t('monitor.batTemp'))}</dt><dd class="num"><span data-live="batTemp" data-fmt="temp">—</span>${UI.tempUnit()}</dd>
            <dt>${esc(t('monitor.power'))}</dt><dd class="num"><span data-live="batPower" data-fmt="watt">—</span> W</dd>
          </div>
        </section>
      </div>`;
    }
  };

  /* ---------- 手机联动 ---------- */
  function viewLink() {
    const P = window.Monitor.phone;
    if (!P.connected) {
      return `<div class="content-inner">
        <section class="card" style="max-width:720px;margin:0 auto">
          <div class="empty" style="padding:var(--sp-7) var(--sp-5)">
            ${UI.icon('phoneLink', 44)}
            <h2 style="font-size:var(--fs-xl)">${esc(t('link.noDevice'))}</h2>
            <p class="muted" style="max-width:46ch;line-height:1.7">${esc(t('link.noDeviceDesc'))}</p>
            <div class="flex gap-3" style="margin-top:var(--sp-4)">
              <button class="btn primary" id="btnSimConnect">${UI.icon('phoneLink', 16)}${esc(t('link.rescan'))}</button>
              <button class="btn" id="btnSimWireless">${UI.icon('cloud', 16)}${esc(t('link.wireless'))}</button>
            </div>
          </div>
        </section>
      </div>`;
    }
    const apps = filteredApps();
    const tabs = `<div class="tabs">
      <button class="tab${ui.linkTab === 'apps' ? ' active' : ''}" data-ltab="apps">${esc(t('link.appMgmt'))}</button>
      <button class="tab${ui.linkTab === 'files' ? ' active' : ''}" data-ltab="files">${esc(t('link.fileMgmt'))}</button>
    </div>`;
    const head = `<section class="card" style="margin-bottom:16px">
      <div class="flex between wrap gap-4">
        <div class="flex center gap-4">
          <span style="width:46px;height:46px;display:grid;place-items:center;border-radius:var(--radius-md);background:var(--c-accent-soft);color:var(--c-accent)">${UI.icon('phoneLink', 26)}</span>
          <div>
            <div style="font-size:var(--fs-lg);font-weight:600">${esc(P.name)}</div>
            <div class="tnum dim" style="font-size:var(--fs-xs)">${esc(P.model)} · ${esc(P.android)}</div>
          </div>
          <span class="chip ok"><span class="d"></span>${esc(t('link.connected'))}</span>
        </div>
        <div class="flex center gap-4">
          <div style="text-align:right">
            <div class="label">${esc(t('link.storageInfo'))}</div>
            <div class="tnum" style="font-size:var(--fs-base)">${P.storage.usedGb} / ${P.storage.totalGb} GB</div>
          </div>
          <div style="width:110px"><div class="bar"><i class="bar-fill" style="width:${(P.storage.usedGb / P.storage.totalGb * 100).toFixed(0)}%"></i></div></div>
          <button class="btn danger sm" id="btnDisconnect">${UI.icon('close', 14)}${esc(t('link.disconnect'))}</button>
        </div>
      </div>
      <div class="grid g-4 keep" style="margin-top:16px">
        <div class="metric"><div class="metric-label label">${esc(t('link.serialNo'))}</div><div class="num" style="font-weight:600">${esc(P.serial)}</div></div>
        <div class="metric"><div class="metric-label label">${esc(t('link.connType'))}</div><div style="font-weight:600">${esc(P.link === 'usb' ? t('link.usb') : t('link.wireless'))}</div></div>
        <div class="metric"><div class="metric-label label">${esc(t('link.totalApps'))}</div><div class="num" style="font-weight:600">${P.apps.filter(a => !a.removed).length}</div></div>
        <div class="metric"><div class="metric-label label">${esc(t('link.androidVer'))}</div><div class="tnum" style="font-weight:600;font-size:var(--fs-sm)">${esc(P.android.split(' · ')[0])}</div></div>
      </div>
    </section>`;

    const appsPane = `<section class="card flush">
      <div class="card-head" style="padding:16px 16px 0;flex-wrap:wrap;gap:12px">
        <div class="search-wrap" style="flex:1;min-width:200px;max-width:340px">
          <span class="ico">${UI.icon('search', 15)}</span>
          <input class="input" id="appSearch" type="search" placeholder="${esc(t('link.searchApp'))}" value="${esc(ui.appQuery)}">
        </div>
        <div class="seg" id="appFilter">
          ${[['all', 'common.all'], ['sys', 'link.systemApp'], ['user', 'link.userApp'], ['frozen', 'link.frozen']].map(f =>
            `<button class="seg-item${ui.appFilter === f[0] ? ' active' : ''}" data-filter="${f[0]}">${esc(t(f[1]))}</button>`).join('')}
        </div>
      </div>
      <table class="table">
        <thead><tr>
          <th>${esc(t('link.appMgmt'))}</th><th>${esc(t('link.packageName'))}</th>
          <th class="right">${esc(t('link.sizeCol'))}</th><th class="center">${esc(t('link.risk'))}</th>
          <th class="right">${esc(t('common.apply'))}</th>
        </tr></thead>
        <tbody>${apps.map(appRow).join('') || `<tr><td colspan="5"><div class="empty">${UI.icon('search', 26)}<div class="et">${esc(t('common.na'))}</div></div></td></tr>`}</tbody>
      </table>
    </section>`;

    const filesPane = `<section class="card flush">
      <div class="card-head" style="padding:16px 16px 0">
        <div class="flex center gap-2 tnum" style="font-size:var(--fs-sm)">
          ${UI.icon('folder', 16)} <span class="muted">${esc(ui.phonePath.join('/').replace('//', '/'))}</span>
        </div>
        <button class="btn sm" id="btnNewFolder">${UI.icon('folder', 14)}${esc(t('link.fileMgmt'))}</button>
      </div>
      <div class="row-list" style="padding:8px 16px 16px">
        ${P.files.map((f, i) => `<div class="row" data-fid="${i}">
          <span style="color:${f.type === 'dir' ? 'var(--c-accent)' : 'var(--c-text-3)'}">${UI.icon(f.type === 'dir' ? 'folder' : 'file', 18)}</span>
          <span class="row-main"><span class="row-t1">${esc(f.name)}</span>
            <span class="row-t2">${esc(f.modified)}</span></span>
          <span class="tnum dim" style="font-size:var(--fs-xs)">${esc(f.size)}</span>
          <span class="row-actions">
            ${f.type === 'file' ? `<button class="btn ghost sm" data-fact="download" data-fid="${i}" title="${esc(t('link.download'))}">${UI.icon('download', 14)}</button>` : ''}
            <button class="btn ghost sm" data-fact="delete" data-fid="${i}" title="${esc(t('link.delete'))}">${UI.icon('trash', 14)}</button>
          </span>
        </div>`).join('')}
      </div>
    </section>`;

    return `<div class="content-inner">${head}${tabs}${ui.linkTab === 'apps' ? appsPane : filesPane}</div>`;
  }

  function filteredApps() {
    const P = window.Monitor.phone;
    const q = ui.appQuery.toLowerCase();
    return P.apps.filter(a => {
      if (ui.appFilter === 'sys' && a.kind !== 'sys') return false;
      if (ui.appFilter === 'user' && a.kind !== 'user') return false;
      if (ui.appFilter === 'frozen' && !a.frozen) return false;
      if (a.removed && ui.appFilter !== 'frozen') return false;
      if (q && !(a.name.toLowerCase().includes(q) || a.pkg.toLowerCase().includes(q))) return false;
      return true;
    });
  }

  function appRow(a) {
    const riskCls = a.risk === 'danger' ? 'danger' : a.risk === 'warn' ? 'warn' : 'ok';
    const riskTxt = a.risk === 'danger' ? 'link.riskDanger' : a.risk === 'warn' ? 'link.riskWarn' : 'link.riskSafe';
    return `<tr>
      <td><div class="flex center gap-2">
        <span class="chip ${a.kind === 'sys' ? '' : 'accent'}" style="min-width:0">${esc(a.kind === 'sys' ? t('link.systemApp') : t('link.userApp'))}</span>
        <span>${esc(a.name)}</span>${a.frozen ? ` <span class="chip warn" style="margin-left:2px">${esc(t('link.frozen'))}</span>` : ''}
      </div></td>
      <td class="tnum dim">${esc(a.pkg)}</td>
      <td class="num right">${UI.mb(a.sizeMb)}</td>
      <td class="center"><span class="chip ${riskCls}"><span class="d"></span>${esc(t(riskTxt))}</span></td>
      <td class="right"><div class="flex gap-1" style="justify-content:flex-end">
        ${a.frozen ? `<button class="btn ghost sm" data-app="${a.id}" data-act="restore">${UI.icon('restore', 14)}${esc(t('link.restore'))}</button>`
        : `<button class="btn ghost sm" data-app="${a.id}" data-act="freeze" title="${esc(t('link.freeze'))}">${UI.icon('snow', 14)}</button>
           <button class="btn danger sm" data-app="${a.id}" data-act="uninstall" title="${esc(t('link.uninstall'))}">${UI.icon('trash', 14)}</button>`}
      </div></td>
    </tr>`;
  }

  /* ---------- 搞机工具 ---------- */
  function viewTools() {
    const tabs = [
      ['bench', 'tools.tabBench', 'speed'], ['sensors', 'tools.tabSensors', 'activity'],
      ['startup', 'tools.tabStartup', 'power'], ['drivers', 'tools.tabDrivers', 'server']
    ];
    return `<div class="content-inner">
      <div class="tabs">${tabs.map(x => `<button class="tab${ui.toolsTab === x[0] ? ' active' : ''}" data-ttab="${x[0]}">${esc(t(x[1]))}</button>`).join('')}</div>
      <div id="toolsPane">${TOOLS_PANES[ui.toolsTab]()}</div>
    </div>`;
  }

  const TOOLS_PANES = {
    bench() {
      const b = ui.bench;
      const s = b.scores;
      return `<div class="split">
        <section class="card bracket">
          ${cardHead('tools.benchmark', 'speed', `<span class="chip ${b.running ? 'accent' : ''}">${b.running ? esc(t('tools.running')) : esc(t('tools.lastRun'))}</span>`)}
          <div class="score-hero">
            <div>
              <div class="label">${esc(t('tools.totalScore'))}</div>
              <div class="score-big">${s ? s.total.toLocaleString() : '— — —'}</div>
              <div class="score-den">${esc(t('tools.perfTier'))}: ${s ? tierOf(s.total) : '—'}</div>
            </div>
            <div class="grow grid g-2" style="gap:12px">
              <div class="score-item"><div class="label">${esc(t('tools.single'))}</div><div class="sv num">${s ? s.single : '—'}</div></div>
              <div class="score-item"><div class="label">${esc(t('tools.multi'))}</div><div class="sv num">${s ? s.multi : '—'}</div></div>
              <div class="score-item"><div class="label">${esc(t('tools.graphic'))}</div><div class="sv num">${s ? s.graphic : '—'}</div></div>
              <div class="score-item"><div class="label">${esc(t('tools.memoryScore'))}</div><div class="sv num">${s ? s.memory : '—'}</div></div>
            </div>
          </div>
          <div id="benchBarBox" style="margin-top:16px" ${b.running ? '' : 'hidden'}>
            <div class="flex between" style="margin-bottom:6px"><span class="label">${esc(t('tools.running'))}</span><span class="num" id="benchPct">0%</span></div>
            <div class="scanline"></div>
          </div>
          <div class="flex gap-3" style="margin-top:18px">
            <button class="btn primary" id="btnBench" ${b.running ? 'disabled' : ''}>
              ${UI.icon('play', 16)}${esc(s ? t('tools.benchAgain') : t('tools.runBench'))}</button>
            <button class="btn ghost" id="btnBenchClear">${esc(t('common.reset'))}</button>
          </div>
        </section>
        <section class="card">
          ${cardHead('tools.benchHistory', 'activity', `<span class="card-sub">${ui.bench.history.length} ${esc(t('common.items'))}</span>`)}
          ${ui.bench.history.length ? `<div class="row-list">${ui.bench.history.map(h => `<div class="row">
            <span class="row-main"><span class="row-t1 num" style="font-size:var(--fs-lg)">${h.total.toLocaleString()}</span>
              <span class="row-t2">${esc(h.time)}</span></span>
            <span class="chip">${esc(tierOf(h.total))}</span>
          </div>`).join('')}</div>`
          : `<div class="empty">${UI.icon('activity', 30)}<div class="et">${esc(t('common.na'))}</div></div>`}
        </section>
      </div>`;
    },
    sensors() {
      const list = window.Monitor.sensors || [];
      const caps = (window.NativeBridge && window.NativeBridge.caps) || {};
      const isWin = !caps.platform || caps.platform === 'windows';
      // 未装 LibreHardwareMonitor 时 Windows 只能拿到很少的传感器，
      // 在表格下方补一句说明，避免用户以为采集坏了。
      const hint = (list.length && isWin && !caps.libreHardwareMonitor)
        ? `<div class="na-hint" style="padding:12px 16px 16px">${UI.icon('warn', 13)}${esc(t('tools.sensorHintWin'))}</div>`
        : '';
      return `<section class="card flush">
        <div style="padding:16px 16px 0">${cardHead('tools.tabSensors', 'activity', `<span class="card-sub">${list.length} ${esc(t('common.items'))}</span>`)}</div>
        ${list.length ? `<table class="table">
          <thead><tr>
            <th>${esc(t('tools.sensorName'))}</th><th>${esc(t('tools.sensorType'))}</th>
            <th class="right">${esc(t('tools.sensorValue'))}</th>
            <th class="right">${esc(t('tools.sensorMin'))}</th><th class="right">${esc(t('tools.sensorMax'))}</th>
          </tr></thead>
          <tbody id="sensorsBody">${sensorRows()}</tbody>
        </table>${hint}` : `<div class="empty" style="padding:var(--sp-7) var(--sp-4)">
          ${UI.icon('temp', 38)}
          <h2 style="font-size:var(--fs-lg)">${esc(t('tools.noSensors'))}</h2>
          <p class="muted" style="max-width:52ch;line-height:1.7">${esc(isWin ? t('tools.noSensorsWin') : t('tools.noSensorsMobile'))}</p>
        </div>`}
      </section>`;
    },
    startup() {
      const list = window.Monitor.startup || [];
      const srcKey = k => k === 'folder' ? 'tools.srcFolder' : k === 'task' ? 'tools.srcTask' : 'tools.srcRegistry';
      return `<section class="card flush">
        <div style="padding:16px 16px 0">${cardHead('tools.tabStartup', 'power',
          `<span class="card-sub">${list.length} ${esc(t('common.items'))}${window.Monitor.native ? ' · ' + esc(t('source.native')) : ' · ' + esc(t('source.demo'))}</span>`)}</div>
        <table class="table">
          <thead><tr>
            <th>${esc(t('tools.startupName'))}</th><th>${esc(t('tools.publisher'))}</th>
            <th>${esc(t('tools.startType'))}</th><th class="right">${esc(t('tools.status'))}</th>
          </tr></thead>
          <tbody id="startupBody">${list.length ? list.map(s => `<tr>
            <td><div class="flex center gap-2">${UI.icon(s.kind === 'folder' ? 'folder' : s.kind === 'task' ? 'gear' : 'server', 14)}<span>${esc(s.name)}</span></div></td>
            <td class="dim">${esc(showOr(s.publisher))}</td>
            <td><span class="chip">${esc(t(srcKey(s.kind)))}</span></td>
            <td class="right">${s.stateKnown === false
              ? `<span class="chip">${esc(t('common.unknown'))}</span>`
              : `<span class="chip ${s.disabled ? 'warn' : 'ok'}"><span class="d"></span>${esc(s.disabled ? t('common.disabled') : t('common.enabled'))}</span>`}</td>
          </tr>`).join('') : `<tr><td colspan="4"><div class="empty">${UI.icon('power', 24)}<div class="et">${esc(t('common.na'))}</div></div></td></tr>`}</tbody>
        </table>
      </section>`;
    },
    drivers() {
      const B = profile.board;
      const sys = profile.system || {};
      const drivers = window.Monitor.drivers || [];
      // 固件信息只展示**真实采集到的**项。
      // 曾经这里写死了 ME 版本号（16.1.30.2264）与永远为「—」的 EC 版本，
      // 那是伪造内容，已删除。消费级主板的 EC / ME 版本在 Windows 用户态
      // 根本读不到，读不到就不展示，而不是编一个。
      const fw = [
        { l: t('tools.biosVersion'), v: B.bios, d: profile.biosDate },
        { l: t('monitor.biosVendor'), v: B.biosVendor, d: '' },
        { l: t('monitor.boardModel'), v: jn(B.vendor, B.model), d: B.serial ? `SN ${B.serial}` : '' },
        { l: t('monitor.machineType'), v: sys.chassis, d: jn(sys.manufacturer, sys.model) },
        { l: t('monitor.memTotal'), v: profile.mem.totalGb ? profile.mem.totalGb + ' GB' : '', d: jd(profile.mem.type, profile.mem.speedMhz ? profile.mem.speedMhz + ' MT/s' : '') }
      ].filter(f => f.v && f.v !== '—');
      return `<div class="stack">
        <div class="grid g-3">
          ${fw.map(f => `<div class="card">
            <div class="label">${esc(f.l)}</div>
            <div class="num" style="font-size:var(--fs-xl);font-weight:600;margin-top:6px;overflow-wrap:anywhere">${esc(f.v)}</div>
            <div class="dim" style="font-size:var(--fs-xs);margin-top:4px">${esc(f.d || '')}</div>
          </div>`).join('')}
        </div>
        <section class="card flush">
          <div style="padding:16px 16px 0">${cardHead('tools.tabDrivers', 'server',
            `<span class="card-sub">${drivers.length} ${esc(t('common.items'))}${window.Monitor.native ? ' · ' + esc(t('source.native')) : ' · ' + esc(t('source.demo'))}</span>`)}</div>
          <table class="table">
            <thead><tr>
              <th>${esc(t('tools.driverDevice'))}</th><th>${esc(t('tools.driverVendor'))}</th>
              <th class="right">${esc(t('tools.driverVer'))}</th><th class="right">${esc(t('tools.driverDate'))}</th>
            </tr></thead>
            <tbody>${drivers.length ? drivers.map(d => `<tr>
              <td>${esc(d.device)}</td><td class="dim">${esc(showOr(d.vendor))}</td>
              <td class="num right">${esc(showOr(d.ver))}</td><td class="num right dim">${esc(showOr(d.date))}</td>
            </tr>`).join('') : `<tr><td colspan="4"><div class="empty">${UI.icon('warn', 24)}<div class="et">${esc(t('na.notSupported'))}</div></div></td></tr>`}</tbody>
          </table>
        </section>
      </div>`;
    }
  };

  function tierOf(score) {
    if (score >= 80000) return 'S · 旗舰';
    if (score >= 60000) return 'A · 高端';
    if (score >= 40000) return 'B · 主流';
    return 'C · 入门';
  }

  /* 6 套配色的元数据（设置页与引导页共用色卡） */
  const COLORS = [
    { id: 'dark', key: 'color.dark', d: 'color.darkD', sw: 'linear-gradient(135deg,#1a1e26 55%,#2ee08a 55%)' },
    { id: 'light-green', key: 'color.lightGreen', d: 'color.lightGreenD', sw: 'linear-gradient(135deg,#ffffff 55%,#0b8f4f 55%)' },
    { id: 'cyber', key: 'color.cyber', d: 'color.cyberD', sw: 'linear-gradient(135deg,#17172b 55%,#00e5ff 55%)' },
    { id: 'ember', key: 'color.ember', d: 'color.emberD', sw: 'linear-gradient(135deg,#241f1a 55%,#ff8a3d 55%)' },
    { id: 'ice', key: 'color.ice', d: 'color.iceD', sw: 'linear-gradient(135deg,#ffffff 55%,#1668dc 55%)' },
    { id: 'sand', key: 'color.sand', d: 'color.sandD', sw: 'linear-gradient(135deg,#fffdf7 55%,#a86f1f 55%)' }
  ];

  /* ---------- 设置 ---------- */
  function viewSettings() {
    const S = Store.state;
    const isMobile = Store.isMobile();
    const styleOpt = [['geek', 'style.geek'], ['minimal', 'style.minimal'], ['apple', 'style.apple']];
    const refreshOpt = [[500, 'settings.r05'], [1000, 'settings.r1'], [2000, 'settings.r2'], [0, 'settings.rPause']];
    const unitOpt = [['c', 'settings.celsius'], ['f', 'settings.fahrenheit']];

    const colorCards = COLORS.map(c => `
      <button class="choice${S.theme === c.id ? ' active' : ''}" data-theme-val="${c.id}" type="button" style="min-height:auto">
        <div class="ch-t"><span>${esc(t(c.key))}</span><span class="tick"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><path d="M4 12.5l5 5L20 6.5"/></svg></span></div>
        <div class="preview" data-theme="${c.id}" data-style="geek">
          <span class="sw" style="background:${c.sw}"></span>
          <span class="lines"><span class="ln a"></span><span class="ln b"></span></span>
        </div>
        <div class="ch-d">${esc(t(c.d))}</div>
      </button>`).join('');

    return `<div class="content-inner stack" style="max-width:1000px">

      <section class="card">
        ${cardHead('settings.appearance', 'grid')}
        <div style="margin-bottom:6px">
          <div class="set-t">${esc(t('settings.colorScheme'))}</div>
          <div class="set-d">${esc(t('ob.colorSub'))}</div>
        </div>
        <div class="choice-grid three">${colorCards}</div>

        <div class="set-row" style="margin-top:var(--sp-5)">
          <div><div class="set-t">${esc(t('settings.style'))}</div><div class="set-d">${esc(t('ob.styleSub'))}</div></div>
          <div class="set-c">${isMobile
            ? `<span class="chip accent">${esc(t('style.geek'))}</span>`
            : `<div class="seg" id="setStyle">
                 ${styleOpt.map(o => `<button class="seg-item${S.style === o[0] ? ' active' : ''}" data-val="${o[0]}">${esc(t(o[1]))}</button>`).join('')}
               </div>`}</div>
        </div>
        <div class="set-row">
          <div><div class="set-t">${esc(t('settings.language'))}</div><div class="set-d">Language</div></div>
          <div class="set-c"><div class="seg" id="setLang">
            <button class="seg-item${S.lang === 'zh' ? ' active' : ''}" data-val="zh">简体中文</button>
            <button class="seg-item${S.lang === 'en' ? ' active' : ''}" data-val="en">English</button>
          </div></div>
        </div>
      </section>

      <section class="card">
        ${cardHead('settings.monitoring', 'activity')}
        <div class="set-row">
          <div><div class="set-t">${esc(t('settings.refreshRate'))}</div><div class="set-d">${esc(t('topbar.samplesPerSec'))} 1 / ${Math.max(1, Math.round(1000 / (S.refresh || 1000))) || '—'} s</div></div>
          <div class="set-c"><div class="seg" id="setRefresh">
            ${refreshOpt.map(o => `<button class="seg-item${S.refresh === o[0] ? ' active' : ''}" data-val="${o[0]}">${esc(t(o[1]))}</button>`).join('')}
          </div></div>
        </div>
        <div class="set-row">
          <div><div class="set-t">${esc(t('settings.temperatureUnit'))}</div></div>
          <div class="set-c"><div class="seg" id="setUnit">
            ${unitOpt.map(o => `<button class="seg-item${S.unit === o[0] ? ' active' : ''}" data-val="${o[0]}">${esc(t(o[1]))}</button>`).join('')}
          </div></div>
        </div>
        <div class="set-row">
          <div><div class="set-t">${esc(t('settings.showPower'))}</div><div class="set-d">${esc(t('dashboard.overallPower'))}</div></div>
          <div class="set-c"><button class="switch" role="switch" aria-checked="${S.showPower}" data-sw="showPower" aria-label="${esc(t('settings.showPower'))}"></button></div>
        </div>
        <div class="set-row">
          <div><div class="set-t">${esc(t('settings.showFan'))}</div><div class="set-d">${esc(t('dashboard.cpuFan'))}</div></div>
          <div class="set-c"><button class="switch" role="switch" aria-checked="${S.showFan}" data-sw="showFan" aria-label="${esc(t('settings.showFan'))}"></button></div>
        </div>
      </section>

      <section class="card">
        ${cardHead('settings.data', 'download')}
        <div class="set-row">
          <div><div class="set-t">${esc(t('settings.exportData'))}</div><div class="set-d">JSON · ${esc(t('settings.deviceReport'))}</div></div>
          <div class="set-c"><button class="btn" id="btnExport">${UI.icon('download', 15)}${esc(t('settings.exportData'))}</button></div>
        </div>
        <div class="set-row" style="border-bottom:none">
          <div><div class="set-t" style="color:var(--st-danger)">${esc(t('settings.resetAll'))}</div><div class="set-d">${esc(t('settings.dangerZone'))}</div></div>
          <div class="set-c"><button class="btn danger" id="btnReset">${UI.icon('refresh', 15)}${esc(t('settings.resetAll'))}</button></div>
        </div>
      </section>

      <section class="card">
        ${cardHead('settings.about', 'shieldCheck')}
        <div class="flex center gap-4 wrap" style="margin-bottom:16px">
          <img src="assets/logo-mark.png" alt="Geek Space"
               style="width:64px;height:64px;border-radius:var(--radius-md);display:block;box-shadow:var(--shadow-1)">
          <div>
            <div style="font-size:var(--fs-lg);font-weight:var(--font-weight-strong)">极客空间 · Geek Space</div>
            <div class="tnum dim" style="font-size:var(--fs-xs)">v0.2.0 · ${esc(t('settings.buildChannel'))}: win-x64 / android-arm64</div>
          </div>
        </div>
        <p class="muted" style="line-height:1.7;margin-bottom:16px">${esc(t('settings.aboutDesc'))}</p>
        <div class="flex gap-3 wrap">
          <button class="btn" id="btnOnboard">${UI.icon('refresh', 15)}${esc(t('settings.runOnboard'))}</button>
          <span class="chip">MIT License</span>
          <span class="chip">${esc(t('settings.license'))}: ${esc(t('common.na'))}</span>
        </div>
      </section>

    </div>`;
  }

  /* ============================================================
     视图挂载与实时绑定
     ============================================================ */
  function mountView() {
    sparkCanvases = [];
    updaters = [];

    if (ui.view === 'dashboard') {
      const c1 = $('#trendChart');
      if (c1) sparkCanvases.push(() => {
        const p = palette();
        // 功耗按 500W 归一化到 0-100，与其余百分比曲线共用纵轴
        const powerNorm = window.Monitor.history.power.map(v => Math.min(100, (v || 0) / 5));
        UI.drawMultiSpine(c1, [
          { data: window.Monitor.history.cpu, color: p.accent, width: 2.0 },
          { data: window.Monitor.history.gpu, color: p.info, width: 1.6 },
          { data: window.Monitor.history.mem, color: p.warn, width: 1.4, dash: [4, 3] },
          { data: powerNorm, color: p.accent2, width: 1.3 }
        ], { max: 100 });
      });
      updaters.push(() => {
        const L = window.Monitor.live;
        const chip = $('#loadChip');
        if (chip) chip.textContent = t('dashboard.' + L.load);
        const p = palette();
        $$('.metric .gauge').forEach((g, i) => {
          const val = g.querySelector('.gv'); const arc = g.querySelector('.gauge-val');
          const r = Number(arc.getAttribute('r')); const c = 2 * Math.PI * r;
          const cfg = [[L.cpuUsage, p.accent], [L.cpuTemp, p.warn], [L.gpuUsage, p.info], [L.memPercent, p.warn]][i];
          if (!cfg) return;
          const v = cfg[0];
          // GPU 等读数可能整体缺失（GeForce 老卡不开放查询）：
          // 这时把环留空并显示「—」，而不是画成 0%
          if (v === null || v === undefined || !isFinite(v)) {
            arc.setAttribute('stroke-dashoffset', c.toFixed(2));
            if (val) val.textContent = '—';
            return;
          }
          arc.setAttribute('stroke-dashoffset', (c * (1 - Math.min(1, v / 100))).toFixed(2));
          arc.setAttribute('stroke', cfg[1]);
          if (val) val.textContent = i === 1 ? UI.tempVal(v) : Math.round(v);
        });
        // 整机功耗环
        const heroG = $('.card.bracket .gauge');
        if (heroG) {
          const arc = heroG.querySelector('.gauge-val');
          const r = Number(arc.getAttribute('r')); const c = 2 * Math.PI * r;
          arc.setAttribute('stroke-dashoffset', (c * (1 - Math.min(1, L.systemPower / 800))).toFixed(2));
          const gv = heroG.querySelector('.gv'); if (gv) gv.textContent = Math.round(L.systemPower);
        }
        // 功耗分解条
        const b1 = $('[data-bar="cpuPowerRaw"]'); if (b1) b1.style.width = Math.min(100, L.cpuPower / 200 * 100) + '%';
        const b2 = $('[data-bar="gpuPowerRaw"]'); if (b2) b2.style.width = Math.min(100, (L.gpuPower || 0) / 350 * 100) + '%';
        const b3 = $('[data-bar="diskReadRaw"]'); if (b3) b3.style.width = Math.min(100, (L.diskRead || 0) / 3000 * 100) + '%';
      });
    }

    if (ui.view === 'monitor') {
      const pane = $('#monitorPane');
      const tab = ui.monitorTab;
      if (pane && (tab === 'cpu' || tab === 'gpu')) {
        updaters.push(() => {
          const L = window.Monitor.live; const p = palette();
          const cfg = tab === 'gpu'
            ? [[L.gpuUsage, p.info], [L.gpuTemp, p.warn]]
            : [[L.cpuUsage, p.accent], [L.cpuTemp, p.warn]];
          $$('.gauge', pane).forEach((g, i) => {
            if (!cfg[i]) return;
            const arc = g.querySelector('.gauge-val'); const gv = g.querySelector('.gv');
            const r = Number(arc.getAttribute('r')); const c = 2 * Math.PI * r;
            const v = cfg[i][0];
            if (v === null || v === undefined || !isFinite(v)) {
              // 读不到真实读数就把圆环留空并显示「—」，
              // 不要把「查询不到」画成「0%」
              arc.setAttribute('stroke-dashoffset', c.toFixed(2));
              if (gv) gv.textContent = '—';
              return;
            }
            arc.setAttribute('stroke-dashoffset', (c * (1 - Math.min(1, v / 100))).toFixed(2));
            arc.style.stroke = cfg[i][1];
            if (gv) gv.textContent = i === 1 ? UI.tempVal(v) : Math.round(v);
          });
        });
      } else if (pane && tab === 'battery') {
        updaters.push(() => {
          const g = $('.gauge', pane);
          if (!g) return;
          const arc = g.querySelector('.gauge-val'); const gv = g.querySelector('.gv');
          const r = Number(arc.getAttribute('r')); const c = 2 * Math.PI * r;
          const lvl = batteryLevel();
          if (lvl === null || lvl === undefined || !isFinite(lvl)) {
            arc.setAttribute('stroke-dashoffset', c.toFixed(2));
            if (gv) gv.textContent = '—';
            return;
          }
          arc.setAttribute('stroke-dashoffset', (c * (1 - Math.min(1, lvl / 100))).toFixed(2));
          if (gv) gv.textContent = Math.round(lvl);
        });
      } else if (pane && tab === 'storage') {
        const dc = $('#diskChart');
        if (dc) sparkCanvases.push(() => {
          const p = palette();
          const io = window.Monitor.history.io, net = window.Monitor.history.net;
          const peak = Math.max(400, Math.max.apply(null, io.concat(net)) * 1.25);
          UI.drawMultiSpine(dc, [
            { data: io, color: p.accent, width: 1.8 },
            { data: net, color: p.info, width: 1.4, dash: [4, 3] }
          ], { max: peak });
        });
      } else if (pane && tab === 'battery') {
        const g = $('.gauge', pane);
        if (g) updaters.push(() => {
          const arc = g.querySelector('.gauge-val'); const gv = g.querySelector('.gv');
          const r = Number(arc.getAttribute('r')); const c = 2 * Math.PI * r;
          const v = batteryLevel();
          arc.setAttribute('stroke-dashoffset', (c * (1 - Math.min(1, v / 100))).toFixed(2));
          if (gv) gv.textContent = Math.round(v);
        });
      }
    }

    if (ui.view === 'tools' && ui.toolsTab === 'bench') {
      /* 跑分按钮绑定在 bindEvents 中处理 */
    }
  }

  /* ============================================================
     事件绑定
     ============================================================ */
  function bindEvents() {
    /* 导航（[data-nav] / [data-navtab]）为常驻节点，改用一次性事件委托，
       见 installNavDelegation()，避免每次渲染重复绑定。此处只绑定内容区内节点。 */

    /* 监控页签 */
    $$('[data-mtab]').forEach(b => b.addEventListener('click', () => {
      ui.monitorTab = b.getAttribute('data-mtab'); persistUI(); renderAll();
    }));
    /* 手机联动页签 */
    $$('[data-ltab]').forEach(b => b.addEventListener('click', () => {
      ui.linkTab = b.getAttribute('data-ltab'); persistUI(); renderAll();
    }));
    /* 工具页签 */
    $$('[data-ttab]').forEach(b => b.addEventListener('click', () => {
      ui.toolsTab = b.getAttribute('data-ttab'); persistUI(); renderAll();
    }));

    /* 连接手机 */
    const bc = $('#btnSimConnect'); if (bc) bc.addEventListener('click', () => {
      window.Monitor.connectPhone(true);
      UI.toast(t('toast.connected'), 'ok'); syncNav(); render();
    });
    const bw = $('#btnSimWireless'); if (bw) bw.addEventListener('click', () => {
      window.Monitor.connectPhone(true); window.Monitor.phone.link = 'wireless';
      UI.toast(t('toast.connected'), 'ok'); syncNav(); render();
    });
    const bd = $('#btnDisconnect'); if (bd) bd.addEventListener('click', () => {
      window.Monitor.connectPhone(false); UI.toast(t('toast.disconnected'), 'warn'); syncNav(); render();
    });

    /* 应用搜索 / 筛选 */
    const search = $('#appSearch');
    if (search) search.addEventListener('input', e => {
      ui.appQuery = e.target.value;
      const pos = e.target.selectionStart;
      render();
      const s2 = $('#appSearch'); if (s2) { s2.focus(); s2.setSelectionRange(pos, pos); }
    });
    $$('[data-filter]').forEach(b => b.addEventListener('click', () => {
      ui.appFilter = b.getAttribute('data-filter'); persistUI(); render();
    }));
    $$('[data-app]').forEach(b => b.addEventListener('click', () => {
      const id = Number(b.getAttribute('data-app'));
      const act = b.getAttribute('data-act');
      const app = window.Monitor.phoneAction(id, act);
      if (app) {
        if (act === 'uninstall') UI.toast(t('toast.uninstalled', { name: app.name }), 'warn');
        else if (act === 'freeze') UI.toast(t('toast.frozen', { name: app.name }), 'warn');
        else UI.toast(t('toast.restored', { name: app.name }), 'ok');
        render();
      }
    }));
    $$('[data-fact]').forEach(b => b.addEventListener('click', () => {
      const act = b.getAttribute('data-fact');
      if (act === 'delete') {
        const i = Number(b.getAttribute('data-fid'));
        window.Monitor.phone.files.splice(i, 1);
        render();
      } else {
        UI.toast(t('toast.notAvailable'), 'warn');
      }
    }));
    const nf = $('#btnNewFolder'); if (nf) nf.addEventListener('click', () => UI.toast(t('toast.notAvailable'), 'warn'));

    /* 跑分 */
    const bb = $('#btnBench'); if (bb) bb.addEventListener('click', runBench);
    const bbc = $('#btnBenchClear'); if (bbc) bbc.addEventListener('click', () => {
      ui.bench = { running: false, progress: 0, scores: null, history: [] }; persistUI(); render();
    });

    /* 启动项：状态为只读展示。
       原先那个开关只是改内存里的布尔值、对系统毫无影响，属于误导性控件，
       已移除。真正启停启动项要写注册表 StartupApproved，且 HKLM 项需要
       管理员权限 —— 那是系统级改动，不在本次范围内。 */

    /* 设置：色彩风格（6 套，卡片式） */
    $$('[data-theme-val]').forEach(b => b.addEventListener('click', () => {
      const val = b.getAttribute('data-theme-val');
      Store.set({ theme: val }, 'theme');
      $$('[data-theme-val]').forEach(x => x.classList.toggle('active', x === b));
      render(); mountView(); refreshLive();
      UI.toast(t('color.' + ({
        'dark': 'dark', 'light-green': 'lightGreen', 'cyber': 'cyber',
        'ember': 'ember', 'ice': 'ice', 'sand': 'sand'
      }[val] || 'dark')), 'ok');
    }));
    /* 设置：视觉风格 */
    $$('#setStyle [data-val]').forEach(b => b.addEventListener('click', () => {
      Store.set({ style: b.getAttribute('data-val') }, 'style'); render();
    }));
    /* 设置：语言 */
    $$('#setLang [data-val]').forEach(b => b.addEventListener('click', () => {
      Store.set({ lang: b.getAttribute('data-val') }, 'lang'); renderAll();
    }));
    /* 设置：刷新率 */
    $$('#setRefresh [data-val]').forEach(b => b.addEventListener('click', () => {
      const ms = Number(b.getAttribute('data-val'));
      Store.set({ refresh: ms }, 'refresh');
      applyRate(); render();
    }));
    /* 设置：温度单位 */
    $$('#setUnit [data-val]').forEach(b => b.addEventListener('click', () => {
      Store.set({ unit: b.getAttribute('data-val') }, 'unit'); render(); mountView(); refreshLive();
    }));
    /* 设置：开关 */
    $$('[data-sw]').forEach(b => b.addEventListener('click', () => {
      const k = b.getAttribute('data-sw');
      const v = !Store.state[k];
      b.setAttribute('aria-checked', String(v));
      Store.set({ [k]: v }, 'switch');
    }));
    /* 设置：导出 / 重置 / 引导 */
    const be = $('#btnExport'); if (be) be.addEventListener('click', exportReport);
    const br = $('#btnReset'); if (br) br.addEventListener('click', () => {
      if (window.confirm(t('settings.resetConfirm'))) {
        Store.reset();
        UI.toast(t('toast.settingsReset'), 'ok');
        startOnboarding(true);
      }
    });
    const bo = $('#btnOnboard'); if (bo) bo.addEventListener('click', () => startOnboarding(true));
  }

  function runBench() {
    if (ui.bench.running) return;
    ui.bench.running = true; ui.bench.progress = 0; ui.bench.scores = null;
    render();
    const box = $('#benchBarBox'); if (box) box.hidden = false;
    const pctEl = $('#benchPct');
    benchTimer = setInterval(() => {
      ui.bench.progress = Math.min(100, ui.bench.progress + 3 + Math.random() * 5);
      if (pctEl) pctEl.textContent = Math.round(ui.bench.progress) + '%';
      if (ui.bench.progress >= 100) {
        clearInterval(benchTimer); benchTimer = null;
        const P = profile;
        const multi = Math.round(P.cpu.threads * 720 + P.cpu.boost * 1400 + Math.random() * 900);
        const single = Math.round(P.cpu.boost * 430 + 900 + Math.random() * 120);
        const graphic = Math.round(P.gpu.tdp * 118 + P.gpu.vram * 320 + Math.random() * 700);
        const memory = Math.round(P.mem.speedMhz * 4.6 + P.mem.totalGb * 46 + Math.random() * 500);
        const total = single + multi + graphic + memory;
        ui.bench.running = false;
        ui.bench.scores = { single, multi, graphic, memory, total };
        ui.bench.history.unshift({ total, time: new Date().toLocaleString() });
        ui.bench.history = ui.bench.history.slice(0, 6);
        persistUI();
        UI.toast(t('toast.benchDone', { score: total.toLocaleString() }), 'ok');
        render();
      }
    }, 90);
  }

  function exportReport() {
    const data = {
      app: 'Geek Space', version: '0.1.0-prototype', exportedAt: new Date().toISOString(),
      device: profile, live: window.Monitor.live, sensors: window.Monitor.sensors, drivers: window.Monitor.drivers
    };
    try {
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `geek-space-report-${Date.now()}.json`;
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 4000);
      UI.toast(t('settings.exportOk'), 'ok');
    } catch (e) { UI.toast(t('toast.notAvailable'), 'warn'); }
  }

  /* ============================================================
     路由
     ============================================================ */
  function go(view) {
    if (!VIEWS[view]) return;
    ui.view = view; persistUI();
    $('#content').scrollTop = 0;
    renderAll();
    closeDrawer();
  }

  function render() {
    const content = $('#content');
    content.innerHTML = VIEWS[ui.view]();
    window.I18N.apply(content);
    window.I18N.apply(document);
    updateChrome();
    mountView();
    bindEvents();
    playReveal(content);
    updateNavActive();
  }

  function renderAll() {
    render();
    refreshLive();
  }

  function updateNavActive() {
    $$('[data-nav]').forEach(b => b.classList.toggle('active', b.getAttribute('data-nav') === ui.view));
    $$('[data-navtab]').forEach(b => b.classList.toggle('active', b.getAttribute('data-navtab') === ui.view));
  }

  function playReveal(root) {
    const items = $$('.content-inner > *', root || document);
    items.forEach(el => el.classList.add('reveal'));
    requestAnimationFrame(() => items.forEach(el => el.classList.add('in')));
  }

  function updateChrome() {
    const nav = NAV.find(n => n.id === ui.view);
    $('#viewTitle').textContent = t(nav.key);
    $('#viewSub').textContent = t('navsub.' + ui.view);
    $('#brandName').innerHTML = window.I18N.lang === 'zh'
      ? '极客空间<span class="en">Geek Space</span>' : 'Geek Space<span class="en">极客空间</span>';
    $('#hostNameTxt').textContent = profile.host;
    $('#hostOsTxt').textContent = profile.os.name;
    $('#btnLang').querySelector('.lbl').textContent = window.I18N.lang === 'zh' ? '中' : 'EN';
    document.title = (window.I18N.lang === 'zh' ? '极客空间' : 'Geek Space') + ' · ' + (window.I18N.lang === 'zh' ? 'Geek Space' : '极客空间');
  }

  function updateStatusbar() {
    const L = window.Monitor.live, P = profile;
    // 顶栏「实时 / 已暂停 / 原生采集」标识。
    // 必须每秒校正：顶栏 HTML 里该节点带 data-i18n，renderAll() 的统一
    // i18n 刷新会把它重置回静态文案，因此不能只靠 applyRate 设一次。
    const chip = $('#liveChip'), chipTxt = $('#liveChipTxt');
    if (chip && chipTxt) {
      const paused = Store.state.refresh === 0;
      chip.classList.toggle('paused', paused);
      chipTxt.textContent = paused
        ? t('topbar.paused')
        : (window.Monitor.native ? t('source.native') : t('topbar.live'));
    }
    const sl = $('#statusLeft'), sr = $('#statusRight');
    if (!sl || !sr) return;
    sl.innerHTML = `
      <span>CPU <b class="num">${Math.round(L.cpuUsage || 0)}%</b> · ${UI.temp(L.cpuTemp)}</span>
      <span>GPU <b class="num">${L.gpuUsage == null ? '—' : Math.round(L.gpuUsage) + '%'}</b> · ${UI.temp(L.gpuTemp)}</span>
      <span>MEM <b class="num">${(L.memUsedGb || 0).toFixed(1)}/${P.mem.totalGb} GB</b></span>
      <span>SYS <b class="num">${Math.round(L.systemPower || 0)} W</b></span>`;
    const src = window.Monitor.native
      ? [t('source.native'), window.Monitor.estimated ? t('source.estimated') : null].filter(Boolean).join(' · ')
      : t('source.demo');
    sr.innerHTML = `
      <span>${esc(t('navsub.monitor').split(' · ')[0])} ${P.cpu.cores}C/${P.cpu.threads}T</span>
      <span>${UI.uptime(L.uptimeSec)}</span>
      <span class="${window.Monitor.native ? 'tnum' : 'tnum dim'}">${esc(src)}</span>
      <span class="tnum">v0.3.0</span>`;
  }

  function tickStatus() { updateStatusbar(); }

  /* ============================================================
     导航渲染 / 抽屉
     ============================================================ */
  function renderNav() {
    const nav = $('#nav');
    nav.innerHTML = NAV.map(n => `
      <button class="nav-item${ui.view === n.id ? ' active' : ''}" data-nav="${n.id}" type="button">
        <span class="nav-icon">${UI.icon(n.icon, 18)}</span>
        <span class="nav-label" data-i18n="${n.key}">${esc(t(n.key))}</span>
        ${n.id === 'link' && window.Monitor.phone.connected ? '<span class="nav-badge">USB</span>' : ''}
      </button>`).join('');
    window.I18N.apply(nav);

    const tb = $('#tabbarInner');
    tb.innerHTML = NAV.map(n => `
      <button class="tab-btn${ui.view === n.id ? ' active' : ''}" data-navtab="${n.id}" type="button">
        ${UI.icon(n.icon, 20)}<span class="tl" data-i18n="${n.key}">${esc(t(n.key))}</span>
      </button>`).join('');
    window.I18N.apply(tb);
  }

  /* 常驻导航的一次性委托绑定 */
  let navDelegationInstalled = false;
  function installNavDelegation() {
    if (navDelegationInstalled) return;
    navDelegationInstalled = true;
    document.addEventListener('click', e => {
      const n1 = e.target.closest('[data-nav]');
      if (n1) { go(n1.getAttribute('data-nav')); return; }
      const n2 = e.target.closest('[data-navtab]');
      if (n2) { go(n2.getAttribute('data-navtab')); }
    });
  }

  function syncNav() { renderNav(); }

  function openDrawer() {
    const app = $('#app');
    app.classList.add('drawer-open');
    if (!$('.scrim')) {
      const s = document.createElement('div');
      s.className = 'scrim';
      s.addEventListener('click', closeDrawer);
      app.appendChild(s);
    }
  }
  function closeDrawer() {
    $('#app').classList.remove('drawer-open');
    const s = $('.scrim'); if (s) s.remove();
  }

  /* ============================================================
     引导流程
     ============================================================ */
  let obStep = 0;
  const obSteps = ['welcome', 'color', 'lang', 'style'];
  const obSel = { theme: 'dark', lang: 'zh', style: 'geek' };

  function startOnboarding(reset) {
    obSel.theme = reset ? 'dark' : Store.state.theme;
    obSel.lang = reset ? 'zh' : Store.state.lang;
    obSel.style = reset ? 'geek' : Store.state.style;
    obStep = 0;
    $('#onboarding').hidden = false;
    $('#app').hidden = true;
    $('#tabbar').hidden = true;
    document.body.style.overflow = 'hidden';

    $$('#obColorChoices .choice').forEach(c => c.classList.toggle('active', c.getAttribute('data-value') === obSel.theme));
    $$('#obLangChoices .choice').forEach(c => c.classList.toggle('active', c.getAttribute('data-value') === obSel.lang));
    $$('#obStyleChoices .choice').forEach(c => c.classList.toggle('active', c.getAttribute('data-value') === obSel.style));
    obSync();
  }

  function obSync() {
    $$('.ob-pane').forEach(p => p.classList.toggle('active', p.getAttribute('data-pane') === obSteps[obStep]));
    const last = obStep >= obSteps.length - 1;
    $('#obNext').textContent = last ? t('common.finish') : t('common.next');
    $('#obBack').style.visibility = obStep === 0 ? 'hidden' : 'visible';
    $('#obDots').innerHTML = obSteps.map((_, i) => `<span class="ob-dot${i === obStep ? ' on' : ''}"></span>`).join('');
    window.I18N.apply($('#onboarding'));
  }

  function obNext() {
    if (obStep >= obSteps.length - 1) { finishOnboarding(); return; }
    const next = obStep + 1;
    if (obSteps[next] === 'style' && Store.isMobile()) { finishOnboarding(); return; }
    obStep = next; obSync();
  }
  function obBack() {
    if (obStep === 0) return;
    let prev = obStep - 1;
    if (obSteps[prev] === 'style' && Store.isMobile()) prev--;
    obStep = Math.max(0, prev); obSync();
  }

  function finishOnboarding() {
    Store.set({ theme: obSel.theme, lang: obSel.lang, style: obSel.style, onboarded: true }, 'onboard');
    $('#onboarding').hidden = true;
    $('#app').hidden = false;
    $('#tabbar').hidden = !Store.isMobile();
    document.body.style.overflow = '';
    boot();
    UI.toast(window.I18N.lang === 'zh' ? '设置已保存，欢迎使用极客空间' : 'Preferences saved. Welcome to Geek Space', 'ok');
  }

  function bindOnboarding() {
    $$('#obColorChoices .choice').forEach(c => c.addEventListener('click', () => {
      obSel.theme = c.getAttribute('data-value');
      $$('#obColorChoices .choice').forEach(x => x.classList.toggle('active', x === c));
      // 引导页卡片即时预览：仅预览该卡内部，不污染整体
      document.documentElement.dataset.theme = obSel.theme;
    }));
    $$('#obLangChoices .choice').forEach(c => c.addEventListener('click', () => {
      obSel.lang = c.getAttribute('data-value');
      $$('#obLangChoices .choice').forEach(x => x.classList.toggle('active', x === c));
      window.I18N.setLang(obSel.lang);
      window.I18N.apply($('#onboarding'));
      obSync();
    }));
    $$('#obStyleChoices .choice').forEach(c => c.addEventListener('click', () => {
      obSel.style = c.getAttribute('data-value');
      $$('#obStyleChoices .choice').forEach(x => x.classList.toggle('active', x === c));
    }));
    $('#obNext').addEventListener('click', obNext);
    $('#obBack').addEventListener('click', obBack);

    /* 顶栏快捷按钮 */
    $('#btnRefresh').addEventListener('click', () => {
      const paused = Store.state.refresh === 0;
      Store.set({ refresh: paused ? 1000 : 0 }, 'quickrefresh');
      applyRate(); render();
      UI.toast(paused ? t('common.enabled') : t('topbar.paused'), 'warn');
    });
    $('#btnLang').addEventListener('click', () => {
      Store.set({ lang: window.I18N.lang === 'zh' ? 'en' : 'zh' }, 'quicklang');
      renderAll(); syncNav();
    });
    $('#btnStyle').addEventListener('click', () => {
      if (Store.isMobile()) { UI.toast(t('settings.styleHint'), 'warn'); return; }
      const order = ['geek', 'minimal', 'apple'];
      const next = order[(order.indexOf(Store.state.style) + 1) % 3];
      Store.set({ style: next }, 'quickstyle');
      render();
      UI.toast(t('style.' + next), 'ok');
    });
    $('#menuToggle').addEventListener('click', openDrawer);
  }

  /* ============================================================
     启动
     ============================================================ */
  let nativeTimer = null;
  let procTimer = null;

  /** 原生模式下低频拉取真实进程占用榜 */
  function startProcessPolling(ms) {
    if (procTimer) { clearInterval(procTimer); procTimer = null; }
    const pull = async () => {
      if (!window.Monitor.native) return;
      const list = await window.NativeBridge.processes();
      if (!Array.isArray(list)) return;
      window.Monitor.processes = list;
      const b = $('#procBody');
      if (b && ui.view === 'dashboard') b.innerHTML = processRows();
    };
    pull();
    procTimer = setInterval(pull, ms);
  }

  /** 原生模式下按刷新率轮询 Rust 侧实时快照 */
  function startNativeLoop(ms) {
    if (nativeTimer) { clearInterval(nativeTimer); nativeTimer = null; }
    window.Monitor.stop();
    const pull = async () => {
      const s = await window.NativeBridge.live();
      if (s) window.Monitor.applyNative(s);
    };
    pull();
    nativeTimer = setInterval(pull, ms);
  }

  function applyRate() {
    const ms = Store.state.refresh;
    const chip = $('#liveChip'), txt = $('#liveChipTxt');
    if (ms === 0) {
      window.Monitor.stop();
      if (nativeTimer) { clearInterval(nativeTimer); nativeTimer = null; }
      if (chip) chip.classList.add('paused');
      if (txt) txt.textContent = t('topbar.paused');
    } else if (window.Monitor.native) {
      startNativeLoop(ms);
      if (chip) chip.classList.remove('paused');
      if (txt) txt.textContent = t('source.native');
    } else {
      if (nativeTimer) { clearInterval(nativeTimer); nativeTimer = null; }
      window.Monitor.setRate(ms);
      window.Monitor.start();
      if (chip) chip.classList.remove('paused');
      if (txt) txt.textContent = t('topbar.live');
    }
  }

  function applyVisibility() {
    $('#tabbar').hidden = $('#app').hidden || !Store.isMobile();
    $('#menuToggle').style.display = Store.isMobile() ? 'grid' : 'none';
    $('#btnStyle').style.display = Store.isMobile() ? 'none' : 'grid';
  }

  function boot() {
    renderNav();
    renderAll();
    applyRate();
    applyVisibility();
    updateChrome();
  }

  window.Monitor.onTick(() => {
    refreshLive();
    updateStatusbar();
  });

  Store.subscribe((s, reason) => {
    if (reason === 'theme' || reason === 'lang' || reason === 'unit' || reason === 'viewport') {
      applyVisibility();
    }
  });

  document.addEventListener('DOMContentLoaded', () => {
    Store.load();
    Store.apply();
    window.I18N.apply(document);
    installNavDelegation();
    bindOnboarding();

    window.addEventListener('resize', () => {
      applyVisibility();
      $$('canvas.spark').forEach(c => { c.width = 0; });
      sparkCanvases.forEach(f => f());
    });

    if (!Store.state.onboarded) startOnboarding(false);
    else {
      $('#onboarding').hidden = true;
      $('#app').hidden = false;
      boot();
    }

    /* 原生数据源：在 Tauri 壳内异步接入真实硬件；失败则保持模拟引擎 */
    (async () => {
      if (!window.NativeBridge || !window.NativeBridge.available) return;
      const ok = await window.NativeBridge.init();
      if (!ok) return;
      const [prof, sens, startup, drivers] = await Promise.all([
        window.NativeBridge.profile(),
        window.NativeBridge.sensors(),
        window.NativeBridge.startup(),
        window.NativeBridge.drivers()
      ]);
      if (!prof || !prof.host) return;
      window.Monitor.enableNative(prof);
      // 原生模式下即使采集结果为空也要覆盖列表 —— 否则会把内置演示样本
      // 当成真实数据展示出来，那是最糟糕的一种"编造"。
      window.Monitor.replaceList('sensors', sens || []);
      window.Monitor.replaceList('startup', startup || []);
      window.Monitor.replaceList('drivers', drivers || []);
      startProcessPolling(3000);
      applyRate();
      renderAll();
      syncNav();
      const caps = window.NativeBridge.caps || {};
      if (Array.isArray(caps.degraded) && caps.degraded.length) {
        console.info('[Geek Space] 采集降级项:', caps.degraded.join(', '));
      }
    })();

    setInterval(tickStatus, 1000);
    // 演示模式才需要刷新内置进程样本；原生模式由 startProcessPolling 负责
    setInterval(() => {
      if (window.Monitor.native) return;
      const b = $('#procBody');
      if (b && ui.view === 'dashboard') b.innerHTML = processRows();
    }, 3000);
  });
})();
