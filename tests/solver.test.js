// Run with: node tests/solver.test.js
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const solver = require('../src/solver.js');
const api = require('../src/api.js');

const tests = [];
const test = (name, fn) => tests.push({ name, fn });

// ---------- builders ----------
let crnCounter = 1000;
function sec(courseKey, meetings, extra = {}) {
  const [subject, courseNumber] = courseKey.split(' ');
  return Object.assign({
    crn: String(crnCounter++), term: '202710', subject, courseNumber, courseKey,
    section: '001', title: courseKey, scheduleType: 'Lecture', credits: 3,
    instructors: [], instructorKey: 'TBA', seats: 10, capacity: 30, waitCount: 0, waitAvailable: 0,
    open: true, method: 'Face-to-Face Instruction', campus: 'Main', linkIdentifier: null, isLinked: false,
    meetings: meetings.map((m) => Object.assign({ startDate: '2027-01-11', endDate: '2027-05-06', location: '', type: 'Class' }, m)),
    online: meetings.length === 0,
  }, extra);
}
const mt = (days, start, end, extra) => Object.assign({ days, start, end }, extra);
const course = (key, sections) => ({ key, sections });
const gen = (courses, options = {}, breaks = []) => solver.generate({ courses, breaks, options });

// ---------- tests ----------
test('conflict detection: overlap, adjacency, different days', () => {
  const a = sec('A 1', [mt([1, 3], 600, 660)]);
  assert.ok(solver.conflicts(a, sec('B 1', [mt([3], 630, 700)])));
  assert.ok(!solver.conflicts(a, sec('B 1', [mt([3], 660, 700)])), 'back-to-back is fine');
  assert.ok(!solver.conflicts(a, sec('B 1', [mt([2, 4], 600, 660)])));
  const r = gen([course('A 1', [a]), course('B 1', [sec('B 1', [mt([1], 630, 700)])])]);
  assert.strictEqual(r.total, 0);
});

test('generate returns one section per course in input order', () => {
  const r = gen([
    course('A 1', [sec('A 1', [mt([1], 600, 660)])]),
    course('B 1', [sec('B 1', [mt([1], 700, 760)]), sec('B 1', [mt([1], 620, 680)])]),
  ]);
  assert.strictEqual(r.total, 1);
  assert.deepStrictEqual(r.schedules[0].sections.map((s) => s.courseKey), ['A 1', 'B 1']);
});

test('breaks exclude overlapping sections', () => {
  const a = sec('A 1', [mt([1], 700, 760)]);
  const b = sec('A 1', [mt([1], 900, 960)]);
  const r = gen([course('A 1', [a, b])], {}, [{ days: [1], start: 720, end: 780, label: 'Lunch' }]);
  assert.deepStrictEqual(r.schedules.map((s) => s.sections[0]), [b]);
  const r2 = gen([course('A 1', [a])], {}, [{ days: [2], start: 720, end: 780 }]);
  assert.strictEqual(r2.total, 1, 'break on another day is fine');
});

test('daysOff excludes sections', () => {
  const a = sec('A 1', [mt([1, 5], 600, 660)]);
  const b = sec('A 1', [mt([2, 4], 600, 660)]);
  const r = gen([course('A 1', [a, b])], { daysOff: [5] });
  assert.deepStrictEqual(r.schedules.map((s) => s.sections[0]), [b]);
});

test('earliest / latest bounds', () => {
  const early = sec('A 1', [mt([1], 480, 530)]);
  const mid = sec('A 1', [mt([1], 600, 660)]);
  const late = sec('A 1', [mt([1], 1050, 1110)]);
  const r = gen([course('A 1', [early, mid, late])], { earliest: 540, latest: 1080 });
  assert.deepStrictEqual(r.schedules.map((s) => s.sections[0]), [mid]);
});

test('online sections never conflict and fit any constraints', () => {
  const online = sec('O 1', []);
  const a = sec('A 1', [mt([1], 600, 660)]);
  assert.ok(!solver.conflicts(a, online));
  assert.strictEqual(gen([course('A 1', [a]), course('O 1', [online])]).total, 1);
  const allDay = [{ days: [0, 1, 2, 3, 4, 5, 6], start: 0, end: 1440 }];
  const r = gen([course('O 1', [online])], { daysOff: [1, 2, 3, 4, 5], earliest: 1000 }, allDay);
  assert.strictEqual(r.total, 1);
});

