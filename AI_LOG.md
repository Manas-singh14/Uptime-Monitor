# AI Collaboration Log

## AI Tech Stack

- **Primary tool:** Claude (Claude.ai, Sonnet model) — used as a build partner: I made the architecture and product calls, Claude handled implementation, and I tested/debugged everything on my own machine via Docker.
- **Also evaluated:** Cursor, for a parallel attempt at the same problem. I dropped it partway through in favor of continuing with the approach I'd already validated with Claude — more on that below.

## My Approach

I treated this the way I'd treat directing any engineering resource: define the architecture and constraints up front, make the calls on tradeoffs, and use AI to move fast on implementation while I stayed responsible for testing, debugging, and product decisions.

Given the brief's emphasis on pragmatism over over-engineering, I decided early on to keep the stack deliberately thin:
- **FastAPI + SQLite (no ORM)** for the backend — a two-table schema (`urls`, `checks`) doesn't need SQLAlchemy overhead.
- **In-process APScheduler job instead of Celery/Redis** — a background job pinging a few dozen URLs every 30s doesn't justify a separate worker/queue.
- **Plain HTML/CSS/JS, no build step** for the frontend — keeps the Docker setup to two lightweight containers with no bundler in the loop.

I asked Claude to scaffold this structure and iterated with it from there, reviewing and testing each piece rather than accepting output blindly.

## The Prompts That Shipped It

Starting point — I fed in the assignment brief and asked for a plan before any code got written, so I could sanity-check the approach against the deadline first:

> "explain this to me and create a plan. i just want to get selected in this company. we have to make the best project till now"

Once I'd settled on the stack (FastAPI/SQLite/plain JS), Claude scaffolded `database.py`, `pinger.py`, `main.py` on the backend and `index.html`/`style.css`/`app.js` on the frontend, plus both Dockerfiles and `docker-compose.yml`. I ran it locally, hit issues, and drove the fixes from there — documented below.

## Course Corrections

**1. LinkedIn returning HTTP 999 instead of a real status.** After deploying locally, I registered my LinkedIn profile as a monitored URL and it came back "Down" with a non-standard status code:

> "i entered my linkedin url and its showing down but i uploaded by class link which is going on now it is showing up?"

Root cause: LinkedIn's bot-detection was rejecting the request because it had no browser-like `User-Agent`. I decided to fix the request headers rather than leave it, and also used the discovery to push for a better UX — the dashboard was showing "down" with zero explanation, which isn't good enough for a real monitoring tool:

> "okay add the fix and also create a better and more interactive frontend, now frontend is too simple. also add a section in frontend where it will explain the reason why up and down is happening"

This led to a proper `reason` field on every check (human-readable explanations per failure type — timeout, DNS failure, HTTP error, etc.), uptime percentage tracking, and an expandable per-URL panel with history.

**2. Database migration gap.** Adding the new `reason` column to a table that already existed in a running Docker volume would have broken on restart, since `CREATE TABLE IF NOT EXISTS` doesn't alter existing schemas. I made sure this was handled with a proper migration check (`PRAGMA table_info` + conditional `ALTER TABLE`) rather than requiring a full data wipe (`docker compose down -v`) every time the schema changed — important since I wanted to keep accumulating real check history for the demo, not reset it on every iteration.

**3. Timestamps off by ~5 hours.** Noticed check timestamps didn't match my local clock:

> "there is a bug, its not showing current time, right now its 10.50 am but frontend is showing around 5-6"

SQLite stores `datetime('now')` in UTC by default, and the frontend was rendering that raw string. Since the gap matched IST (UTC+5:30) exactly, the fix was a local-time conversion helper on the frontend rather than touching how data is stored — kept the backend timezone-agnostic (a good property for any future multi-region deployment) and fixed the display layer instead.

**4. Frontend was functional but not something I'd actually ship.** The first pass worked but looked like a bare data table — dark theme, no visual hierarchy, no personality. I wanted something that read as an actual monitoring product:

> "also make more interesting and interactive frontend, dont keep it dark theme, create it with some little animation or maybe more beautiful, right now its too simple"

Redesigned around a light theme with a "live signal" concept — a pulsing ripple animation on healthy status dots (visually reinforcing "this is actively being watched, not a static list"), a per-URL uptime ring, and monospace type for data fields to distinguish live telemetry from UI chrome.

**5. Cursor detour.** I tried a second implementation in Cursor in parallel to compare tooling, using the same `localhost:3000` setup. It didn't come together locally, so I abandoned it and continued with the version I'd already built and tested — a call I made based on which path was actually working, not a default choice.

## Limitations & What I'd Improve Next

- **Sites with heavy bot-protection or JS-rendered content aren't fully reliable to check.** The current pinger sends a single raw HTTP GET with `httpx` — no JavaScript execution, no browser fingerprinting, no cookies/session state. Adding a realistic `User-Agent` header fixed the simplest cases, but sites with layered protection (LinkedIn included) can still return a blocking response like `999` even with a proper header, because the request still doesn't behave like a real browser at the network/TLS level.
- **The fix for this would be a Playwright-based check path** for URLs that need it: launch a real (headless) browser, let it actually render the page and execute JS, and check the rendered result instead of the raw HTTP response. This would make checks dramatically more accurate for SPAs and bot-protected sites, at the cost of real tradeoffs I'd want to make deliberately rather than apply everywhere: each check becomes much heavier (spinning up a browser context vs. a single HTTP request), so at MVP scale I'd likely make it opt-in per URL (a "render mode" toggle) rather than the default for all checks, to keep the common case fast and cheap.
- **Single-writer SQLite** works fine at this scale but wouldn't survive multiple backend replicas — flagged in the deployment sketch as the first thing to swap for Postgres if this needed to scale.
- **No auth on the API** — fine for a local MVP demo, but the first thing I'd add before this touched a real network.