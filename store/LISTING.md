# Chrome Web Store submission kit

Everything to paste into the [Chrome Web Store Developer Dashboard](https://chrome.google.com/webstore/devconsole).
The upload file is `dist/niner-schedule-wizard-v<version>.zip` (run `node tools/build.js`), also attached to each
[GitHub release](https://github.com/isteiger/SchedWizard/releases).

---

## Package tab
Upload: **`dist/niner-schedule-wizard-v1.0.0.zip`**

## Store listing tab

**Name** (from manifest): `Niner Schedule Wizard`

**Summary** (from manifest, 132 max):
> Generate conflict-free class schedules for UNC Charlotte's Banner 9 registration and save them as a plan.

**Category:** Education (or Productivity → Tools)

**Language:** English (United States)

**Description:**
```
The UNC Charlotte schedule wizard is back.

Niner Schedule Wizard runs right on top of UNC Charlotte's registration portal. Type in the classes you need, block out the times you don't want, and it builds every conflict-free schedule for you. Then save the one you like straight into Banner as a Plan Ahead plan, ready for registration day.

COURSES IN SECONDS
• Type courses the way you write them: MATH 2164, math2164, or a comma-separated list
• Lock to an exact section (MATH 2164-003) or a CRN
• Labs are added automatically: add ESCI 1101 and ESCI 1101L comes with it

BREAKS & PREFERENCES
• Block lunch, work, or commute times on any days
• No classes before or after a time, plus days off
• Prefer online or in-person, or only online / only in-person
• Minimum professor rating

PICK YOUR PROFESSORS
• Every professor is selected by default; uncheck the ones you don't want
• RateMyProfessors ratings next to every professor: overall rating, difficulty, would-take-again %, and number of ratings
• Pick one exact section or professor in a single click

EVERY SCHEDULE, RANKED
• Generates every combination with no time conflicts
• Sort by fewest gaps, fewest days on campus, latest start, earliest end, most open seats, or best-rated professors
• Weekly calendar view, details table, and Copy CRNs

SAVE IT TO BANNER
• Apply as Plan saves the schedule into Banner's Plan Ahead
• See your existing plans right in the wizard, and load one back in to tweak it

PRIVATE BY DESIGN
No accounts, no servers, no tracking. The extension works inside your existing Banner login, and your inputs are saved only in your browser.

HOW TO USE
1. Log in to the UNC Charlotte registration portal (selfservice.uncc.edu)
2. Click the green "Schedule Wizard" button in the bottom-right corner, or the extension icon
3. Pick a term, add courses, set preferences, then generate

Open source (MIT): https://github.com/isteiger/SchedWizard
Created by Ian Steiger. Support: ko-fi.com/isteiger

Unofficial student project. Not affiliated with or endorsed by UNC Charlotte, Ellucian, or RateMyProfessors. Always double-check your schedule in Banner before registering.
```

**Graphic assets** (all in `store/`):
| Asset | File | Required size |
| --- | --- | --- |
| Store icon | `icons/icon128.png` | 128×128 |
| Screenshots (1–5) | `store/screenshot-1.png` … | 1280×800 |
| Small promo tile | `store/promo-small-440x280.png` | 440×280 |
| Marquee promo tile (optional) | `store/promo-marquee-1400x560.png` | 1400×560 |

**Official URL:** none (or your own site later)
**Homepage URL:** `https://github.com/isteiger/SchedWizard`
**Support URL:** `https://github.com/isteiger/SchedWizard/issues`

## Privacy practices tab

**Single purpose description:**
> Helps UNC Charlotte students build conflict-free class schedules on the university's Banner registration portal and save them as registration plans.

**Permission justifications:**

| Permission | Justification |
| --- | --- |
| `storage` | Saves the student's wizard inputs (courses, breaks, preferences, section choices) per term, and caches RateMyProfessors ratings locally so they aren't re-fetched on every visit. |
| Host: `https://selfservice.uncc.edu/*` | The extension's UI runs only on UNC Charlotte's Banner registration portal. It reads course sections, terms, and the student's existing plans, and saves a plan when the student clicks "Apply as Plan", all through the student's own logged-in session. |
| Host: `https://www.ratemyprofessors.com/*` | Looks up public professor ratings by instructor name (UNC Charlotte only) to show them beside each professor. |

**Remote code:** No, I am not using remote code. (All JS ships in the package; it only fetches JSON and HTML data.)

**Data usage:** check these boxes:
- ☑ **Website content** (course listings and plans read from the registration portal)
- ☑ **User activity** (only if the reviewer considers the student's course and plan selections to be user activity; selections are sent to Banner only when the student saves a plan). Leave unchecked if you read it as clicks/browsing history; the extension doesn't record that.
- Leave everything else unchecked (no personally identifiable info, health, financial, authentication, personal communications, location, or web history).

Then certify all three:
- ☑ I do not sell or transfer user data to third parties, outside of the approved use cases
- ☑ I do not use or transfer user data for purposes that are unrelated to my item's single purpose
- ☑ I do not use or transfer user data to determine creditworthiness or for lending purposes

**Privacy policy URL:**
`https://github.com/isteiger/SchedWizard/blob/master/PRIVACY.md` (the repo must be **public** for this link to work)

## Distribution tab
- Visibility: **Public** (or **Unlisted** for a soft launch: anyone with the link can install it)
- Regions: All regions (or just United States)
- Pricing: Free

## Before you submit
- [ ] Make the GitHub repo public (the privacy policy link and the release depend on it)
- [ ] Pay the one-time $5 developer registration fee and verify your contact email
- [ ] Bump `version` in `manifest.json` for every new upload (the store rejects duplicate versions)
- [ ] Expect review to take a few days. Host permissions on a third-party site usually add a little review time.
