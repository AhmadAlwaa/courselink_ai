// M0 spike popup: triggers runs, shows the context × session matrix, exports redacted results.
const ROWS = [
  ["content_script", "Content script (in CourseLink tab)"],
  ["sw_tab_open", "Service worker, CourseLink tab open"],
  ["sw_no_tab", "Service worker, no CourseLink tab"],
  ["sw_startup", "Service worker after browser restart"],
];
const COLUMNS = [
  ["signed_in", "ok"],
  ["signed_out", "expired"],
];
const REDACT_KEYS = new Set([
  "FirstName", "LastName", "UniqueName", "DisplayName", "OrgDefinedId",
  "Email", "EmailAddress", "ProfileIdentifier", "Username", "UserName",
]);
const EMAIL = /[\w.+-]+@[\w-]+(\.[\w-]+)+/g;
const BUTTONS = ["runTab", "runSw", "scheduleAlarm"];

const $ = (id) => document.getElementById(id);

function el(tag, props = {}, children = []) {
  const node = Object.assign(document.createElement(tag), props);
  node.append(...children.filter((c) => c !== null && c !== undefined));
  return node;
}

const toronto = (iso) => (iso ? new Date(iso).toLocaleString("en-CA", { timeZone: "America/Toronto" }) : "—");

function rowKey(run) {
  if (run.context === "content_script") return "content_script";
  if (run.context === "sw_startup") return "sw_startup";
  return run.tabsOpen > 0 ? "sw_tab_open" : "sw_no_tab";
}

function renderMatrix(runs) {
  const header = el("tr", {}, [el("th", { textContent: "Context" }), ...COLUMNS.map(([col]) => el("th", { textContent: col }))]);
  const rows = ROWS.map(([key, label]) => {
    const cells = COLUMNS.map(([col, wanted]) => {
      const run = runs.find((r) => rowKey(r) === key && r.expectedSession === col);
      if (!run) return el("td", { className: "muted", textContent: "not run" });
      return el("td", {
        className: run.verdict === wanted ? "pass" : "fail",
        textContent: `${run.verdict} (${run.context}, ${toronto(run.startedAt)})`,
      });
    });
    return el("tr", {}, [el("td", { textContent: label }), ...cells]);
  });
  $("matrix").replaceChildren(header, ...rows);
}

function recordNote(r) {
  if (r.skipped) return `skipped: ${r.skipped}`;
  if (r.error) return `error: ${r.error}`;
  const parts = [];
  if (r.itemCount !== null && r.itemCount !== undefined) parts.push(`${r.itemCount} items`);
  if (r.headers) parts.push(Object.entries(r.headers).filter(([, v]) => v).map(([k, v]) => `${k}: ${v}`).join("; "));
  if (r.htmlTitle) parts.push(`title: ${r.htmlTitle}`);
  if (r.redirected || r.sessionSignal) parts.push(`final: ${r.finalUrl}`);
  return parts.join(" | ");
}

function renderRuns(runs) {
  if (!runs.length) {
    $("runs").replaceChildren(el("p", { className: "muted", textContent: "No runs yet." }));
    return;
  }
  const columns = ["label", "status", "type", "content-type", "json", "signal", "ms", "notes"];
  $("runs").replaceChildren(
    ...runs.map((run) => {
      const summary = [
        toronto(run.startedAt), run.context, `tabs open: ${run.tabsOpen}`, `expected: ${run.expectedSession}`,
        `verdict: ${run.verdict}`, `orgUnit: ${run.orgUnitId ?? "—"}`,
        run.versions ? `lp ${run.versions.lp} / le ${run.versions.le}` : "no versions",
      ].join(" · ");
      const rows = (run.records || []).map((r) =>
        el("tr", {}, [
          r.label, r.status ?? "", r.type ?? "", r.contentType ?? "", r.isJson === undefined ? "" : String(r.isJson),
          r.sessionSignal ?? "", r.ms ?? "", recordNote(r),
        ].map((v) => el("td", { textContent: String(v) }))),
      );
      return el("details", {}, [
        el("summary", { textContent: summary }),
        el("table", {}, [el("tr", {}, columns.map((c) => el("th", { textContent: c }))), ...rows]),
      ]);
    }),
  );
}

async function render() {
  const { runs = [], startupArmed } = await chrome.storage.local.get(["runs", "startupArmed"]);
  $("armStartup").checked = Boolean(startupArmed);
  renderMatrix(runs);
  renderRuns(runs);
}

