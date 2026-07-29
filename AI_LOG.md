# AI Collaboration Log

## AI Tech Stack

- **Primary tool:** Claude (Claude.ai, Sonnet model) — used as a build partner: I made the architecture and product calls, Claude handled implementation, and I tested/debugged everything on my own machine via Docker.
- **Also evaluated:** Cursor, for a parallel attempt at the same problem. I dropped it partway through in favor of continuing with the approach I'd already validated with Claude — more on that below.
- **Kicking off the build, from the assignment brief:**
- "we gotta task to do buddy, prepare yourself. you are a great AI coder and your reasoning and catching a bug power is high"

- **Explaining my approach and plan**
- "Here is my plan and execution , thats how i would like to built it, compare it with your plan and let me know what could be improved"

- "Why dont we use Playwright if my linkedin is blocking the request?"

- "ok got it"

- "No i dont like streamlit, i choose to go for html/js/css"

- "no we wont deploy it on AWS right now, that i will do if needed." 

## My Approach

I treated this the way I'd treat directing any engineering resource: define the architecture and constraints up front, make the calls on tradeoffs, and use AI to move fast on implementation while I stayed responsible for testing, debugging, and product decisions.

Given the brief's emphasis on pragmatism over over-engineering, I decided early on to keep the stack deliberately thin:
- **FastAPI + SQLite (no ORM)** for the backend — a two-table schema (`urls`, `checks`) doesn't need SQLAlchemy overhead.
- **In-process APScheduler job instead of Celery/Redis** — a background job pinging a few dozen URLs every 30s doesn't justify a separate worker/queue.
- **Plain HTML/CSS/JS, no build step** for the frontend — keeps the Docker setup to two lightweight containers with no bundler in the loop.

I asked Claude to scaffold this structure and iterated with it from there, reviewing and testing each piece rather than accepting output blindly.

## The Prompts That Shipped It

I started by walking the assistant through the assignment brief and requesting a build plan before any code was written, so I could validate the approach against the deadline and scope constraints first. From there I specified the stack decisions above and had it scaffold the initial structure: `database.py`, `pinger.py`, `main.py` on the backend, and `index.html` / `style.css` / `app.js` on the frontend, plus both Dockerfiles and `docker-compose.yml`.

I ran the result locally, tested it against real and broken URLs, and drove each subsequent iteration based on what I found — documented below.

## Course Corrections

**1. LinkedIn returning HTTP 999 instead of a real status.** After deploying locally, I registered my LinkedIn profile as a monitored URL and it came back "Down" with a non-standard status code. Root cause: LinkedIn's bot-detection was rejecting the request because it had no browser-like `User-Agent`. I directed a fix to the request headers, and used the finding to push for a better UX overall — a monitoring dashboard that just says "down" with no explanation isn't good enough, so I asked for every check to surface a clear reason for its result, not just a status code.

This led to a proper `reason` field on every check (human-readable explanations per failure type — timeout, DNS failure, HTTP error, etc.), uptime percentage tracking, and an expandable per-URL panel with history.

**2. Database migration gap.** Adding the new `reason` column to a table that already existed in a running Docker volume would have broken on restart, since `CREATE TABLE IF NOT EXISTS` doesn't alter existing schemas. I made sure this was handled with a proper migration check (`PRAGMA table_info` + conditional `ALTER TABLE`) rather than requiring a full data wipe (`docker compose down -v`) every time the schema changed — important since I wanted to keep accumulating real check history for the demo, not reset it on every iteration.

**3. Timestamps off by roughly five hours.** During testing I noticed check timestamps didn't match my local clock. SQLite stores `datetime('now')` in UTC by default, and the frontend was rendering that raw string without conversion. Since the gap matched IST (UTC+5:30) exactly, I had this fixed with a local-time conversion helper on the frontend rather than touching how data is stored — this kept the backend timezone-agnostic (a good property for any future multi-region deployment) and corrected the display layer instead.

**4. Frontend was functional but not something I'd actually ship.** The first working version was a plain dark-themed list — no visual hierarchy, no personality, nothing that read as an actual product. I directed a full visual redesign: a light theme with a "live signal" concept — a pulsing ripple animation on healthy status dots (reinforcing that URLs are actively being watched, not just listed), a per-URL uptime ring, and monospace type for data fields to visually distinguish live telemetry from UI chrome.

**5. Cursor detour.** I tried a second implementation in Cursor in parallel to compare tooling, using the same local setup. It didn't come together, so I abandoned it and continued with the version I'd already built and validated — a call made based on which path was actually working, not a default choice.

## Limitations & What I'd Improve Next

- **Sites with heavy bot-protection or JS-rendered content aren't fully reliable to check.** The current pinger sends a single raw HTTP GET with `httpx` — no JavaScript execution, no browser fingerprinting, no cookies/session state. Adding a realistic `User-Agent` header fixed the simplest cases, but sites with layered protection (LinkedIn included) can still return a blocking response like `999` even with a proper header, because the request still doesn't behave like a real browser at the network/TLS level.
- **The fix for this would be a Playwright-based check path** for URLs that need it: launch a real (headless) browser, let it actually render the page and execute JS, and check the rendered result instead of the raw HTTP response. This would make checks dramatically more accurate for SPAs and bot-protected sites, at the cost of real tradeoffs I'd want to make deliberately rather than apply everywhere: each check becomes much heavier (spinning up a browser context vs. a single HTTP request), so at MVP scale I'd likely make it opt-in per URL (a "render mode" toggle) rather than the default for all checks, to keep the common case fast and cheap.
- **Single-writer SQLite** works fine at this scale but wouldn't survive multiple backend replicas — flagged in the deployment sketch as the first thing to swap for Postgres if this needed to scale.
- **No auth on the API** — fine for a local MVP demo, but the first thing I'd add before this touched a real network.

 needed to scale.
- **No auth on the API** — fine for a local MVP demo, but the first thing I'd add before this touched a real network.
