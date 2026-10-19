# Privacy Policy — Niner Schedule Wizard

_Last updated: October 19, 2026_

Niner Schedule Wizard is a Chrome extension that helps UNC Charlotte students build class schedules on the
university's Banner registration portal. It was built by Ian Steiger, an independent student developer.

## The short version
- The extension has **no servers** and **no accounts**, and it does **no analytics or tracking**.
- Nothing about you is sent to the developer.
- Your data stays in your browser.

## What the extension accesses
| Data | Where it goes | Why |
| --- | --- | --- |
| Course search results, terms, and your existing registration plans from `selfservice.uncc.edu` | Read in your browser, using your existing logged-in Banner session | To build schedules and show your current plans |
| The plan you choose to save (course CRNs and a plan name) | Sent to `selfservice.uncc.edu` (UNC Charlotte's own Banner system), **only when you click "Apply as Plan"** | To create the plan in Banner for you |
| Instructor names from course listings | Sent to `ratemyprofessors.com`'s public search | To show professor ratings |
| Your wizard inputs (courses, breaks, preferences, section choices) and cached professor ratings | Stored locally with `chrome.storage.local` | So the wizard remembers your work per term |

The extension never reads or stores your password, student ID, grades, or any other personal records. It does not
access any website other than the two listed above.

## Data sharing and sale
No user data is sold, shared with third parties, or used for advertising, credit, or any purpose unrelated to the
extension's single purpose of schedule planning. The only network requests go to UNC Charlotte's Banner (your own session)
and RateMyProfessors (professor names only).

## Removing your data
Uninstalling the extension deletes everything it stored locally. You can also clear it at any time by removing the extension
or clearing site and extension data in Chrome.

## Contact
Questions: open an issue at https://github.com/isteiger/SchedWizard/issues

_Not affiliated with or endorsed by UNC Charlotte, Ellucian, or RateMyProfessors._