function currentOptions() {
  return {
    expectedSession: document.querySelector('input[name="expected"]:checked').value,
    orgUnitId: $("orgUnitId").value.trim() || null,
  };
}

async function send(type, statusText, extra = {}) {
  $("status").textContent = statusText;
  BUTTONS.forEach((id) => ($(id).disabled = true));
  try {
    const res = await chrome.runtime.sendMessage({ type, ...currentOptions(), ...extra });
    $("status").textContent = res && res.error ? `Error: ${res.error}` : `Done: ${JSON.stringify(res)}`;
  } catch (err) {
    $("status").textContent = `Error: ${err.message}`;
  } finally {
    BUTTONS.forEach((id) => ($(id).disabled = false));
  }
}

// --- Redaction for export: strips the signed-in user's identity before results leave the browser.

const escapeRegExp = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

function collectPii(runs) {
  const names = new Set();
  const ids = new Set();
  for (const run of runs) {
    for (const r of run.records || []) {
      if (r.label !== "whoami" || !r.json) continue;
      for (const key of ["FirstName", "LastName", "UniqueName"]) {
        const value = r.json[key];
        if (typeof value !== "string") continue;
        [value, ...value.split(/\s+/)].filter((v) => v.length >= 3).forEach((v) => names.add(v));
      }
      for (const key of ["Identifier", "ProfileIdentifier"]) {
        if (r.json[key] !== null && r.json[key] !== undefined) ids.add(String(r.json[key]));
      }
    }
  }
  return {
    // Letters-only boundaries so "Ahmad_Lab1.pdf" is caught but "Ali" doesn't hit "quality".
    names: [...names].map((n) => new RegExp(`(?<![A-Za-z])${escapeRegExp(n)}(?![A-Za-z])`, "gi")),
    ids: [...ids].map((id) => ({ raw: id, re: new RegExp(`(?<!\\d)${escapeRegExp(id)}(?!\\d)`, "g") })),
  };
}

function scrub(text, pii) {
  let out = text.replace(EMAIL, "redacted@example.com");
  for (const re of pii.names) out = out.replace(re, "[name]");
  for (const { re } of pii.ids) out = out.replace(re, "[user-id]");
  return out;
}

function redact(value, pii, key = "") {
  if (REDACT_KEYS.has(key) && value !== null && value !== undefined) return "[redacted]";
  if (Array.isArray(value)) return value.map((v) => redact(v, pii));
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, redact(v, pii, k)]));
  }
  if (typeof value === "number" && pii.ids.some(({ raw }) => raw === String(value))) return 0;
  if (typeof value === "string") return scrub(value, pii);
  return value;
}

async function exportRedacted() {
  const { runs = [] } = await chrome.storage.local.get("runs");
  const data = { exportedAt: new Date().toISOString(), runs: redact(runs, collectPii(runs)) };
  const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: "application/json" }));
  el("a", { href: url, download: `gryphcal-m0-${Date.now()}.json` }).click();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}

// --- Wiring

async function restoreUi() {
  const { ui } = await chrome.storage.local.get("ui");
  if (!ui) return;
  const radio = document.querySelector(`input[name="expected"][value="${ui.expectedSession}"]`);
  if (radio) radio.checked = true;
  $("orgUnitId").value = ui.orgUnitId || "";
}

const saveUi = () => chrome.storage.local.set({ ui: currentOptions() });
document.querySelectorAll('input[name="expected"]').forEach((r) => r.addEventListener("change", saveUi));
$("orgUnitId").addEventListener("input", saveUi);

$("runTab").addEventListener("click", () => send("run_tab", "Running inside the CourseLink tab…"));
$("runSw").addEventListener("click", () => send("run_sw", "Running in the service worker…"));
$("scheduleAlarm").addEventListener("click", () =>
  send("schedule_alarm", "Scheduling… now close every CourseLink tab and this popup, wait ~1 min, then reopen."),
);
$("armStartup").addEventListener("change", (e) =>
  send("arm_startup", e.target.checked ? "Armed: quit Chrome fully and reopen it." : "Disarmed.", { armed: e.target.checked }),
);
$("export").addEventListener("click", exportRedacted);
$("clear").addEventListener("click", async () => {
  await chrome.storage.local.remove("runs");
  await chrome.action.setBadgeText({ text: "" });
});
$("openTab").addEventListener("click", () => chrome.tabs.create({ url: chrome.runtime.getURL("popup.html") }));

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "local" && (changes.runs || changes.startupArmed)) render();
});

restoreUi().then(render);
