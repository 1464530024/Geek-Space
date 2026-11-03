/* ============================================================
   极客空间 Geek Space — README 截图生成
   ------------------------------------------------------------
   用浏览器直接打开 geek-space/index.html（无原生壳 → 演示模式），
   注入设置绕过首次引导，逐视图截图到 .shots/。

   用法：
     npm i playwright            # 首次需要
     node tools/screenshot.js            # 生成全部
     node tools/screenshot.js bench      # 只重截文件名含 bench 的项

   随后执行 python tools/optimize-shots.py 压缩到 docs/images/。

   说明：
   - 用本机 Edge 内核（channel: 'msedge'），无需下载 Chromium
   - 截图里状态栏会显示「演示模式」，这是浏览器直开的真实状态
   ============================================================ */
const { chromium } = require('playwright');
const { pathToFileURL } = require('url');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const URL_INDEX = pathToFileURL(path.join(ROOT, 'geek-space', 'index.html')).href;
const OUT = path.join(ROOT, '.shots');
fs.mkdirSync(OUT, { recursive: true });

const KEY = 'geekspace.settings.v1';
const ONLY = process.argv[2] || '';

function settings(patch) {
  return Object.assign({
    version: 1, onboarded: true,
    theme: 'dark', style: 'geek', lang: 'zh',
    refresh: 1000, unit: 'c', showPower: true, showFan: true
  }, patch || {});
}

const shots = [];
let browser;

async function newPage(opts) {
  const { width = 1440, height = 900, scale = 1.5, cfg = {} } = opts;
  const ctx = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: scale });
  await ctx.addInitScript(([k, v]) => {
    try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* 无痕模式忽略 */ }
  }, [KEY, settings(cfg)]);
  const p = await ctx.newPage();
  p.on('pageerror', e => console.log('PAGEERROR:', e.message));
  p.on('console', m => { if (m.type() === 'error') console.log('CONSOLE:', m.text()); });
  await p.goto(URL_INDEX, { waitUntil: 'load' });
  await p.waitForTimeout(1400);
  return p;
}

async function go(p, view, sub) {
  const isM = await p.evaluate(() => window.Store.isMobile());
  await p.click(isM ? `[data-navtab="${view}"]` : `[data-nav="${view}"]`);
  await p.waitForTimeout(700);
  if (sub) {
    const attr = view === 'monitor' ? 'mtab' : view === 'tools' ? 'ttab' : 'ltab';
    await p.click(`[data-${attr}="${sub}"]`);
    await p.waitForTimeout(700);
  }
}

async function grab(name, opts) {
  if (ONLY && !name.includes(ONLY)) return;
  const p = await newPage(opts);
  if (opts.view) await go(p, opts.view, null);          // 先切视图
  if (opts.click) {                                     // 视图内操作（如连接手机）
    for (const c of opts.click) { await p.click(c); await p.waitForTimeout(opts.wait || 900); }
  }
  if (opts.sub) await go(p, opts.view, opts.sub);        // 再进子页签
  if (opts.click2) {                                    // 子页签内操作（如开始跑分）
    for (const c of opts.click2) { await p.click(c); await p.waitForTimeout(opts.wait || 900); }
  }
  if (opts.scroll) { await p.evaluate(y => window.scrollTo(0, y), opts.scroll); await p.waitForTimeout(400); }
  await p.waitForTimeout(600);
  const file = path.join(OUT, name + '.png');
  await p.screenshot({ path: file, fullPage: !!opts.full });
  shots.push({ name, size: fs.statSync(file).size });
  console.log('  shot:', name + '.png');
  await p.context().close();
}

