# Uptime Monitor

A lightweight full-stack app that periodically pings a list of URLs and shows whether each one is up or down, along with response time and a plain-English explanation of why.

## Stack

- **Backend:** FastAPI + APScheduler (in-process background job, no separate worker/queue needed at this scale) + SQLite (raw `sqlite3`, no ORM)
- **Frontend:** Plain HTML/CSS/JS, no build step — served as static files via nginx
- **Orchestration:** Docker Compose (2 services: `backend`, `frontend`)

## 1-Line Setup

```bash
docker compose up --build
```

Then open:
- Frontend dashboard: **http://localhost:3000**
- Backend API docs (Swagger): **http://localhost:8000/docs**

URLs are checked immediately on registration, and then re-checked every **30 seconds** in the background. The dashboard polls the backend every **5 seconds**, so status updates show up quickly without needing a page refresh.

## Testing Steps (verifying up/down detection)

1. Run `docker compose up --build` and open http://localhost:3000
2. **Add a working URL** — name: `Example`, url: `https://example.com`. It should show a green pulsing dot / "Up" within a couple seconds, with a status code (200) and response time.
3. **Add a broken URL** — name: `Broken`, url: `https://this-domain-does-not-exist-abc123.com` (or any unreachable/invalid host). It should show a red dot / "Down", with no status code (connection failed, not an HTTP error).
4. You can also test a URL that *responds* but with an error, e.g. `https://httpstat.us/500` — this will show "Down" with status code 500, demonstrating that the check evaluates the actual status code, not just reachability.
5. Click any card to expand it — you'll see a "why it's up/down" explanation, a sparkline of recent checks, and a short history table.
6. Wait 30 seconds and confirm the numbers update — this shows the background scheduler is actively re-checking, not just checking once on add.
7. To sanity-check the API directly instead of the UI:
```bash
   curl -X POST http://localhost:8000/api/urls \
     -H "Content-Type: application/json" \
     -d '{"name":"Example","url":"https://example.com"}'

   curl http://localhost:8000/api/urls
```

## API Reference

| Method | Endpoint | Description |
|---|---|---|
| `POST` | `/api/urls` | Register a new URL (`{name, url}`) — runs an immediate check |
| `GET` | `/api/urls` | List all URLs with their latest check, uptime %, and recent history |
| `DELETE` | `/api/urls/{id}` | Remove a monitored URL |
| `GET` | `/api/urls/{id}/checks` | Check history for a URL (last 50 by default) |
| `GET` | `/api/health` | Health check |

## Design Notes

- **Why no ORM:** at this scale (a few dozen URLs), a thin `sqlite3` wrapper is easier to read and debug than adding SQLAlchemy/SQLModel as a dependency. Two tables (`urls`, `checks`), a handful of queries.
- **Why in-process scheduler instead of Celery/cron:** APScheduler running inside the FastAPI process avoids standing up Redis + a worker container for a job that runs a background HTTP request every 30s. If this needed to scale to thousands of URLs or multiple backend replicas, this would be the first thing to swap out for a proper job queue.
- **Down detection covers two failure modes:** (1) the request fails outright (DNS failure, connection refused, timeout) → `status_code` is `null`, `is_up = false`; (2) the request succeeds but returns an HTTP error (4xx/5xx) → `status_code` is populated, `is_up = false`. Both render as "Down" on the dashboard, but the status code and `reason` field tell you which kind of failure it was.
- **Every check stores a human-readable `reason`** (e.g. "Connection timed out", "Server responded with HTTP 403 (Forbidden)"), shown in an expandable panel per URL on the dashboard along with a sparkline of the last 20 checks and a short history table.
- **Outbound checks send a real browser `User-Agent`.** Some sites (e.g. LinkedIn) block requests that look like bots and return non-standard status codes (LinkedIn uses `999`) instead of serving the page. Sending a normal browser User-Agent avoids false "down" readings caused by basic bot-blocking — though sites with more advanced protection may still block automated checks regardless (see Limitations below).
- **Timestamps are stored in UTC, displayed in local time.** SQLite's `datetime('now')` is UTC by default; the frontend converts to the browser's local timezone before rendering, so times in the dashboard match your wall clock.
- **Frontend visual design:** light theme with a live "signal" concept — a pulsing ripple animation on healthy status dots, a per-URL uptime ring, and an expandable panel per card with a sparkline and history table, built to feel like an actual monitoring product rather than a bare data dump.