test('part-of-term sections with disjoint dates do not conflict', () => {
  const first = sec('A 1', [mt([1, 3], 600, 700, { startDate: '2027-01-11', endDate: '2027-03-01' })]);
  const second = sec('B 1', [mt([1, 3], 600, 700, { startDate: '2027-03-15', endDate: '2027-05-06' })]);
  const overlapping = sec('B 1', [mt([1, 3], 600, 700, { startDate: '2027-02-15', endDate: '2027-05-06' })]);
  assert.ok(!solver.conflicts(first, second));
  assert.ok(solver.conflicts(first, overlapping));
  assert.strictEqual(gen([course('A 1', [first]), course('B 1', [second])]).total, 1);
  assert.strictEqual(gen([course('A 1', [first]), course('B 1', [overlapping])]).total, 0);
});

test('allowFull filtering', () => {
  const full = sec('A 1', [mt([1], 600, 660)], { seats: 0 });
  const open = sec('A 1', [mt([2], 600, 660)], { seats: 5 });
  assert.deepStrictEqual(gen([course('A 1', [full, open])]).schedules.map((s) => s.sections[0]), [open]);
  assert.strictEqual(gen([course('A 1', [full, open])], { allowFull: true }).total, 2);
});

test('sorting: compact, fewestDays, latestStart, earliestEnd, mostSeats', () => {
  const x = course('X 1', [sec('X 1', [mt([1, 3], 600, 660)], { seats: 100 })]);
  const y = course('Y 1', [
    sec('Y 1', [mt([1, 3], 662, 720)], { seats: 3, section: 'tight' }),      // near-adjacent, same days
    sec('Y 1', [mt([1, 3], 900, 960)], { seats: 50, section: 'gap' }),       // big gap, latest
    sec('Y 1', [mt([2, 4], 480, 540)], { seats: 20, section: 'otherdays' }), // more days, earliest
  ]);
  const order = (sort) => gen([x, y], { sort }).schedules.map((s) => s.sections[1].section);
  assert.deepStrictEqual(order('compact'), ['tight', 'otherdays', 'gap']);
  assert.strictEqual(order('fewestDays')[0], 'tight');
  assert.strictEqual(order('fewestDays')[2], 'otherdays');
  assert.strictEqual(order('latestStart')[2], 'otherdays');
  assert.strictEqual(order('earliestEnd')[0], 'otherdays');
  assert.strictEqual(order('mostSeats')[0], 'gap');
  const best = gen([x, y], { sort: 'compact' }).schedules[0];
  assert.deepStrictEqual(best.stats, {
    days: 2, totalGapMinutes: 4, earliestStart: 600, latestEnd: 720, credits: 6, minSeats: 3, avgProfRating: null,
  });
});

test('maxResults limits output but total counts all', () => {
  const secs = [0, 1, 2, 3, 4].map((i) => sec('A 1', [mt([1], 600 + i * 100, 650 + i * 100)]));
  const r = gen([course('A 1', secs)], { maxResults: 2 });
  assert.strictEqual(r.schedules.length, 2);
  assert.strictEqual(r.total, 5);
});

test('truncation at hard cap of 50,000', () => {
  const online = (k) => course(k, Array.from({ length: 15 }, () => sec(k, [])));
  const r = gen([online('A 1'), online('B 1'), online('C 1'), online('D 1')], { maxResults: 10 }); // 15^4 = 50,625
  assert.strictEqual(r.truncated, true);
  assert.strictEqual(r.total, 50000);
  assert.strictEqual(r.schedules.length, 10);
  const small = gen([online('A 1'), online('B 1')]);
  assert.strictEqual(small.truncated, false);
  assert.strictEqual(small.total, 225);
});

test('empty-course error', () => {
  const r = gen([
    course('MATH 2164', [sec('MATH 2164', [mt([5], 600, 660)])]),
    course('A 1', [sec('A 1', [mt([1], 600, 660)])]),
  ], { daysOff: [5] });
  assert.deepStrictEqual(r.errors, ['No sections of MATH 2164 fit your constraints']);
  assert.strictEqual(r.total, 0);
  assert.deepStrictEqual(gen([course('Z 9', [])]).errors, ['No sections of Z 9 fit your constraints']);
});

test('components: lecture + lab required, links respected', () => {
  const lec1 = sec('C 1', [mt([1], 600, 660)], { scheduleType: 'Lecture', linkIdentifier: 'A', section: 'L1' });
  const lec2 = sec('C 1', [mt([1], 700, 760)], { scheduleType: 'Lecture', linkIdentifier: 'B', section: 'L2' });
  const lab1 = sec('C 1', [mt([2], 600, 700)], { scheduleType: 'Laboratory', linkIdentifier: 'A', section: 'B1' });
  const r = gen([course('C 1', [lec1, lec2, lab1])]);
  assert.strictEqual(r.total, 1);
  assert.deepStrictEqual(r.schedules[0].sections.map((s) => s.section).sort(), ['B1', 'L1']);
  const noLab = gen([course('C 1', [lec1, lab1])], { daysOff: [2] });
  assert.strictEqual(noLab.errors.length, 1, 'lab excluded -> course unsatisfiable');
});

