from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from apscheduler.schedulers.background import BackgroundScheduler
from pydantic import BaseModel, field_validator

from .database import init_db, get_conn
from .pinger import check_all_urls, check_url

CHECK_INTERVAL_SECONDS = 30

app = FastAPI(title="Uptime Monitor API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


class URLCreate(BaseModel):
    name: str
    url: str

    @field_validator("url")
    @classmethod
    def url_must_have_scheme(cls, v: str) -> str:
        if not (v.startswith("http://") or v.startswith("https://")):
            raise ValueError("url must start with http:// or https://")
        return v


@app.on_event("startup")
def startup():
    init_db()
    scheduler = BackgroundScheduler()
    scheduler.add_job(check_all_urls, "interval", seconds=CHECK_INTERVAL_SECONDS, id="ping_all")
    scheduler.start()
    # run one check immediately on boot so the dashboard isn't empty
    check_all_urls()


RECENT_CHECKS_FOR_HISTORY = 20


@app.get("/api/urls")
def list_urls():
    with get_conn() as conn:
        urls = conn.execute("SELECT * FROM urls ORDER BY created_at").fetchall()
        result = []
        for u in urls:
            latest = conn.execute(
                "SELECT * FROM checks WHERE url_id = ? ORDER BY checked_at DESC LIMIT 1",
                (u["id"],),
            ).fetchone()

            recent = conn.execute(
                "SELECT is_up, status_code, response_time_ms, checked_at FROM checks "
                "WHERE url_id = ? ORDER BY checked_at DESC LIMIT ?",
                (u["id"], RECENT_CHECKS_FOR_HISTORY),
            ).fetchall()

            uptime_pct = None
            if recent:
                up_count = sum(r["is_up"] for r in recent)
                uptime_pct = round((up_count / len(recent)) * 100, 1)

            result.append({
                "id": u["id"],
                "name": u["name"],
                "url": u["url"],
                "latest_check": dict(latest) if latest else None,
                "uptime_pct": uptime_pct,
                "recent_history": [dict(r) for r in reversed(recent)],
            })
        return result


@app.post("/api/urls", status_code=201)
def create_url(payload: URLCreate):
    with get_conn() as conn:
        try:
            cur = conn.execute(
                "INSERT INTO urls (name, url) VALUES (?, ?)", (payload.name, payload.url)
            )
            conn.commit()
        except Exception:
            raise HTTPException(status_code=409, detail="URL already registered")
        new_id = cur.lastrowid

    # check it right away so the user sees a status without waiting for the next tick
    check_url(new_id, payload.url)

    with get_conn() as conn:
        row = conn.execute("SELECT * FROM urls WHERE id = ?", (new_id,)).fetchone()
        return dict(row)


@app.delete("/api/urls/{url_id}", status_code=204)
def delete_url(url_id: int):
    with get_conn() as conn:
        cur = conn.execute("DELETE FROM urls WHERE id = ?", (url_id,))
        conn.commit()
        if cur.rowcount == 0:
            raise HTTPException(status_code=404, detail="URL not found")


@app.get("/api/urls/{url_id}/checks")
def get_checks(url_id: int, limit: int = 50):
    with get_conn() as conn:
        rows = conn.execute(
            "SELECT * FROM checks WHERE url_id = ? ORDER BY checked_at DESC LIMIT ?",
            (url_id, limit),
        ).fetchall()
        return [dict(r) for r in rows]


@app.get("/api/health")
def health():
    return {"status": "ok"}