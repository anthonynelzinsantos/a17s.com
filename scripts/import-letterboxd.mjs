#!/usr/bin/env node
// Full Letterboxd history from the official data export (Settings ▸ Data ▸
// Export). The RSS fetcher only reaches the ~50 most recent films; this reads
// the complete diary.csv, so it's the one-time backfill.
//
//   node scripts/import-letterboxd.mjs ~/Downloads/letterboxd-<user>-<date>/
//
// Pass the unzipped export folder (or the diary.csv inside it).
//
// diary.csv columns: Date, Name, Year, Letterboxd URI, Rating, Rewatch, Tags, Watched Date
// We date each entry by "Watched Date" (when you actually saw it, not when you
// logged it), so the timeline reflects reality. Rows are processed oldest-first
// so writeEntry treats a later viewing of the same film as a re-watch. A row
// flagged Rewatch=Yes but seen only once (you watched it before joining
// Letterboxd) is tagged re-watched directly.
import { readFile } from "node:fs/promises";
import path from "node:path";
import { writeEntry, report, parseCSV } from "./lib.mjs";

let arg = process.argv[2];
if (!arg) { console.error("Usage: import-letterboxd.mjs <export-folder | diary.csv>"); process.exit(1); }
const dir = arg.endsWith(".csv") ? path.dirname(arg) : arg;

const rows = parseCSV(await readFile(path.join(dir, "diary.csv"), "utf8"));
const header = rows.shift().map((h) => h.trim());
const col = (r, name) => r[header.indexOf(name)]?.trim() ?? "";

// Attach any written reviews, keyed by the diary URI.
const reviews = new Map();
try {
  const rv = parseCSV(await readFile(path.join(dir, "reviews.csv"), "utf8"));
  const rh = rv.shift().map((h) => h.trim());
  for (const r of rv) reviews.set(r[rh.indexOf("Letterboxd URI")]?.trim(), r[rh.indexOf("Review")]?.trim());
} catch { /* no reviews.csv — fine */ }

// Oldest first, so the earliest viewing is the canonical one.
const diary = rows.filter((r) => r.length > 1)
  .map((r) => ({ r, when: col(r, "Watched Date") || col(r, "Date") }))
  .filter((x) => x.when)
  .sort((a, b) => a.when.localeCompare(b.when));

const results = [];
for (const { r, when } of diary) {
  const stars = col(r, "Rating");
  const tags = (col(r, "Tags") || "").split(",").map((t) => t.trim()).filter(Boolean);
  if (col(r, "Rewatch") === "Yes" && !tags.includes("re-watched")) tags.push("re-watched");
  const uri = col(r, "Letterboxd URI");
  results.push(await writeEntry({
    date: new Date(when),
    section: "watched",
    title: col(r, "Name"),
    year: col(r, "Year") ? Number(col(r, "Year")) : undefined,
    rating: stars ? Math.round(Number(stars)) : undefined,
    external: uri,
    tags,
    hasSummary: false,
    body: (reviews.get(uri) || "").replace(/<[^>]+>/g, ""),  // strip Letterboxd's HTML
  }));
}
await report("letterboxd-csv", results);
