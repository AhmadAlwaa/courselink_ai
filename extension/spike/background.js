// M0 spike service worker: runs the same probe from different contexts and stores every run.
// Contexts: injected into a CourseLink tab, the service worker itself (with or without a
// CourseLink tab open), a chrome.alarms wake-up, and a browser restart.
importScripts("probe.js");

const COURSELINK_TABS = "https://courselink.uoguelph.ca/*";
const ALARM = "m0-probe";
const MAX_RUNS = 30;
const BADGES = { ok: ["OK", "#2e7d32"], expired: ["EXP", "#c62828"], error: ["ERR", "#ef6c00"] };

// Listeners are registered at top level so they exist when Chrome wakes a stopped worker.
chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  handle(msg).then(sendResponse, (err) => sendResponse({ error: String((err && err.message) || err) }));
  return true; // keep the channel open for the async response
});

chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name !== ALARM) return;
  const { pendingAlarm } = await chrome.storage.local.get("pendingAlarm");
  await chrome.storage.local.remove("pendingAlarm");
  await runInServiceWorker("sw_alarm", pendingAlarm || {});
});

chrome.runtime.onStartup.addListener(async () => {
  const { startupArmed } = await chrome.storage.local.get("startupArmed");
  if (!startupArmed) return;
  await chrome.storage.local.remove("startupArmed");
  await runInServiceWorker("sw_startup", startupArmed);
});

async function handle(msg) {
  const opts = { expectedSession: msg.expectedSession || "unknown", orgUnitId: msg.orgUnitId || null };
  switch (msg.type) {
    case "run_tab":
      return runInCourseLinkTab(opts);
    case "run_sw":
      return runInServiceWorker("service_worker", opts);
    case "schedule_alarm":
      await chrome.storage.local.set({ pendingAlarm: opts });
      await chrome.alarms.create(ALARM, { delayInMinutes: 1 });
      return { scheduled: true };
    case "arm_startup":
      if (msg.armed) await chrome.storage.local.set({ startupArmed: opts });
      else await chrome.storage.local.remove("startupArmed");
      return { armed: Boolean(msg.armed) };
    default:
      throw new Error(`Unknown message type: ${msg.type}`);
  }
}

async function courselinkTabs() {
  return chrome.tabs.query({ url: COURSELINK_TABS });
}

async function runInServiceWorker(context, opts) {
  const tabsOpen = (await courselinkTabs()).length;
  const result = await globalThis.GryphProbe.run({ orgUnitId: opts.orgUnitId });
  return saveRun({ ...result, context, tabsOpen, ...meta(opts) });
}

async function runInCourseLinkTab(opts) {
  const tabs = await courselinkTabs();
  if (!tabs.length) throw new Error("Open a CourseLink tab first.");
  const tab = tabs.find((t) => t.active) || tabs[0];
  await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ["probe.js"] });
  const [{ result }] = await chrome.scripting.executeScript({
    target: { tabId: tab.id },
    func: (orgUnitId) => globalThis.GryphProbe.run({ orgUnitId }),
    args: [opts.orgUnitId],
  });
  if (!result) throw new Error("Probe threw inside the tab; check that tab's DevTools console.");
  return saveRun({ ...result, context: "content_script", tabsOpen: tabs.length, ...meta(opts) });
}

function meta(opts) {
  return {
    expectedSession: opts.expectedSession || "unknown",
    chromeVersion: (navigator.userAgent.match(/Chrome\/([\d.]+)/) || [])[1] || null,
  };
}

async function saveRun(run) {
  const { runs = [] } = await chrome.storage.local.get("runs");
  runs.unshift({ id: crypto.randomUUID(), ...run });
  await chrome.storage.local.set({ runs: runs.slice(0, MAX_RUNS) });
  const [text, color] = BADGES[run.verdict] || BADGES.error;
  await chrome.action.setBadgeText({ text });
  await chrome.action.setBadgeBackgroundColor({ color });
  return { context: run.context, verdict: run.verdict };
}
