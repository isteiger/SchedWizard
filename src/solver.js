// SW.solver — pure schedule generator (no DOM). Works on NormSection objects from SW.api.normalizeSection.
(function (root) {
  const SW = (root.SW = root.SW || {});
  const HARD_CAP = 50000;
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
  // Online = flagged online (no meeting times) or an online/distance/remote method, and not hybrid.
  function isOnline(sec) {
    if (!sec || isHybrid(sec)) return false;
    return !!sec.online || ONLINE_RE.test(sec.method || '');
  }
  // 'online' | 'hybrid' | 'inperson'
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
  function buildComponents(course, eligible) {
    const types = [...new Set(eligible.map((s) => s.scheduleType))];
    const combined = course.sections.some((s) => /lecture\s*\/\s*lab/i.test(s.scheduleType));
    const allTypes = new Set(course.sections.map((s) => s.scheduleType));
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
      if (!eligible.length || comps.some((c) => !c.length)) {
        errors.push(`No sections of ${course.key} fit your constraints`);
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

    const found = [];
    let truncated = false;
    const picked = new Array(order.length);
    const occ0 = [0n, 0n, 0n, 0n, 0n, 0n, 0n];

    function dfs(depth, occ) {
      if (truncated) return;
      if (depth === order.length) {
        if (found.length >= cap) { truncated = true; return; }
        const secs = new Array(order.length);
        for (let i = 0; i < order.length; i++) secs[order[i].outPos] = picked[i].sec;
        found.push(secs);
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

    const scored = found.map((secs) => scoreSchedule(secs, opts.sort, opts.modality));
    scored.sort((a, b) => a.score - b.score || a.compact - b.compact);
    const top = scored.slice(0, opts.maxResults).map(({ sections, score, stats }) => ({ sections, score, stats }));
    return { schedules: top, total: found.length, truncated, errors: [] };
  }

  SW.solver = { isOnline, isHybrid, modalityOf, modalityPenalty, generate, conflicts, sectionFits, scoreSchedule, buildComponents, minutesToLabel, daysToLabel };
  if (typeof module !== 'undefined' && module.exports) module.exports = SW.solver;
})(typeof globalThis !== 'undefined' ? globalThis : this);
