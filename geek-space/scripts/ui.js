/* ============================================================
   极客空间 Geek Space — UI 工具层
   格式化 / 环形仪表 / 实时曲线 / 图标 / 提示
   ============================================================ */
(function () {
  'use strict';

  const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

  /* ---------------- 格式化 ---------------- */
  const F = {
    num(v, d) { return Number(v).toFixed(d == null ? 0 : d); },
    pct(v) { return Math.round(v) + '%'; },
    /* 温度：跟随设置 C / F；读不到（null）时返回「—」，不要显示成 0°C */
    temp(c) {
      if (c === null || c === undefined || !isFinite(c)) return '—';
      const u = (window.Store && window.Store.state.unit) || 'c';
      if (u === 'f') return Math.round(c * 9 / 5 + 32) + '°F';
      return Math.round(c) + '°C';
    },
    tempVal(c) {
      if (c === null || c === undefined || !isFinite(c)) return '—';
      const u = (window.Store && window.Store.state.unit) || 'c';
      return Math.round(u === 'f' ? c * 9 / 5 + 32 : c);
    },
    tempUnit() { return ((window.Store && window.Store.state.unit) || 'c') === 'f' ? '°F' : '°C'; },
    ghz(v) { return v.toFixed(2) + ' GHz'; },
    mhz(v) { return Math.round(v) + ' MHz'; },
    gb(v, d) { return Number(v).toFixed(d == null ? 1 : d) + ' GB'; },
    mb(v) { return v >= 1024 ? (v / 1024).toFixed(2) + ' GB' : Math.round(v) + ' MB'; },
    watt(v) { return Math.round(v) + ' W'; },
    rpm(v) { return Math.round(v) + ' RPM'; },
    speed(v) { return v >= 1000 ? (v / 1000).toFixed(2) + ' GB/s' : Math.round(v) + ' MB/s'; },
    uptime(sec) {
      const d = Math.floor(sec / 86400), h = Math.floor(sec % 86400 / 3600), m = Math.floor(sec % 3600 / 60);
      const zh = window.I18N.lang === 'zh';
      if (d > 0) return zh ? `${d} 天 ${h} 小时 ${m} 分` : `${d}d ${h}h ${m}m`;
      return zh ? `${h} 小时 ${m} 分` : `${h}h ${m}m`;
    },
    date(s) { return s; }
  };

  /* 阈值 → 语义类 */
  function level(v, warn, danger) {
    if (v >= danger) return 'danger';
    if (v >= warn) return 'warn';
    return '';
  }
  function tempLevel(c) { return level(c, 72, 86); }

  /* ---------------- 环形仪表 ---------------- */
  function ring(opt) {
    const o = Object.assign({ value: 0, max: 100, size: 118, thickness: 9, unit: '%', decimals: 0, label: '', color: null }, opt);
    const r = (o.size - o.thickness) / 2;
    const c = 2 * Math.PI * r;
    const ratio = clamp(o.value / o.max, 0, 1);
    const off = c * (1 - ratio);
    const stroke = o.color || 'var(--c-accent)';
    const val = o.decimals > 0 ? Number(o.value).toFixed(o.decimals) : Math.round(o.value);
    return `
      <div class="gauge" style="width:${o.size}px;height:${o.size}px">
        <svg viewBox="0 0 ${o.size} ${o.size}" role="img" aria-label="${o.label || ''} ${val}${o.unit}">
          <circle class="gauge-track" cx="${o.size / 2}" cy="${o.size / 2}" r="${r}" fill="none" stroke-width="${o.thickness}"/>
          <circle class="gauge-val" cx="${o.size / 2}" cy="${o.size / 2}" r="${r}" fill="none" stroke-width="${o.thickness}"
            stroke-linecap="round" style="stroke:${stroke}"
            stroke-dasharray="${c.toFixed(2)}" stroke-dashoffset="${off.toFixed(2)}"/>
        </svg>
        <div class="gauge-center">
          <span class="gv" style="font-size:${Math.round(o.size / 4.1)}px">${val}</span>
          <span class="gu">${o.unit}</span>
        </div>
      </div>`;
  }

  /* ---------------- 曲线 ---------------- */
  function prep(canvas) {
    const dpr = window.devicePixelRatio || 1;
    const w = canvas.clientWidth || 320;
    const h = canvas.clientHeight || 90;
    if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
    }
    const ctx = canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    return { ctx, w, h };
  }

  function tracePath(ctx, data, w, h, max, pad) {
    const n = data.length;
    if (n < 2) return;
    const stepX = w / (n - 1);
    const y = v => h - pad - (clamp(v / max, 0, 1) * (h - pad * 2));
    ctx.beginPath();
    ctx.moveTo(0, y(data[0]));
    for (let i = 1; i < n; i++) {
      const x0 = (i - 1) * stepX, x1 = i * stepX;
      const y0 = y(data[i - 1]), y1 = y(data[i]);
      const cx = (x0 + x1) / 2;
      ctx.bezierCurveTo(cx, y0, cx, y1, x1, y1);
    }
  }

  function drawSpark(canvas, data, opt) {
    const o = Object.assign({ color: '#2bc97e', max: 100, fill: true, grid: true, pad: 6 }, opt);
    const { ctx, w, h } = prep(canvas);
    if (o.grid) {
      ctx.strokeStyle = 'rgba(128,140,150,0.16)';
      ctx.lineWidth = 1;
      for (let i = 1; i < 4; i++) {
        const gy = (h / 4) * i + 0.5;
        ctx.beginPath(); ctx.moveTo(0, gy); ctx.lineTo(w, gy); ctx.stroke();
      }
    }
    tracePath(ctx, data, w, h, o.max, o.pad);
    if (o.fill) {
      const grad = ctx.createLinearGradient(0, 0, 0, h);
      grad.addColorStop(0, hexA(o.color, 0.30));
      grad.addColorStop(1, hexA(o.color, 0));
      ctx.lineTo(w, h); ctx.lineTo(0, h); ctx.closePath();
      ctx.fillStyle = grad; ctx.fill();
      tracePath(ctx, data, w, h, o.max, o.pad);
    }
    ctx.strokeStyle = o.color; ctx.lineWidth = 1.8;
    ctx.lineJoin = 'round'; ctx.lineCap = 'round';
    ctx.stroke();
  }

  function drawMultiSpine(canvas, series, opt) {
    const o = Object.assign({ max: 100, grid: true, pad: 6 }, opt);
    const { ctx, w, h } = prep(canvas);
    if (o.grid) {
      ctx.strokeStyle = 'rgba(128,140,150,0.16)'; ctx.lineWidth = 1;
      for (let i = 1; i < 4; i++) { const gy = (h / 4) * i + 0.5; ctx.beginPath(); ctx.moveTo(0, gy); ctx.lineTo(w, gy); ctx.stroke(); }
    }
    series.forEach(s => {
      tracePath(ctx, s.data, w, h, o.max, o.pad);
      ctx.strokeStyle = s.color; ctx.lineWidth = s.width || 1.6;
      ctx.lineJoin = 'round'; ctx.lineCap = 'round';
      ctx.setLineDash(s.dash || []);
      ctx.stroke();
      ctx.setLineDash([]);
    });
  }

  function hexA(hex, a) {
    if (hex.indexOf('var(') === 0) hex = '#2bc97e';
    const n = parseInt(hex.replace('#', ''), 16);
    return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
  }

  /* ---------------- 图标 ---------------- */
  const ICONS = {
    overview: '<rect x="3" y="3" width="7.5" height="7.5" rx="1.6"/><rect x="13.5" y="3" width="7.5" height="7.5" rx="1.6"/><rect x="3" y="13.5" width="7.5" height="7.5" rx="1.6"/><rect x="13.5" y="13.5" width="7.5" height="7.5" rx="1.6"/>',
    cpu: '<rect x="6.5" y="6.5" width="11" height="11" rx="2"/><rect x="10" y="10" width="4" height="4" rx=".8"/><path d="M9.5 3v3.5M14.5 3v3.5M9.5 17.5V21M14.5 17.5V21M3 9.5h3.5M3 14.5h3.5M17.5 9.5H21M17.5 14.5H21"/>',
    phone: '<rect x="5.5" y="2" width="13" height="20" rx="3"/><path d="M9.8 4.7h4.4"/><rect x="7.7" y="6.8" width="8.6" height="11.4" rx="1.2" stroke-width="1.1" opacity=".5"/><path d="M10.6 20h2.8"/>',
    phoneLink: '<rect x="2.5" y="6" width="12" height="15" rx="2.2"/><path d="M6.4 8.3h4.2"/><path d="M17 10.5v6M20.5 12.5v2"/><path d="M14.5 12h2.5M14.5 15.5h2.5" opacity=".6"/>',
    wrench: '<path d="M15.2 3.6a4.8 4.8 0 0 0-4.3 6.9L3.4 18 6 20.6l7.5-7.5a4.8 4.8 0 0 0 6.9-4.3l-2.8 2.8-2.6-2.6 2.2-5.4z"/>',
    gear: '<circle cx="12" cy="12" r="3.2"/><path d="M19.4 14.5a1.6 1.6 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.6 1.6 0 0 0-2.7 1.1v.2a2 2 0 1 1-4 0v-.1a1.6 1.6 0 0 0-2.8-1.1l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.6 1.6 0 0 0-1.1-2.7H3.4a2 2 0 1 1 0-4h.1a1.6 1.6 0 0 0 1.1-2.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.6 1.6 0 0 0 2.7-1.1V3.4a2 2 0 1 1 4 0v.1a1.6 1.6 0 0 0 2.7 1.1l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.6 1.6 0 0 0 1.1 2.7h.2a2 2 0 1 1 0 4h-.1a1.6 1.6 0 0 0-1.4 1z"/>',
    temp: '<path d="M14 14.8V4.5a2 2 0 1 0-4 0v10.3a4 4 0 1 0 4 0z"/><path d="M12 17.5v-2"/>',
    bolt: '<path d="M13 2.5L4.5 13.5H11l-1 8 8.5-11H12z"/>',
    fan: '<circle cx="12" cy="12" r="2.2"/><path d="M12 9.8c0-4 -1.4-7.3-3.4-7.3S6 5.4 8.7 11M14.2 12c4 0 7.3-1.4 7.3-3.4S18.6 6 13 8.7M12 14.2c0 4 1.4 7.3 3.4 7.3S18 18.6 15.3 13M9.8 12c-4 0-7.3 1.4-7.3 3.4S5.4 18 11 15.3"/>',
    disk: '<ellipse cx="12" cy="6" rx="8" ry="3.2"/><path d="M4 6v12c0 1.8 3.6 3.2 8 3.2s8-1.4 8-3.2V6"/><path d="M4 12c0 1.8 3.6 3.2 8 3.2s8-1.4 8-3.2"/>',
    battery: '<rect x="2.5" y="7" width="17" height="10" rx="2.4"/><path d="M21.5 10.5v3"/><rect x="5" y="9.4" width="8" height="5.2" rx="1" fill="currentColor" stroke="none"/>',
    ram: '<rect x="2.5" y="7" width="19" height="10" rx="1.6"/><path d="M6.5 7v10M12 7v10M17.5 7v10"/><path d="M6 17v2M12 17v2M18 17v2"/>',
    gpu: '<rect x="2.5" y="6" width="19" height="12" rx="2.2"/><circle cx="9" cy="12" r="2.6"/><circle cx="16.5" cy="12" r="2.2"/><path d="M6.5 21v-3M18 21v-3"/>',
    board: '<rect x="3" y="3" width="18" height="18" rx="2"/><rect x="6.5" y="6.5" width="6" height="6" rx="1"/><path d="M16 6.5v5M16 14.5h2.5M6.5 17h11"/>',
    display: '<rect x="2.5" y="4" width="19" height="12.5" rx="2"/><path d="M8 20h8M12 16.5V20"/>',
    usb: '<circle cx="12" cy="17.5" r="2"/><path d="M12 15.5V4M12 4l-3 3M12 4l3 3M9 8.5l-2 2M15 11l2-2"/>',
    check: '<path d="M4.5 12.5l5 5L20 6.5"/>',
    close: '<path d="M6 6l12 12M18 6L6 18"/>',
    warn: '<path d="M12 3.5l9.5 16.5H2.5z"/><path d="M12 9.5v5M12 17.4v.2"/>',
    trash: '<path d="M4 7h16M9.5 7V4.5h5V7M6.5 7l1 13h9l1-13"/><path d="M10.5 11v5M13.5 11v5"/>',
    snow: '<path d="M12 2.5v19M4 7l16 10M20 7L4 17M12 6.5l-2.4-2.4M12 6.5l2.4-2.4M12 17.5l-2.4 2.4M12 17.5l2.4 2.4"/>',
    restore: '<path d="M4 12a8 8 0 1 0 2.6-5.9"/><path d="M4 5v5h5"/>',
    download: '<path d="M12 4v11M7.5 11l4.5 4.5 4.5-4.5M4.5 20h15"/>',
    search: '<circle cx="11" cy="11" r="6.5"/><path d="M16 16l4.5 4.5"/>',
    play: '<path d="M7 4.5l12 7.5-12 7.5z"/>',
    stop: '<rect x="6.5" y="6.5" width="11" height="11" rx="1.6"/>',
    copy: '<rect x="8.5" y="8.5" width="11.5" height="11.5" rx="2"/><path d="M15.5 8.5V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v7.5a2 2 0 0 0 2 2h2.5"/>',
    refresh: '<path d="M4 12a8 8 0 1 1 2.4 5.7"/><path d="M4 19v-5h5"/>',
    shield: '<path d="M12 3l7.5 3v6c0 4.4-3.1 8.1-7.5 9-4.4-.9-7.5-4.6-7.5-9V6z"/>',
    activity: '<path d="M2.5 12h4l2.5-7 4 15 2.5-8h6"/>',
    folder: '<path d="M3 6.5A1.5 1.5 0 0 1 4.5 5h4l2 2.5h9A1.5 1.5 0 0 1 21 9v9a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 18z"/>',
    file: '<path d="M6 3h7l5 5v13H6z"/><path d="M13 3v5h5"/>',
    lock: '<rect x="4.5" y="10.5" width="15" height="10" rx="2"/><path d="M8 10.5V7.8a4 4 0 0 1 8 0v2.7"/>',
    power: '<path d="M12 3v8"/><path d="M6.8 6.5a8 8 0 1 0 10.4 0"/>',
    arrow: '<path d="M5 12h13M13 6.5l5.5 5.5L13 17.5"/>',
    grid: '<rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18M9 3v18"/>',
    server: '<rect x="3" y="4" width="18" height="7" rx="2"/><rect x="3" y="13" width="18" height="7" rx="2"/><path d="M7 7.5h.01M7 16.5h.01"/>',
    speed: '<path d="M4 18a8 8 0 1 1 16 0"/><path d="M12 18l4.5-5"/><circle cx="12" cy="18" r="1.4"/>',
    shieldCheck: '<path d="M12 3l7.5 3v6c0 4.4-3.1 8.1-7.5 9-4.4-.9-7.5-4.6-7.5-9V6z"/><path d="M9 12l2 2 4-4.5"/>',
    cloud: '<path d="M7 18.5h10a3.5 3.5 0 0 0 .4-7A5 5 0 0 0 8 10.4 3.6 3.6 0 0 0 7 18.5z"/>'
  };

  function icon(name, size) {
    const p = ICONS[name] || ICONS.activity;
    const s = size || 16;
    return `<svg viewBox="0 0 24 24" width="${s}" height="${s}" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${p}</svg>`;
  }

  /* ---------------- Toast ---------------- */
  function toast(msg, type) {
    const wrap = document.getElementById('toastWrap');
    if (!wrap) return;
    const el = document.createElement('div');
    el.className = 'toast ' + (type || 'ok');
    const ic = type === 'err' ? 'warn' : type === 'warn' ? 'warn' : 'check';
    el.innerHTML = `<span class="ti">${icon(ic, 16)}</span><span>${escapeHtml(msg)}</span>`;
    wrap.appendChild(el);
    setTimeout(() => {
      el.style.transition = 'opacity .25s, transform .25s';
      el.style.opacity = '0'; el.style.transform = 'translateY(6px)';
      setTimeout(() => el.remove(), 260);
    }, 2400);
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  window.UI = Object.assign(F, {
    ring, drawSpark, drawMultiSpine, icon, toast, escapeHtml,
    level, tempLevel,
    /* 指标 → 语义色 */
    colorFor(level) {
      return level === 'danger' ? 'var(--st-danger)' : level === 'warn' ? 'var(--st-warn)' : 'var(--c-accent)';
    }
  });
})();
