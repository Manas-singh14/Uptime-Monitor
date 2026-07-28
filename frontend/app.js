const API_BASE = window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1"
  ? "http://localhost:8000"
  : `${window.location.protocol}//${window.location.hostname}:8000`;

const listEl = document.getElementById("url-list");
const summaryEl = document.getElementById("summary-bar");
const formEl = document.getElementById("add-url-form");
const nameInput = document.getElementById("name-input");
const urlInput = document.getElementById("url-input");
const errorEl = document.getElementById("form-error");

const POLL_INTERVAL_MS = 5000;

// Track expanded card ids and last-known up/down state across polls,
// so we don't collapse cards or lose the "just changed" flash on every refresh.
const expandedIds = new Set();
const lastKnownStatus = {};
let hasRenderedOnce = false;

async function fetchUrls() {
  try {
    const res = await fetch(`${API_BASE}/api/urls`);
    const urls = await res.json();
    renderSummary(urls);
    renderUrls(urls);
  } catch (err) {
    console.error("Failed to fetch URLs", err);
  }
}

function renderSummary(urls) {
  if (urls.length === 0) {
    summaryEl.innerHTML = "";
    return;
  }
  const up = urls.filter((u) => u.latest_check && u.latest_check.is_up).length;
  const down = urls.length - up;

  summaryEl.innerHTML = `
    <div class="summary-chip">
      <div class="chip-value">${urls.length}</div>
      <div class="chip-label">Monitored</div>
    </div>
    <div class="summary-chip up">
      <div class="chip-value">${up}</div>
      <div class="chip-label">Up</div>
    </div>
    <div class="summary-chip down">
      <div class="chip-value">${down}</div>
      <div class="chip-label">Down</div>
    </div>
  `;
}

function renderUrls(urls) {
  if (urls.length === 0) {
    listEl.innerHTML = `
      <div class="empty-state">
        <div class="empty-icon">◎</div>
        <p>Nothing being watched yet</p>
        <span>Add a URL above to start monitoring it</span>
      </div>
    `;
    return;
  }

  listEl.innerHTML = urls.map((u, i) => renderCard(u, i)).join("");
  hasRenderedOnce = true;

  urls.forEach((u) => {
    const header = document.getElementById(`header-${u.id}`);
    if (header) {
      header.addEventListener("click", () => toggleExpand(u.id));
    }
    const btn = document.getElementById(`delete-${u.id}`);
    if (btn) {
      btn.addEventListener("click", (e) => {
        e.stopPropagation();
        deleteUrl(u.id);
      });
    }

    // Track status changes for the flash effect
    const wasUp = lastKnownStatus[u.id];
    const isUp = u.latest_check ? !!u.latest_check.is_up : null;
    if (wasUp !== undefined && wasUp !== null && isUp !== null && wasUp !== isUp) {
      const card = document.getElementById(`card-${u.id}`);
      if (card) {
        card.classList.add(isUp ? "flash-up" : "flash-down");
        setTimeout(() => card.classList.remove("flash-up", "flash-down"), 2000);
      }
    }
    lastKnownStatus[u.id] = isUp;
  });
}

function toggleExpand(id) {
  if (expandedIds.has(id)) {
    expandedIds.delete(id);
  } else {
    expandedIds.add(id);
  }
  const card = document.getElementById(`card-${id}`);
  if (card) card.classList.toggle("expanded");
}

function renderCard(u, index) {
  const check = u.latest_check;
  let statusClass = "unknown";
  let statusText = "Pending first check…";
  let responseTime = "—";
  let statusCode = "—";

  if (check) {
    statusClass = check.is_up ? "up" : "down";
    statusText = check.is_up ? "Up" : "Down";
    responseTime = `${check.response_time_ms} ms`;
    statusCode = check.status_code ?? "no response";
  }

  const isExpanded = expandedIds.has(u.id);
  const entranceClass = hasRenderedOnce ? "" : "entrance";
  const entranceStyle = hasRenderedOnce ? "" : `style="--delay:${Math.min(index * 0.05, 0.4)}s"`;
  const uptimeRing = u.uptime_pct !== null && u.uptime_pct !== undefined
    ? `
      <div class="uptime-ring" style="--pct:${u.uptime_pct}">
        <div class="uptime-ring-inner">${Math.round(u.uptime_pct)}%</div>
      </div>
    `
    : "";

  return `
    <div class="url-card ${isExpanded ? "expanded" : ""} ${entranceClass}" id="card-${u.id}" ${entranceStyle}>
      <div class="url-card-header" id="header-${u.id}">
        <div class="url-info">
          <span class="status-dot-wrap ${statusClass}">
            <span class="status-dot ${statusClass}"></span>
          </span>
          <div class="url-text">
            <div class="url-name">${escapeHtml(u.name)}</div>
            <div class="url-href">${escapeHtml(u.url)}</div>
          </div>
        </div>
        <div class="url-meta">
          ${uptimeRing}
          <div class="meta-item">
            <div class="meta-label">Status</div>
            <div class="meta-value">${statusText}</div>
          </div>
          <div class="meta-item">
            <div class="meta-label">Code</div>
            <div class="meta-value">${statusCode}</div>
          </div>
          <div class="meta-item">
            <div class="meta-label">Response</div>
            <div class="meta-value">${responseTime}</div>
          </div>
          <button class="delete-btn" id="delete-${u.id}">Remove</button>
          <span class="expand-arrow">▼</span>
        </div>
      </div>
      <div class="url-details">
        <div class="url-details-inner">
          ${renderReasonBox(check, statusClass)}
          ${renderSparkline(u.recent_history)}
          ${renderHistoryTable(u.recent_history)}
        </div>
      </div>
    </div>
  `;
}

