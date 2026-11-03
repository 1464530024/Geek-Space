/* ============================================================
   极客空间 Geek Space — 硬件数据引擎
   ------------------------------------------------------------
   说明：本原型使用「确定性伪随机 + 正弦漂移 + 负载场景」模拟
   真实传感器读数。原生版本（Tauri）将把 Monitor 的实现替换为
   Rust 侧 sysinfo / LibreHardwareMonitor / NVML / ADB 的真实采集，
   上层视图与格式化函数无需改动。
   ============================================================ */
(function () {
  'use strict';

  /* ---------- 工具 ---------- */
  function mulberry32(seed) {
    let a = seed >>> 0;
    return function () {
      a |= 0; a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
  const lerp = (a, b, t) => a + (b - a) * t;

  /* ---------- 设备档案：首次生成并固化 ---------- */
  const CPU_POOL = [
    { model: 'AMD Ryzen 9 7950X', vendor: 'AMD', codename: 'Raphael', cores: 16, threads: 32, base: 4.5, boost: 5.7, l3: 64, node: '5 nm', tdp: 170, socket: 'AM5' },
    { model: 'AMD Ryzen 7 7800X3D', vendor: 'AMD', codename: 'Raphael', cores: 8, threads: 16, base: 4.2, boost: 5.0, l3: 96, node: '5 nm', tdp: 120, socket: 'AM5' },
    { model: 'Intel Core i9-14900K', vendor: 'Intel', codename: 'Raptor Lake Refresh', cores: 24, threads: 32, base: 3.2, boost: 6.0, l3: 36, node: 'Intel 7', tdp: 125, socket: 'LGA1700' },
    { model: 'Intel Core i5-13600K', vendor: 'Intel', codename: 'Raptor Lake', cores: 14, threads: 20, base: 3.5, boost: 5.1, l3: 24, node: 'Intel 7', tdp: 125, socket: 'LGA1700' }
  ];
  const GPU_POOL = [
    { model: 'NVIDIA GeForce RTX 4080 SUPER', vendor: 'NVIDIA', vram: 16, driver: '560.94', base: 2290, boost: 2550, mem: 11501, bus: 256, tdp: 320 },
    { model: 'NVIDIA GeForce RTX 4070 Ti', vendor: 'NVIDIA', vram: 12, driver: '560.94', base: 2310, boost: 2610, mem: 10501, bus: 192, tdp: 285 },
    { model: 'AMD Radeon RX 7900 XT', vendor: 'AMD', vram: 20, driver: '24.9.1', base: 2000, boost: 2400, mem: 10000, bus: 320, tdp: 315 },
    { model: 'NVIDIA GeForce RTX 4060', vendor: 'NVIDIA', vram: 8, driver: '560.94', base: 1830, boost: 2460, mem: 8500, bus: 128, tdp: 115 }
  ];
  const BOARD_POOL = [
    { vendor: 'ASUS', model: 'ROG STRIX X670E-E GAMING', chipset: 'AMD X670E', bios: '2604', ec: '1.0.0.C4' },
    { vendor: 'MSI', model: 'MAG B650 TOMAHAWK WIFI', chipset: 'AMD B650', bios: '7D75v1A', ec: '0.9.2' },
    { vendor: 'GIGABYTE', model: 'Z790 AORUS ELITE AX', chipset: 'Intel Z790', bios: 'F10', ec: '1.3' },
    { vendor: 'ASUS', model: 'PRIME Z790-A WIFI', chipset: 'Intel Z790', bios: '2002', ec: '1.1.5' }
  ];
  const DISK_POOL = [
    { model: 'Samsung SSD 990 PRO 2TB', iface: 'NVMe PCIe 4.0 x4', cap: 2000, type: 'ssd' },
    { model: 'WD_BLACK SN850X 1TB', iface: 'NVMe PCIe 4.0 x4', cap: 1000, type: 'ssd' },
    { model: 'Crucial P3 Plus 2TB', iface: 'NVMe PCIe 4.0 x4', cap: 2000, type: 'ssd' },
    { model: 'Seagate Barracuda 4TB', iface: 'SATA III', cap: 4000, type: 'hdd' }
  ];
  const DISPLAY_POOL = [
    { model: 'DELL U2723QE', vendor: 'DELL', res: '3840 × 2160', refresh: 60, size: 27, panel: 'IPS Black', hdr: 'HDR400' },
    { model: 'LG 27GP950', vendor: 'LG', res: '3840 × 2160', refresh: 144, size: 27, panel: 'Nano IPS', hdr: 'HDR600' },
    { model: 'AOC Q27G3XMN', vendor: 'AOC', res: '2560 × 1440', refresh: 180, size: 27, panel: 'VA Mini-LED', hdr: 'HDR1000' },
    { model: 'ASUS ROG Swift PG279QM', vendor: 'ASUS', res: '2560 × 1440', refresh: 240, size: 27, panel: 'Fast IPS', hdr: 'HDR400' }
  ];

  function buildProfile() {
    const seed = Math.floor(Math.random() * 1e9);
    const rnd = mulberry32(seed);
    const pick = arr => arr[Math.floor(rnd() * arr.length)];

    const cpu = Object.assign({}, pick(CPU_POOL));
    const gpu = Object.assign({}, pick(GPU_POOL));
    const board = Object.assign({}, pick(BOARD_POOL));
    const display = Object.assign({}, pick(DISPLAY_POOL));

    const memTotal = pick([16, 32, 32, 64]);
    const memType = rnd() > 0.45 ? 'DDR5' : 'DDR4';
    const memSpeed = memType === 'DDR5' ? pick([5200, 5600, 6000, 6400]) : pick([3200, 3600, 4000]);
    const channelCount = memTotal >= 32 ? 2 : 2;
    const perStick = memTotal / 2;
    const memVendor = pick(['Samsung', 'SK Hynix', 'Micron', 'Kingston', 'G.Skill']);

    const diskCount = rnd() > 0.6 ? 2 : 1;
    const disks = [];
    for (let i = 0; i < diskCount; i++) {
      const d = Object.assign({}, DISK_POOL[i === 0 ? Math.floor(rnd() * 3) : 3]);
      disks.push({
        id: i,
        model: d.model,
        iface: d.iface,
        type: d.type,
        capGb: d.cap,
        usedGb: Math.round(d.cap * (0.28 + rnd() * 0.5)),
        health: Math.round(92 + rnd() * 8),
        temp: Math.round(34 + rnd() * 14),
        powerOn: Math.round(180 + rnd() * 1400),
        hours: Math.round(1200 + rnd() * 12000),
        readMB: d.type === 'ssd' ? Math.round(6800 + rnd() * 700) : Math.round(180 + rnd() * 40),
        writeMB: d.type === 'ssd' ? Math.round(6100 + rnd() * 900) : Math.round(160 + rnd() * 40),
        system: i === 0
      });
    }

    const battery = {
      present: true,
      designWh: 84,
      fullWh: Math.round(72 + rnd() * 11),
      cycles: Math.round(48 + rnd() * 260)
    };

    return {
      seed,
      host: pick(['GEEK-STATION', 'RIG-01', 'DEEPTHOUGHT', 'NEBULA-PC', 'HAL9000']),
      os: { name: 'Windows 11 Pro', build: '26100.2314', arch: 'x64', install: '2024-03-18' },
      cpu, gpu, board, display, disks, battery,
      mem: {
        totalGb: memTotal, type: memType, speedMhz: memSpeed, channels: channelCount,
        vendor: memVendor, slots: [
          { name: 'DIMM_A1', sizeGb: perStick, speedMhz: memSpeed, vendor: memVendor },
          { name: 'DIMM_B1', sizeGb: perStick, speedMhz: memSpeed, vendor: memVendor }
        ]
      },
      biosDate: `${String(Math.floor(rnd() * 12) + 1).padStart(2, '0')}/1${Math.floor(rnd() * 8) + 1}/2024`,
      platform: 'windows',
      systemDisk: disks.findIndex(d => d.system),
      // 演示模式不伪造分区表，由前端按磁盘推算（见 app.js volumesDemo）
      volumes: [],
      fans: [
        { name: 'CPU_FAN', rpm: 1180 },
        { name: 'PUMP_FAN', rpm: 2240 },
        { name: 'SYS_FAN1', rpm: 860 },
        { name: 'SYS_FAN2', rpm: 812 }
      ]
    };
  }

  let profile = window.Store ? window.Store.getProfile() : null;
  if (!profile) {
    profile = buildProfile();
    if (window.Store) window.Store.setProfile(profile);
  }

  /* ---------- 手机数据 ---------- */
  const APP_SEED = [
    ['com.android.systemui', 'System UI', 42, 'danger', 'sys'],
    ['com.google.android.gms', 'Google Play 服务', 268, 'warn', 'sys'],
    ['com.android.chrome', 'Chrome', 312, 'safe', 'user'],
    ['com.tencent.mm', '微信', 986, 'safe', 'user'],
    ['com.tencent.mobileqq', 'QQ', 742, 'safe', 'user'],
    ['com.tencent.mm:push', '微信推送服务', 18, 'warn', 'sys'],
    ['com.taobao.taobao', '淘宝', 614, 'safe', 'user'],
    ['com.eg.android.AlipayGphone', '支付宝', 588, 'safe', 'user'],
    ['com.bytedance.music', '汽水音乐', 226, 'safe', 'user'],
    ['com.ss.android.ugc.aweme', '抖音', 892, 'safe', 'user'],
    ['com.ss.android.article.news', '今日头条', 468, 'safe', 'user'],
    ['com.netease.cloudmusic', '网易云音乐', 344, 'safe', 'user'],
    ['com.ximalaya.ting.android', '喜马拉雅', 302, 'safe', 'user'],
    ['com.UCMobile', 'UC 浏览器', 268, 'warn', 'user'],
    ['com.baidu.BaiduMap', '百度地图', 412, 'safe', 'user'],
    ['com.autonavi.minimap', '高德地图', 396, 'safe', 'user'],
    ['com.tencent.qqmusic', 'QQ 音乐', 358, 'safe', 'user'],
    ['com.smile.gifmaker', '快手', 512, 'safe', 'user'],
    ['com.android.bluetooth', '蓝牙', 12, 'warn', 'sys'],
    ['com.android.printspooler', '打印服务', 8, 'safe', 'sys'],
    ['com.android.bips', '内置打印服务', 6, 'safe', 'sys'],
    ['com.qualcomm.qti.telephonyservice', '高通电话服务', 24, 'danger', 'sys'],
    ['com.android.stk', 'SIM 卡工具包', 4, 'safe', 'sys'],
    ['com.android.hotwordenrollment', '语音唤醒', 9, 'warn', 'sys'],
    ['com.miui.analytics', '系统分析服务', 16, 'warn', 'sys'],
    ['com.miui.cloudservice', '小米云服务', 68, 'safe', 'sys'],
    ['com.android.vending', 'Google Play 商店', 128, 'safe', 'sys'],
    ['com.google.android.apps.maps', 'Google 地图', 212, 'safe', 'user'],
    ['org.telegram.messenger', 'Telegram', 176, 'safe', 'user'],
    ['com.spotify.music', 'Spotify', 148, 'safe', 'user'],
    ['com.microsoft.office.word', 'Word', 132, 'safe', 'user'],
    ['com.android.settings', '设置', 34, 'danger', 'sys'],
    ['com.android.documentsui', '文件', 12, 'danger', 'sys'],
    ['com.miui.securitycenter', '安全中心', 88, 'warn', 'sys'],
    ['com.android.providers.media', '媒体存储', 22, 'warn', 'sys'],
    ['com.miui.videoplayer', '视频', 96, 'safe', 'user']
  ];

  const phone = {
    connected: false,
    name: 'Xiaomi 14 Pro',
    model: '23116PN5BC',
    android: 'Android 15 · HyperOS 2.0',
    serial: 'AP7X9K2M4T',
    link: 'usb',
    storage: { totalGb: 512, usedGb: 287 },
    apps: APP_SEED.map((a, i) => ({
      id: i, pkg: a[0], name: a[1], sizeMb: a[2], risk: a[3], kind: a[4], frozen: false, removed: false
    })),
    files: [
      { name: 'DCIM', type: 'dir', size: '—', modified: '2026-11-01 18:24' },
      { name: 'Download', type: 'dir', size: '—', modified: '2026-11-02 09:10' },
      { name: 'Pictures', type: 'dir', size: '—', modified: '2026-10-28 21:03' },
      { name: 'Android', type: 'dir', size: '—', modified: '2026-11-02 14:55' },
      { name: 'MIUI', type: 'dir', size: '—', modified: '2026-09-19 11:40' },
      { name: 'screenshot_2026-11-02.png', type: 'file', size: '2.84 MB', modified: '2026-11-02 15:31' },
      { name: 'geek-space-release.apk', type: 'file', size: '24.6 MB', modified: '2026-11-01 22:07' },
      { name: 'IMG_20261031_140233.jpg', type: 'file', size: '4.12 MB', modified: '2026-10-31 14:02' },
      { name: 'logcat_1031.txt', type: 'file', size: '868 KB', modified: '2026-10-31 09:45' }
    ]
  };

  /* ---------- 搞机工具数据 ---------- */
  const sensors = [
    { name: 'CPU Package', type: '温度', unit: '°C', base: 52, spread: 14, min: 34, max: 88 },
    { name: 'CPU Core Max', type: '温度', unit: '°C', base: 49, spread: 13, min: 32, max: 90 },
    { name: 'GPU Core', type: '温度', unit: '°C', base: 58, spread: 18, min: 38, max: 82 },
    { name: 'GPU Hot Spot', type: '温度', unit: '°C', base: 66, spread: 20, min: 42, max: 94 },
    { name: 'NVMe Composite', type: '温度', unit: '°C', base: 41, spread: 9, min: 33, max: 62 },
    { name: 'VCore', type: '电压', unit: 'V', base: 1.24, spread: 0.09, min: 1.08, max: 1.41 },
    { name: 'DRAM Voltage', type: '电压', unit: 'V', base: 1.36, spread: 0.02, min: 1.34, max: 1.38 },
    { name: '+12V Rail', type: '电压', unit: 'V', base: 12.06, spread: 0.18, min: 11.84, max: 12.28 },
    { name: 'CPU Fan', type: '风扇', unit: 'RPM', base: 1240, spread: 320, min: 780, max: 1980 },
    { name: 'Case Fan 1', type: '风扇', unit: 'RPM', base: 880, spread: 180, min: 620, max: 1420 },
    { name: 'Almost Silent', type: '风扇', unit: 'RPM', base: 0, spread: 0, min: 0, max: 0 },
    { name: 'CPU Package Power', type: '功耗', unit: 'W', base: 96, spread: 62, min: 22, max: 268 },
    { name: 'GPU Board Power', type: '功耗', unit: 'W', base: 184, spread: 96, min: 34, max: 318 },
    { name: 'System Fan', type: '风扇', unit: 'RPM', base: 820, spread: 180, min: 600, max: 1380 }
  ];

  // 与原生采集同构：kind = registry | folder | task，stateKnown 表示状态是否可判定
  const startup = [
    { name: 'Steam Client Bootstrapper', publisher: 'Valve Corporation', boot: true, disabled: false, kind: 'registry', stateKnown: true },
    { name: 'Discord', publisher: 'Discord Inc.', boot: true, disabled: false, kind: 'registry', stateKnown: true },
    { name: 'NVIDIA App', publisher: 'NVIDIA Corporation', boot: true, disabled: false, kind: 'registry', stateKnown: true },
    { name: 'WeChat', publisher: 'Tencent', boot: true, disabled: false, kind: 'registry', stateKnown: true },
    { name: 'OneDrive', publisher: 'Microsoft Corporation', boot: true, disabled: true, kind: 'registry', stateKnown: true },
    { name: 'Windows Security Notification', publisher: 'Microsoft Corporation', boot: true, disabled: false, kind: 'task', stateKnown: true },
    { name: 'Adobe Creative Cloud', publisher: 'Adobe Inc.', boot: true, disabled: true, kind: 'registry', stateKnown: true },
    { name: 'Epic Games Launcher', publisher: 'Epic Games, Inc.', boot: true, disabled: false, kind: 'registry', stateKnown: true },
    { name: 'Docker Desktop', publisher: 'Docker Inc.', boot: true, disabled: false, kind: 'registry', stateKnown: true },
    { name: 'Clash Verge', publisher: 'Clash Verge', boot: true, disabled: false, kind: 'folder', stateKnown: true },
    { name: 'Google Updater', publisher: 'Google LLC', boot: true, disabled: false, kind: 'task', stateKnown: true },
    { name: 'SysMain (Superfetch)', publisher: 'Microsoft Corporation', boot: false, disabled: false, kind: 'registry', stateKnown: false }
  ];

  const drivers = [
    { device: 'NVIDIA GeForce RTX 4080 SUPER', ver: '560.94', date: '2026-08-21', vendor: 'NVIDIA' },
    { device: 'AMD Chipset / PSP', ver: '6.07.22.037', date: '2026-06-12', vendor: 'AMD' },
    { device: 'Realtek PCIe GbE Family Controller', ver: '10.68.0522', date: '2026-05-22', vendor: 'Realtek' },
    { device: 'Intel Wi-Fi 6E AX211', ver: '23.70.2.1', date: '2026-07-03', vendor: 'Intel' },
    { device: 'Realtek USB Audio', ver: '6.4.0.2412', date: '2026-04-18', vendor: 'Realtek' },
    { device: 'Samsung NVMe Controller', ver: '3.3.0.2012', date: '2026-02-09', vendor: 'Samsung' },
    { device: 'Microsoft Bluetooth LE Enumerator', ver: '10.0.26100', date: '2026-01-15', vendor: 'Microsoft' },
    { device: 'AMD USB 3.2 Host Controller', ver: '1.0.0.12', date: '2026-03-27', vendor: 'AMD' }
  ];

  const firmware = [
    { label: 'BIOS', key: 'biosVersion', desc: '主板固件' },
    { label: 'EC', key: 'embeddedVer', desc: '嵌入式控制器' },
    { label: 'ME', key: 'meVer', desc: '管理引擎' }
  ];

  /* ---------- 实时指标 ---------- */
  const MAXPTS = 120;
  const live = {
    cpuUsage: 18, cpuTemp: 46, cpuClock: 0, cpuPower: 0,
    memUsedGb: 0, memPercent: 0,
    gpuUsage: 6, gpuTemp: 44, gpuClock: 0, gpuPower: 0, gpuVramUsedMb: null,
    diskRead: 0, diskWrite: 0, netDown: 0, netUp: 0,
    systemPower: 0, uptimeSec: 3 * 86400 + 7 * 3600 + 12 * 60,
    load: 'normal',
    perCore: []
  };
  const history = { cpu: [], gpu: [], mem: [], power: [], io: [], net: [] };

  for (let i = 0; i < profile.cpu.threads; i++) live.perCore.push({ usage: 12, temp: 42, clock: profile.cpu.base });
  for (let i = 0; i < MAXPTS; i++) { history.cpu.push(16); history.gpu.push(6); history.mem.push(34); history.power.push(80); history.io.push(60); history.net.push(180); }

  const t0 = performance.now() / 1000;
  let lastT = t0;
  let scenarioT = 0;
  let scenario = { cpu: 0.28, gpu: 0.12, dur: 14 };
  let nextScenarioAt = 8;
  let burst = 0;

  function pickScenario() {
    const r = Math.random();
    if (r < 0.42) scenario = { cpu: 0.10 + Math.random() * 0.14, gpu: 0.04 + Math.random() * 0.10, dur: 10 + Math.random() * 14, name: 'idle' };
    else if (r < 0.84) scenario = { cpu: 0.30 + Math.random() * 0.24, gpu: 0.14 + Math.random() * 0.26, dur: 12 + Math.random() * 18, name: 'normal' };
    else scenario = { cpu: 0.70 + Math.random() * 0.26, gpu: 0.55 + Math.random() * 0.42, dur: 8 + Math.random() * 12, name: 'heavy' };
    scenarioT = 0;
  }

  function tick() {
    const now = performance.now() / 1000;
    const dt = Math.min(1, now - lastT);
    lastT = now;
    const T = now - t0;

    scenarioT += dt;
    if (scenarioT > scenario.dur) pickScenario();

    // 偶发瞬时尖峰
    if (burst > 0) burst -= dt;
    else if (Math.random() < 0.012) burst = 1.2 + Math.random() * 2.4;

    const ripple = 0.5 + 0.5 * Math.sin(T / 9.5);
    const jitter = (Math.random() - 0.5) * 0.05;
    const burstBoost = burst > 0 ? 0.22 : 0;

    const cpuTarget = clamp(scenario.cpu * (0.72 + 0.56 * ripple) + jitter + burstBoost, 0.03, 0.99);
    const gpuTarget = clamp(scenario.gpu * (0.6 + 0.8 * Math.sin(T / 13.4 + 1.1) * 0.5 + 0.5) + jitter, 0.02, 0.99);

    live.cpuUsage = clamp(lerp(live.cpuUsage, cpuTarget * 100, 0.16), 1, 100);
    live.gpuUsage = clamp(lerp(live.gpuUsage, gpuTarget * 100, 0.13), 0.5, 100);

    // 负载等级
    const lv = live.cpuUsage;
    live.load = lv < 25 ? 'idle' : lv < 62 ? 'normal' : lv < 88 ? 'heavy' : 'extreme';

    // 温度 / 频率 / 功耗
    live.cpuTemp = clamp(lerp(live.cpuTemp, 36 + live.cpuUsage * 0.44 + (profile.cpu.tdp - 120) * 0.05, 0.07), 32, 96);
    live.cpuClock = clamp(lerp(live.cpuClock || profile.cpu.base, lerp(profile.cpu.base, profile.cpu.boost, live.cpuUsage / 100), 0.2), profile.cpu.base * 0.7, profile.cpu.boost);
    live.cpuPower = clamp(lerp(live.cpuPower || 20, 14 + (profile.cpu.tdp - 14) * Math.pow(live.cpuUsage / 100, 1.35), 0.16), 8, profile.cpu.tdp + 12);

    live.gpuTemp = clamp(lerp(live.gpuTemp, 34 + live.gpuUsage * 0.42, 0.06), 30, 92);
    live.gpuClock = clamp(lerp(live.gpuClock || profile.gpu.base, lerp(profile.gpu.base, profile.gpu.boost, live.gpuUsage / 100), 0.18), profile.gpu.base * 0.6, profile.gpu.boost);
    live.gpuPower = clamp(lerp(live.gpuPower || 20, 16 + (profile.gpu.tdp - 16) * Math.pow(live.gpuUsage / 100, 1.25), 0.15), 10, profile.gpu.tdp + 10);

    // 每核心
    for (let i = 0; i < live.perCore.length; i++) {
      const c = live.perCore[i];
      const phase = i * 0.9;
      const solo = clamp(cpuTarget * 100 * (0.66 + 0.62 * (0.5 + 0.5 * Math.sin(T / (3.4 + (i % 5) * 1.3) + phase))) + (Math.random() - 0.5) * 9, 1, 100);
      c.usage = clamp(lerp(c.usage, solo, 0.22), 0.5, 100);
      c.temp = clamp(live.cpuTemp + (c.usage - live.cpuUsage) * 0.16 + (Math.random() - 0.5) * 0.8, 30, 99);
      c.clock = clamp(live.cpuClock * (0.86 + c.usage / 260), profile.cpu.base * 0.6, profile.cpu.boost + 0.1);
    }

    // 内存
    const memBase = profile.mem.totalGb * 0.34;
    const memTarget = clamp(memBase + profile.mem.totalGb * 0.24 * (cpuTarget * 1.5), profile.mem.totalGb * 0.2, profile.mem.totalGb * 0.93);
    live.memUsedGb = lerp(live.memUsedGb || memBase, memTarget, 0.06);
    live.memPercent = (live.memUsedGb / profile.mem.totalGb) * 100;

    // 磁盘 / 网络
    live.diskRead = clamp(lerp(live.diskRead, live.cpuUsage * (2 + Math.random() * 22), 0.2), 0, 6200);
    live.diskWrite = clamp(lerp(live.diskWrite, live.cpuUsage * (1 + Math.random() * 14), 0.2), 0, 5800);
    live.netDown = clamp(lerp(live.netDown, Math.abs(Math.sin(T / 6)) * 420 + Math.random() * 60, 0.15), 0, 1200);
    live.netUp = clamp(lerp(live.netUp, Math.abs(Math.sin(T / 7.7 + 2)) * 90 + Math.random() * 20, 0.15), 0, 600);

    // 整机功耗
    live.systemPower = live.cpuPower + live.gpuPower + 34 + live.diskRead / 620 * 6;

    // 传感器（用于工具页）
    sensors.forEach(s => {
      if (s.unit === 'W' && s.name.indexOf('CPU') === 0) s.value = live.cpuPower;
      else if (s.unit === 'W') s.value = live.gpuPower;
      else if (s.unit === '°C' && s.name.indexOf('GPU') === 0) s.value = live.gpuTemp + (s.name.indexOf('Hot') >= 0 ? 7 : 0);
      else if (s.unit === '°C' && s.name.indexOf('NVMe') >= 0) s.value = profile.disks[0].temp + 2;
      else if (s.unit === '°C') s.value = live.cpuTemp - (s.name.indexOf('Max') >= 0 ? 2 : 0);
      else if (s.unit === 'RPM' && s.name.indexOf('CPU') >= 0) s.value = 800 + live.cpuTemp * 14;
      else if (s.unit === 'RPM') s.value = 600 + live.cpuUsage * 6;
      else s.value = s.base + (Math.random() - 0.5) * s.spread;
    });

    profile.fans[0].rpm = Math.round(800 + live.cpuTemp * 14);
    profile.fans[1].rpm = Math.round(2100 + live.cpuUsage * 6);
    profile.fans[2].rpm = Math.round(720 + live.cpuUsage * 4);
    profile.fans[3].rpm = Math.round(700 + live.cpuUsage * 3.4);
    const d0 = profile.disks[0];
    d0.temp = Math.round(clamp(d0.temp + (live.diskRead > 200 ? 0.06 : -0.05), 30, 62));

    live.uptimeSec += dt;

    // 历史环形缓冲
    history.cpu.push(live.cpuUsage); history.gpu.push(live.gpuUsage);
    history.mem.push(live.memPercent); history.power.push(live.systemPower);
    history.io.push(live.diskRead); history.net.push(live.netDown);
    if (history.cpu.length > MAXPTS) { history.cpu.shift(); history.gpu.shift(); history.mem.shift(); history.power.shift(); history.io.shift(); history.net.shift(); }
  }

  /* ---------- 引擎控制 ---------- */
  let timer = null;
  let rate = 1000;
  const tickSubs = [];

  function loop(ms) {
    if (timer) clearInterval(timer);
    if (ms > 0) timer = setInterval(() => { tick(); tickSubs.forEach(fn => fn(live)); }, ms);
  }

  /* ---------- 原生数据通道 ---------- */
  // 由 native.js 在 Tauri 壳内驱动；浏览器场景保持模拟引擎。
  const nativeBat = { known: false, pct: null, state: 'unknown' };
  let estimated = false;

  window.Monitor = {
    profile,
    phone,
    sensors,
    startup,
    drivers,
    firmware,
    live,
    history,
    /** 原生模式下由 top_processes 命令填充；演示模式保持为空走内置样本 */
    processes: [],
    /** 原生数据源状态（供视图层展示） */
    native: false,
    nativeBat,
    get estimated() { return estimated; },
    getRate() { return rate; },
    setRate(ms) { rate = ms; loop(ms); },
    start() { loop(rate); },
    stop() { if (timer) clearInterval(timer); timer = null; },
    onTick(fn) { tickSubs.push(fn); return () => { const i = tickSubs.indexOf(fn); if (i >= 0) tickSubs.splice(i, 1); }; },
    step() { tick(); tickSubs.forEach(fn => fn(live)); },

    /**
     * 切换到原生数据源：停掉模拟引擎，原地替换 profile（保持对象引用，
     * 因为 app.js 持有 const profile 引用），并接管传感器/启动项/驱动列表。
     */
    enableNative(p) {
      this.stop();
      this.native = true;
      if (p && p.host) {
        Object.keys(profile).forEach(k => { delete profile[k]; });
        Object.assign(profile, p);
      }
      // 清空模拟引擎的残留值。
      // 这些默认值（GPU 温度 44、内存 34% 之类）如果留到原生首帧到达之前，
      // 就会被当成真机读数显示出来 —— 这是最隐蔽的一种"编造数据"。
      // 宁可先显示「—」，也不要闪一帧假数字。
      live.cpuUsage = 0; live.cpuClock = 0;
      live.memUsedGb = 0; live.memPercent = 0;
      live.diskRead = 0; live.diskWrite = 0;
      live.netDown = 0; live.netUp = 0; live.systemPower = 0;
      live.cpuTemp = null; live.cpuPower = null;
      live.gpuUsage = null; live.gpuTemp = null;
      live.gpuClock = null; live.gpuPower = null; live.gpuVramUsedMb = null;
      live.perCore = [];
      live.uptimeSec = 0;
      Object.keys(history).forEach(k => { history[k].length = 0; });
      for (let i = 0; i < MAXPTS; i++) {
        history.cpu.push(0); history.gpu.push(0); history.mem.push(0);
        history.power.push(0); history.io.push(0); history.net.push(0);
      }
      // 清掉上次运行写入的模拟档案，避免下次启动时先闪一帧假设备信息
      if (window.Store && window.Store.clearProfile) window.Store.clearProfile();
    },

    /** 原地替换数组内容，保持引用稳定 */
    replaceList(name, items) {
      const arr = this[name];
      if (!Array.isArray(arr) || !Array.isArray(items)) return;
      arr.length = 0;
      items.forEach(x => arr.push(x));
    },

    /** 写入一份原生实时快照（字段与模拟引擎同构） */
    applyNative(s) {
      if (!s) return;
      // 注意：这里必须「原样覆盖」，不能「跳过 null」。
      // 原生侧读不到的项返回 null（如 GeForce 老卡的 GPU 温度），
      // 若沿用上一次的值，就会把模拟引擎的默认值当成真机读数留在界面上。
      // null 是有意义的信息 —— 它表示「读不到」，界面应显示「—」。
      const keys = [
        'cpuUsage', 'cpuTemp', 'cpuClock', 'cpuPower',
        'memUsedGb', 'memPercent',
        'gpuUsage', 'gpuTemp', 'gpuClock', 'gpuPower', 'gpuVramUsedMb',
        'diskRead', 'diskWrite', 'netDown', 'netUp', 'systemPower'
      ];
      keys.forEach(k => {
        live[k] = (k in s) ? s[k] : null;
      });
      if (typeof s.uptimeSec === 'number') live.uptimeSec = s.uptimeSec;
      if (s.load) live.load = s.load;
      estimated = !!s.estimated;

      if (Array.isArray(s.perCore) && s.perCore.length) {
        live.perCore.length = 0;
        s.perCore.forEach(c => live.perCore.push({ usage: c.usage, temp: c.temp, clock: c.clock }));
      }

      nativeBat.known = true;
      nativeBat.pct = (s.batteryPercent === null || s.batteryPercent === undefined) ? null : s.batteryPercent;
      nativeBat.state = s.batteryState || 'unknown';

      history.cpu.push(live.cpuUsage);
      history.gpu.push(live.gpuUsage);
      history.mem.push(live.memPercent);
      history.power.push(live.systemPower || 0);
      history.io.push(live.diskRead);
      history.net.push(live.netDown);
      if (history.cpu.length > MAXPTS) {
        history.cpu.shift(); history.gpu.shift(); history.mem.shift();
        history.power.shift(); history.io.shift(); history.net.shift();
      }
      tickSubs.forEach(fn => fn(live));
    },

    /* 手机操作（原型：内存内变更） */
    phoneAction(id, action) {
      const app = phone.apps.find(a => a.id === id);
      if (!app) return null;
      if (action === 'uninstall') app.removed = true;
      if (action === 'freeze') app.frozen = true;
      if (action === 'restore') { app.frozen = false; app.removed = false; }
      return app;
    },
    connectPhone(v) {
      phone.connected = !!v;
      if (v) phone.link = 'usb';
    }
  };
})();
