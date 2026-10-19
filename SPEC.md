# Niner Schedule Wizard — Chrome Extension Spec

Rebuild of UNC Charlotte's retired schedule wizard as a Chrome MV3 extension that runs on
`https://selfservice.uncc.edu/StudentRegistrationSsb/*` (Ellucian Banner 9 Self-Service Registration).

**No build step.** Plain JS, loaded unpacked. Content scripts are classic scripts (not ES modules) that
share a global namespace `globalThis.SW`. Every file wraps itself in an IIFE and attaches to `SW`.

## File layout (ownership)

```
manifest.json            (UI agent)
background.js            (UI agent)   action click -> chrome.tabs.sendMessage(tab.id, {type:'SW_TOGGLE'}); if no content script (other site) open https://selfservice.uncc.edu/StudentRegistrationSsb/ssb/term/termSelection?mode=plan
src/api.js               (CORE agent) SW.api
src/solver.js            (CORE agent) SW.solver  — pure, no DOM, node-testable
tests/solver.test.js     (CORE agent) run with `node tests/solver.test.js` (node:assert, no deps)
tests/fixtures/*.json    (CORE agent) hand-made section fixtures in real Banner shape (see below)
src/ui/styles.css        (UI agent)   injected into the shadow root (fetch via chrome.runtime.getURL, web_accessible_resources)
src/ui/app.js            (UI agent)   SW.ui  — all panel rendering/state
src/content.js           (UI agent)   bootstraps: floating launcher button + listens for SW_TOGGLE
icons/icon16.png, icon48.png, icon128.png (UI agent) — generate simple green/gold PNGs with a node script (no deps: write PNG bytes with zlib) 
```

manifest content_scripts order: `src/api.js`, `src/solver.js`, `src/ui/app.js`, `src/content.js`, `run_at: document_idle`,
matches `https://selfservice.uncc.edu/StudentRegistrationSsb/*`. Permissions: `storage`. host_permissions: `https://selfservice.uncc.edu/*`.

Node-test compatibility pattern for solver.js / api.js:
```js
(function (root) {
  const SW = (root.SW = root.SW || {});
  // ...
  SW.solver = { ... };
  if (typeof module !== 'undefined' && module.exports) module.exports = SW.solver;
})(typeof globalThis !== 'undefined' ? globalThis : this);
```

## Banner API (verified live against UNCC on 2026-10-19)

Base: `/StudentRegistrationSsb/ssb`. All calls are same-origin `fetch` from the content script with
`credentials: 'include'` and headers:
```
X-Synchronizer-Token: <meta[name="synchronizerToken"].content of the current document>
X-Requested-With: XMLHttpRequest
Content-Type: application/x-www-form-urlencoded; charset=UTF-8   (for form posts)
```
If the meta tag is missing (some pages), fetch `/StudentRegistrationSsb/ssb/term/termSelection?mode=plan` as text and
regex out `name="synchronizerToken" content="([^"]+)"`.

The server holds the selected term + mode **in the session**, so calls must be **sequential** (one at a time,
serialize through a promise queue in api.js). Never run searches in parallel.

1. **Terms open for planning**: `GET /plan/getTerms?searchTerm=&offset=1&max=30` → `[{code:"202710", description:"Spring 2027"}, ...]`
   (classSearch/getTerms returns same codes with " (View Only)" suffixes — use plan/getTerms.)