function renderReasonBox(check, statusClass) {
  if (!check) {
    return `
      <div class="reason-box">
        <span class="reason-icon">⏳</span>
        <div>
          <div class="reason-title">Waiting on first check</div>
          <div class="reason-text">This URL was just added — the first result will appear within a few seconds.</div>
        </div>
      </div>
    `;
  }

  const icon = check.is_up ? "✅" : "⚠️";
  const title = check.is_up ? "Why it's up" : "Why it's down";

  return `
    <div class="reason-box ${statusClass}">
      <span class="reason-icon">${icon}</span>
      <div>
        <div class="reason-title">${title}</div>
        <div class="reason-text">${escapeHtml(check.reason || "No details available.")}</div>
      </div>
    </div>
  `;
}

function renderSparkline(history) {
  if (!history || history.length === 0) return "";
  return `
    <div class="history-label">Last ${history.length} checks</div>
    <div class="sparkline">
      ${history.map((h) => {
        const cls = h.is_up ? "up" : "down";
        const height = h.is_up ? "100%" : "45%";
        const title = `${formatLocalTime(h.checked_at)} — ${h.is_up ? "Up" : "Down"} (${h.status_code ?? "no response"})`;
        return `<div class="spark-bar ${cls}" style="height:${height}" title="${escapeHtml(title)}"></div>`;
      }).join("")}
    </div>
  `;
}

function renderHistoryTable(history) {
  if (!history || history.length === 0) return "";
  const rows = [...history].reverse().slice(0, 10);
  return `
    <table class="history-table">
      <thead>
        <tr><th>Time</th><th>Status</th><th>Code</th><th>Response</th></tr>
      </thead>
      <tbody>
        ${rows.map((h) => `
          <tr>
            <td>${formatLocalTime(h.checked_at)}</td>
            <td>${h.is_up ? "Up" : "Down"}</td>
            <td>${h.status_code ?? "—"}</td>
            <td>${h.response_time_ms} ms</td>
          </tr>
        `).join("")}
      </tbody>
    </table>
  `;
}

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str;
  return div.innerHTML;
}

// checked_at is stored in UTC (SQLite's datetime('now')). Convert to the
// browser's local time before displaying it, or times look several hours off.
function formatLocalTime(utcString) {
  if (!utcString) return "";
  const isoUtc = utcString.replace(" ", "T") + "Z";
  const date = new Date(isoUtc);
  if (isNaN(date.getTime())) return utcString;
  return date.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

async function deleteUrl(id) {
  await fetch(`${API_BASE}/api/urls/${id}`, { method: "DELETE" });
  expandedIds.delete(id);
  delete lastKnownStatus[id];
  fetchUrls();
}

formEl.addEventListener("submit", async (e) => {
  e.preventDefault();
  errorEl.textContent = "";

  try {
    const res = await fetch(`${API_BASE}/api/urls`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: nameInput.value, url: urlInput.value }),
    });

    if (!res.ok) {
      const data = await res.json();
      errorEl.textContent = Array.isArray(data.detail)
        ? data.detail[0].msg
        : data.detail || "Failed to add URL";
      return;
    }

    nameInput.value = "";
    urlInput.value = "";
    fetchUrls();
  } catch (err) {
    errorEl.textContent = "Could not reach the backend API.";
  }
});

fetchUrls();
setInterval(fetchUrls, POLL_INTERVAL_MS);