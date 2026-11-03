/* ============================================================
   极客空间 Geek Space — 国际化 i18n
   ============================================================ */
(function () {
  'use strict';

  const DICT = {
    zh: {
      common: {
        back: '上一步', next: '下一步', finish: '进入极客空间', cancel: '取消',
        confirm: '确认', apply: '应用', close: '关闭', search: '搜索', all: '全部',
        save: '保存', reset: '重置', refresh: '刷新', loading: '加载中',
        enabled: '已启用', disabled: '已禁用', unknown: '未知', na: '—',
        version: '版本', seconds: '秒', items: '项', mobile: '移动端', desktop: '桌面端'
      },
      topbar: {
        live: '实时', paused: '已暂停', pause: '暂停 / 继续', uptime: '运行时长',
        samplesPerSec: '采样', hz: 'Hz'
      },
      nav: {
        dashboard: '概览', monitor: '硬件监控', link: '手机联动',
        tools: '搞机工具', settings: '设置'
      },
      navsub: {
        dashboard: '设备总览与实时指标',
        monitor: '处理器 · 内存 · 显卡 · 主板 · 显示器 · 存储 · 电池',
        link: '有线连接 · 高权限管理',
        tools: '跑分 · 传感器 · 启动项 · 驱动固件',
        settings: '外观 · 语言 · 监控 · 关于'
      },
      ob: {
        eyebrow: 'Geek Space',
        welcomeTitle: '欢迎来到 <span class="hl">极客空间</span>',
        welcomeSub: '一站式设备信息与硬件监控工作台。实时掌握处理器、显卡、内存、硬盘与电池状态，有线连接手机即可获得更高权限，卸载组件、管理文件，一台搞定。',
        feat1t: '实时硬件监控', feat1d: '温度 / 频率 / 功耗 / 健康度',
        feat2t: '有线连接联动', feat2d: '读取手机信息 · 高权限管理',
        feat3t: '设备跑分', feat3d: '单核 / 多核 / 图形 / 内存',
        feat4t: '搞机工具箱', feat4d: '传感器 · 启动项 · 驱动固件',
        colorTitle: '选择色彩风格', colorSub: '之后可随时在「设置」中修改',
        colorDark: '黑色深色', colorDarkD: '低光环境友好，长时间盯盘不刺眼',
        colorLight: '白色 + 绿色', colorLightD: '明亮清爽，日光下阅读清晰',
        langTitle: '选择界面语言', langSub: 'Language / 语言',
        styleTitle: '选择桌面视觉风格', styleSub: '仅桌面端生效，移动端使用统一风格'
      },
      style: {
        geek: '机械科技', geekD: '金属质感 · 铆钉刻度 · 硬朗直角',
        minimal: '简约线条', minimalD: '细线框 · 大留白 · 零装饰',
        apple: '拟物 iOS', appleD: '毛玻璃 · 大圆角 · 高光胶囊'
      },
      color: {
        dark: '黑色深色', darkD: '低光环境友好，长时间盯盘不刺眼',
        lightGreen: '白色 + 绿色', lightGreenD: '明亮清爽，日光下阅读清晰',
        cyber: '赛博霓虹', cyberD: '深紫黑底 + 霓虹青与品红',
        ember: '熔岩橙红', emberD: '深棕黑底 + 熔岩橙红，冲击力强',
        ice: '冰川蓝', iceD: '浅冷灰底 + 冰川蓝，冷静克制',
        sand: '暖沙米色', sandD: '暖白底 + 琥珀砖红，护眼舒适'
      },
      na: {
        noSensor: '需装 LibreHardwareMonitor',
        noBattery: '本机未检测到电池',
        noSmart: '该设备未上报 SMART',
        noPowerOn: '通电次数不可读（需管理员权限或 smartctl）',
        noFan: '该设备未开放风扇转速',
        noVolume: '未识别到分区',
        desktopOnly: '仅桌面端支持',
        notSupported: '本机不支持',
        needAdmin: '需要管理员权限',
        detected: '已检测',
        unknown: '无法读取'
      },
      dashboard: {
        deviceInfo: '设备信息', hostname: '主机名', os: '操作系统', cpu: '处理器',
        gpu: '显卡', memory: '内存', board: '主板', uptime: '运行时长',
        liveTrend: '实时趋势', overallPower: '整机功耗', cpuUsage: 'CPU 使用率',
        gpuUsage: 'GPU 使用率', memUsage: '内存占用', cpuTemp: 'CPU 温度',
        gpuTemp: 'GPU 温度', diskUsage: '系统盘占用', cpuFan: 'CPU 风扇',
        diskHealth: '硬盘健康', quickStatus: '快速状态', battery: '电池',
        processes: '进程占用 TOP', processName: '进程', pCpu: 'CPU', pMem: '内存',
        powerBudget: '功耗预算', fromWall: '整机瞬时',
        loadLevel: '负载等级', idle: '轻载', normal: '常规', heavy: '重载', extreme: '极限',
        network: '网络速率', online: '在线', netDown: '下行', netUp: '上行',
        free: '可用', batHealth: '电池健康', sysDiskOf: '系统盘', osInstall: '系统安装日期'
      },
      monitor: {
        tabCpu: '处理器', tabMem: '内存', tabGpu: '显卡', tabBoard: '主板',
        tabDisplay: '显示器', tabStorage: '存储', tabBattery: '电池',
        cpuSpec: '处理器规格', cpuModel: '型号', cpuVendor: '厂商', codename: '代号', cores: '核心', threads: '线程',
        baseClock: '基准频率', boostClock: '加速频率', curClock: '当前频率', usage: '使用率', temp: '温度',
        power: '功耗', perCore: '核心负载矩阵', l3: '三级缓存', process: '制程',
        packageTemp: '封装温度', throttle: '降频状态', socket: '插槽',
        memTotal: '总容量', memType: '类型', memSpeed: '频率', channels: '通道',
        memUsed: '已使用', memAvail: '可用', slots: '内存插槽', swap: '虚拟内存',
        gpuModel: '型号', vram: '显存', driver: '驱动版本', coreClock: '核心频率',
        memClock: '显存频率', gpuLoad: '图形负载', gpuPower: '显卡功耗',
        boardMfr: '厂商', boardModel: '型号', chipset: '芯片组',
        biosVer: 'BIOS 版本', biosDate: 'BIOS 日期', ecVer: 'EC 版本', biosVendor: 'BIOS 厂商', boardRev: '主板版本',
        noBatteryDesc: '本机是台式机 / 迷你主机，未检测到系统电池。电池健康度与循环次数仅在笔记本电脑或移动端可用。',
        dispModel: '型号', resolution: '分辨率', refreshRate: '刷新率',
        size: '尺寸', panel: '面板', serial: '序列号', hdr: 'HDR',
        diskModel: '型号', iface: '接口', diskCap: '容量', used: '已用',
        health: '健康度', smart: 'SMART 状态', powerOn: '通电次数',
        readSpeed: '顺序读', writeSpeed: '顺序写', diskTemp: '温度',
        volumes: '分区 / 卷', volume: '卷', fsType: '文件系统',
        throughput: '实时吞吐', realRead: '实际读', realWrite: '实际写',
        netDown: '网络下行', netUp: '网络上行',
        batStatus: '状态', designCap: '设计容量', fullCap: '满充容量',
        healthPct: '健康度', cycles: '循环次数', voltage: '电压',
        batTemp: '电池温度', timeLeft: '预计可用', charging: '充电中',
        discharging: '放电中', full: '已充满', notPresent: '未检测到电池',
        good: '良好', normal: '正常', warn: '注意', bad: '异常',
        noBattery: '未检测到电池',
        systemModel: '主机型号',
        l1l2: '二级缓存', virtualization: '虚拟化', dataWidth: '数据宽度',
        supported: '已支持', unsupported: '不支持',
        videoProcessor: '视频处理器', colorDepth: '色深', displayCount: '显示器数量',
        machineType: '机型', ecVerFull: '嵌入式控制器', chipsetVendor: '芯片组厂商',
        memSlotDetail: '插槽明细', totalSlots: '插槽总数', usedSlots: '已用插槽'
      },
      source: {
        native: '原生采集', demo: '演示模式', estimated: '含估算值', degraded: '部分数据不可用'
      },
      link: {
        connectTitle: '有线连接', connectSub: '通过 USB 数据线连接手机以获取更高权限',
        connected: '已连接', disconnected: '未连接', deviceName: '设备名称',
        model: '型号', androidVer: 'Android 版本', serialNo: '序列号',
        connType: '连接方式', usb: 'USB 线缆', wireless: '无线调试',
        disconnect: '断开连接',
        appMgmt: '应用管理', fileMgmt: '文件管理', systemApp: '系统应用',
        userApp: '普通应用', frozen: '已冻结', uninstall: '卸载', freeze: '冻结',
        restore: '还原', extractApk: '提取 APK', packageName: '包名',
        sizeCol: '大小', risk: '风险', riskSafe: '安全', riskWarn: '需谨慎',
        riskDanger: '高危', searchApp: '搜索应用或包名…', path: '路径',
        fileName: '文件', modified: '修改时间', download: '下载', delete: '删除',
        storageInfo: '存储占用', noDevice: '未检测到设备',
        noDeviceDesc: '请用 USB 数据线连接手机，并在手机上开启「开发者选项 → USB 调试」，随后确认授权弹窗。',
        rescan: '重新扫描', totalApps: '应用总数', selected: '已选'
      },
      tools: {
        tabBench: '设备跑分', tabSensors: '传感器', tabStartup: '启动项 / 服务',
        tabDrivers: '驱动与固件',
        benchmark: '性能基准', runBench: '开始跑分', benchAgain: '重新跑分',
        running: '测试中', single: '单核', multi: '多核', graphic: '图形',
        memoryScore: '内存', totalScore: '综合得分', benchHistory: '历史记录',
        lastRun: '最近一次', comparing: '参考机型', perfTier: '性能档位',
        sensorName: '传感器', sensorType: '类型', sensorValue: '当前值',
        sensorMin: '最低', sensorMax: '最高',
        startupName: '项目名称', publisher: '发行者', status: '状态',
        startType: '启动类型', auto: '自动', manual: '手动', boot: '开机启动',
        enable: '启用', disable: '禁用', services: '系统服务',
        driverDevice: '设备', driverVer: '驱动版本', driverDate: '驱动日期',
        driverVendor: '厂商', firmware: '固件信息', biosVersion: 'BIOS',
        embeddedVer: '嵌入式控制器', meVer: '管理引擎',
        srcRegistry: '注册表自启', srcFolder: '启动文件夹', srcTask: '计划任务',
        noSensors: '本机暂无可读传感器',
        noSensorsWin: 'Windows 用户态无法直接读取温度/电压/风扇，需安装 LibreHardwareMonitor 后才能显示完整传感器。显卡利用率已通过系统性能计数器单独采集。',
        noSensorsMobile: '受系统权限限制，多数安卓机型只开放有限的温度节点。当前设备未提供可读传感器。',
        sensorHintWin: '当前未安装 LibreHardwareMonitor，因此只能读到少数传感器。安装它并开启 WMI Provider，即可显示 CPU/主板/硬盘的温度、风扇转速与电压。'
      },
      settings: {
        appearance: '外观', colorScheme: '色彩风格', style: '桌面视觉风格',
        styleHint: '当前为移动端布局，桌面三风格已锁定为统一视觉',
        language: '界面语言', monitoring: '监控', refreshRate: '刷新频率',
        r05: '0.5 秒', r1: '1 秒', r2: '2 秒', rPause: '暂停',
        temperatureUnit: '温度单位', celsius: '摄氏 °C', fahrenheit: '华氏 °F',
        showPower: '显示功耗数据', showFan: '显示风扇转速',
        data: '数据', exportData: '导出设备报告', exportOk: '设备报告已导出',
        resetAll: '恢复默认设置', resetConfirm: '将清除全部偏好并重新运行引导页，确定继续？',
        about: '关于', aboutDesc: '个人使用的设备信息与硬件监控工作台。项目不含盈利与广告，可通过安装包直接分发。',
        runOnboard: '重新运行引导页', buildChannel: '构建渠道', license: '授权',
        dangerZone: '危险区域', deviceReport: '设备报告'
      },
      toast: {
        uninstalled: '已卸载 {name}', frozen: '已冻结 {name}', restored: '已还原 {name}',
        disconnected: '设备已断开', connected: '设备已连接',
        settingsReset: '已恢复默认设置', copied: '已复制到剪贴板',
        benchDone: '跑分完成，综合得分 {score}', scanning: '正在扫描设备…',
        notAvailable: '演示原型：该操作需在原生版本中接入真实设备'
      }
    },

    en: {
      common: {
        back: 'Back', next: 'Next', finish: 'Enter Geek Space', cancel: 'Cancel',
        confirm: 'Confirm', apply: 'Apply', close: 'Close', search: 'Search', all: 'All',
        save: 'Save', reset: 'Reset', refresh: 'Refresh', loading: 'Loading',
        enabled: 'Enabled', disabled: 'Disabled', unknown: 'Unknown', na: '—',
        version: 'Version', seconds: 's', items: 'items', mobile: 'Mobile', desktop: 'Desktop'
      },
      topbar: {
        live: 'LIVE', paused: 'PAUSED', pause: 'Pause / Resume', uptime: 'Uptime',
        samplesPerSec: 'Sampling', hz: 'Hz'
      },
      nav: {
        dashboard: 'Overview', monitor: 'Hardware', link: 'Device Link',
        tools: 'Geek Tools', settings: 'Settings'
      },
      navsub: {
        dashboard: 'Device summary & live metrics',
        monitor: 'CPU · Memory · GPU · Board · Display · Storage · Battery',
        link: 'Wired connection · elevated control',
        tools: 'Benchmark · Sensors · Startup · Drivers',
        settings: 'Appearance · Language · Monitoring · About'
      },
      ob: {
        eyebrow: 'Geek Space',
        welcomeTitle: 'Welcome to <span class="hl">Geek Space</span>',
        welcomeSub: 'One workbench for device info and hardware monitoring. Watch CPU, GPU, memory, storage and battery in real time; plug in a phone over USB for elevated control — uninstall components, manage files, all in one place.',
        feat1t: 'Live hardware monitor', feat1d: 'Temp / clock / power / health',
        feat2t: 'Wired device link', feat2d: 'Read phone info · elevated control',
        feat3t: 'Device benchmark', feat3d: 'Single / multi / graphics / memory',
        feat4t: 'Geek toolbox', feat4d: 'Sensors · startup · drivers',
        colorTitle: 'Choose a color scheme', colorSub: 'You can change this anytime in Settings',
        colorDark: 'Black Dark', colorDarkD: 'Easy on the eyes in low light',
        colorLight: 'White + Green', colorLightD: 'Bright and crisp under daylight',
        langTitle: 'Choose your language', langSub: 'Language / 语言',
        styleTitle: 'Choose a desktop style', styleSub: 'Desktop only — mobile uses one unified style'
      },
      style: {
        geek: 'Mechanical', geekD: 'Metal texture · rivets · hard edges',
        minimal: 'Minimal', minimalD: 'Hairline frames · space · no ornament',
        apple: 'Skeuomorphic iOS', appleD: 'Frosted glass · big radius · glossy pills'
      },
      color: {
        dark: 'Black Dark', darkD: 'Easy on the eyes in low light',
        lightGreen: 'White + Green', lightGreenD: 'Bright and crisp under daylight',
        cyber: 'Cyber Neon', cyberD: 'Deep violet base + neon cyan & magenta',
        ember: 'Ember Orange', emberD: 'Dark brown base + lava orange, high impact',
        ice: 'Glacier Blue', iceD: 'Cool light grey + glacier blue, calm and restrained',
        sand: 'Warm Sand', sandD: 'Warm off-white + amber & brick red, easy on eyes'
      },
      na: {
        noSensor: 'Install LibreHardwareMonitor',
        noBattery: 'No battery on this machine',
        noSmart: 'SMART not reported',
        noPowerOn: 'Power-on count unreadable (needs admin or smartctl)',
        noFan: 'Fan speed not exposed',
        noVolume: 'No volume detected',
        desktopOnly: 'Desktop only',
        notSupported: 'Not supported here',
        needAdmin: 'Requires admin rights',
        detected: 'Detected',
        unknown: 'Unreadable'
      },
      dashboard: {
        deviceInfo: 'Device Info', hostname: 'Hostname', os: 'Operating system', cpu: 'Processor',
        gpu: 'Graphics', memory: 'Memory', board: 'Motherboard', uptime: 'Uptime',
        liveTrend: 'Live Trend', overallPower: 'System Power', cpuUsage: 'CPU Usage',
        gpuUsage: 'GPU Usage', memUsage: 'Memory Load', cpuTemp: 'CPU Temp',
        gpuTemp: 'GPU Temp', diskUsage: 'System Disk', cpuFan: 'CPU Fan',
        diskHealth: 'Disk Health', quickStatus: 'Quick Status', battery: 'Battery',
        processes: 'Top Processes', processName: 'Process', pCpu: 'CPU', pMem: 'Memory',
        powerBudget: 'Power budget', fromWall: 'Instant draw',
        loadLevel: 'Load level', idle: 'Idle', normal: 'Normal', heavy: 'Heavy', extreme: 'Extreme',
        network: 'Network', online: 'Online', netDown: 'Down', netUp: 'Up',
        free: 'free', batHealth: 'Battery health', sysDiskOf: 'System disk', osInstall: 'OS installed'
      },
      monitor: {
        tabCpu: 'Processor', tabMem: 'Memory', tabGpu: 'Graphics', tabBoard: 'Motherboard',
        tabDisplay: 'Display', tabStorage: 'Storage', tabBattery: 'Battery',
        cpuSpec: 'Processor specs', cpuModel: 'Model', cpuVendor: 'Vendor', codename: 'Codename', cores: 'Cores', threads: 'Threads',
        baseClock: 'Base clock', boostClock: 'Boost clock', curClock: 'Current clock', usage: 'Usage', temp: 'Temp',
        power: 'Power', perCore: 'Per-core load matrix', l3: 'L3 cache', process: 'Process node',
        packageTemp: 'Package temp', throttle: 'Throttling', socket: 'Socket',
        memTotal: 'Total', memType: 'Type', memSpeed: 'Speed', channels: 'Channels',
        memUsed: 'Used', memAvail: 'Available', slots: 'DIMM slots', swap: 'Swap',
        gpuModel: 'Model', vram: 'VRAM', driver: 'Driver', coreClock: 'Core clock',
        memClock: 'Memory clock', gpuLoad: 'Graphics load', gpuPower: 'Board power',
        boardMfr: 'Vendor', boardModel: 'Model', chipset: 'Chipset',
        biosVer: 'BIOS version', biosDate: 'BIOS date', ecVer: 'EC version', biosVendor: 'BIOS vendor', boardRev: 'Board revision',
        noBatteryDesc: 'This is a desktop or mini PC with no system battery. Battery health and cycle count are only available on laptops and mobile devices.',
        dispModel: 'Model', resolution: 'Resolution', refreshRate: 'Refresh rate',
        size: 'Size', panel: 'Panel', serial: 'Serial', hdr: 'HDR',
        diskModel: 'Model', iface: 'Interface', diskCap: 'Capacity', used: 'Used',
        health: 'Health', smart: 'SMART status', powerOn: 'Power-on count',
        readSpeed: 'Seq. read', writeSpeed: 'Seq. write', diskTemp: 'Temp',
        volumes: 'Volumes', volume: 'Volume', fsType: 'File system',
        throughput: 'Live throughput', realRead: 'Actual read', realWrite: 'Actual write',
        netDown: 'Network down', netUp: 'Network up',
        batStatus: 'Status', designCap: 'Design capacity', fullCap: 'Full charge',
        healthPct: 'Health', cycles: 'Cycle count', voltage: 'Voltage',
        batTemp: 'Battery temp', timeLeft: 'Time remaining', charging: 'Charging',
        discharging: 'Discharging', full: 'Fully charged', notPresent: 'No battery detected',
        good: 'Good', normal: 'Normal', warn: 'Watch', bad: 'Fault',
        noBattery: 'No battery detected',
        systemModel: 'System model',
        l1l2: 'L2 cache', virtualization: 'Virtualization', dataWidth: 'Data width',
        supported: 'Enabled', unsupported: 'Disabled',
        videoProcessor: 'Video processor', colorDepth: 'Color depth', displayCount: 'Displays',
        machineType: 'Chassis', ecVerFull: 'Embedded controller', chipsetVendor: 'Chipset vendor',
        memSlotDetail: 'Module detail', totalSlots: 'Total slots', usedSlots: 'Populated'
      },
      source: {
        native: 'Native', demo: 'Demo mode', estimated: 'Partly estimated', degraded: 'Partial data'
      },
      link: {
        connectTitle: 'Wired Connection', connectSub: 'Connect a phone over USB for elevated control',
        connected: 'Connected', disconnected: 'Disconnected', deviceName: 'Device',
        model: 'Model', androidVer: 'Android', serialNo: 'Serial',
        connType: 'Link type', usb: 'USB cable', wireless: 'Wireless ADB',
        disconnect: 'Disconnect',
        appMgmt: 'Apps', fileMgmt: 'Files', systemApp: 'System',
        userApp: 'User', frozen: 'Frozen', uninstall: 'Uninstall', freeze: 'Freeze',
        restore: 'Restore', extractApk: 'Extract APK', packageName: 'Package',
        sizeCol: 'Size', risk: 'Risk', riskSafe: 'Safe', riskWarn: 'Careful',
        riskDanger: 'Critical', searchApp: 'Search app or package…', path: 'Path',
        fileName: 'File', modified: 'Modified', download: 'Download', delete: 'Delete',
        storageInfo: 'Storage', noDevice: 'No device detected',
        noDeviceDesc: 'Connect a phone via USB, enable “Developer options → USB debugging”, then approve the prompt on the phone.',
        rescan: 'Rescan', totalApps: 'Total apps', selected: 'selected'
      },
      tools: {
        tabBench: 'Benchmark', tabSensors: 'Sensors', tabStartup: 'Startup / Services',
        tabDrivers: 'Drivers & Firmware',
        benchmark: 'Performance Benchmark', runBench: 'Start benchmark',
        benchAgain: 'Run again', running: 'Testing', single: 'Single-core',
        multi: 'Multi-core', graphic: 'Graphics', memoryScore: 'Memory',
        totalScore: 'Total score', benchHistory: 'History', lastRun: 'Last run',
        comparing: 'Reference', perfTier: 'Tier',
        sensorName: 'Sensor', sensorType: 'Type', sensorValue: 'Value',
        sensorMin: 'Min', sensorMax: 'Max',
        startupName: 'Item', publisher: 'Publisher', status: 'Status',
        startType: 'Start type', auto: 'Automatic', manual: 'Manual', boot: 'At boot',
        enable: 'Enable', disable: 'Disable', services: 'Services',
        driverDevice: 'Device', driverVer: 'Version', driverDate: 'Date',
        driverVendor: 'Vendor', firmware: 'Firmware', biosVersion: 'BIOS',
        embeddedVer: 'Embedded controller', meVer: 'Management engine',
        srcRegistry: 'Registry Run', srcFolder: 'Startup folder', srcTask: 'Scheduled task',
        noSensors: 'No readable sensors',
        noSensorsWin: 'Windows user mode cannot read temperature / voltage / fan directly. Install LibreHardwareMonitor to expose the full sensor set. GPU utilization is collected separately via system performance counters.',
        noSensorsMobile: 'Android restricts most thermal nodes without root. This device exposes no readable sensors.',
        sensorHintWin: 'LibreHardwareMonitor is not installed, so only a few sensors are available. Install it and enable the WMI provider to expose CPU / motherboard / drive temperatures, fan speeds and voltages.'
      },
      settings: {
        appearance: 'Appearance', colorScheme: 'Color scheme', style: 'Desktop style',
        styleHint: 'Mobile layout active — the three desktop styles are locked to one unified look',
        language: 'Language', monitoring: 'Monitoring', refreshRate: 'Refresh rate',
        r05: '0.5 s', r1: '1 s', r2: '2 s', rPause: 'Paused',
        temperatureUnit: 'Temperature unit', celsius: 'Celsius °C', fahrenheit: 'Fahrenheit °F',
        showPower: 'Show power draw', showFan: 'Show fan speed',
        data: 'Data', exportData: 'Export device report', exportOk: 'Device report exported',
        resetAll: 'Restore defaults', resetConfirm: 'This clears all preferences and reruns onboarding. Continue?',
        about: 'About', aboutDesc: 'A personal device-info and hardware-monitoring workbench. No monetization, no ads — distributed as an installer.',
        runOnboard: 'Run onboarding again', buildChannel: 'Build channel', license: 'License',
        dangerZone: 'Danger zone', deviceReport: 'Device report'
      },
      toast: {
        uninstalled: 'Uninstalled {name}', frozen: 'Frozen {name}', restored: 'Restored {name}',
        disconnected: 'Device disconnected', connected: 'Device connected',
        settingsReset: 'Defaults restored', copied: 'Copied to clipboard',
        benchDone: 'Benchmark done — total {score}', scanning: 'Scanning devices…',
        notAvailable: 'Prototype: this needs the native build for real devices'
      }
    }
  };

  const state = { lang: 'zh' };

  function walk(obj, path) {
    return path.split('.').reduce((acc, k) => (acc && acc[k] != null ? acc[k] : undefined), obj);
  }

  window.I18N = {
    dict: DICT,
    get lang() { return state.lang; },
    setLang(l) { state.lang = DICT[l] ? l : 'zh'; },
    t(key, vars) {
      let s = walk(DICT[state.lang], key);
      if (s == null) s = walk(DICT.zh, key);
      if (s == null) return key;
      if (vars) {
        Object.keys(vars).forEach(k => { s = s.replace(new RegExp('\\{' + k + '\\}', 'g'), vars[k]); });
      }
      return s;
    },
    /* 把 data-i18n / data-i18n-html / data-i18n-title / data-i18n-ph 绑定到 DOM */
    apply(root) {
      const scope = root || document;
      scope.querySelectorAll('[data-i18n]').forEach(el => {
        el.textContent = window.I18N.t(el.getAttribute('data-i18n'));
      });
      scope.querySelectorAll('[data-i18n-html]').forEach(el => {
        el.innerHTML = window.I18N.t(el.getAttribute('data-i18n-html'));
      });
      scope.querySelectorAll('[data-i18n-title]').forEach(el => {
        el.setAttribute('title', window.I18N.t(el.getAttribute('data-i18n-title')));
      });
      scope.querySelectorAll('[data-i18n-ph]').forEach(el => {
        el.setAttribute('placeholder', window.I18N.t(el.getAttribute('data-i18n-ph')));
      });
    }
  };
})();