(async () => {
  browser = await chromium.launch({ channel: 'msedge' });

  console.log('== 桌面端 ==');
  await grab('r-dashboard', { cfg: { theme: 'dark', style: 'geek' }, view: 'dashboard' });
  await grab('r-monitor-cpu', { cfg: { theme: 'dark', style: 'geek' }, view: 'monitor', sub: 'cpu' });
  await grab('r-monitor-gpu', { cfg: { theme: 'dark', style: 'geek' }, view: 'monitor', sub: 'gpu' });
  await grab('r-monitor-storage', { cfg: { theme: 'dark', style: 'geek' }, view: 'monitor', sub: 'storage' });
  await grab('r-link', { cfg: { theme: 'dark', style: 'geek' }, view: 'link', click: ['#btnSimConnect'], sub: 'apps' });
  await grab('r-tools-bench', { cfg: { theme: 'dark', style: 'geek' }, view: 'tools', sub: 'bench', click2: ['#btnBench'], wait: 5000 });
  await grab('r-tools-startup', { cfg: { theme: 'dark', style: 'geek' }, view: 'tools', sub: 'startup' });
  await grab('r-settings', { cfg: { theme: 'dark', style: 'geek' }, view: 'settings' });

  console.log('== 风格与配色 ==');
  await grab('r-style-minimal', { cfg: { theme: 'light-green', style: 'minimal' }, view: 'dashboard' });
  await grab('r-style-apple', { cfg: { theme: 'light-green', style: 'apple' }, view: 'dashboard' });
  await grab('r-theme-cyber', { cfg: { theme: 'cyber', style: 'geek' }, view: 'dashboard' });
  await grab('r-theme-ember', { cfg: { theme: 'ember', style: 'geek' }, view: 'dashboard' });
  await grab('r-theme-ice', { cfg: { theme: 'ice', style: 'geek' }, view: 'monitor', sub: 'cpu' });
  await grab('r-theme-sand', { cfg: { theme: 'sand', style: 'minimal' }, view: 'dashboard' });

  console.log('== 英文 ==');
  await grab('r-en-dashboard', { cfg: { theme: 'dark', style: 'geek', lang: 'en' }, view: 'dashboard' });
  await grab('r-en-monitor', { cfg: { theme: 'dark', style: 'geek', lang: 'en' }, view: 'monitor', sub: 'cpu' });

  console.log('== 移动端 ==');
  await grab('r-mobile-dashboard', { width: 390, height: 844, scale: 2, cfg: { theme: 'dark', lang: 'zh' }, view: 'dashboard' });
  await grab('r-mobile-monitor', { width: 390, height: 844, scale: 2, cfg: { theme: 'dark', lang: 'zh' }, view: 'monitor', sub: 'cpu' });
  await grab('r-mobile-tools', { width: 390, height: 844, scale: 2, cfg: { theme: 'dark', lang: 'zh' }, view: 'tools', sub: 'bench' });
  await grab('r-mobile-light', { width: 390, height: 844, scale: 2, cfg: { theme: 'light-green', lang: 'zh' }, view: 'dashboard' });

  console.log('== 首次引导 ==');
  if (!ONLY || 'onboard'.includes(ONLY)) {
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1.5 });
    await ctx.addInitScript(([k, v]) => {
      try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* ignore */ }
    }, [KEY, settings({ onboarded: false })]);
    const p = await ctx.newPage();
    await p.goto(URL_INDEX, { waitUntil: 'load' });
    await p.waitForTimeout(900);
    for (const [n, act] of [['r-onboard-welcome', null], ['r-onboard-colors', '#obNext']]) {
      if (act) { await p.click(act); await p.waitForTimeout(600); }
      const f = path.join(OUT, n + '.png');
      await p.screenshot({ path: f });
      shots.push({ name: n, size: fs.statSync(f).size });
      console.log('  shot:', n + '.png');
    }
    await ctx.close();
  }

  await browser.close();

  console.log('\n=== 汇总 ===');
  let total = 0;
  shots.forEach(s => { total += s.size; console.log(`  ${s.name.padEnd(24)} ${(s.size / 1024).toFixed(0)} KB`); });
  console.log(`  合计 ${(total / 1048576).toFixed(2)} MB，共 ${shots.length} 张`);
  console.log('  下一步：python tools/optimize-shots.py');
})();
