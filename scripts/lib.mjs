// Shared helpers for the ingestion scripts.
// Every fetcher emits the SAME entry shape into content/<section>/, so the site
// treats an automated scrobble and a hand-written photo note identically.
import { writeFile, readFile, mkdir, readdir, rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const CONTENT_DIR = path.join(ROOT, "content");

// Minimal RFC-4180-ish CSV parser: handles quoted fields with embedded commas,
// newlines and doubled "" quotes. Returns an array of string[] rows.
export function parseCSV(text) {
  const rows = []; let row = [], field = "", q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"' && text[i + 1] === '"') { field += '"'; i++; }
      else if (c === '"') q = false;
      else field += c;
    } else if (c === '"') q = true;
    else if (c === ",") { row.push(field); field = ""; }
    else if (c === "\n") { row.push(field); rows.push(row); row = []; field = ""; }
    else if (c !== "\r") field += c;
  }
  if (field || row.length) { row.push(field); rows.push(row); }
  return rows;
}

export function slugify(s) {
  return s.toLowerCase().normalize("NFKD").replace(/[^\w\s-]/g, "")
    .replace(/[\s-]+/g, "-")          // collapse runs of spaces/hyphens to one
    .replace(/^-+|-+$/g, "")          // trim leading/trailing hyphens
    .slice(0, 60).replace(/-+$/, ""); // and again after the length cap
}

// Section -> the tag we stamp on an item the second time we see it. Doubles as
// a browsable "things I returned to" page at /tags/re-listened/ etc.
function repeatTag(section) {
  return ({ read: "re-read", watched: "re-watched", listened: "re-listened", visited: "re-visited" })[section]
    || "revisited";
}

// Section -> the "main creator" field that leads the slug (and the display).
const CREATOR = { read: "author", watched: "director", listened: "artist" };

// The URL slug: "<creator>-<title>" when we have a creator, else just the title.
// e.g. miles-davis-kind-of-blue, min-jin-lee-pachinko, wim-wenders-perfect-days.
// Parts that slugify to nothing (e.g. a purely non-Latin name) are dropped; if
// everything drops out we fall back to a short stable hash so the slug is never
// empty and never collides two different items.
export function makeSlug(section, title, params) {
  const creator = params[CREATOR[section]] || "";
  const slug = [creator, title].map(slugify).filter(Boolean).join("-");
  if (slug) return slug;
  const raw = `${creator} ${title}`;
  const h = [...raw].reduce((a, c) => (a * 31 + c.charCodeAt(0)) >>> 0, 0).toString(36);
  return `x-${h}`;
}

const ymd = (iso) => iso.slice(0, 10).replaceAll("-", "");

// Files are named YYYYMMDD_<slug>.md for on-disk order, but the URL comes from
// the `slug` front-matter field. To find an item again (for repeats) we index a
// section dir by slug once, then keep it in sync. Cache is per-process.
const _index = new Map();  // dir -> Map(slug -> filename)
async function indexFor(dir) {
  if (_index.has(dir)) return _index.get(dir);
  const m = new Map();
  let files = [];
  try { files = await readdir(dir); } catch { /* new section */ }
  for (const f of files) {
    if (!f.endsWith(".md") || f === "_index.md") continue;
    const u = f.indexOf("_");
    m.set(f.slice(u + 1, -3), f);   // slug is everything after the date prefix
  }
  _index.set(dir, m);
  return m;
}

function yaml(v) {
  if (Array.isArray(v)) return "[" + v.map((x) => JSON.stringify(x)).join(", ") + "]";
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  return JSON.stringify(String(v));
}

// Our writer emits `key: <json-value>` lines, so parsing our own files back is
// just JSON.parse per value — no YAML library needed.
function parseFrontMatter(text) {
  const m = text.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
  if (!m) return { data: {}, body: text };
  const data = {};
  for (const line of m[1].split("\n")) {
    const i = line.indexOf(":");
    if (i === -1) continue;
    const key = line.slice(0, i).trim();
    const raw = line.slice(i + 1).trim();
    try { data[key] = JSON.parse(raw); } catch { data[key] = raw; }
  }
  return { data, body: m[2] };
}