2. **Select term for searching**: `POST /term/search?mode=search` body `term=202710&studyPath=&studyPathText=&startDatepicker=&endDatepicker=` → `{fwdURL: ...}`
3. **Reset search form** (before every search): `POST /classSearch/resetDataForm`
4. **Section search**: `GET /searchResults/searchResults?txt_subject=MATH&txt_courseNumber=2164&txt_term=202710&startDatepicker=&endDatepicker=&uniqueSessionId=<random>&pageOffset=0&pageMaxSize=500&sortColumn=subjectDescription&sortDirection=asc`
   → `{success:true, totalCount:10, data:[Section...]}`. If totalCount > data.length, page with pageOffset.
   Section shape (abridged, real):
   ```json
   {"id":332260,"term":"202710","courseReferenceNumber":"20429","partOfTerm":"1","courseNumber":"2164",
    "subject":"MATH","sequenceNumber":"001","campusDescription":"Main Campus or Dubois Campus",
    "scheduleTypeDescription":"Lecture","courseTitle":"Matrices &amp; Linear Algebra",
    "creditHours":null,"creditHourLow":3,"creditHourHigh":null,
    "maximumEnrollment":60,"enrollment":0,"seatsAvailable":60,"waitCapacity":0,"waitCount":0,"waitAvailable":0,
    "openSection":true,"linkIdentifier":null,"isSectionLinked":false,"subjectCourse":"MATH2164",
    "faculty":[{"displayName":"Alan Dow","emailAddress":"adow@uncc.edu","primaryIndicator":true}],
    "meetingsFaculty":[{"meetingTime":{"beginTime":"0800","endTime":"0850","building":"FRET","buildingDescription":"Fretwell",
       "room":"126","startDate":"01/11/2027","endDate":"05/06/2027","monday":true,"tuesday":false,"wednesday":true,
       "thursday":false,"friday":true,"saturday":false,"sunday":false,"meetingTypeDescription":"Class","hoursWeek":2.5}}],
    "instructionalMethod":"TR","instructionalMethodDescription":"Face-to-Face Instruction"}
   ```
   Notes: `courseTitle` is HTML-escaped (decode `&amp;` etc.). `faculty` may be empty → "TBA". Meeting `beginTime` may be null
   (online async) → no time slots. Sections with no meetings with times are "Online/TBA" and never conflict.
5. **Plan mode**: `POST /term/search?mode=plan` body `term=202710&studyPath=&studyPathText=&startDatepicker=&endDatepicker=` → `{fwdURL:".../plan/selectPlan"}`
6. **Start a new plan**: `GET /plan/plan` (HTML; initialises an empty "Untitled Plan" in the session).
7. **Stage a section**: `POST /plan/addPlanItem` body `term=202710&courseReferenceNumber=20429&section=section`
   → `{success:true, model:{...planCourse, id:null, ...}}` or `{success:false, message:"..."}`.
8. **Save the plan**: `POST /plan/submitPlan/batch` with `Content-Type: application/json`, body
   `JSON.stringify({create:[model1, model2, ...], update:[], destroy:[]})` where each model is the `model` object
   returned by addPlanItem with `headerDescription: "<plan name>"` and `headerComment: ""` added.
   Response `{success:true, data:{planHeader:{...}}}` or `{success:false, message:[{message, type}]}`. Report messages to user.
9. After a successful save, navigate the tab to `/StudentRegistrationSsb/ssb/plan/selectPlan` so the user sees it.
10. Existing plans for a term (optional, for showing count / name collisions): GET `/plan/selectPlan` HTML contains
    `plans:\n[ ... ]` inside `window.bootstraps` — optional, skip if fiddly. Banner limits plans per term (usually ~5); surface server error message.

### SW.api interface (CORE agent implements, UI agent consumes)
```js
SW.api.getTerms(): Promise<Array<{code, description}>>
SW.api.searchCourse(term, subject, courseNumber): Promise<Section[]>  // raw Banner sections (paged until complete); does term/search?mode=search once per term (cache "current search term"), resetDataForm before each search
SW.api.normalizeSection(raw): NormSection   // see below; also exported for tests
SW.api.applyPlan(term, crns: string[], planName: string, onProgress?: (msg)=>void): Promise<{ok:boolean, messages:string[], failedCrns:string[]}>
   // steps 5→6→7(each crn, sequential)→8. If any addPlanItem fails, still save the rest but return failedCrns + messages.
```

