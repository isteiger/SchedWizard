<div align="center">

# 🪄 Niner Schedule Wizard

**The UNC Charlotte schedule wizard is back.**

Pick your classes, block out the times you don't want, and get every conflict-free schedule in a click.
Then save the one you like straight into Banner as a plan.

![Chrome](https://img.shields.io/badge/Chrome-Extension-005035?logo=googlechrome&logoColor=white)
![Manifest V3](https://img.shields.io/badge/Manifest-V3-A49665)
![No build step](https://img.shields.io/badge/build-none-005035)
![Vanilla JS](https://img.shields.io/badge/vanilla-JS-A49665?logo=javascript&logoColor=white)

[Features](#-features) · [Install](#-install) · [How to use](#-how-to-use) · [How it works](#-how-it-works) · [Development](#-development)

</div>

---

## Why

UNC Charlotte used to have a schedule wizard in registration. It was removed, which left students building
schedules by hand in Banner's search screens. Niner Schedule Wizard brings it back as a Chrome extension
that runs right on top of the registration portal (`selfservice.uncc.edu`). There's nothing to sign into and
no separate site. It uses the Banner session you're already logged into.

## ✨ Features

### 📚 Courses in seconds
- Type courses the way you'd write them: `MATH 2164`, `math2164`, `MATH-2164`, or a comma-separated list.
- **Lock to an exact section** with `MATH 2164-003`, `MATH 2164 003`, `MATH2164.003`, or a 5-digit CRN.
- **Labs are added for you.** Add `ESCI 1101` and `ESCI 1101L` is pulled in automatically. Remove it with
  one click if you're taking the lab another semester. Adding only a lab suggests its lecture.

### ⏰ Breaks & preferences
- Block out any time on any days: lunch, work, commute (there's a one-click *Lunch 12–1* preset).
- **No classes before / after** a time, and **days off** with no classes at all.
- **Class format:** prefer online, prefer in-person, online only, or in-person only.
- **Minimum professor rating** from RateMyProfessors, with an option to keep unrated or TBA professors.
- Include or skip full sections.

### 👩‍🏫 Sections & professors
- Every course is grouped by professor, and **all professors are selected by default**. Uncheck the ones you don't want.
- **RateMyProfessors built in.** Every professor gets a color-coded rating pill (green, amber or red).
  Hover it for difficulty, would-take-again %, number of ratings, department, and last review date, plus a link to their RMP page.
- Professors are sorted by rating. Seats open and capacity are shown per professor and per section.
- **"Only this prof"** and **"Only this"** section buttons, plus *Select all / none / Skip full*.
- Each section is tagged **Online**, **Hybrid**, or **In person**.

### 🗓️ Schedules
- Generates **every conflict-free combination**. It accounts for meeting days, times, and part-of-term
  dates, so two half-semester classes can share a time slot.
- Sort by **most compact** (fewest gaps), **fewest days on campus**, **latest start**, **earliest end**, **most open seats**,
  or **best-rated professors**.
- Each result card shows days, time span, gap hours, credits, minimum seats, number of online classes, and average professor rating,
  plus a mini week preview.
- A full **weekly calendar view** with color-coded classes, your breaks drawn as hatched blocks, and online/TBA classes listed below.
- A details table with section, CRN, instructor and rating, times, location, and seats.
- **Copy CRNs** to the clipboard in one click.

### ✅ Apply as a Banner plan
- **Apply as Plan** saves the schedule into Banner's *Plan Ahead* with a name you choose, showing live progress.
- **Your existing plans** for the term appear at the top of the wizard (e.g. *2/5 plans*). Click one to view it on the
  calendar, or **Load into wizard** to tweak it.
- It warns you when you're at Banner's 5-plan limit.

### 💾 Remembers everything
Courses, breaks, preferences, and section picks are saved **per term** in your browser, so you can pick up where you left off.

## 🖥️ The UI

The wizard opens as a full-screen panel over the registration portal. Click the green **✨ Schedule Wizard** button
in the bottom-right corner, or the extension icon in the Chrome toolbar. It's styled in Charlotte Green and Niner Gold.

| Step | What you do |
| --- | --- |
| **1 · Term** | Pick a term that's open for planning. |
| **2 · Courses** | Add courses (and exact sections or CRNs). Each chip shows the course title and section count. |
| **3 · Breaks & Preferences** | Add breaks, time limits, days off, class format, minimum rating, and sort order. |
| **4 · Sections & Professors** | An accordion for each course, with professors, rating pills, and expandable section rows. |
| **5 · Schedules** | A result list on the left and the week calendar plus details table on the right. Apply as Plan from here. |

A **"Your plans"** strip sits under the step tabs on every step. The UI lives in an isolated Shadow DOM, so it never
interferes with Banner's own page.

## 📦 Install

> Not on the Chrome Web Store yet, so install it as an unpacked extension.

1. Download this repo (**Code → Download ZIP** and unzip it, or `git clone` it).
2. Open **`chrome://extensions`** in Chrome.
3. Turn on **Developer mode** (top right).
4. Click **Load unpacked** and select the project folder (the one containing `manifest.json`).
5. Log in to the [UNC Charlotte registration portal](https://selfservice.uncc.edu/StudentRegistrationSsb/ssb/registration)
   and refresh the page. The **✨ Schedule Wizard** button appears in the bottom-right corner.

To update later, pull or download the new version and hit the ↻ reload button on the extension in `chrome://extensions`.

## 🚀 How to use

1. Open the wizard on the registration page.
2. Choose your **term**.
3. Add your **courses**, e.g. `MATH 2164, ITSC 3688, ESCI 1101`.
4. Add any **breaks** and **preferences**.
5. Uncheck **professors or sections** you want to avoid.
6. Click **Generate schedules**, then flip through the results.
7. Click **Apply as Plan**, name it, and confirm. It shows up under *Plan Ahead* in Banner, ready for registration day.

## 🔧 How it works

Everything runs locally in your browser. There's no server and no account, and the extension does no tracking of any kind.

- **Banner data:** the extension makes the same requests the registration site makes, inside your existing logged-in
  session (Banner 9 Student Registration SSB: term list, class search, and the Plan Ahead endpoints). Requests run one at a time,
  because Banner keeps your selected term in the session.
- **Schedule solver:** a backtracking search with per-day bitmasks (5-minute slots) for fast conflict checks. It enumerates up
  to 200,000 schedules and keeps the best results for your chosen sort.
- **RateMyProfessors:** the background service worker looks up professors on RMP's public GraphQL endpoint (UNC Charlotte only),
  with fuzzy name matching and a few nickname aliases. Results are cached for 3 days.

### Permissions
| Permission | Why |
| --- | --- |
| `storage` | Save your per-term wizard state and the RMP cache. |
| `selfservice.uncc.edu` | Run on the registration portal and talk to Banner as you. |
| `ratemyprofessors.com` | Fetch professor ratings. |

## 🛠️ Development

No build step and no dependencies: plain JavaScript loaded straight from the folder.

```
manifest.json        MV3 manifest
background.js        toolbar action + RateMyProfessors lookup/cache
src/api.js           Banner 9 client (terms, class search, plans, apply plan)
src/solver.js        pure schedule generator + scoring (node-testable)
src/content.js       injects the Shadow DOM host
src/ui/app.js        the whole wizard UI
src/ui/styles.css    Charlotte Green & Niner Gold theme
tests/               node tests (no deps)
tools/make-icons.js  generates the PNG icons
```

Run the tests with Node 18+:

```bash
node tests/solver.test.js && node tests/plans.test.js && node tests/rmp.test.js
```

After editing, reload the extension in `chrome://extensions` and refresh the Banner tab.

## ⚠️ Disclaimer

This is an unofficial student project. It is not affiliated with or endorsed by UNC Charlotte, Ellucian, or RateMyProfessors.
Always double-check your schedule in Banner before registering. Seat counts and ratings change constantly.

---

<div align="center">

Created by **Ian Steiger** · ☕ [ko-fi.com/isteiger](https://ko-fi.com/isteiger)

Go Niners ⛏️

</div>