test('labels', () => {
  assert.strictEqual(solver.minutesToLabel(480), '8:00 AM');
  assert.strictEqual(solver.minutesToLabel(0), '12:00 AM');
  assert.strictEqual(solver.minutesToLabel(720), '12:00 PM');
  assert.strictEqual(solver.minutesToLabel(1085), '6:05 PM');
  assert.strictEqual(solver.daysToLabel([5, 1, 3]), 'MWF');
  assert.strictEqual(solver.daysToLabel([2, 4, 0, 6]), 'TRSU');
});

test('normalizeSection on real-shape fixture', () => {
  const raw = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'math2164.json'), 'utf8'));
  const n = api.normalizeSection(raw[0]);
  assert.strictEqual(n.crn, '20429');
  assert.strictEqual(n.courseKey, 'MATH 2164');
  assert.strictEqual(n.section, '001');
  assert.strictEqual(n.title, 'Matrices & Linear Algebra');
  assert.strictEqual(n.credits, 3);
  assert.deepStrictEqual(n.instructors, ['Alan Dow']);
  assert.strictEqual(n.instructorKey, 'Alan Dow');
  assert.strictEqual(n.seats, 60);
  assert.strictEqual(n.open, true);
  assert.strictEqual(n.method, 'Face-to-Face Instruction');
  assert.strictEqual(n.online, false);
  assert.strictEqual(n.meetings.length, 1, 'one-off final exam skipped');
  assert.deepStrictEqual(n.meetings[0], {
    days: [1, 3, 5], start: 480, end: 530, startDate: '2027-01-11', endDate: '2027-05-06',
    location: 'Fretwell 126', type: 'Class',
  });

  const o = api.normalizeSection(raw[1]);
  assert.strictEqual(o.online, true);
  assert.deepStrictEqual(o.meetings, []);
  assert.deepStrictEqual(o.instructors, []);
  assert.strictEqual(o.instructorKey, 'TBA');
  assert.strictEqual(o.open, false);
  assert.strictEqual(o.waitAvailable, 4);
});

test('performance: 7 courses x 30 sections under 1500ms', () => {
  let seed = 12345;
  const rnd = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
  const patterns = [[1, 3, 5], [2, 4], [1, 3], [2, 4], [1], [3], [5], [1, 2, 3, 4]];
  const courses = Array.from({ length: 7 }, (_, c) => {
    const key = `C${c} 1000`;
    return course(key, Array.from({ length: 30 }, () => {
      const start = 480 + Math.floor(rnd() * 28) * 30; // 8:00 .. 21:30
      const len = rnd() < 0.5 ? 50 : 75;
      return sec(key, [mt(patterns[Math.floor(rnd() * patterns.length)], start, start + len)]);
    }));
  });
  const t0 = Date.now();
  const r = gen(courses, { maxResults: 200 });
  const ms = Date.now() - t0;
  console.log(`  (perf: ${r.total} schedules, truncated=${r.truncated}, ${ms}ms)`);
  assert.ok(ms < 1500, `took ${ms}ms`);
});

test('bestProfs sort orders by mean professor rating; unrated count as 3.0', () => {
  const a1 = sec('A 1', [mt([1], 600, 650)], { profRating: 2.0 });
  const a2 = sec('A 1', [mt([2], 600, 650)], { profRating: 4.8 });
  const a3 = sec('A 1', [mt([3], 600, 650)]); // unrated -> 3.0
  const b1 = sec('B 1', [mt([4], 600, 650)], { profRating: 4.0 });
  const r = gen([course('A 1', [a1, a2, a3]), course('B 1', [b1])], { sort: 'bestProfs' });
  assert.strictEqual(r.total, 3);
  assert.deepStrictEqual(r.schedules.map((s) => s.sections[0].crn), [a2.crn, a3.crn, a1.crn]);
  assert.ok(Math.abs(r.schedules[0].stats.avgProfRating - 4.4) < 1e-9);
  assert.strictEqual(r.schedules[1].stats.avgProfRating, 4.0); // only known ratings averaged
  const none = gen([course('A 1', [sec('A 1', [mt([1], 600, 650)])])]);
  assert.strictEqual(none.schedules[0].stats.avgProfRating, null);
});

// ---------- runner ----------
let failed = 0;
for (const { name, fn } of tests) {
  try {
    fn();
    console.log('PASS', name);
  } catch (e) {
    failed++;
    console.log('FAIL', name, '\n    ' + (e && e.stack ? e.stack.split('\n').slice(0, 4).join('\n    ') : e));
  }
}
console.log(`\n${tests.length - failed}/${tests.length} passed`);
process.exit(failed ? 1 : 0);
