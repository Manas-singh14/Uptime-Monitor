import time
import httpx
from .database import get_conn

TIMEOUT_SECONDS = 10

# Some sites (LinkedIn, etc.) block requests that don't look like a real browser.
# A normal User-Agent avoids false "down" results caused by bot-blocking.
HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
        "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
    )
}


def check_url(url_id: int, url: str):
    start = time.perf_counter()
    status_code = None
    is_up = 0
    reason = ""

    try:
        resp = httpx.get(url, timeout=TIMEOUT_SECONDS, follow_redirects=True, headers=HEADERS)
        status_code = resp.status_code
        is_up = 1 if resp.status_code < 400 else 0
        if is_up:
            reason = f"OK - server responded with HTTP {status_code}"
        else:
            reason = f"Server responded with HTTP {status_code} ({resp.reason_phrase})"

    except httpx.ConnectTimeout:
        reason = "Connection timed out - server did not respond in time"
    except httpx.ReadTimeout:
        reason = "Connected, but the response took too long to arrive"
    except httpx.ConnectError:
        reason = "Could not connect - host unreachable, DNS failure, or connection refused"
    except httpx.TooManyRedirects:
        reason = "Too many redirects - the URL may be misconfigured"
    except httpx.RequestError as e:
        reason = f"Request failed: {type(e).__name__}"

    elapsed_ms = round((time.perf_counter() - start) * 1000, 2)

    with get_conn() as conn:
        conn.execute(
            "INSERT INTO checks (url_id, status_code, response_time_ms, is_up, reason) VALUES (?, ?, ?, ?, ?)",
            (url_id, status_code, elapsed_ms, is_up, reason),
        )
        conn.commit()


def check_all_urls():
    with get_conn() as conn:
        urls = conn.execute("SELECT id, url FROM urls").fetchall()

    for row in urls:
        check_url(row["id"], row["url"])