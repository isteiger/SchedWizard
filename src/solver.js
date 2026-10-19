// SW.solver — pure schedule generator (no DOM). Works on NormSection objects from SW.api.normalizeSection.
(function (root) {
  const SW = (root.SW = root.SW || {});
  const HARD_CAP = 200000;
  const SLOT = 5; // minutes per bitmask slot
  const SLOTS_PER_DAY = 288;

  // ---------- labels ----------

  function minutesToLabel(m) {
    const h24 = Math.floor(m / 60) % 24;
    const mm = String(m % 60).padStart(2, '0');
    const h = h24 % 12 === 0 ? 12 : h24 % 12;
    return `${h}:${mm} ${h24 < 12 ? 'AM' : 'PM'}`;
  }

  const DAY_LETTERS = ['U', 'M', 'T', 'W', 'R', 'F', 'S']; // index = 0 (Sun) .. 6 (Sat)
  const DAY_ORDER = [1, 2, 3, 4, 5, 6, 0];
  function daysToLabel(days) {
    const set = new Set(days);
    return DAY_ORDER.filter((d) => set.has(d)).map((d) => DAY_LETTERS[d]).join('');
  }

  // ---------- modality ----------

  const HYBRID_RE = /hybrid|blended/i;
  const ONLINE_RE = /online|distance|remote/i;
  function isHybrid(sec) { return !!sec && HYBRID_RE.test(sec.method || ''); }
  // No timed meetings (flagged online by the API, or simply no meetings).
  function hasNoTimes(sec) { return !!sec && (!!sec.online || !sec.meetings || !sec.meetings.length); }
  // Online = an online/distance/remote method, or no timed meetings with an empty/unknown method; never hybrid.
  function isOnline(sec) {
    if (!sec || isHybrid(sec)) return false;
    const method = String(sec.method || '').trim();
    if (ONLINE_RE.test(method)) return true;
    return hasNoTimes(sec) && !method;
  }
  // TBA = no timed meetings but a non-online delivery method (e.g. Face-to-Face with times still to be announced).
  function isTba(sec) {
    if (!sec || isHybrid(sec) || !hasNoTimes(sec)) return false;
    const method = String(sec.method || '').trim();
    return !!method && !ONLINE_RE.test(method);
  }
  // 'online' | 'hybrid' | 'inperson' (TBA-time non-online sections count as in person)
  function modalityOf(sec) { return isHybrid(sec) ? 'hybrid' : isOnline(sec) ? 'online' : 'inperson'; }
  // 1000 per non-preferred section, 500 per hybrid.
  function modalityPenalty(sections, modality) {
    if (modality !== 'preferOnline' && modality !== 'preferInPerson') return 0;
    const want = modality === 'preferOnline' ? 'online' : 'inperson';
    let p = 0;
    for (const s of sections) {
      const m = modalityOf(s);
      if (m === want) continue;
      p += m === 'hybrid' ? 500 : 1000;
    }
    return p;
  }

  // ---------- conflicts ----------

  function datesOverlap(a, b) {
    if (!a.startDate || !a.endDate || !b.startDate || !b.endDate) return true;
    return a.startDate <= b.endDate && b.startDate <= a.endDate; // ISO strings compare lexically
  }

  function meetingsConflict(a, b) {
    return a.start < b.end && b.start < a.end && a.days.some((d) => b.days.includes(d)) && datesOverlap(a, b);
  }

  // Exact conflict test between two sections.
  function conflicts(secA, secB) {
    for (const a of secA.meetings) for (const b of secB.meetings) if (meetingsConflict(a, b)) return true;
    return false;
  }

  // Per-day BigInt bitmask of 5-minute slots (conservative: rounds outward).
  const maskCache = new Map();
  function rangeMask(start, end) {
    const key = start * 2000 + end;
    let m = maskCache.get(key);
    if (m === undefined) {
      const s = Math.floor(start / SLOT);
      const e = Math.min(SLOTS_PER_DAY, Math.ceil(end / SLOT));
      m = e > s ? ((1n << BigInt(e - s)) - 1n) << BigInt(s) : 0n;
      maskCache.set(key, m);
    }
    return m;
  }

  function sectionMasks(sec) {
    const masks = [0n, 0n, 0n, 0n, 0n, 0n, 0n];
    for (const mt of sec.meetings) {
      const m = rangeMask(mt.start, mt.end);
      for (const d of mt.days) masks[d] |= m;
    }
    return masks;
  }

  // ---------- eligibility ----------

  // Does the section satisfy breaks + options? (times only; allowFull handled separately)
  function sectionFits(sec, breaks, options) {
    const o = options || {};
    const off = o.daysOff || [];
    for (const mt of sec.meetings) {
      if (o.earliest != null && mt.start < o.earliest) return false;
      if (o.latest != null && mt.end > o.latest) return false;
      if (off.length && mt.days.some((d) => off.includes(d))) return false;
      for (const br of breaks || []) {
        if (mt.start < br.end && br.start < mt.end && mt.days.some((d) => br.days.includes(d))) return false;
      }
    }
    return true;
  }

  // ---------- components ----------

  // Split a course's eligible sections into required components.
  // One component normally; one per scheduleType when several types exist and none is "Lecture/Lab".
  // Required types come from course.allSections (every loaded section, selected or not) when given.
  function buildComponents(course, eligible) {
    const types = [...new Set(eligible.map((s) => s.scheduleType))];
    const full = course.allSections || course.sections;
    const combined = full.some((s) => /lecture\s*\/\s*lab/i.test(s.scheduleType));
    const allTypes = new Set(full.map((s) => s.scheduleType));
    if (allTypes.size <= 1 || combined) return [eligible];
    // Component per type found in the full list so a missing type surfaces as "no sections fit".
    const comps = [...allTypes].map((t) => eligible.filter((s) => s.scheduleType === t));
    return types.length ? comps : [eligible];
  }

  function linkCompatible(a, b) {
    return a.linkIdentifier == null || b.linkIdentifier == null || a.linkIdentifier === b.linkIdentifier;
  }

  // ---------- scoring ----------

  function computeStats(sections) {
    const byDay = new Map(); // day -> [[start,end]]
    let earliestStart = Infinity;
    let latestEnd = -Infinity;
    let minSeats = Infinity;
    const creditsByCourse = new Map();
    let ratingSum = 0;
    let ratingN = 0;
    let onlineCount = 0;
    for (const s of sections) {
      if (typeof s.profRating === 'number' && isFinite(s.profRating)) { ratingSum += s.profRating; ratingN++; }
      if (isOnline(s)) onlineCount++;
      minSeats = Math.min(minSeats, s.seats);
      creditsByCourse.set(s.courseKey, Math.max(creditsByCourse.get(s.courseKey) || 0, s.credits || 0));
      for (const mt of s.meetings) {
        earliestStart = Math.min(earliestStart, mt.start);
        latestEnd = Math.max(latestEnd, mt.end);
        for (const d of mt.days) {
          if (!byDay.has(d)) byDay.set(d, []);
          byDay.get(d).push([mt.start, mt.end]);
        }
      }
    }
    let totalGapMinutes = 0;
    let startSum = 0;
    let endSum = 0;
    for (const iv of byDay.values()) {
      iv.sort((a, b) => a[0] - b[0]);
      let prevEnd = iv[0][1];
      startSum += iv[0][0];
      for (let i = 1; i < iv.length; i++) {
        if (iv[i][0] > prevEnd) totalGapMinutes += iv[i][0] - prevEnd;
        prevEnd = Math.max(prevEnd, iv[i][1]);
      }
      endSum += prevEnd;
    }
    const days = byDay.size;
    let credits = 0;
    for (const c of creditsByCourse.values()) credits += c;
    return {
      stats: {
        days, totalGapMinutes,
        earliestStart: days ? earliestStart : 0,
        latestEnd: days ? latestEnd : 0,
        credits,
        minSeats: minSeats === Infinity ? 0 : minSeats,
        avgProfRating: ratingN ? ratingSum / ratingN : null,
        onlineCount,
      },
      avgStart: days ? startSum / days : 0,
      avgEnd: days ? endSum / days : 0,
    };
  }

  function compactScore(st) { return st.totalGapMinutes + 30 * st.days; }

  function scoreSchedule(sections, sort, modality) {
    const { stats, avgStart, avgEnd } = computeStats(sections);
    const compact = compactScore(stats);
    let score;
    switch (sort) {
      case 'fewestDays': score = stats.days * 1000 + stats.totalGapMinutes; break;
      case 'latestStart': score = -avgStart; break;
      case 'earliestEnd': score = avgEnd; break;
      case 'mostSeats': score = -stats.minSeats; break;
      case 'bestProfs': {
        // Sections without a rating count as a neutral 3.0.
        let sum = 0;
        for (const s of sections) sum += typeof s.profRating === 'number' && isFinite(s.profRating) ? s.profRating : 3.0;
        score = -(sections.length ? sum / sections.length : 3.0);
        break;
      }
      default: score = compact;
    }
    score += modalityPenalty(sections, modality);
    return { sections, score, stats, compact };
  }

  // ---------- generate ----------

  function better(a, b) { return a.score < b.score || (a.score === b.score && a.compact < b.compact); }

  // Per-section heuristic (lower = tried first) approximating the chosen sort.
  function candidateKeyFn(sort) {
    const ext = (sec, f, init) => sec.meetings.reduce((a, m) => f(a, m), init);
    switch (sort) {
      case 'bestProfs': return (s) => -(typeof s.profRating === 'number' && isFinite(s.profRating) ? s.profRating : 3.0);
      case 'mostSeats': return (s) => -s.seats;
      case 'latestStart': return (s) => (s.meetings.length ? -ext(s, (a, m) => Math.min(a, m.start), Infinity) : 0);
      case 'earliestEnd': return (s) => (s.meetings.length ? ext(s, (a, m) => Math.max(a, m.end), -Infinity) : 0);
      default: return (s) => new Set([].concat(...s.meetings.map((m) => m.days))).size;
    }
  }

  function generate(input) {
    const courses = (input && input.courses) || [];
    const breaks = (input && input.breaks) || [];
    const opts = Object.assign({ earliest: null, latest: null, daysOff: [], allowFull: false, maxResults: 200, sort: 'compact' }, input && input.options);
    const cap = opts.hardCap || HARD_CAP;
    const empty = (errors) => ({ schedules: [], total: 0, truncated: false, errors });

    if (!courses.length) return empty(['No courses selected']);

    // Pre-filter and split into components.
    const slots = []; // { courseIdx, compIdx, cands }
    const errors = [];
    courses.forEach((course, ci) => {
      const eligible = course.sections.filter((s) => (opts.allowFull || s.seats > 0) && sectionFits(s, breaks, opts));
      const comps = buildComponents(course, eligible);
      if (!eligible.length) {
        errors.push(`No sections of ${course.key} fit your constraints`);
        return;
      }
      const missing = comps.findIndex((c) => !c.length);
      if (missing >= 0) {
        const full = course.allSections || course.sections;
        const allTypes = [...new Set(full.map((x) => x.scheduleType))];
        errors.push(`No ${allTypes[missing] || ''} sections of ${course.key} selected/fit your constraints`.replace('No  ', 'No '));
        return;
      }
      comps.forEach((cands, k) => {
        slots.push({
          courseIdx: ci, compIdx: k,
          cands: cands.map((sec) => ({ sec, masks: sectionMasks(sec) })),
        });
      });
    });
    if (errors.length) return empty(errors);

    // Output order = input course order, then component order; search order = fewest candidates first.
    slots.forEach((s, i) => { s.outPos = i; });
    const order = slots.slice().sort((a, b) => a.cands.length - b.cands.length);

    // Order each slot's candidates by a cheap heuristic matching the sort so the capped search sees good schedules first.
    const candKey = candidateKeyFn(opts.sort);
    order.forEach((slot) => {
      slot.cands.forEach((c) => { c.key = candKey(c.sec); });
      slot.cands.sort((a, b) => a.key - b.key); // stable
    });

    const top = []; // best K by (score, compact), ascending
    const K = Math.max(0, opts.maxResults);
    let total = 0;
    let truncated = false;
    const picked = new Array(order.length);
    const occ0 = [0n, 0n, 0n, 0n, 0n, 0n, 0n];

    function dfs(depth, occ) {
      if (truncated) return;
      if (depth === order.length) {
        if (total >= cap) { truncated = true; return; }
        total++;
        const secs = new Array(order.length);
        for (let i = 0; i < order.length; i++) secs[order[i].outPos] = picked[i].sec;
        const sc = scoreSchedule(secs, opts.sort, opts.modality);
        if (top.length < K || better(sc, top[top.length - 1])) {
          // Insert after any equal entries (keeps enumeration order on ties).
          let lo = 0, hi = top.length;
          while (lo < hi) { const mid = (lo + hi) >> 1; if (better(sc, top[mid])) hi = mid; else lo = mid + 1; }
          top.splice(lo, 0, sc);
          if (top.length > K) top.pop();
        }
        return;
      }
      const slot = order[depth];
      for (const cand of slot.cands) {
        if (truncated) return;
        if (!placeable(depth, slot, cand, occ)) continue;
        const next = occ.slice();
        for (let d = 0; d < 7; d++) next[d] |= cand.masks[d];
        picked[depth] = cand;
        dfs(depth + 1, next);
      }
    }

    function placeable(depth, slot, cand, occ) {
      for (let i = 0; i < depth; i++) {
        if (order[i].courseIdx === slot.courseIdx && !linkCompatible(picked[i].sec, cand.sec)) return false;
      }
      let collide = false;
      for (let d = 0; d < 7; d++) if (occ[d] & cand.masks[d]) { collide = true; break; }
      if (!collide) return true;
      // Bitmasks are conservative (and ignore dates); confirm with exact comparison.
      for (let i = 0; i < depth; i++) if (conflicts(picked[i].sec, cand.sec)) return false;
      return true;
    }

    dfs(0, occ0);

    const schedules = top.map(({ sections, score, stats }) => ({ sections, score, stats }));
    return { schedules, total, truncated, errors: [] };
  }

  SW.solver = { isOnline, isHybrid, isTba, modalityOf, modalityPenalty, generate, conflicts, sectionFits, scoreSchedule, buildComponents, minutesToLabel, daysToLabel };
  if (typeof module !== 'undefined' && module.exports) module.exports = SW.solver;
})(typeof globalThis !== 'undefined' ? globalThis : this);