### NormSection (produced by normalizeSection, consumed by solver + UI)
```js
{
  crn: "20429", term: "202710", subject: "MATH", courseNumber: "2164", courseKey: "MATH 2164",
  section: "001", title: "Matrices & Linear Algebra", scheduleType: "Lecture",
  credits: 3, instructors: ["Alan Dow"],          // [] if none → UI shows "TBA"
  instructorKey: "Alan Dow",                         // instructors.join(' / ') or "TBA"
  seats: 60, capacity: 60, waitCount: 0, waitAvailable: 0, open: true,
  method: "Face-to-Face Instruction", campus: "Main Campus or Dubois Campus",
  linkIdentifier: null, isLinked: false,
  meetings: [ { days: [1,3,5],               // 0=Sun..6=Sat
                start: 480, end: 530,        // minutes from midnight
                startDate: "2027-01-11", endDate: "2027-05-06",
                location: "Fretwell 126", type: "Class" } ],
  online: false   // true if no meeting has start/end
}
```
Skip meetings whose startDate === endDate (one-off exam/final). Keep meetings with no times out of `meetings`.

## Solver (SW.solver) — CORE agent

```js
SW.solver.generate(input): { schedules: Schedule[], total: number, truncated: boolean, errors: string[] }
input = {
  courses: [ { key:"MATH 2164", sections: NormSection[] } ],   // already filtered by UI to only selected sections
  breaks: [ { days:[1,3], start: 720, end: 780, label:"Lunch" } ],   // user-blocked times (minutes)
  options: { earliest: 480|null, latest: 1080|null, daysOff: [5],     // no classes starting before / ending after; no classes on these days
             allowFull: false,   // if false, drop sections with seats<=0 (UI default false, but keep a toggle)
             maxResults: 200, sort: "compact"|"fewestDays"|"latestStart"|"earliestEnd"|"mostSeats" }
}
Schedule = { sections: NormSection[] (one per course, same order as input.courses), score: number,
             stats: { days: number, totalGapMinutes: number, earliestStart: number, latestEnd: number, credits: number, minSeats: number } }
```
Rules:
- Exactly one section per course. (If a course's sections include multiple distinct `scheduleType`s AND none is "Lecture/Lab",
  treat each scheduleType as a required component: pick one section of each type. Respect `linkIdentifier` if non-null: components
  must share the same linkIdentifier prefix group. Keep this logic isolated in `buildComponents(course)`; if it gets weird, fall back
  to one-section-per-course.) → so a Schedule's `sections` can contain >1 section per course; that's fine.
- Two meetings conflict iff they share a day, times overlap (`a.start < b.end && b.start < a.end`), AND date ranges overlap.
- A section violates breaks/options if any meeting overlaps a break on a shared day, starts before earliest, ends after latest, or is on a daysOff day. Pre-filter sections by these first (cheap), then if any course has zero eligible sections return `errors:["No sections of MATH 2164 fit your constraints"]`.
- Backtracking DFS, order courses by fewest eligible sections first (but output sections in input order). Precompute a per-section bitmask
  of 5-minute slots per day (7 days × 288 slots → use arrays of BigInt or 7 Uint32-ish arrays; simplest: per day a BigInt of 288 bits) for O(1) conflict checks; date-range overlap check only when bitmasks collide and sections have different partOfTerm/date ranges.
- Enumerate up to a hard cap of 50,000 valid schedules (set truncated=true if hit), score all, sort, return top maxResults.
- Scores: compact = total gap minutes between classes per day (lower better) + 30*days; fewestDays = days*1000 + gaps; latestStart = -(earliest start avg); earliestEnd = latest end avg; mostSeats = -minSeats. Tie-break with compact.
- Must handle 7 courses × ~30 sections each in < 1s.

Tests (tests/solver.test.js): conflict detection, breaks, daysOff, earliest/latest, online sections never conflict, part-of-term non-overlap allowed,
allowFull filtering, sorting, truncation, empty-course error, normalizeSection on a real-shape raw section (use the JSON above, incl. `&amp;` decoding and null beginTime).

## UI — UI agent

