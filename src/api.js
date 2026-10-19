// SW.api — Banner 9 Student Registration SSB client (same-origin fetch from the content script).
(function (root) {
  const SW = (root.SW = root.SW || {});
  const BASE = '/StudentRegistrationSsb/ssb';
  const PAGE_SIZE = 500;
  const hasDom = typeof document !== 'undefined' && typeof fetch === 'function';

  // ---------- helpers ----------

  function sessionExpired(detail) {
    const err = new Error('Your Banner session expired — refresh the page and log in.' + (detail ? ' (' + detail + ')' : ''));
    err.code = 'SESSION_EXPIRED';
    return err;
  }

  const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };
  function decodeHtml(s) {
    if (s == null) return '';
    return String(s).replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e) => {
      if (e[0] === '#') {
        const code = e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
        return Number.isFinite(code) ? String.fromCodePoint(code) : m;
      }
      const v = ENTITIES[e.toLowerCase()];
      return v === undefined ? m : v;
    });
  }

  function parseTime(t) {
    if (t == null || !/^\d{3,4}$/.test(String(t))) return null;
    const s = String(t).padStart(4, '0');
    return parseInt(s.slice(0, 2), 10) * 60 + parseInt(s.slice(2), 10);
  }

  // "01/11/2027" -> "2027-01-11"
  function parseDate(d) {
    const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(d || '');
    return m ? `${m[3]}-${m[1].padStart(2, '0')}-${m[2].padStart(2, '0')}` : d || null;
  }

  const DAY_KEYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];

  // ---------- normalization ----------

  function normalizeSection(raw) {
    const meetings = [];
    for (const mf of raw.meetingsFaculty || []) {
      const mt = mf && mf.meetingTime;
      if (!mt) continue;
      const start = parseTime(mt.beginTime);
      const end = parseTime(mt.endTime);
      if (start == null || end == null) continue;
      const startDate = parseDate(mt.startDate);
      const endDate = parseDate(mt.endDate);
      if (startDate && startDate === endDate) continue; // one-off exam/final
      const days = [];
      DAY_KEYS.forEach((k, i) => { if (mt[k]) days.push(i); });
      if (!days.length) continue;
      const place = decodeHtml(mt.buildingDescription || mt.building || '');
      meetings.push({
        days, start, end, startDate, endDate,
        location: [place, mt.room].filter(Boolean).join(' '),
        type: decodeHtml(mt.meetingTypeDescription || ''),
      });
    }

    const instructors = (raw.faculty || []).map((f) => decodeHtml(f.displayName)).filter(Boolean);
    const credits = [raw.creditHours, raw.creditHourLow, raw.creditHourHigh].find((v) => typeof v === 'number') ?? 0;
    const subject = raw.subject || '';
    const courseNumber = raw.courseNumber || '';

    return {
      crn: String(raw.courseReferenceNumber),
      term: String(raw.term),
      subject,
      courseNumber,
      courseKey: `${subject} ${courseNumber}`,
      section: raw.sequenceNumber || '',
      title: decodeHtml(raw.courseTitle),
      scheduleType: decodeHtml(raw.scheduleTypeDescription),
      credits,
      instructors,
      instructorKey: instructors.length ? instructors.join(' / ') : 'TBA',
      seats: raw.seatsAvailable ?? 0,
      capacity: raw.maximumEnrollment ?? 0,
      waitCount: raw.waitCount ?? 0,
      waitAvailable: raw.waitAvailable ?? 0,
      open: !!raw.openSection,
      method: decodeHtml(raw.instructionalMethodDescription),
      campus: decodeHtml(raw.campusDescription),
      linkIdentifier: raw.linkIdentifier ?? null,
      isLinked: !!raw.isSectionLinked,
      meetings,
      online: meetings.length === 0,
    };
  }

  // ---------- network layer (browser only) ----------

  let queue = Promise.resolve();
  // Banner keeps term/mode in the server session, so every public call runs one at a time.
  function enqueue(task) {
    const run = queue.then(task);
    queue = run.catch(() => {});
    return run;
  }

  let cachedToken = null;
  let searchTerm = null; // term currently selected in "search" mode on the server

  async function getToken() {
    if (hasDom) {
      const meta = document.querySelector('meta[name="synchronizerToken"]');
      if (meta && meta.content) return meta.content;
    }
    if (cachedToken) return cachedToken;
    const res = await fetch(`${BASE}/term/termSelection?mode=plan`, { credentials: 'include' });
    checkResponse(res);
    const m = /name="synchronizerToken"\s+content="([^"]+)"/.exec(await res.text());
    if (!m) throw sessionExpired('no synchronizer token');
    cachedToken = m[1];
    return cachedToken;
  }

  function checkResponse(res) {
    if (res.status === 401 || res.status === 403) throw sessionExpired('HTTP ' + res.status);
    if (res.redirected && /login|\/cas\/|saml|sso/i.test(res.url)) throw sessionExpired('redirected to login');
    if (!res.ok) throw new Error(`Banner request failed (HTTP ${res.status})`);
  }

  // opts: { method, body (string), contentType, html }  -> parsed JSON (or text when html)
  async function request(path, opts = {}) {
    const headers = {
      'X-Synchronizer-Token': await getToken(),
      'X-Requested-With': 'XMLHttpRequest',
    };
    if (opts.body !== undefined) headers['Content-Type'] = opts.contentType || 'application/x-www-form-urlencoded; charset=UTF-8';
    const res = await fetch(BASE + path, {
      method: opts.method || 'GET',
      credentials: 'include',
      headers,
      body: opts.body,
    });
    checkResponse(res);
    const text = await res.text();
    if (opts.html) return text;
    try {
      return JSON.parse(text);
    } catch (e) {
      throw sessionExpired('non-JSON response'); // login pages come back as HTML
    }
  }

  const form = (obj) => Object.entries(obj).map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`).join('&');
  const termBody = (term) => form({ term, studyPath: '', studyPathText: '', startDatepicker: '', endDatepicker: '' });

  // Banner messages are a string or [{message, type}]
  function formatMessage(m) {
    if (!m) return '';
    if (Array.isArray(m)) return m.map((x) => (x && x.message) || String(x)).join('; ');
    return typeof m === 'string' ? m : (m.message || JSON.stringify(m));
  }

  // ---------- public API ----------

  function getTerms() {
    return enqueue(async () => {
      const list = await request('/plan/getTerms?searchTerm=&offset=1&max=30');
      return (Array.isArray(list) ? list : []).map((t) => ({ code: String(t.code), description: decodeHtml(t.description) }));
    });
  }

  function searchCourse(term, subject, courseNumber) {
    return enqueue(async () => {
      if (searchTerm !== term) {
        searchTerm = null;
        await request('/term/search?mode=search', { method: 'POST', body: termBody(term) });
        searchTerm = term;
      }
      await request('/classSearch/resetDataForm', { method: 'POST', body: '' });

      const uniqueSessionId = Math.random().toString(36).slice(2, 7) + Date.now();
      const all = [];
      for (;;) {
        const qs = form({
          txt_subject: subject, txt_courseNumber: courseNumber, txt_term: term,
          startDatepicker: '', endDatepicker: '', uniqueSessionId,
          pageOffset: all.length, pageMaxSize: PAGE_SIZE,
          sortColumn: 'subjectDescription', sortDirection: 'asc',
        });
        const res = await request('/searchResults/searchResults?' + qs);
        const data = (res && res.data) || [];
        all.push(...data);
        const total = (res && res.totalCount) || 0;
        if (!data.length || all.length >= total) break;
      }
      return all;
    });
  }

  function applyPlan(term, crns, planName, onProgress) {
    const say = (m) => { if (onProgress) { try { onProgress(m); } catch (e) { /* ignore UI errors */ } } };
    return enqueue(async () => {
      const messages = [];
      const failedCrns = [];
      const models = [];

      say('Switching to plan mode…');
      await request('/term/search?mode=plan', { method: 'POST', body: termBody(term) });
      searchTerm = null; // server is no longer in search mode; force re-select on next search

      say('Starting a new plan…');
      await request('/plan/plan', { html: true });

      for (const crn of crns) {
        say(`Adding CRN ${crn}…`);
        try {
          const res = await request('/plan/addPlanItem', {
            method: 'POST',
            body: form({ term, courseReferenceNumber: crn, section: 'section' }),
          });
          if (res && res.success && res.model) {
            models.push(Object.assign({}, res.model, { headerDescription: planName, headerComment: '' }));
          } else {
            failedCrns.push(crn);
            messages.push(`CRN ${crn}: ${(res && formatMessage(res.message)) || 'could not be added'}`);
          }
        } catch (e) {
          if (e.code === 'SESSION_EXPIRED') throw e;
          failedCrns.push(crn);
          messages.push(`CRN ${crn}: ${e.message}`);
        }
      }

      if (!models.length) {
        messages.push('No sections could be added, so the plan was not saved.');
        return { ok: false, messages, failedCrns };
      }

      say('Saving plan…');
      const res = await request('/plan/submitPlan/batch', {
        method: 'POST',
        contentType: 'application/json',
        body: JSON.stringify({ create: models, update: [], destroy: [] }),
      });
      if (!res || !res.success) {
        messages.push(formatMessage(res && res.message) || 'Banner rejected the plan.');
        return { ok: false, messages, failedCrns };
      }
      say('Plan saved.');
      return { ok: failedCrns.length === 0, messages, failedCrns };
    });
  }

  SW.api = { getTerms, searchCourse, normalizeSection, applyPlan, decodeHtml };
  if (typeof module !== 'undefined' && module.exports) module.exports = SW.api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
