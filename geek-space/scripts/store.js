/* ============================================================
   极客空间 Geek Space — 设置状态与持久化
   ============================================================ */
(function () {
  'use strict';

  const KEY = 'geekspace.settings.v1';
  const PROFILE_KEY = 'geekspace.profile.v1';

  const DEFAULTS = {
    version: 1,
    onboarded: false,
    theme: 'dark',          // dark | light-green
    style: 'geek',          // geek | minimal | apple
    lang: 'zh',             // zh | en
    refresh: 1000,          // 500 | 1000 | 2000 | 0
    unit: 'c',              // c | f
    showPower: true,
    showFan: true
  };

  let state = Object.assign({}, DEFAULTS);
  const subs = [];

  const MQ_MOBILE = window.matchMedia('(max-width: 760px)');

  function isMobile() { return MQ_MOBILE.matches; }

  function load() {
    try {
      const raw = localStorage.getItem(KEY);
      if (raw) state = Object.assign({}, DEFAULTS, JSON.parse(raw));
    } catch (e) { state = Object.assign({}, DEFAULTS); }
  }

  function save() {
    try { localStorage.setItem(KEY, JSON.stringify(state)); } catch (e) { /* 私隐模式忽略 */ }
  }

  /* 应用令牌到 <html>，并同步 i18n */
  function apply() {
    const el = document.documentElement;
    el.dataset.theme = state.theme;
    // 移动端锁定统一视觉风格，避免颜色污染
    el.dataset.style = isMobile() ? 'geek' : state.style;
    el.setAttribute('lang', state.lang === 'en' ? 'en' : 'zh-CN');
    if (window.I18N) window.I18N.setLang(state.lang);
  }

  function emit(reason) {
    subs.forEach(fn => { try { fn(state, reason); } catch (e) { console.error(e); } });
  }

  window.Store = {
    get state() { return state; },
    defaults: DEFAULTS,
    isMobile,
    load,
    save,
    apply,
    set(patch, reason) {
      state = Object.assign({}, state, patch);
      save();
      apply();
      emit(reason || 'set');
    },
    subscribe(fn) { subs.push(fn); return () => { const i = subs.indexOf(fn); if (i >= 0) subs.splice(i, 1); }; },
    reset() {
      state = Object.assign({}, DEFAULTS);
      save();
      apply();
      emit('reset');
    },
    /* —— 模拟硬件档案（首次生成后固化，保证每次打开一致）—— */
    getProfile() {
      try {
        const raw = localStorage.getItem(PROFILE_KEY);
        if (raw) return JSON.parse(raw);
      } catch (e) { /* ignore */ }
      return null;
    },
    setProfile(p) {
      try { localStorage.setItem(PROFILE_KEY, JSON.stringify(p)); } catch (e) { /* ignore */ }
    },
    /** 原生模式下清掉模拟档案，避免下次启动先闪一帧假设备信息 */
    clearProfile() {
      try { localStorage.removeItem(PROFILE_KEY); } catch (e) { /* ignore */ }
    }
  };

  MQ_MOBILE.addEventListener
    ? MQ_MOBILE.addEventListener('change', () => { apply(); emit('viewport'); })
    : MQ_MOBILE.addListener(() => { apply(); emit('viewport'); });
})();
