// M0 spike: calls each candidate CourseLink Valence endpoint and records what comes back.
// Loaded by the service worker (importScripts) and injected into CourseLink tabs (chrome.scripting),
// so the same code runs in both contexts and the results are directly comparable.
// SHORTCUT: throwaway plain JS, no build step, no tests. M1 replaces it with
// extension/src/courselink/client.ts (TypeScript + Zod + unit tests).
// Wrapped in an IIFE so injecting it into the same tab twice doesn't redeclare top-level consts.
(() => {
  const ORIGIN = "https://courselink.uoguelph.ca";
  const MAX_ARRAY_ITEMS = 5;
  const MAX_STRING_CHARS = 3000;
  const MAX_ENROLLMENT_PAGES = 5;
  const FILE_HEADERS = ["content-length", "content-disposition", "etag", "last-modified", "cache-control"];

  // The only function in the spike that talks to CourseLink. GET only (hard constraint #1).
  function courselinkFetch(path, init = {}) {
    const method = (init.method || "GET").toUpperCase();
    if (method !== "GET") {
      throw new Error(`Blocked ${method} ${path}: CourseLink access is GET-only`);
    }
    // credentials: "include" matters in the service worker: its origin is chrome-extension://,
    // so the default ("same-origin") would never send the CourseLink session cookie.
    return fetch(ORIGIN + path, { ...init, method: "GET", credentials: "include", cache: "no-store" });
  }

  // Classifies anything that looks like "not signed in". 403 can also mean "students can't
  // read this endpoint", so the per-run verdict only trusts this signal on whoami.
  function sessionSignal(r) {
    if (r.type === "opaqueredirect") return "redirect";
    if (r.finalUrl && /\/d2l\/login|shibboleth|login\.microsoftonline/i.test(r.finalUrl)) return "login_redirect";
    if (r.finalUrl && !r.finalUrl.startsWith(ORIGIN)) return "offsite_redirect";
    if (r.status === 401) return "http_401";
    if (r.status === 403) return "http_403";
    if (!r.headersOnly && r.isJson === false && /text\/html/i.test(r.contentType || "")) return "html_body";
    return null;
  }

  function truncate(value) {
    if (Array.isArray(value)) return value.slice(0, MAX_ARRAY_ITEMS).map(truncate);
    if (value && typeof value === "object") {
      return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, truncate(v)]));
    }
    if (typeof value === "string" && value.length > MAX_STRING_CHARS) {
      return value.slice(0, MAX_STRING_CHARS) + "…[truncated]";
    }
    return value;
  }

  function itemCount(data) {
    if (Array.isArray(data)) return data.length;
    if (!data || typeof data !== "object") return null;
    for (const key of ["Items", "Objects", "Modules"]) {
      if (Array.isArray(data[key])) return data[key].length;
    }
    return null;
  }

  // One GET, fully described. Returns the stored (truncated) record and the full parsed body.
  async function probe(label, path, { redirect = "follow", headersOnly = false } = {}) {
    const started = Date.now();
    const record = { label, path, redirect, headersOnly };
    const controller = new AbortController();
    let data = null;
    try {
      const res = await courselinkFetch(path, { redirect, signal: controller.signal });
      Object.assign(record, {
        status: res.status,
        ok: res.ok,
        type: res.type,
        redirected: res.redirected,
        finalUrl: res.url,
        contentType: res.headers.get("content-type"),
      });
      if (headersOnly) {
        // File downloads: keep the headers (do they carry a version we can diff on?), skip the body.
        record.headers = Object.fromEntries(FILE_HEADERS.map((h) => [h, res.headers.get(h)]));
        controller.abort();
      } else if (res.type !== "opaqueredirect") {
        const text = await res.text();
        record.bodyChars = text.length;
        try {
          data = JSON.parse(text);
          record.isJson = true;
          record.itemCount = itemCount(data);
          record.json = truncate(data);
        } catch {
          record.isJson = false;
          record.htmlTitle = (text.match(/<title[^>]*>([^<]*)<\/title>/i) || [])[1] || null;
          record.bodySnippet = text.slice(0, 300);
        }
      }
      record.sessionSignal = sessionSignal(record);
    } catch (err) {
      record.error = String((err && err.message) || err);
    }
    record.ms = Date.now() - started;
    return { record, data };
  }

  function skipped(label, reason) {
    return { label, skipped: reason };
  }

  const asArray = (x) => (Array.isArray(x) ? x : []);

  function pickVersions(data) {
    if (!Array.isArray(data)) return null;
    const latest = (code) => data.find((p) => p.ProductCode === code)?.LatestVersion;
    const lp = latest("lp");
    const le = latest("le");
    return lp && le ? { lp, le } : null;
  }

  // Prefer course offerings whose access window contains today, most recently accessed first.
  function pickCourse(enrollments, now) {
    const courses = enrollments.filter((e) => e.OrgUnit?.Type?.Id === 3 && e.Access?.CanAccess !== false);
    const inWindow = courses.filter((e) => {
      const start = e.Access?.StartDate ? new Date(e.Access.StartDate) : null;
      const end = e.Access?.EndDate ? new Date(e.Access.EndDate) : null;
      return (start || end) && (!start || start <= now) && (!end || end >= now);
    });
    const pool = inWindow.length ? inWindow : courses;
    const recency = (e) => String(e.Access?.LastAccessed || e.Access?.StartDate || "");
    pool.sort((a, b) => recency(b).localeCompare(recency(a)));
    return pool[0] ? String(pool[0].OrgUnit.Id) : null;
  }

  function findFileTopic(node) {
    if (!node) return null;
    for (const topic of node.Topics || []) {
      if (/file/i.test(topic.TypeIdentifier || "")) return topic;
    }
    for (const module of node.Modules || []) {
      const found = findFileTopic(module);
      if (found) return found;
    }
    return null;
  }

  function sessionVerdict(records) {
    const r = records.find((x) => x.label === "whoami") || records.find((x) => x.label === "versions");
    if (!r) return "error";
    if (r.status === 200 && r.isJson && r.json?.Identifier) return "ok";
    if (r.sessionSignal) return "expired";
    return "error";
  }

  async function run({ orgUnitId = null } = {}) {
    const startedAt = new Date().toISOString();
    const records = [];
    const step = async (label, path, opts) => {
      const { record, data } = await probe(label, path, opts);
      records.push(record);
      return record.ok && record.isJson ? data : null;
    };
    const finish = (extra) => ({
      startedAt,
      finishedAt: new Date().toISOString(),
      verdict: sessionVerdict(records),
      records,
      ...extra,
    });

    const versions = pickVersions(await step("versions", "/d2l/api/versions/"));
    if (!versions) return finish({ versions: null, orgUnitId });
    const lp = `/d2l/api/lp/${versions.lp}`;
    const le = `/d2l/api/le/${versions.le}`;

    await step("whoami", `${lp}/users/whoami`);
    // Same call without following redirects: shows whether "expired" is a raw 302 to the login page.
    await step("whoami_manual_redirect", `${lp}/users/whoami`, { redirect: "manual" });

    const enrollments = [];
    let bookmark = null;
    for (let page = 1; page <= MAX_ENROLLMENT_PAGES; page++) {
      const qs = new URLSearchParams({ orgUnitTypeId: "3" });
      if (bookmark) qs.set("bookmark", bookmark);
      const data = await step(page === 1 ? "enrollments" : `enrollments_page${page}`, `${lp}/enrollments/myenrollments/?${qs}`);
      if (!data) break;
      enrollments.push(...(data.Items || []));
      if (!data.PagingInfo?.HasMoreItems) break;
      bookmark = data.PagingInfo.Bookmark;
    }

    const now = new Date();
    const day = 24 * 60 * 60 * 1000;
    const range = new URLSearchParams({
      startDateTime: new Date(now.getTime() - 60 * day).toISOString(),
      endDateTime: new Date(now.getTime() + 120 * day).toISOString(),
    });
    // Cross-course "what's due" feed: if it works, it may replace several per-course calls.
    await step("my_items_due_all_courses", `${le}/content/myItems/due/?${range}`);

    const ou = orgUnitId || pickCourse(enrollments, now);
    if (!ou) return finish({ versions, orgUnitId: null, enrollmentCount: enrollments.length });
    const c = `${le}/${ou}`;

    const folders = asArray(await step("dropbox_folders", `${c}/dropbox/folders/`));
    const pastDue = folders.find((f) => f.DueDate && new Date(f.DueDate) < now) || folders[0];
    if (pastDue) {
      await step("dropbox_my_submissions", `${c}/dropbox/folders/${pastDue.Id}/submissions/mysubmissions/`);
    } else {
      records.push(skipped("dropbox_my_submissions", "no dropbox folders"));
    }
    const withAttachment = folders.find((f) => f.Attachments?.length);
    if (withAttachment) {
      const fileId = withAttachment.Attachments[0].FileId;
      await step("dropbox_attachment_headers", `${c}/dropbox/folders/${withAttachment.Id}/attachments/${fileId}`, { headersOnly: true });
    } else {
      records.push(skipped("dropbox_attachment_headers", "no folder with attachments"));
    }

    await step("quizzes", `${c}/quizzes/`);

    const news = asArray(await step("news", `${c}/news/`));
    const newsWithAttachment = news.find((n) => n.Attachments?.length);
    if (newsWithAttachment) {
      const fileId = newsWithAttachment.Attachments[0].FileId;
      await step("news_attachment_headers", `${c}/news/${newsWithAttachment.Id}/attachments/${fileId}`, { headersOnly: true });
    } else {
      records.push(skipped("news_attachment_headers", "no announcement with attachments"));
    }

    const topic = findFileTopic(await step("content_toc", `${c}/content/toc`));
    if (topic) {
      await step("content_topic_file_headers", `${c}/content/topics/${topic.TopicId}/file`, { headersOnly: true });
    } else {
      records.push(skipped("content_topic_file_headers", "no file topic in toc"));
    }

    await step("grade_values", `${c}/grades/values/myGradeValues/`);
    await step("grade_objects", `${c}/grades/`);
    await step("grade_categories", `${c}/grades/categories/`);
    await step("calendar_my_events", `${c}/calendar/events/myEvents/?${range}`);

    return finish({ versions, orgUnitId: ou, enrollmentCount: enrollments.length });
  }

  globalThis.GryphProbe = { run };
})();