## Limitations & What I'd Improve Next

- **Sites with heavy bot-protection or JS-rendered content aren't fully reliable to check.** The current check is a single raw HTTP GET via `httpx` — no JavaScript execution, no browser fingerprinting, no session/cookie state. A realistic `User-Agent` header resolves the simplest cases, but sites with layered protection can still return a blocking response (e.g. LinkedIn's `999`) even with a proper header, because the request still doesn't behave like a real browser at the network/TLS level.
- **Next step for this:** a **Playwright-based check path**, opt-in per URL, that launches a real headless browser, lets the page actually render and run its JS, and evaluates the rendered result instead of the raw HTTP response. This would materially improve accuracy for single-page apps and bot-protected sites. It's deliberately not the default for every check — spinning up a browser context per check is far heavier than a single HTTP request, so at this scale it makes more sense as an explicit "render mode" toggle on individual URLs rather than the default check path for all of them.
- **Single-writer SQLite** is fine at this scale but wouldn't survive multiple backend replicas — the deployment sketch below calls this out as the first thing to swap for Postgres if this needed to scale.
- **No auth on the API** — acceptable for a local MVP demo, but the first thing to add before this touched a real network.

## Deployment Sketch (AWS, hypothetical)

For an MVP this size, I'd avoid Kubernetes entirely and go with a minimal container-hosting setup:

- **Backend + Frontend:** two small services on **AWS ECS Fargate** (or Fly.io / Render for even less ops overhead), each built from the same Dockerfiles in this repo. No servers to patch.
- **Database:** swap SQLite for a small **RDS Postgres** instance (or keep SQLite on an EFS-backed volume if we want to stay minimal-cost) — SQLite's single-writer model is fine for the MVP but wouldn't survive multiple backend replicas.
- **Networking:** an **Application Load Balancer** in front of both services, frontend on `/`, backend on `/api/*` — this also lets us drop the CORS wildcard and lock it down to the ALB's own domain.
- **Static frontend alternative:** since the frontend has no build step and no server-side logic, it could just as easily be pushed to **S3 + CloudFront** instead of running in a container, which is cheaper and simpler than Fargate for static assets.

Rough Terraform sketch (illustrative, not complete):

```hcl
resource "aws_ecs_service" "backend" {
  name            = "uptime-backend"
  cluster         = aws_ecs_cluster.this.id
  task_definition = aws_ecs_task_definition.backend.arn
  desired_count   = 1
  launch_type     = "FARGATE"

  network_configuration {
    subnets          = var.private_subnet_ids
    security_groups  = [aws_security_group.backend.id]
  }
}

resource "aws_s3_bucket" "frontend" {
  bucket = "uptime-monitor-frontend"
}

resource "aws_cloudfront_distribution" "frontend_cdn" {
  origin {
    domain_name = aws_s3_bucket.frontend.bucket_regional_domain_name
    origin_id   = "frontend-s3"
  }
  enabled             = true
  default_root_object = "index.html"
  # ... default_cache_behavior, viewer_certificate, etc.
}
```

Not grading production hardening here per the brief, so this is intentionally a sketch — no WAF, no autoscaling policy, no multi-AZ RDS failover configured above.

## AI Collaboration

See [`AI_LOG.md`](./AI_LOG.md) for the full breakdown of how this was built with AI assistance, including prompts and course-corrections.
