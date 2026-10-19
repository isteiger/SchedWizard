(function (root) {
  'use strict';
  if (root.__swContentLoaded) return;
  root.__swContentLoaded = true;
  const SW = (root.SW = root.SW || {});

  async function boot() {
    if (document.getElementById('sw-root')) return;
    const host = document.createElement('div');
    host.id = 'sw-root';
    host.style.cssText = 'all:initial;position:fixed;z-index:2147483000;top:0;left:0;width:0;height:0;';
    (document.body || document.documentElement).appendChild(host);
    const shadow = host.attachShadow({ mode: 'closed' });

    let cssText = '';
    try {
      const res = await fetch(chrome.runtime.getURL('src/ui/styles.css'));
      cssText = await res.text();
    } catch (e) {
      try {
        const link = document.createElement('link');
        link.rel = 'stylesheet';
        link.href = chrome.runtime.getURL('src/ui/styles.css');
        shadow.appendChild(link);
      } catch (e2) { /* no styles available */ }
    }

    if (!SW.ui || typeof SW.ui.mount !== 'function') {
      console.error('[SchedWizard] SW.ui missing');
      return;
    }
    const ctrl = SW.ui.mount(shadow, host, cssText);
    try {
      chrome.runtime.onMessage.addListener((msg) => {
        if (msg && msg.type === 'SW_TOGGLE') ctrl.toggle();
      });
    } catch (e) { /* extension context invalidated */ }
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})(typeof globalThis !== 'undefined' ? globalThis : this);
