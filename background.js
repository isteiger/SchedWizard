'use strict';
const BASE = 'https://selfservice.uncc.edu/StudentRegistrationSsb/';
const START = BASE + 'ssb/term/termSelection?mode=plan';

chrome.action.onClicked.addListener(async (tab) => {
  const onSite = !!(tab && tab.url && tab.url.startsWith(BASE));
  if (onSite) {
    try {
      await chrome.tabs.sendMessage(tab.id, { type: 'SW_TOGGLE' });
      return;
    } catch (e) {
      // Content script not present (tab was open before install) - reload so it injects.
      try { await chrome.tabs.reload(tab.id); return; } catch (e2) { /* fall through */ }
    }
  }
  chrome.tabs.create({ url: START });
});