const ORDER = ["title", "slug", "date", "updated", "label", "featured", "image",
  "author", "artist", "director", "year", "rating", "external", "hasSummary", "tags"];

function serialize(data, body) {
  const keys = [...ORDER.filter((k) => k in data),
    ...Object.keys(data).filter((k) => !ORDER.includes(k))];
  const lines = ["---"];
  for (const k of keys) {
    const v = data[k];
    if (v === undefined || v === null || v === "" || (Array.isArray(v) && !v.length)) continue;
    lines.push(`${k}: ${yaml(v)}`);
  }
  lines.push("---", (body || "").trim(), "");
  return lines.join("\n");
}

// Writes one entry into content/<section>/ as YYYYMMDD_<slug>.md, with the clean
// `slug` in front matter driving the URL. `date` must be a Date.
//   • first time we see a slug  → create it, `date` = when it happened
//   • a LATER occurrence        → keep the original `date`, set `updated` to the
//                                 newest occurrence, add the section's repeat tag
//   • an EARLIER occurrence      → move `date` back (and rename the file's prefix)
//   • a duplicate in-between      → no-op
// So a re-listen / rewatch enriches the one canonical URL instead of forking it.
// Returns { status: "created" | "updated" | "unchanged", name }.
export async function writeEntry({ date, section, title, body = "", slug, ...params }) {
  const dir = path.join(CONTENT_DIR, section);
  await mkdir(dir, { recursive: true });
  const iso = date.toISOString();
  slug = slug || makeSlug(section, title, params);
  const index = await indexFor(dir);

  const existing = index.get(slug);
  if (!existing) {
    const name = `${ymd(iso)}_${slug}.md`;
    await writeFile(path.join(dir, name), serialize({ title, date: iso, slug, ...params }, body));
    index.set(slug, name);
    return { status: "created", name: `${section}/${name}` };
  }

  const { data, body: keepBody } = parseFrontMatter(await readFile(path.join(dir, existing), "utf8"));
  const first = data.date;
  const last = data.updated || data.date;
  let movedEarlier = false;
  if (iso > last) data.updated = iso;
  else if (iso < first) { data.date = iso; if (!data.updated) data.updated = last; movedEarlier = true; }
  else return { status: "unchanged", name: `${section}/${existing}` };   // already accounted for

  const tag = repeatTag(section);
  const tags = Array.isArray(data.tags) ? data.tags.slice() : (data.tags ? [data.tags] : []);
  if (!tags.includes(tag)) tags.push(tag);
  data.tags = tags;

  // If the canonical date moved earlier, rename the file so its prefix stays true.
  let name = existing;
  if (movedEarlier) {
    name = `${ymd(data.date)}_${slug}.md`;
    if (name !== existing) { await rm(path.join(dir, existing)); index.set(slug, name); }
  }
  await writeFile(path.join(dir, name), serialize(data, keepBody));
  return { status: "updated", name: `${section}/${name}` };
}

// Split a list of epoch-ms timestamps into "sessions": consecutive plays with
// no gap larger than gapMs belong to the same sitting. Used to roll many track
// scrobbles into one album listen (and to tell a genuine re-listen apart from
// just playing the next track). Returns an array of sessions, each a number[].
export function sessionize(times, gapMs) {
  const sorted = [...times].sort((a, b) => a - b);
  const sessions = [];
  let cur = [];
  for (const t of sorted) {
    if (cur.length && t - cur[cur.length - 1] > gapMs) { sessions.push(cur); cur = []; }
    cur.push(t);
  }
  if (cur.length) sessions.push(cur);
  return sessions;
}

export async function report(source, results) {
  const created = results.filter((r) => r.status === "created");
  const updated = results.filter((r) => r.status === "updated");
  const parts = [];
  if (created.length) parts.push(`${created.length} new`);
  if (updated.length) parts.push(`${updated.length} re-logged`);
  const names = [...created, ...updated].map((r) => r.name);
  console.log(`[${source}] ${parts.length ? parts.join(", ") : "nothing new"}` +
    (names.length ? ":\n  " + names.join("\n  ") : ""));
}
