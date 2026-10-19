(function (root) {
  'use strict';
  const SW = (root.SW = root.SW || {});

  // ---------------------------------------------------------------- helpers
  const STEPS = ['Term', 'Courses', 'Breaks & Preferences', 'Sections & Professors', 'Schedules'];
  const DAY_LETTERS = [['U', 0], ['M', 1], ['T', 2], ['W', 3], ['R', 4], ['F', 5], ['S', 6]];
  const DAY_ORDER = [['M', 1], ['T', 2], ['W', 3], ['R', 4], ['F', 5], ['S', 6], ['U', 0]];
  const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  const PALETTE = ['#2E7D5B', '#A49665', '#3B6EA5', '#8E5572', '#C27C2C', '#4F7F7F', '#6B5B95', '#7A8B2E'];
  const SORTS = [
    ['compact', 'Most compact (fewest gaps)'],
    ['fewestDays', 'Fewest days on campus'],
    ['latestStart', 'Latest start'],
    ['earliestEnd', 'Earliest finish'],
    ['mostSeats', 'Most open seats'],
    ['bestProfs', 'Best-rated professors'],
  ];
  const STORAGE_KEY = 'sw_state_v1';
  const PLANS_URL = '/StudentRegistrationSsb/ssb/plan/selectPlan';

  function h(tag, attrs) {
    const el = document.createElement(tag);
    let deferred = null;
    if (attrs) {
      for (const k of Object.keys(attrs)) {
        const v = attrs[k];
        if (v == null || v === false) continue;
        if (k === 'class') el.className = v;
        else if (k === 'style' && typeof v === 'object') {
          for (const sk of Object.keys(v)) {
            if (sk.startsWith('--')) el.style.setProperty(sk, v[sk]);
            else el.style[sk] = v[sk];
          }
        } else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
        else if (k === 'value' || k === 'checked' || k === 'indeterminate' || k === 'selected') (deferred = deferred || {})[k] = v;
        else if (k === 'disabled') el.disabled = !!v;
        else el.setAttribute(k, v === true ? '' : String(v));
      }
    }
    for (let i = 2; i < arguments.length; i++) appendKid(el, arguments[i]);
    if (deferred) for (const k of Object.keys(deferred)) el[k] = deferred[k];
    return el;
  }
  function appendKid(el, kid) {
    if (kid == null || kid === false) return;
    if (Array.isArray(kid)) { kid.forEach((k) => appendKid(el, k)); return; }
    if (kid instanceof Node) el.appendChild(kid);
    else el.appendChild(document.createTextNode(String(kid)));
  }

  function pad2(n) { return (n < 10 ? '0' : '') + n; }
  function toMin(hhmm) {
    if (!hhmm || typeof hhmm !== 'string') return null;
    const m = /^(\d{1,2}):(\d{2})/.exec(hhmm);
    return m ? parseInt(m[1], 10) * 60 + parseInt(m[2], 10) : null;
  }
  function fromMin(min) {
    if (min == null) return '';
    return pad2(Math.floor(min / 60)) + ':' + pad2(min % 60);
  }
  function minLabel(m) {
    if (SW.solver && typeof SW.solver.minutesToLabel === 'function') {
      try { return SW.solver.minutesToLabel(m); } catch (e) { /* fallback */ }
    }
    let hh = Math.floor(m / 60);
    const mm = m % 60, ap = hh >= 12 ? 'PM' : 'AM';
    hh = hh % 12; if (hh === 0) hh = 12;
    return hh + ':' + pad2(mm) + ' ' + ap;
  }
  function daysLabel(days) {
    if (SW.solver && typeof SW.solver.daysToLabel === 'function') {
      try { return SW.solver.daysToLabel(days); } catch (e) { /* fallback */ }
    }
    const letters = { 0: 'U', 1: 'M', 2: 'T', 3: 'W', 4: 'R', 5: 'F', 6: 'S' };
    return days.slice().sort((a, b) => ((a + 6) % 7) - ((b + 6) % 7)).map((d) => letters[d]).join('');
  }
  function meetingLabel(m) {
    return daysLabel(m.days) + ' ' + minLabel(m.start) + '–' + minLabel(m.end);
  }
  function sectionTimes(sec) {
    if (!sec.meetings || !sec.meetings.length) return 'Online / TBA';
    return sec.meetings.map(meetingLabel).join('; ');
  }
  function sectionLocation(sec) {
    const locs = [];
    (sec.meetings || []).forEach((m) => { if (m.location && locs.indexOf(m.location) < 0) locs.push(m.location); });
    return locs.join('; ') || (sec.online ? sec.method || 'Online' : '—');
  }
  function profLabel(sec) { return sec.instructors && sec.instructors.length ? sec.instructors.join(' / ') : 'TBA'; }
  // Primary (first) instructor used for RateMyProfessors lookups; null for TBA/empty.
  function cleanProfName(n) {
    const t = String(n == null ? '' : n).trim();
    return !t || /^tba$/i.test(t) ? null : t;
  }
  function primaryProf(sec) {
    return sec && sec.instructors && sec.instructors.length ? cleanProfName(sec.instructors[0]) : null;
  }
  function primaryOfKey(key) { return cleanProfName(String(key || '').split(' / ')[0]); }
  function rmpColor(r) { return r >= 4.0 ? '#2E7D32' : r >= 3.0 ? '#C98A00' : '#B3261E'; }
  function monthYear(d) {
    const t = d ? new Date(String(d).replace(' ', 'T')) : null;
    if (!t || isNaN(t.getTime())) return null;
    return ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][t.getMonth()] + ' ' + t.getFullYear();
  }
  function normalizeCourseKey(raw) {
    const m = /^\s*([A-Za-z]{2,5})[\s\-_]*([0-9]{3,4}[A-Za-z]?)\s*$/.exec(raw || '');
    return m ? m[1].toUpperCase() + ' ' + m[2].toUpperCase() : null;
  }
  // Course input forms: "MATH 2164", "MATH 2164-003", "MATH 2164 003", "MATH2164.003", bare 5-digit CRN.
  function parseCourseInput(raw) {
    const t = String(raw == null ? '' : raw).trim();
    if (/^\d{5}$/.test(t)) return { crn: t };
    const m = /^([A-Za-z]{2,5})[\s\-_]*([0-9]{3,4}[A-Za-z]?)[\s\-_.]+([0-9A-Za-z]{2,4})$/.exec(t);
    if (m) return { key: m[1].toUpperCase() + ' ' + m[2].toUpperCase(), section: m[3].toUpperCase() };
    const key = normalizeCourseKey(t);
    return key ? { key } : null;
  }
  function sameSection(a, b) {
    const x = String(a || '').toUpperCase(), y = String(b || '').toUpperCase();
    if (x === y) return true;
    return /^\d+$/.test(x) && /^\d+$/.test(y) && parseInt(x, 10) === parseInt(y, 10);
  }
  const MODALITIES = [
    ['any', 'No preference'],
    ['preferOnline', 'Prefer online'],
    ['preferInPerson', 'Prefer in-person'],
    ['onlineOnly', 'Online only'],
    ['inPersonOnly', 'In-person only'],
  ];
  const MOD_LABELS = { online: 'Online', hybrid: 'Hybrid', inperson: 'In person' };
  function modalityOf(sec) {
    return SW.solver && SW.solver.modalityOf ? SW.solver.modalityOf(sec) : (sec && sec.online ? 'online' : 'inperson');
  }
  function modTag(sec) {
    const m = modalityOf(sec);
    return h('span', { class: 'mod-tag ' + m }, MOD_LABELS[m]);
  }
  function isFull(sec) { return !(sec.seats > 0); }
  function errMsg(e) { return (e && e.message) || String(e || 'Unknown error'); }
  function uid() { return Math.random().toString(36).slice(2, 9); }

  // ---------------------------------------------------------------- mount
  function mount(shadow, host, cssText) {
    // ---- state
    const defaultOptions = () => ({ earliest: null, latest: null, daysOff: [], allowFull: false, sort: 'compact', minRating: null, allowUnrated: true, modality: 'any' });
    const S = {
      open: false,
      initialized: false,
      initializing: false,
      initError: null,
      sessionExpired: false,
      terms: [],
      term: null,
      step: 0,
      courses: [],            // keys, in order
      breaks: [],             // {id, days, start, end, label}
      options: defaultOptions(),
      deselected: {},         // crn -> true
      locks: {},              // courseKey -> {section, crns[]} (typed "locked to one section")
      byTerm: {},             // term -> saved snapshot (persisted)
      plans: { term: null, status: 'idle', list: [], max: 5, error: '' },  // existing Banner plans
      plansOpen: true,
      planView: null,         // {plan, loading, sections, missing} read-only plan view in the Schedules step
      // runtime only
      cache: {},              // term|key -> {status, sections, title, error}
      courseInput: '',
      openCourses: {},
      openProfs: {},
      sortProfs: true,        // sort professors by RMP rating in step 4
      generating: false,
      result: null,           // {schedules,total,truncated,errors}
      selIdx: 0,
      rmp: {},                // prof name -> RmpInfo | null | 'loading'
      modal: null,            // {name, running, lines, done, ok, messages, failed}
    };

    // ---- DOM skeleton
    const style = h('style');
    style.textContent = cssText || '';
    const launcher = h('button', { class: 'launcher', type: 'button', title: 'Open Niner Schedule Wizard', onclick: () => ctrl.toggle() },
      h('span', { class: 'launcher-icon' }, '✨'), h('span', null, 'Schedule Wizard'));
    const panelWrap = h('div', { class: 'overlay', hidden: true });
    shadow.append(style, launcher, panelWrap);

    ['keydown', 'keyup', 'keypress'].forEach((ev) => host.addEventListener(ev, (e) => e.stopPropagation()));
    panelWrap.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        if (S.modal && !S.modal.running) { S.modal = null; render(); } else if (!S.modal) ctrl.close();
      }
    });

    // ---- persistence
    function snapshot() {
      return { courses: S.courses.slice(), breaks: S.breaks, options: S.options, deselected: S.deselected, locks: S.locks };
    }
    function save() {
      try {
        if (S.term) S.byTerm[S.term] = snapshot();
        const payload = Object.assign({ term: S.term, byTerm: S.byTerm }, snapshot());
        if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
          chrome.storage.local.set({ [STORAGE_KEY]: payload }, () => { void (chrome.runtime && chrome.runtime.lastError); });
        }
      } catch (e) { /* ignore */ }
    }
    function loadStored() {
      return new Promise((resolve) => {
        try {
          chrome.storage.local.get(STORAGE_KEY, (r) => {
            void chrome.runtime.lastError;
            resolve((r && r[STORAGE_KEY]) || null);
          });
        } catch (e) { resolve(null); }
      });
    }
    function applySnapshot(snap) {
      snap = snap || {};
      S.courses = Array.isArray(snap.courses) ? snap.courses.slice() : [];
      S.breaks = Array.isArray(snap.breaks) ? snap.breaks.filter((b) => b && Array.isArray(b.days)).map((b) => Object.assign({ id: uid(), label: '' }, b)) : [];
      S.options = Object.assign(defaultOptions(), snap.options || {});
      S.deselected = snap.deselected && typeof snap.deselected === 'object' ? snap.deselected : {};
      S.locks = snap.locks && typeof snap.locks === 'object' ? snap.locks : {};
      S.result = null; S.selIdx = 0; S.planView = null;
    }
    // any input-affecting change
    function changed() { S.result = null; S.selIdx = 0; save(); }

    // ---- API wrappers
    function handleApiError(e) {
      if (e && e.code === 'SESSION_EXPIRED') S.sessionExpired = true;
    }
    const ck = (term, key) => term + '|' + key;
    function info(key) { return S.cache[ck(S.term, key)]; }

    async function fetchCourse(key) {
      const term = S.term;
      const id = ck(term, key);
      const existing = S.cache[id];
      if (existing && (existing.status === 'ok' || existing.status === 'loading')) return;
      S.cache[id] = { status: 'loading', sections: [], title: '', error: '' };
      render();
      const [subj, num] = key.split(' ');
      try {
        const raw = await SW.api.searchCourse(term, subj, num);
        const sections = (raw || []).map((r) => SW.api.normalizeSection(r)).filter(Boolean);
        if (!sections.length) {
          const desc = termDesc(term);
          S.cache[id] = { status: 'error', sections: [], title: '', error: 'No sections found for ' + desc };
        } else {
          S.cache[id] = { status: 'ok', sections, title: sections[0].title || '', error: '' };
        }
      } catch (e) {
        handleApiError(e);
        S.cache[id] = { status: 'error', sections: [], title: '', error: errMsg(e) };
      }
      if (S.term === term) { S.result = null; render(); if (!batching) requestRmp(); }
    }
    let batching = false;
    async function fetchAllCourses() {
      const list = S.courses.slice();
      batching = true;
      try {
        for (const key of list) {
          if (S.term && S.courses.indexOf(key) >= 0) await fetchCourse(key);
        }
      } finally { batching = false; }
      requestRmp();
    }

    // Resolve once a course is in the cache as ok/error (fetching it if needed).
    async function ensureLoaded(key) {
      const id = ck(S.term, key);
      let c = S.cache[id];
      if (!c || c.status === 'error') { delete S.cache[id]; await fetchCourse(key); return; }
      for (let n = 0; c && c.status === 'loading' && n < 600; n++) {
        await new Promise((r) => setTimeout(r, 50));
        c = S.cache[id];
      }
    }

    // ---- existing Banner plans
    async function loadPlans() {
      const term = S.term;
      if (!term) return;
      const prev = S.plans.term === term ? S.plans : null;
      S.plans = { term, status: 'loading', list: prev ? prev.list : [], max: prev ? prev.max : 5, error: '' };
      render();
      try {
        const r = await SW.api.getPlans(term);
        if (S.term !== term) return;
        S.plans = { term, status: 'ok', list: (r && r.plans) || [], max: (r && r.max) || 5, error: '' };
      } catch (e) {
        handleApiError(e);
        if (S.term !== term) return;
        S.plans = { term, status: 'error', list: [], max: 5, error: errMsg(e) };
      }
      render();
    }
    function planCredits(plan) { return plan.courses.reduce((a, c) => a + (c.credits || 0), 0); }
    function planKeys(plan) {
      const keys = [];
      plan.courses.forEach((c) => { if (c.courseKey && keys.indexOf(c.courseKey) < 0) keys.push(c.courseKey); });
      return keys;
    }
    async function viewPlan(plan) {
      const term = S.term;
      const pv = { plan, loading: true, sections: [], missing: [] };
      S.planView = pv; S.step = 4; render();
      for (const key of planKeys(plan)) {
        if (S.planView !== pv || S.term !== term) return;
        try { await ensureLoaded(key); } catch (e) { handleApiError(e); }
      }
      if (S.planView !== pv || S.term !== term) return;
      plan.courses.forEach((c) => {
        const i = S.cache[ck(term, c.courseKey)];
        const sec = i && i.status === 'ok' ? i.sections.find((s) => s.crn === c.crn) : null;
        if (sec) pv.sections.push(sec); else pv.missing.push(c);
      });
      pv.loading = false; render(); requestRmp();
    }
    async function loadPlanIntoWizard(plan) {
      const term = S.term;
      const keys = planKeys(plan);
      if (!keys.length) { toast('This plan has no courses'); return; }
      keys.forEach((k) => { if (S.courses.indexOf(k) < 0) S.courses.push(k); });
      changed(); render();
      toast('Loading plan into the wizard…');
      for (const key of keys) {
        try { await ensureLoaded(key); } catch (e) { handleApiError(e); }
      }
      if (S.term !== term) return;
      const missing = [];
      keys.forEach((k) => {
        const i = info(k);
        if (!i || i.status !== 'ok') { missing.push(k); return; }
        const want = {};
        plan.courses.forEach((c) => { if (c.courseKey === k) want[c.crn] = true; });
        i.sections.forEach((s) => { if (want[s.crn]) delete S.deselected[s.crn]; else S.deselected[s.crn] = true; });
        delete S.locks[k];
      });
      changed();
      S.planView = null; S.step = 3; render();
      toast(missing.length ? 'Loaded, but could not fetch: ' + missing.join(', ') : 'Plan loaded: ' + keys.length + ' courses selected');
    }

    // ---- exact-section locks
    function applyLock(key, matches) {
      const i = info(key);
      if (!i || i.status !== 'ok') return;
      i.sections.forEach((s) => { if (matches.indexOf(s) >= 0) delete S.deselected[s.crn]; else S.deselected[s.crn] = true; });
      S.locks[key] = { section: matches[0].section, crns: matches.map((s) => s.crn) };
      changed(); render();
    }
    async function lockSection(key, section) {
      const term = S.term;
      await ensureLoaded(key);
      if (S.term !== term) return;
      const i = info(key);
      if (!i || i.status !== 'ok') return;
      const matches = i.sections.filter((s) => sameSection(s.section, section));
      if (!matches.length) { toast('Section ' + section + ' of ' + key + ' was not found'); return; }
      applyLock(key, matches);
    }
    // Bare CRN: only resolvable against already-loaded courses. Returns true if found.
    function lockCrn(crn) {
      const prefix = S.term + '|';
      for (const id of Object.keys(S.cache)) {
        if (id.indexOf(prefix) !== 0) continue;
        const c = S.cache[id];
        if (!c || c.status !== 'ok') continue;
        const sec = c.sections.find((s) => s.crn === crn);
        if (!sec) continue;
        if (S.courses.indexOf(sec.courseKey) < 0) S.courses.push(sec.courseKey);
        applyLock(sec.courseKey, [sec]);
        return true;
      }
      return false;
    }
    function activeLock(key) {
      const L = S.locks[key];
      if (!L || !Array.isArray(L.crns)) return null;
      const sel = selectedSections(key).map((s) => s.crn);
      return sel.length === L.crns.length && L.crns.every((c) => sel.indexOf(c) >= 0) ? L : null;
    }
    function unlock(key) {
      delete S.locks[key];
      const i = info(key);
      if (i && i.status === 'ok') i.sections.forEach((s) => { delete S.deselected[s.crn]; });
      changed(); render();
    }
    function onlySections(courseKey, keep) {
      const i = info(courseKey);
      if (!i || i.status !== 'ok') return;
      i.sections.forEach((s) => { if (keep.indexOf(s) >= 0) delete S.deselected[s.crn]; else S.deselected[s.crn] = true; });
      changed(); render();
    }

    // ---- RateMyProfessors
    function rmpInfoFor(name) {
      const v = name ? S.rmp[name] : null;
      return v && typeof v === 'object' && v.numRatings > 0 && isFinite(v.avgRating) ? v : null;
    }
    function ratingOf(name) { const i = rmpInfoFor(name); return i ? i.avgRating : null; }
    function requestRmp() {
      const names = [];
      Object.keys(S.cache).forEach((id) => {
        const c = S.cache[id];
        if (!c || c.status !== 'ok') return;
        c.sections.forEach((sec) => {
          const n = primaryProf(sec);
          if (n && S.rmp[n] === undefined && names.indexOf(n) < 0) names.push(n);
        });
      });
      if (!names.length) return;
      names.forEach((n) => { S.rmp[n] = 'loading'; });
      render();
      const done = (results) => {
        names.forEach((n) => {
          const v = results && results[n];
          S.rmp[n] = v && typeof v === 'object' ? v : null;
        });
        render();
      };
      try {
        chrome.runtime.sendMessage({ type: 'SW_RMP', names }, (resp) => {
          void (chrome.runtime && chrome.runtime.lastError);
          done(resp && resp.results);
        });
      } catch (e) { done(null); }
    }
    let tipEl = null, tipTimer = null;
    function hideTip() { clearTimeout(tipTimer); if (tipEl) { tipEl.remove(); tipEl = null; } }
    function showTip(anchor, name, info) {
      clearTimeout(tipTimer);
      hideTip();
      const stat = (label, val) => h('div', { class: 'rmp-stat' }, h('span', null, label), h('strong', null, val));
      const last = monthYear(info.lastRatingDate);
      const card = h('div', { class: 'rmp-tip', role: 'tooltip' },
        h('div', { class: 'rmp-tip-name' }, (info.firstName || '') + ' ' + (info.lastName || '')),
        h('div', { class: 'rmp-tip-big', style: { color: rmpColor(info.avgRating) } }, info.avgRating.toFixed(1), h('span', null, ' / 5')),
        stat('Difficulty', isFinite(info.avgDifficulty) ? info.avgDifficulty.toFixed(1) + ' / 5' : 'N/A'),
        stat('Would take again', info.wouldTakeAgainPercent >= 0 ? Math.round(info.wouldTakeAgainPercent) + '%' : 'N/A'),
        stat('Ratings', String(info.numRatings)),
        info.department ? stat('Department', info.department) : null,
        last ? stat('Last review', last) : null,
        info.numRatings < 10 ? h('div', { class: 'rmp-warn' }, '\u26A0 low rating count') : null,
        h('a', { class: 'rmp-link', href: info.url, target: '_blank', rel: 'noopener' }, 'View on RateMyProfessors \u2197'));
      card.addEventListener('mouseenter', () => clearTimeout(tipTimer));
      card.addEventListener('mouseleave', () => { tipTimer = setTimeout(hideTip, 150); });
      card.style.visibility = 'hidden';
      panelWrap.appendChild(card);
      tipEl = card;
      const r = anchor.getBoundingClientRect();
      const w = card.offsetWidth, hh = card.offsetHeight, vw = window.innerWidth, vh = window.innerHeight;
      const left = Math.min(Math.max(8, r.left), vw - w - 8);
      let top = r.bottom + 6;
      if (top + hh > vh - 8) top = Math.max(8, r.top - hh - 6);
      card.style.left = left + 'px'; card.style.top = top + 'px'; card.style.visibility = '';
    }
    // Reusable rating pill. compact=true renders "\u2605" + rating and nothing when no data.
    function rmpBadge(name, compact) {
      const n = cleanProfName(name);
      if (!n) return null;
      const v = S.rmp[n];
      if (v === 'loading' || v === undefined) {
        return compact ? null : h('span', { class: 'rmp-pill loading', title: 'Loading RateMyProfessors rating\u2026' }, '\u2026');
      }
      const info = rmpInfoFor(n);
      if (!info) return compact ? null : h('span', { class: 'rmp-pill na', title: 'No RateMyProfessors data' }, 'N/A');
      const a = h('a', {
        class: 'rmp-pill' + (compact ? ' compact' : ''), href: info.url, target: '_blank', rel: 'noopener',
        style: { background: rmpColor(info.avgRating) },
        'aria-label': n + ' RateMyProfessors rating ' + info.avgRating.toFixed(1),
        onclick: (e) => e.stopPropagation(),
        onmouseenter: () => showTip(a, n, info),
        onmouseleave: () => { tipTimer = setTimeout(hideTip, 150); },
      }, compact ? '\u2605' + info.avgRating.toFixed(1) : info.avgRating.toFixed(1));
      return a;
    }
    function termDesc(code) {
      const t = S.terms.find((x) => x.code === code);
      return t ? t.description : code || '';
    }

    // ---- init
    async function init() {
      if (S.initialized || S.initializing) return;
      S.initializing = true; S.initError = null; render();
      try {
        const [stored, terms] = await Promise.all([loadStored(), SW.api.getTerms()]);
        S.terms = terms || [];
        if (stored && stored.byTerm) S.byTerm = stored.byTerm;
        else if (stored && stored.term) S.byTerm = { [stored.term]: { courses: stored.courses, breaks: stored.breaks, options: stored.options, deselected: stored.deselected } };
        const pick = stored && S.terms.some((t) => t.code === stored.term) ? stored.term : S.terms[0] && S.terms[0].code;
        S.term = pick || null;
        applySnapshot(S.term ? S.byTerm[S.term] : null);
        S.initialized = true;
        S.step = S.courses.length ? 1 : 0;
        S.initializing = false;
        render();
        fetchAllCourses();
        loadPlans();
      } catch (e) {
        handleApiError(e);
        S.initError = errMsg(e);
        S.initializing = false;
        render();
      }
    }

    function setTerm(code) {
      if (code === S.term) return;
      if (S.term) S.byTerm[S.term] = snapshot();
      S.term = code;
      applySnapshot(S.byTerm[code]);
      save();
      S.plans = { term: code, status: 'idle', list: [], max: 5, error: '' };
      render();
      fetchAllCourses();
      loadPlans();
    }

    // ---- derived
    function loadedCourses() {
      return S.courses.map((k) => ({ key: k, info: info(k) })).filter((c) => c.info && c.info.status === 'ok');
    }
    function selectedSections(key) {
      const i = info(key);
      return i && i.status === 'ok' ? i.sections.filter((s) => !S.deselected[s.crn]) : [];
    }
    function reachable(step) {
      if (step <= 1) return !!S.term;
      return loadedCourses().length > 0;
    }
    function goStep(n) {
      if (n < 0 || n >= STEPS.length || !reachable(n)) return;
      S.step = n; S.planView = null; render();
    }

    // ---- scroll preservation + render
    function render() {
      if (S.open) { launcher.hidden = true; panelWrap.hidden = false; } else { launcher.hidden = false; panelWrap.hidden = true; return; }
      const saved = {};
      panelWrap.querySelectorAll('[data-scroll]').forEach((el) => { saved[el.getAttribute('data-scroll')] = el.scrollTop; });
      const active = shadow.activeElement;
      const activeId = active && active.getAttribute && active.getAttribute('data-focus');
      const selStart = active && typeof active.selectionStart === 'number' ? active.selectionStart : null;

      const panel = h('div', { class: 'panel', role: 'dialog', 'aria-label': 'Niner Schedule Wizard' },
        renderHeader(), renderTabs(), renderBanner(), renderPlansStrip(), renderBody(), S.step < 4 && S.initialized ? renderFooter() : null,
        S.modal ? renderModal() : null);
      tipEl = null;
      panelWrap.textContent = '';
      panelWrap.appendChild(panel);

      panelWrap.querySelectorAll('[data-scroll]').forEach((el) => {
        const v = saved[el.getAttribute('data-scroll')];
        if (v != null) el.scrollTop = v;
      });
      if (activeId) {
        const el = panelWrap.querySelector('[data-focus="' + activeId + '"]');
        if (el) { el.focus(); if (selStart != null && el.setSelectionRange) { try { el.setSelectionRange(selStart, selStart); } catch (e) { /* ignore */ } } }
      }
    }

    function toast(msg) {
      const t = h('div', { class: 'toast' }, msg);
      panelWrap.appendChild(t);
      setTimeout(() => t.remove(), 2200);
    }

    // ---- chrome
    function renderHeader() {
      return h('header', { class: 'hdr' },
        h('div', { class: 'brand' },
          h('span', { class: 'brand-mark' }, '49'),
          h('div', null,
            h('div', { class: 'brand-title' }, 'Niner Schedule Wizard'),
            h('div', { class: 'brand-sub' }, S.term ? termDesc(S.term) + ' · UNC Charlotte' : 'UNC Charlotte'))),
        h('button', { class: 'icon-btn', type: 'button', title: 'Close', 'aria-label': 'Close', onclick: () => ctrl.close() }, '✕'));
    }
    function renderTabs() {
      return h('nav', { class: 'tabs' }, STEPS.map((name, i) => {
        const ok = S.initialized && reachable(i);
        return h('button', {
          type: 'button', class: 'tab' + (i === S.step ? ' active' : '') + (ok ? '' : ' disabled'), disabled: !ok,
          onclick: () => goStep(i),
        }, h('span', { class: 'tab-num' }, String(i + 1)), h('span', { class: 'tab-name' }, name));
      }));
    }
    function renderBanner() {
      if (!S.sessionExpired) return null;
      return h('div', { class: 'banner danger', role: 'alert' },
        h('span', null, 'Your Banner session expired — refresh the page and log in.'),
        h('button', { class: 'btn small', type: 'button', onclick: () => { S.sessionExpired = false; render(); } }, 'Dismiss'));
    }
    function renderPlansStrip() {
      if (!S.initialized || !S.term) return null;
      const p = S.plans.term === S.term ? S.plans : { status: 'idle', list: [], max: 5, error: '' };
      const count = p.status === 'ok' ? String(p.list.length) : '…';
      const head = h('div', { class: 'plans-head' },
        h('button', { class: 'plans-toggle', type: 'button', 'aria-expanded': S.plansOpen ? 'true' : 'false', onclick: () => { S.plansOpen = !S.plansOpen; render(); } },
          h('span', null, S.plansOpen ? '▾' : '▸'), 'Your plans for ' + termDesc(S.term) + ' (' + count + '/' + p.max + ')'),
        p.status === 'loading' ? h('span', { class: 'spinner' }) : null,
        h('button', { class: 'link-btn', type: 'button', disabled: p.status === 'loading', onclick: () => loadPlans() }, 'Refresh'),
        h('a', { href: PLANS_URL, target: '_blank', rel: 'noopener' }, 'Manage in Banner ↗'));
      let body = null;
      if (S.plansOpen) {
        if (p.status === 'error') {
          body = h('div', { class: 'row', style: { paddingTop: '6px' } }, h('span', { class: 'err small' }, 'Could not load plans: ' + p.error),
            h('button', { class: 'link-btn', type: 'button', onclick: () => loadPlans() }, 'Retry'));
        } else if (p.status === 'ok' && !p.list.length) {
          body = h('div', { class: 'muted small', style: { paddingTop: '6px' } }, 'No plans yet for this term. Use "Apply as Plan" on a schedule to create one.');
        } else if (p.list.length) {
          body = h('div', { class: 'plans-list' }, p.list.map((plan) => {
            const keys = planKeys(plan);
            const sel = S.planView && S.planView.plan === plan;
            return h('button', {
              class: 'plan-card' + (sel ? ' sel' : ''), type: 'button', title: 'View "' + plan.name + '" read-only in the Schedules step',
              onclick: () => viewPlan(plan),
            },
            h('div', { class: 'plan-name' }, plan.name),
            h('div', { class: 'plan-meta' }, planCredits(plan) + ' cr · ' + plan.courses.length + (plan.courses.length === 1 ? ' section' : ' sections')),
            h('div', { class: 'plan-courses' }, keys.length ? keys.join(', ') : 'Empty plan'));
          }));
        } else if (p.status === 'loading') {
          body = h('div', { class: 'muted small', style: { paddingTop: '6px' } }, 'Loading your plans…');
        }
      }
      return h('div', { class: 'plans-strip' }, head, body);
    }
    function renderPlanView() {
      const pv = S.planView, plan = pv.plan;
      const keys = planKeys(plan);
      const colors = {};
      keys.forEach((k, i) => { colors[k] = PALETTE[i % PALETTE.length]; });
      const sch = { sections: pv.sections };
      const head = h('div', { class: 'plan-view-head' },
        h('button', { class: 'btn small', type: 'button', onclick: () => { S.planView = null; render(); } }, '← Back'),
        h('h3', null, 'Plan: ' + plan.name),
        h('span', { class: 'muted small' }, planCredits(plan) + ' credits · read-only'),
        h('button', { class: 'btn gold', type: 'button', disabled: pv.loading, onclick: () => loadPlanIntoWizard(plan) }, 'Load into wizard'),
        h('a', { href: PLANS_URL, target: '_blank', rel: 'noopener', class: 'small' }, 'Manage in Banner ↗'));
      let content;
      if (pv.loading) content = h('div', { class: 'center-msg' }, h('div', { class: 'spinner big' }), h('p', null, 'Loading sections for this plan…'));
      else {
        content = h('div', null,
          pv.missing.length ? h('div', { class: 'banner warn block' }, 'Could not find details for: ' + pv.missing.map((c) => (c.courseKey || 'CRN') + ' (CRN ' + c.crn + ')').join(', ')) : null,
          pv.sections.length ? [renderCalendar(sch, colors, true), renderOnlineList(sch, colors), renderTable(sch, colors)]
            : h('div', { class: 'empty' }, 'No section details available for this plan.'));
      }
      return h('div', { class: 'sched-wrap' }, head, h('div', { class: 'plan-view', 'data-scroll': 'planview' }, content));
    }
    function renderBody() {
      const body = h('main', { class: 'body step-' + S.step, 'data-scroll': 'body' });
      if (S.initializing) { body.appendChild(h('div', { class: 'center-msg' }, h('div', { class: 'spinner big' }), h('p', null, 'Loading terms…'))); return body; }
      if (S.initError) {
        body.appendChild(h('div', { class: 'center-msg' },
          h('p', { class: 'err' }, 'Could not load terms: ' + S.initError),
          h('button', { class: 'btn primary', type: 'button', onclick: () => init() }, 'Try again')));
        return body;
      }
      if (!S.initialized) { body.appendChild(h('div', { class: 'center-msg' }, h('div', { class: 'spinner big' }))); return body; }
      const fn = [stepTerm, stepCourses, stepPrefs, stepSections, stepSchedules][S.step];
      body.appendChild(fn());
      return body;
    }
    function renderFooter() {
      const next = S.step + 1;
      const canNext = next < STEPS.length && reachable(next);
      return h('footer', { class: 'ftr' },
        h('button', { class: 'btn', type: 'button', disabled: S.step === 0, onclick: () => goStep(S.step - 1) }, '← Back'),
        h('div', { class: 'ftr-hint' }, canNext ? '' : (S.step >= 1 ? 'Add at least one course with sections to continue.' : '')),
        h('button', { class: 'btn primary', type: 'button', disabled: !canNext, onclick: () => goStep(next) },
          (next === 4 ? 'Go to Schedules' : 'Next: ' + (STEPS[next] || '')) + ' →'));
    }

    // ---- step 1: term
    function stepTerm() {
      const sel = h('select', { class: 'input', 'data-focus': 'term', onchange: (e) => setTerm(e.target.value) },
        S.terms.map((t) => h('option', { value: t.code, selected: t.code === S.term }, t.description)));
      sel.value = S.term || '';
      return h('section', { class: 'card narrow' },
        h('h2', null, 'Choose a term'),
        h('p', { class: 'muted' }, 'Pick the term you are planning for. Only terms open for planning are listed.'),
        S.terms.length ? sel : h('p', { class: 'err' }, 'No terms are open for planning right now.'),
        h('p', { class: 'muted small' }, 'Your courses, breaks and preferences are remembered separately for each term.'));
    }

    // ---- step 2: courses
    function addCourses(text) {
      const parts = String(text || '').split(/[,;\n]+/).map((s) => s.trim()).filter(Boolean);
      const bad = [];
      const noCrn = [];
      const lockJobs = [];
      let added = 0;
      let crnLocked = false;
      parts.forEach((p) => {
        const pi = parseCourseInput(p);
        if (!pi) { bad.push(p); return; }
        if (pi.crn) {
          if (lockCrn(pi.crn)) crnLocked = true; else noCrn.push(pi.crn);
          return;
        }
        if (S.courses.indexOf(pi.key) < 0) { S.courses.push(pi.key); added++; }
        if (pi.section) lockJobs.push([pi.key, pi.section]);
      });
      S.courseInput = bad.concat(noCrn).join(', ');
      if (bad.length) toast('Could not read: ' + bad.join(', ') + ' (try e.g. MATH 2164 or MATH 2164-003)');
      else if (noCrn.length) toast('Add the course first, then enter the CRN (' + noCrn.join(', ') + ')');
      if (added) { changed(); render(); S.courses.slice(-added).forEach((k) => fetchCourse(k)); }
      else if (!crnLocked) render();
      lockJobs.forEach(([k, sec]) => { lockSection(k, sec); });
    }
    function removeCourse(key) {
      delete S.locks[key];
      S.courses = S.courses.filter((k) => k !== key);
      changed(); render();
    }
    function stepCourses() {
      const input = h('input', {
        class: 'input', type: 'text', placeholder: 'e.g. MATH 2164, ITSC 1212, MATH 2164-003', value: S.courseInput, 'data-focus': 'course-input',
        oninput: (e) => { S.courseInput = e.target.value; },
        onkeydown: (e) => { if (e.key === 'Enter') { e.preventDefault(); addCourses(input.value); } },
      });
      const chips = S.courses.map((key) => {
        const i = info(key) || { status: 'loading' };
        let detail;
        if (i.status === 'loading') detail = h('span', { class: 'muted' }, 'Searching…');
        else if (i.status === 'error') detail = h('span', { class: 'err' }, i.error);
        else detail = h('span', { class: 'chip-detail' }, [i.title, ' · ', i.sections.length + (i.sections.length === 1 ? ' section' : ' sections')]);
        const lk = activeLock(key);
        return h('div', { class: 'chip ' + i.status },
          i.status === 'loading' ? h('span', { class: 'spinner' }) : h('span', { class: 'chip-dot' }),
          h('span', { class: 'chip-key' }, key), detail,
          lk ? h('span', { class: 'lock-tag', title: 'Only section ' + lk.section + ' is selected' },
            '\u{1F512} Sec ' + lk.section + ' only',
            h('button', { type: 'button', title: 'Unlock (select all sections again)', 'aria-label': 'Unlock ' + key, onclick: () => unlock(key) }, '×')) : null,
          i.status === 'error' ? h('button', { class: 'link-btn', type: 'button', onclick: () => { delete S.cache[ck(S.term, key)]; fetchCourse(key); } }, 'Retry') : null,
          h('button', { class: 'chip-x', type: 'button', title: 'Remove ' + key, 'aria-label': 'Remove ' + key, onclick: () => removeCourse(key) }, '×'));
      });
      return h('section', { class: 'card' },
        h('h2', null, 'Add your courses'),
        h('p', { class: 'muted' }, 'Type a subject and number. Separate several with commas — "math2164", "MATH-2164" and "MATH 2164" all work. To pick one exact section, add it like "MATH 2164-003", "MATH 2164 003" or "MATH2164.003", or enter a 5-digit CRN of a course you already added.'),
        h('div', { class: 'row' }, input, h('button', { class: 'btn primary', type: 'button', onclick: () => addCourses(input.value) }, 'Add')),
        S.courses.length ? h('div', { class: 'chips' }, chips) : h('div', { class: 'empty' }, 'No courses yet. Add the classes you want in ' + termDesc(S.term) + '.'));
    }

    // ---- step 3: breaks & prefs
    function dayButtons(selected, onToggle) {
      return h('div', { class: 'daybtns' }, DAY_ORDER.map(([letter, num]) =>
        h('button', {
          type: 'button', class: 'daybtn' + (selected.indexOf(num) >= 0 ? ' on' : ''), title: DAY_NAMES[num],
          'aria-pressed': selected.indexOf(num) >= 0 ? 'true' : 'false',
          onclick: () => onToggle(num),
        }, letter)));
    }
    function toggleIn(arr, v) {
      const i = arr.indexOf(v);
      if (i >= 0) arr.splice(i, 1); else arr.push(v);
      return arr;
    }
    function timeInput(minVal, onChange, focusId) {
      return h('input', {
        class: 'input time', type: 'time', value: fromMin(minVal), 'data-focus': focusId,
        onchange: (e) => onChange(toMin(e.target.value)),
      });
    }
    function stepPrefs() {
      const o = S.options;
      const breakRows = S.breaks.map((b, idx) =>
        h('div', { class: 'break-row' },
          dayButtons(b.days, (d) => { toggleIn(b.days, d); changed(); render(); }),
          h('div', { class: 'time-pair' },
            timeInput(b.start, (v) => { b.start = v; changed(); }, 'bs' + b.id),
            h('span', { class: 'muted' }, 'to'),
            timeInput(b.end, (v) => { b.end = v; changed(); }, 'be' + b.id)),
          h('input', {
            class: 'input label-in', type: 'text', placeholder: 'Label (optional)', value: b.label || '', 'data-focus': 'bl' + b.id,
            oninput: (e) => { b.label = e.target.value; save(); },
          }),
          h('button', { class: 'icon-btn dark', type: 'button', title: 'Remove break', onclick: () => { S.breaks.splice(idx, 1); changed(); render(); } }, '✕')));

      return h('div', { class: 'two-col' },
        h('section', { class: 'card' },
          h('h2', null, 'Breaks'),
          h('p', { class: 'muted' }, 'Block out times when you do not want class (work, lunch, commute).'),
          S.breaks.length ? h('div', { class: 'break-list' }, breakRows) : h('div', { class: 'empty' }, 'No breaks added.'),
          h('div', { class: 'row wrap' },
            h('button', { class: 'btn', type: 'button', onclick: () => { S.breaks.push({ id: uid(), days: [1, 2, 3, 4, 5], start: 720, end: 780, label: '' }); changed(); render(); } }, '+ Add break'),
            h('button', { class: 'btn ghost', type: 'button', onclick: () => { S.breaks.push({ id: uid(), days: [1, 2, 3, 4, 5], start: 720, end: 780, label: 'Lunch' }); changed(); render(); } }, 'Lunch 12–1 MTWRF'))),
        h('section', { class: 'card' },
          h('h2', null, 'Preferences'),
          h('div', { class: 'field' }, h('label', null, 'No classes before'),
            h('div', { class: 'row' }, timeInput(o.earliest, (v) => { o.earliest = v; changed(); }, 'earliest'),
              h('button', { class: 'link-btn', type: 'button', onclick: () => { o.earliest = null; changed(); render(); } }, 'Clear'))),
          h('div', { class: 'field' }, h('label', null, 'No classes after'),
            h('div', { class: 'row' }, timeInput(o.latest, (v) => { o.latest = v; changed(); }, 'latest'),
              h('button', { class: 'link-btn', type: 'button', onclick: () => { o.latest = null; changed(); render(); } }, 'Clear'))),
          h('div', { class: 'field' }, h('label', null, 'Days off (no classes at all)'),
            dayButtons(o.daysOff, (d) => { toggleIn(o.daysOff, d); changed(); render(); })),
          h('div', { class: 'field' }, h('label', { class: 'check' },
            h('input', { type: 'checkbox', checked: !!o.allowFull, onchange: (e) => { o.allowFull = e.target.checked; changed(); } }),
            h('span', null, 'Include full sections (no seats available)'))),
          h('div', { class: 'field' }, h('label', null, 'Minimum professor rating (RateMyProfessors)'),
            minRatingSelect(),
            h('label', { class: 'check', style: { marginTop: '6px' } },
              h('input', { type: 'checkbox', checked: o.allowUnrated !== false, onchange: (e) => { o.allowUnrated = e.target.checked; changed(); } }),
              h('span', null, 'Also allow unrated professors (and TBA)'))),
          h('div', { class: 'field' }, h('label', null, 'Class format'), modalitySelect()),
          h('div', { class: 'field' }, h('label', null, 'Sort schedules by'), sortSelect())));
    }
    function modalitySelect() {
      const sel = h('select', { class: 'input', 'data-focus': 'modality',
        onchange: (e) => { S.options.modality = e.target.value; changed(); render(); } },
      MODALITIES.map(([v, l]) => h('option', { value: v, selected: v === (S.options.modality || 'any') }, l)));
      sel.value = S.options.modality || 'any';
      return sel;
    }
    function minRatingSelect() {
      const cur = S.options.minRating == null ? '' : String(S.options.minRating);
      const sel = h('select', { class: 'input', 'data-focus': 'minrating',
        onchange: (e) => { S.options.minRating = e.target.value === '' ? null : parseFloat(e.target.value); changed(); render(); } },
      [['', 'Any'], ['2.5', '2.5+'], ['3', '3.0+'], ['3.5', '3.5+'], ['4', '4.0+']].map(([v, l]) =>
        h('option', { value: v, selected: cur === v }, l)));
      sel.value = cur;
      return sel;
    }
    function sortSelect() {
      const sel = h('select', { class: 'input', 'data-focus': 'sort', onchange: (e) => { S.options.sort = e.target.value; changed(); render(); } },
        SORTS.map(([v, l]) => h('option', { value: v, selected: v === S.options.sort }, l)));
      sel.value = S.options.sort;
      return sel;
    }

    // ---- step 4: sections & professors
    function groupByProf(sections) {
      const map = new Map();
      sections.forEach((s) => {
        const k = s.instructorKey || profLabel(s);
        if (!map.has(k)) map.set(k, []);
        map.get(k).push(s);
      });
      const groups = Array.from(map.entries()).map(([name, secs]) => ({ name, secs }));
      if (S.sortProfs) {
        const rk = (g) => ratingOf(primaryOfKey(g.name));
        groups.forEach((g, i) => { g.i = i; });
        groups.sort((a, b) => {
          const ra = rk(a), rb = rk(b);
          if (ra == null && rb == null) return a.i - b.i;
          if (ra == null) return 1;
          if (rb == null) return -1;
          return rb - ra || a.i - b.i;
        });
      }
      return groups;
    }
    function setSections(secs, on) {
      secs.forEach((s) => { if (on) delete S.deselected[s.crn]; else S.deselected[s.crn] = true; });
      changed(); render();
    }
    function stepSections() {
      const courses = loadedCourses();
      if (!courses.length) return h('div', { class: 'empty' }, 'Add courses first.');
      return h('div', { class: 'accordion-list' }, courses.map(({ key, info: ci }) => {
        const total = ci.sections.length, selN = selectedSections(key).length;
        const open = S.openCourses[key] !== false; // default open
        const head = h('button', { class: 'acc-head', type: 'button', onclick: () => { S.openCourses[key] = !open; render(); } },
          h('span', { class: 'acc-caret' }, open ? '▾' : '▸'),
          h('span', { class: 'acc-key' }, key), h('span', { class: 'acc-title' }, ci.title),
          h('span', { class: 'badge' + (selN === 0 ? ' bad' : '') }, selN + ' / ' + total + ' selected'));
        const el = h('div', { class: 'acc' }, head);
        if (open) {
          const groups = groupByProf(ci.sections);
          el.appendChild(h('div', { class: 'acc-body' },
            h('div', { class: 'row wrap acc-tools' },
              h('button', { class: 'btn small', type: 'button', onclick: () => setSections(ci.sections, true) }, 'Select all'),
              h('button', { class: 'btn small', type: 'button', onclick: () => setSections(ci.sections, false) }, 'Select none'),
              h('button', { class: 'btn small', type: 'button', onclick: () => { ci.sections.forEach((s) => { if (isFull(s)) S.deselected[s.crn] = true; else delete S.deselected[s.crn]; }); changed(); render(); } }, 'Skip full'),
              h('label', { class: 'check small push-right' },
                h('input', { type: 'checkbox', checked: S.sortProfs, onchange: (e) => { S.sortProfs = e.target.checked; render(); } }),
                h('span', null, 'Sort profs by rating'))),
            groups.map((g) => renderProfGroup(key, g))));
        }
        return el;
      }));
    }
    function renderProfGroup(courseKey, g) {
      const onN = g.secs.filter((s) => !S.deselected[s.crn]).length;
      const gid = courseKey + '|' + g.name;
      const open = !!S.openProfs[gid];
      const seats = g.secs.reduce((a, s) => a + Math.max(0, s.seats || 0), 0);
      const cap = g.secs.reduce((a, s) => a + (s.capacity || 0), 0);
      const cb = h('input', {
        type: 'checkbox', checked: onN === g.secs.length, indeterminate: onN > 0 && onN < g.secs.length,
        onchange: (e) => setSections(g.secs, e.target.checked),
      });
      const wrap = h('div', { class: 'prof' },
        h('div', { class: 'prof-head' },
          h('label', { class: 'check' }, cb, h('span', { class: 'prof-name' }, g.name)),
          rmpBadge(primaryOfKey(g.name)),
          h('span', { class: 'grow' }),
          h('span', { class: 'muted small' }, g.secs.length + (g.secs.length === 1 ? ' section' : ' sections') + ' · ' + seats + '/' + cap + ' seats open'),
          h('button', { class: 'btn small only-btn', type: 'button', title: 'Select only this professor\'s sections of ' + courseKey, onclick: () => onlySections(courseKey, g.secs) }, 'Only this prof'),
          h('button', { class: 'link-btn', type: 'button', onclick: () => { S.openProfs[gid] = !open; render(); } }, open ? 'Hide sections' : 'Show sections')));
      if (open) {
        wrap.appendChild(h('div', { class: 'sec-table' }, g.secs.map((s) => {
          const full = isFull(s);
          return h('label', { class: 'sec-row' + (full ? ' full' : '') },
            h('input', { type: 'checkbox', checked: !S.deselected[s.crn], onchange: (e) => setSections([s], e.target.checked) }),
            h('span', { class: 'sec-num' }, s.section), h('span', { class: 'sec-crn muted' }, s.crn),
            h('span', { class: 'sec-type muted' }, s.scheduleType || ''),
            h('span', { class: 'sec-time' }, sectionTimes(s)),
            h('span', { class: 'sec-loc' }, sectionLocation(s), modTag(s)),
            h('span', { class: 'sec-seats' }, full ? h('span', { class: 'badge bad' }, 'FULL') : null, ' ' + Math.max(0, s.seats) + '/' + s.capacity),
            h('span', { class: 'sec-method muted' }, s.method || ''),
            h('button', {
              class: 'btn small only-btn', type: 'button', title: 'Select only section ' + s.section + ' of ' + courseKey,
              onclick: (e) => { e.preventDefault(); e.stopPropagation(); onlySections(courseKey, [s]); },
            }, 'Only this'));
        })));
      }
      return wrap;
    }

    // ---- step 5: schedules
    function buildInput() {
      const o = S.options;
      const mode = o.modality || 'any';
      const courses = loadedCourses().map(({ key }) => ({
        key,
        sections: selectedSections(key).filter((sec) => {
          const r = ratingOf(primaryProf(sec));
          sec.profRating = r;
          // Hybrid counts as in-person for the "only" filters.
          if (mode === 'onlineOnly' && !SW.solver.isOnline(sec)) return false;
          if (mode === 'inPersonOnly' && SW.solver.isOnline(sec)) return false;
          if (o.minRating == null) return true;
          return r == null ? o.allowUnrated !== false : r >= o.minRating;
        }),
      }));
      return {
        courses,
        breaks: S.breaks.filter((b) => b.start != null && b.end != null && b.end > b.start && b.days.length)
          .map((b) => ({ days: b.days.slice(), start: b.start, end: b.end, label: b.label || 'Break' })),
        options: { earliest: o.earliest, latest: o.latest, daysOff: o.daysOff.slice(), allowFull: !!o.allowFull, maxResults: 200, sort: o.sort,
          modality: mode === 'preferOnline' || mode === 'preferInPerson' ? mode : undefined },
      };
    }
    function generate() {
      if (S.generating) return;
      const input = buildInput();
      const empty = input.courses.filter((c) => !c.sections.length).map((c) => c.key);
      if (empty.length) {
        S.result = { schedules: [], total: 0, truncated: false, errors: ['No sections selected for ' + empty.join(', ') + '. Go back to "Sections & Professors"' + (S.options.minRating != null ? ' or loosen the minimum professor rating.' : '.') +
          (/Only$/.test(S.options.modality || '') ? ' (Your "Class format" setting excludes some sections.)' : '')] };
        render(); return;
      }
      S.generating = true; S.result = null; render();
      setTimeout(() => {
        try {
          const r = SW.solver.generate(input);
          S.result = r || { schedules: [], total: 0, truncated: false, errors: ['Solver returned nothing.'] };
        } catch (e) {
          S.result = { schedules: [], total: 0, truncated: false, errors: ['Solver error: ' + errMsg(e)] };
        }
        S.selIdx = 0; S.generating = false; render();
      }, 30);
    }

    function colorMap() {
      const m = {};
      S.courses.forEach((k, i) => { m[k] = PALETTE[i % PALETTE.length]; });
      return m;
    }
    function schedDays(sch) {
      const set = new Set();
      sch.sections.forEach((s) => (s.meetings || []).forEach((m) => m.days.forEach((d) => set.add(d))));
      return DAY_ORDER.filter(([, n]) => set.has(n)).map(([l]) => l).join('');
    }

    function stepSchedules() {
      if (S.planView) return renderPlanView();
      const r = S.result;
      const toolbar = h('div', { class: 'sched-toolbar' },
        h('button', { class: 'btn primary', type: 'button', disabled: S.generating, onclick: generate }, S.generating ? 'Generating…' : (r ? 'Regenerate' : 'Generate schedules')),
        h('div', { class: 'tb-sort' }, h('span', { class: 'muted small' }, 'Sort'), sortSelect()),
        r && r.schedules.length ? h('span', { class: 'muted' }, r.total + ' valid schedule' + (r.total === 1 ? '' : 's') + (r.truncated ? ' (search capped; showing best ' + r.schedules.length + ')' : r.total > r.schedules.length ? ' (showing best ' + r.schedules.length + ')' : '')) : null);

      let content;
      if (S.generating) content = h('div', { class: 'center-msg' }, h('div', { class: 'spinner big' }), h('p', null, 'Finding conflict-free schedules…'));
      else if (!r) content = h('div', { class: 'center-msg' }, h('p', { class: 'muted' }, 'Ready when you are. Click "Generate schedules" to build every conflict-free combination.'));
      else if (!r.schedules.length) {
        content = h('div', { class: 'center-msg' },
          h('div', { class: 'empty-big' }, 'No schedules found'),
          (r.errors && r.errors.length ? r.errors : ['These courses and constraints have no conflict-free combination. Try loosening your breaks, time limits, or section selection.'])
            .map((e) => h('p', { class: 'err' }, e)));
      } else {
        if (S.selIdx >= r.schedules.length) S.selIdx = 0;
        content = h('div', { class: 'sched-layout' }, renderList(r), renderDetail(r.schedules[S.selIdx]));
      }
      return h('div', { class: 'sched-wrap' }, toolbar,
        r && r.errors && r.errors.length && r.schedules.length ? h('div', { class: 'banner warn' }, r.errors.join(' ')) : null,
        content);
    }

    function renderList(r) {
      const colors = colorMap();
      return h('aside', { class: 'sched-list', 'data-scroll': 'list' }, r.schedules.map((sch, i) => {
        const st = sch.stats || {};
        return h('button', { type: 'button', class: 'sched-card' + (i === S.selIdx ? ' sel' : ''), onclick: () => { S.selIdx = i; render(); } },
          h('div', { class: 'sc-top' }, h('span', { class: 'sc-n' }, '#' + (i + 1)), h('span', { class: 'sc-days' }, schedDays(sch) || 'Online'),
            h('span', { class: 'sc-range muted' }, st.earliestStart != null && isFinite(st.earliestStart) ? minLabel(st.earliestStart) + '–' + minLabel(st.latestEnd) : 'No set times')),
          miniWeek(sch, colors),
          h('div', { class: 'sc-stats muted small' },
            h('span', null, ((st.totalGapMinutes || 0) / 60).toFixed(1) + ' h gaps'), h('span', null, (st.credits != null ? st.credits : 0) + ' cr'),
            h('span', null, 'min ' + (st.minSeats != null && isFinite(st.minSeats) ? st.minSeats : '—') + ' seats'),
            st.onlineCount > 0 ? h('span', null, st.onlineCount + ' online') : null,
            st.avgProfRating != null ? h('span', null, 'avg prof \u2605' + st.avgProfRating.toFixed(1)) : null));
      }));
    }
    function miniWeek(sch, colors) {
      const lo = 420, hi = 1320; // 7am-10pm
      const cols = [1, 2, 3, 4, 5].map((d) => {
        const col = h('div', { class: 'mini-col' });
        sch.sections.forEach((s) => (s.meetings || []).forEach((m) => {
          if (m.days.indexOf(d) < 0) return;
          const top = Math.max(0, (m.start - lo) / (hi - lo)) * 100;
          const hgt = Math.max(3, ((Math.min(m.end, hi) - Math.max(m.start, lo)) / (hi - lo)) * 100);
          col.appendChild(h('i', { style: { top: top + '%', height: hgt + '%', background: colors[s.courseKey] || PALETTE[0] } }));
        }));
        return col;
      });
      return h('div', { class: 'mini-week' }, cols);
    }

    function renderDetail(sch) {
      const r = S.result, n = r.schedules.length;
      const colors = colorMap();
      const crns = sch.sections.map((s) => s.crn);
      return h('section', { class: 'sched-detail', 'data-scroll': 'detail' },
        h('div', { class: 'detail-head' },
          h('div', { class: 'nav' },
            h('button', { class: 'btn small', type: 'button', disabled: S.selIdx === 0, onclick: () => { S.selIdx--; render(); } }, '←'),
            h('strong', null, 'Schedule ' + (S.selIdx + 1) + ' of ' + n),
            h('button', { class: 'btn small', type: 'button', disabled: S.selIdx >= n - 1, onclick: () => { S.selIdx++; render(); } }, '→')),
          h('div', { class: 'row' },
            h('button', { class: 'btn', type: 'button', onclick: () => copyText(crns.join(', ')).then((ok) => toast(ok ? 'Copied ' + crns.length + ' CRNs' : 'Copy failed')) }, 'Copy CRNs'),
            h('button', { class: 'btn gold', type: 'button', onclick: () => openModal(sch) }, 'Apply as Plan'))),
        renderCalendar(sch, colors),
        renderOnlineList(sch, colors),
        renderTable(sch, colors));
    }

    function renderCalendar(sch, colors, noBreaks) {
      // days + range
      const used = new Set([1, 2, 3, 4, 5]);
      let lo = Infinity, hi = -Infinity;
      sch.sections.forEach((s) => (s.meetings || []).forEach((m) => {
        m.days.forEach((d) => used.add(d));
        lo = Math.min(lo, m.start); hi = Math.max(hi, m.end);
      }));
      if (!isFinite(lo)) { lo = 9 * 60; hi = 15 * 60; }
      let start = Math.max(0, Math.floor((lo - 60) / 60) * 60), end = Math.min(1440, Math.ceil((hi + 60) / 60) * 60);
      if (end - start < 6 * 60) end = Math.min(1440, start + 6 * 60);
      const ppm = 0.9; // px per minute
      const dayList = DAY_ORDER.filter(([, n]) => used.has(n));
      // sun last already via DAY_ORDER; ensure only Sat/Sun when used
      const days = dayList;

      const timeCol = h('div', { class: 'cal-times', style: { height: (end - start) * ppm + 'px' } });
      for (let m = start; m < end; m += 60) {
        timeCol.appendChild(h('div', { class: 'cal-time', style: { top: (m - start) * ppm + 'px' } }, minLabel(m).replace(':00', '')));
      }
      const cols = days.map(([letter, num]) => {
        const col = h('div', { class: 'cal-col', style: { height: (end - start) * ppm + 'px' } });
        const items = [];
        (noBreaks ? [] : S.breaks).forEach((b) => { if (b.days.indexOf(num) >= 0 && b.start != null && b.end > b.start && b.start < end && b.end > start) items.push({ kind: 'break', s: b.start, e: b.end, b }); });
        sch.sections.forEach((sec) => (sec.meetings || []).forEach((m) => { if (m.days.indexOf(num) >= 0) items.push({ kind: 'sec', s: m.start, e: m.end, sec, m }); }));
        // lane assignment for overlapping items
        items.sort((a, b) => a.s - b.s || a.e - b.e);
        const lanes = [];
        items.forEach((it) => {
          let l = 0;
          while (lanes[l] != null && lanes[l] > it.s) l++;
          lanes[l] = it.e; it.lane = l;
        });
        items.forEach((it) => {
          // lane count among overlapping items
          const overl = items.filter((o) => o.s < it.e && it.s < o.e);
          const cnt = Math.max.apply(null, overl.map((o) => o.lane)) + 1;
          const top = (Math.max(it.s, start) - start) * ppm, hgt = (Math.min(it.e, end) - Math.max(it.s, start)) * ppm;
          const pos = { top: top + 'px', height: Math.max(hgt - 1, 8) + 'px', left: 'calc(' + (it.lane / cnt) * 100 + '% + 2px)', width: 'calc(' + 100 / cnt + '% - 4px)' };
          if (it.kind === 'break') {
            col.appendChild(h('div', { class: 'cal-block brk', style: pos, title: (it.b.label || 'Break') + ' ' + minLabel(it.s) + '–' + minLabel(it.e) }, h('span', { class: 'cb-t' }, it.b.label || 'Break')));
          } else {
            const sec = it.sec;
            pos.background = colors[sec.courseKey] || PALETTE[0];
            col.appendChild(h('div', { class: 'cal-block', style: pos, title: sec.courseKey + ' ' + sec.section + ' — ' + sec.title + '\n' + profLabel(sec) },
              h('span', { class: 'cb-t' }, sec.courseKey + (sec.scheduleType && sec.scheduleType !== 'Lecture' ? ' ' + sec.scheduleType : '')),
              h('span', { class: 'cb-s' }, minLabel(it.s) + '–' + minLabel(it.e)),
              h('span', { class: 'cb-s' }, 'Sec ' + sec.section + (it.m.location ? ' · ' + it.m.location : '')),
              h('span', { class: 'cb-s' }, profLabel(sec), ' ', rmpBadge(primaryProf(sec), true))));
          }
        });
        return h('div', { class: 'cal-daycol' }, h('div', { class: 'cal-dayhead' }, DAY_NAMES[num].slice(0, 3)), col);
      });
      return h('div', { class: 'cal', style: { '--ppm': String(ppm), '--cols': String(days.length) } },
        h('div', { class: 'cal-grid' }, h('div', { class: 'cal-timecol' }, h('div', { class: 'cal-dayhead' }), timeCol), cols));
    }

    function renderOnlineList(sch, colors) {
      const online = sch.sections.filter((s) => !s.meetings || !s.meetings.length);
      if (!online.length) return null;
      return h('div', { class: 'online-box' }, h('strong', null, 'Online / TBA'),
        online.map((s) => h('span', { class: 'online-pill', style: { background: colors[s.courseKey] || PALETTE[0] } }, s.courseKey + ' · Sec ' + s.section + ' · ' + profLabel(s))));
    }

    function renderTable(sch, colors) {
      const rows = sch.sections.map((s) => h('tr', null,
        h('td', null, h('span', { class: 'swatch', style: { background: colors[s.courseKey] || PALETTE[0] } }), h('strong', null, s.courseKey), h('div', { class: 'muted small' }, s.title)),
        h('td', null, s.section, modTag(s)), h('td', null, s.crn), h('td', null, profLabel(s), ' ', rmpBadge(primaryProf(s))), h('td', null, sectionTimes(s)), h('td', null, sectionLocation(s)),
        h('td', null, Math.max(0, s.seats) + '/' + s.capacity)));
      return h('div', { class: 'table-wrap' }, h('table', { class: 'tbl' },
        h('thead', null, h('tr', null, ['Course', 'Sec', 'CRN', 'Instructor', 'Times', 'Location', 'Seats'].map((t) => h('th', null, t)))),
        h('tbody', null, rows)));
    }

    function copyText(text) {
      return new Promise((resolve) => {
        const fallback = () => {
          try {
            const ta = h('textarea', { style: { position: 'fixed', opacity: '0' } });
            ta.value = text; panelWrap.appendChild(ta); ta.select();
            const ok = document.execCommand('copy'); ta.remove(); resolve(!!ok);
          } catch (e) { resolve(false); }
        };
        try {
          if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).then(() => resolve(true), fallback);
          else fallback();
        } catch (e) { fallback(); }
      });
    }

    // ---- apply-as-plan modal
    function openModal(sch) {
      const n = S.selIdx + 1;
      const name = ('Wizard – ' + termDesc(S.term) + ' #' + n).slice(0, 30);
      S.modal = { sch, name, running: false, lines: [], done: false, ok: false, messages: [], failed: [] };
      render();
    }
    function runApply() {
      const m = S.modal;
      if (!m || m.running) return;
      const name = (m.name || '').trim().slice(0, 30);
      if (!name) { toast('Enter a plan name'); return; }
      m.running = true; m.lines = ['Starting…']; m.done = false; render();
      const crns = m.sch.sections.map((s) => s.crn);
      const push = (msg) => { m.lines.push(msg); renderModalLog(); };
      Promise.resolve().then(() => SW.api.applyPlan(S.term, crns, name, push)).then((res) => {
        m.running = false; m.done = true; m.ok = !!(res && res.ok);
        m.messages = (res && res.messages) || []; m.failed = (res && res.failedCrns) || [];
        render();
        loadPlans();
      }, (e) => {
        handleApiError(e);
        m.running = false; m.done = true; m.ok = false; m.messages = [errMsg(e)]; m.failed = [];
        render();
        loadPlans();
      });
    }
    function renderModalLog() {
      const log = panelWrap.querySelector('.m-log');
      if (!log || !S.modal) return;
      log.textContent = '';
      S.modal.lines.forEach((l) => log.appendChild(h('div', null, l)));
      log.scrollTop = log.scrollHeight;
    }
    function renderModal() {
      const m = S.modal;
      const crns = m.sch.sections;
      let body;
      if (m.done) {
        body = h('div', null,
          h('div', { class: 'm-result ' + (m.ok ? 'ok' : 'bad') }, m.ok ? '✓ Plan saved' + (m.failed.length ? ' (some sections could not be added)' : '') : '✕ Could not save the plan'),
          m.failed.length ? h('p', { class: 'err' }, 'Failed CRNs: ' + m.failed.join(', ')) : null,
          m.messages.length ? h('ul', { class: 'm-msgs' }, m.messages.map((x) => h('li', null, x))) : null,
          m.lines.length ? h('div', { class: 'm-log' }, m.lines.map((l) => h('div', null, l))) : null);
      } else if (m.running) {
        body = h('div', null, h('div', { class: 'row' }, h('span', { class: 'spinner' }), h('strong', null, 'Saving your plan…')),
          h('div', { class: 'm-log' }, m.lines.map((l) => h('div', null, l))));
      } else {
        const pl = S.plans.term === S.term && S.plans.status === 'ok' ? S.plans : null;
        body = h('div', null,
          pl && pl.list.length >= pl.max
            ? h('div', { class: 'banner warn block', role: 'alert' }, 'You already have ' + pl.list.length + '/' + pl.max + ' plans for this term. Banner will reject a new one — delete a plan in Banner first (use "Manage in Banner" in the plans strip), then try again.')
            : null,
          h('div', { class: 'field' }, h('label', null, 'Plan name (max 30 characters)'),
            h('input', { class: 'input', type: 'text', maxlength: '30', value: m.name, 'data-focus': 'planname', oninput: (e) => { m.name = e.target.value; },
              onkeydown: (e) => { if (e.key === 'Enter') runApply(); } })),
          h('p', { class: 'muted small' }, 'These sections will be added to a new plan in ' + termDesc(S.term) + ':'),
          h('ul', { class: 'm-crns' }, crns.map((s) => h('li', null, h('strong', null, s.courseKey), ' · Sec ' + s.section + ' · CRN ' + s.crn))));
      }
      const footer = m.done
        ? h('div', { class: 'row end' },
          m.ok ? h('button', { class: 'btn gold', type: 'button', onclick: () => { location.href = PLANS_URL; } }, 'View my plans') : null,
          h('button', { class: 'btn', type: 'button', onclick: () => { S.modal = null; render(); } }, 'Close'))
        : h('div', { class: 'row end' },
          h('button', { class: 'btn', type: 'button', disabled: m.running, onclick: () => { S.modal = null; render(); } }, 'Cancel'),
          h('button', { class: 'btn gold', type: 'button', disabled: m.running, onclick: runApply }, 'Confirm'));
      return h('div', { class: 'modal-back', onclick: (e) => { if (e.target === e.currentTarget && !m.running) { S.modal = null; render(); } } },
        h('div', { class: 'modal', role: 'dialog', 'aria-modal': 'true' }, h('h3', null, 'Apply as Plan'), body, footer));
    }

    // ---- controller
    const ctrl = {
      open() { S.open = true; render(); init(); },
      close() { S.open = false; render(); },
      toggle() { if (S.open) ctrl.close(); else ctrl.open(); },
      isOpen() { return S.open; },
    };
    render();
    return ctrl;
  }

  SW.ui = { mount, _helpers: { toMin, fromMin, normalizeCourseKey, parseCourseInput } };
  if (typeof module !== 'undefined' && module.exports) module.exports = SW.ui;
})(typeof globalThis !== 'undefined' ? globalThis : this);
