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

// Section (= folder name) -> the tag we stamp on an item the second time we see
// it. Doubles as a browsable "things I returned to" page at /tags/re-listened/.
function repeatTag(section) {
  return ({ Read: "re-read", Watched: "re-watched", Listened: "re-listened" })[section] || "revisited";
}

// Section -> the "main creator" field that leads the content identity.
const CREATOR = { Read: "author", Watched: "director", Listened: "artist" };

// An item's *content identity*: "<creator>-<title>" when we have a creator, else
// just the title — e.g. miles-davis-kind-of-blue. This is NOT the URL (that's the
// date's epoch); it's how we recognise an item we've already archived, so a
// re-listen updates it instead of forking a new page.
// Parts that slugify to nothing (e.g. a purely non-Latin name) are dropped; if
// everything drops out we fall back to a short stable hash so the identity is
// never empty and never merges two different items.
export function makeSlug(section, title, params) {
  const creator = params[CREATOR[section]] || "";
  const slug = [creator, title].map(slugify).filter(Boolean).join("-");
  if (slug) return slug;
  const raw = `${creator} ${title}`;
  const h = [...raw].reduce((a, c) => (a * 31 + c.charCodeAt(0)) >>> 0, 0).toString(36);
  return `x-${h}`;
}

// An item's file name AND slug are the UNIX epoch (seconds) of its original
// date, so every URL has the same length. Seconds match the real precision of
// the sources (Last.fm scrobbles are second-granular; books/films are dated to
// the day), so sub-second digits would be pure zero-padding. That makes the file
// name opaque, so to find an item again (for repeats) we index a section by a
// *content identity* — the creator+title slug — read from each file's front
// matter. Cache is per-process.
const _index = new Map();  // dir -> { byIdentity: Map(identity -> file), used: Set(file) }
async function indexFor(dir, section) {
  if (_index.has(dir)) return _index.get(dir);
  const byIdentity = new Map(), used = new Set();
  let files = [];
  try { files = await readdir(dir); } catch { /* new section */ }
  for (const f of files) {
    if (!f.endsWith(".md") || f === "_index.md") continue;
    used.add(f);
    try {
      const { data } = parseFrontMatter(await readFile(path.join(dir, f), "utf8"));
      if (data.title) byIdentity.set(makeSlug(section, data.title, data), f);
    } catch { /* unreadable → skip */ }
  }
  const idx = { byIdentity, used };
  _index.set(dir, idx);
  return idx;
}

// The UNIX epoch (seconds) of a Date.
const epochOf = (d) => Math.floor(d.getTime() / 1000);

// Two items can share a second (books/films are dated to the day, i.e. midnight),
// so walk forward a second at a time until the epoch is free.
function freeEpoch(used, epoch) {
  while (used.has(`${epoch}.md`)) epoch++;
  return epoch;
}

function yaml(v) {
  if (Array.isArray(v)) return "[" + v.map((x) => JSON.stringify(x)).join(", ") + "]";
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  return JSON.stringify(String(v));
}

// Our writer emits `key: <json-value>` lines, so parsing our own files back is
// just JSON.parse per value — no YAML library needed.
export function parseFrontMatter(text) {
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

const ORDER = ["title", "slug", "date", "updated", "on", "label", "featured", "image",
  "author", "artist", "director", "by", "year", "rating", "about", "from", "external", "hasSummary", "tags"];

export function serialize(data, body) {
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

// Writes one entry into content/<section>/ as <epoch>.md, where <epoch> is the
// UNIX time in seconds of the original date — that same epoch is the `slug`
// driving the URL, so every URL is the same length. `date` must be a Date.
//   • first time we see an item → create it, `date` = when it happened
//   • a LATER occurrence        → keep the original `date`, set `updated` to the
//                                 newest occurrence, add the section's repeat tag
//   • an EARLIER occurrence     → move `date` back (the epoch/slug follows it)
//   • a duplicate in-between    → no-op
// So a re-listen / rewatch enriches the one canonical URL instead of forking it.
// Items are matched by content identity (creator+title), not by file name.
// Returns { status: "created" | "updated" | "unchanged", name }.
export async function writeEntry({ date, section, title, body = "", ...params }) {
  const dir = path.join(CONTENT_DIR, section);
  await mkdir(dir, { recursive: true });
  const iso = date.toISOString();
  const identity = makeSlug(section, title, params);
  const idx = await indexFor(dir, section);

  const existing = idx.byIdentity.get(identity);
  if (!existing) {
    const epoch = freeEpoch(idx.used, epochOf(date));
    const name = `${epoch}.md`;
    await writeFile(path.join(dir, name),
      serialize({ title, slug: String(epoch), date: iso, ...params }, body));
    idx.byIdentity.set(identity, name);
    idx.used.add(name);
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

  // The slug is the original date's epoch, so an earlier occurrence moves it.
  let name = existing;
  if (movedEarlier) {
    idx.used.delete(existing);
    const epoch = freeEpoch(idx.used, epochOf(new Date(data.date)));
    name = `${epoch}.md`;
    data.slug = String(epoch);
    if (name !== existing) { await rm(path.join(dir, existing)); idx.byIdentity.set(identity, name); }
    idx.used.add(name);
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