Injected UI lives in a **closed-over Shadow DOM** on a host div `#sw-root` appended to `document.body` (so Banner's CSS/jQuery
don't touch it). Load `src/ui/styles.css` via `fetch(chrome.runtime.getURL('src/ui/styles.css'))` and insert as `<style>` in the shadow root.

**Launcher**: floating pill button bottom-right "🪄 Schedule Wizard" (Charlotte green, gold border). Click or toolbar action toggles the panel.

**Panel**: full-viewport overlay (fixed, z-index 2147483000, 96vw × 92vh centered, rounded, shadow) with header bar
"Niner Schedule Wizard" + close ✕. Wizard steps as tabs across the top (clickable once reachable): 

1. **Term** — dropdown from `SW.api.getTerms()`; default to the first term. 
2. **Courses** — input "e.g. MATH 2164" + Add (Enter adds; accept "math2164", "MATH-2164", comma-separated lists). On add, call
   `searchCourse`, show a loading spinner on the chip; on success chip shows `MATH 2164 · Matrices & Linear Algebra · 10 sections`;
   on 0 results show error state "No sections found for Spring 2027". Remove chip with ×. Cache results per term+course in memory.
3. **Breaks & Preferences** — list of break rows: day toggle buttons (M T W R F S U) + start/end `<input type=time>` + label + remove; "Add break" button.
   Quick presets: "Lunch 12–1 MTWRF". Preferences: no classes before [time], none after [time], days off (toggle buttons), "Include full sections" checkbox, sort dropdown.
4. **Sections & Professors** — per course an accordion: header shows course + count selected. Inside: professor list with checkboxes
   (default all checked; shows each prof's section count and a tiny "seats" summary), toggling a prof toggles all their sections; expand to see each
   section row (checkbox, section #, CRN, days/times, location, seats/cap, method) for fine control. "Select all / none" buttons.
   Full sections shown greyed with "FULL" badge.
5. **Schedules** — "Generate" runs solver (in a setTimeout so UI paints a spinner). Left column: scrollable list of result cards
   (#n, days used, earliest–latest, gap hours, credits, min seats; mini sparkline of week is a nice-to-have). Right: selected schedule as a
   **weekly calendar grid** (Mon–Fri, add Sat/Sun columns only if used; rows 7am–10pm auto-trimmed to the used range ±1h, 30-min grid lines),
   colored blocks per course (palette of distinct muted colors that work on white; text: course key, section, time, location, prof);
   break blocks drawn as hatched grey; online/TBA sections listed below the grid. Below: table of the selected schedule (Course, Sec, CRN, Instructor, Times, Location, Seats).
   Buttons: "Copy CRNs" (clipboard), prev/next, and **"Apply as Plan"** (gold primary).
6. **Apply as Plan** modal — plan name input (default "Wizard – Spring 2027 #3", max 30 chars), lists the CRNs, Confirm → calls `SW.api.applyPlan`
   with live progress lines; on success show ✓ and a button "View my plans" (navigates to `/StudentRegistrationSsb/ssb/plan/selectPlan`); on failure show messages.

State persists per term in `chrome.storage.local` under `sw_state_v1`: `{term, courses:[keys], breaks, options, deselected: {crn:true}}` (store
DE-selected CRNs so newly-seen sections default to selected). Restore on open; re-fetch course sections on restore.

Empty/error states everywhere; never throw uncaught. Session-expired (fetch returns HTML login page / 401 / redirect to login) → banner "Your Banner session expired — refresh the page and log in."

### Theme — UNC Charlotte
- Charlotte Green `#005035` (primary, header, launcher), dark green `#003825` (hover), Niner Gold `#A49665` (accent/primary CTA), light gold `#E8E2CF`,
  Quartz/off-white `#F7F6F2` background, text `#1F2A24`, muted `#5B6B62`, borders `#D9D6CC`, danger `#B3261E`, success `#2E7D32`.
- Font: system stack (`-apple-system, Segoe UI, Roboto, sans-serif`); headings bold; 8px radius; subtle shadows.
- Header: green bar with gold bottom border (4px) and a small pickaxe/"49" mark (text/emoji ok, no trademarked logo image).
- Buttons: primary gold w/ dark green text; secondary outlined green.
- Course block colors: green/gold-family-friendly distinct palette e.g. `#2E7D5B #A49665 #3B6EA5 #8E5572 #C27C2C #4F7F7F #6B5B95 #7A8B2E` at ~85% with white text.
```
