# API Contract (source of truth)

Change this file first, then update `backend/app/api/schemas.py` (Pydantic) and
`extension/src/api/types.ts` (TypeScript) in the same change.

- Base URL: `http://localhost:8000` (configurable in extension options)
- Auth: header `X-GryphCal-Key: <shared secret>` (single user). SHORTCUT: replace with real auth before deploying.
- All timestamps: UTC ISO-8601 strings. IDs from CourseLink are strings.

## Types

```ts
type Course = {
  id: string;            // orgUnitId
  code: string;          // e.g. "ENGG*3450"
  name: string;
  term: string | null;   // e.g. "F26"
};

type Attachment = {
  source_id: string;     // stable CourseLink id for the file
  name: string;
  size_bytes: number | null;
};

type Deadline = {
  id: string;            // "<kind>:<courseLinkId>"
  course_id: string;
  kind: "assignment" | "quiz" | "other";
  title: string;
  due_at: string | null;
  end_at: string | null;          // hard close if different from due
  status: "not_submitted" | "submitted" | "graded";
  grade: { points: number; out_of: number } | null;
  weight_percent: number | null;
  description_html: string | null;
  rubric_text: string | null;
  attachments: Attachment[];
  url: string;                     // link back to CourseLink
};

type Announcement = {
  id: string;
  course_id: string;
  title: string;
  body_html: string;
  posted_at: string;
  updated_at: string | null;
  attachments: Attachment[];
};

type ContentItem = {
  id: string;            // topic id
  course_id: string;
  module_path: string[]; // e.g. ["Week 3", "Lecture Slides"]
  title: string;
  kind: "file" | "link" | "html";
  url: string;
  updated_at: string | null;
  file: Attachment | null;
};

type SyncPayload = {
  synced_at: string;
  trigger: "timer" | "tab_open" | "manual";
  courses: Course[];
  deadlines: Deadline[];        // full snapshot per course; backend diffs
  announcements: Announcement[];
  content_items: ContentItem[];
};

type SyncResponse = {
  sync_id: string;
  changes_detected: number;
  files_needed: { source_id: string; course_id: string }[];  // backend lacks these files
};

type Estimate = {
  hours_low: number;
  hours_high: number;
  difficulty: 1 | 2 | 3 | 4 | 5;
  rationale: string;
  prompt_version: string;
  created_at: string;
};

type Change = {
  id: string;
  course_id: string;
  kind: "announcement_new" | "announcement_edited" | "file_new" | "file_changed"
      | "due_date_moved" | "deadline_new" | "deadline_removed";
  entity_id: string;
  before: unknown | null;
  after: unknown | null;
  detected_at: string;
  summary: string | null;             // filled by AI layer later
  affected_deadline_ids: string[];    // filled by AI layer later
};

type Notification = {
  id: string;
  kind: "start_by" | "change" | "session_expired" | "plan_ready";
  title: string;
  body: string;
  deadline_id: string | null;
  created_at: string;
  read: boolean;
};
```

## Endpoints

| Method | Path | Built by | Notes |
|---|---|---|---|
| GET | `/health` | CC | |
| POST | `/sync` | CC | body `SyncPayload` → `SyncResponse`. Idempotent for identical snapshots. |
| POST | `/files` | CC | multipart: `source_id`, `course_id`, `file`. Stored by sha256; dedup. |
| POST | `/session-status` | CC | `{ status: "ok" \| "expired", detected_at }` |
| GET | `/courses` | CC | `Course[]` |
| GET | `/deadlines?from=&to=` | CC | `(Deadline & { estimate: Estimate \| null; start_by: string \| null })[]` |
| GET | `/changes?since=` | CC | `Change[]` |
| GET | `/notifications?unread=true` | CC | `Notification[]` |
| POST | `/notifications/{id}/read` | CC | |
| POST | `/deadlines/{id}/time-log` | CC | `{ minutes: number, note?: string }` |
| POST | `/deadlines/{id}/estimate` | CC endpoint, ME logic | 501 until AI implemented |
| POST | `/chat` | CC endpoint (SSE), ME logic | `{ message, thread_id }` → streamed tokens + `citations` event. 501 until implemented |
| GET | `/plans/pending` | CC endpoint, ME logic | proposed weekly plan awaiting approval |
| POST | `/plans/{id}/approve` | CC endpoint, ME logic | resumes LangGraph run |
| POST | `/plans/{id}/reject` | CC endpoint, ME logic | `{ feedback: string }` resumes with feedback |
| GET | `/grades/what-if?course_id=&target=` | CC | deterministic, no LLM |
