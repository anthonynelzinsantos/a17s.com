#!/usr/bin/env node
// StoryGraph has no public API, but you can export your library as CSV
// (Account ▸ Manage Your Data ▸ Export). Point this at that file:
//
//   node scripts/import-storygraph.mjs ~/Downloads/storygraph_export.csv
//
// Only rows with Read Status "read" become entries (to-read / currently-reading
// / did-not-finish are skipped). Each book is dated by its "Last Date Read", so
// the timeline reflects when you actually finished it.
import { readFile } from "node:fs/promises";
import { writeEntry, report, parseCSV } from "./lib.mjs";

const csvPath = process.argv[2];
if (!csvPath) { console.error("Usage: import-storygraph.mjs <export.csv>"); process.exit(1); }

// StoryGraph dates are YYYY/MM/DD; normalize to an ISO date (parsed as UTC) so
// the on-disk date prefix doesn't drift by a timezone.
const toDate = (s) => new Date(s.replaceAll("/", "-"));
// Reviews can carry a little HTML; strip tags and decode the entities we see.
const clean = (s) => s.replace(/<[^>]+>/g, "")
  .replace(/&nbsp;/g, " ").replace(/&amp;/g, "&")
  .replace(/&#39;|&apos;/g, "'").replace(/&quot;/g, '"').trim();

const rows = parseCSV(await readFile(csvPath, "utf8"));
const header = rows.shift().map((h) => h.trim());
const col = (r, name) => r[header.indexOf(name)]?.trim() ?? "";

// Oldest-first, so a re-read (if any) registers against the earliest reading.
const read = rows
  .filter((r) => col(r, "Read Status") === "read")
  .map((r) => ({ r, when: col(r, "Last Date Read") || col(r, "Dates Read").split("-").pop() }))
  .filter((x) => x.when)
  .sort((a, b) => a.when.localeCompare(b.when));

const results = [];
for (const { r, when } of read) {
  const stars = col(r, "Star Rating");
  results.push(await writeEntry({
    date: toDate(when),
    section: "read",             // default label "Book"
    title: col(r, "Title"),
    author: col(r, "Authors") || col(r, "Author"),
    rating: stars ? Math.round(Number(stars)) : undefined,
    tags: (col(r, "Tags") || "").split(",").map((t) => t.trim()).filter(Boolean),
    body: clean(col(r, "Review") || ""),
    hasSummary: false,           // keep review off the compact listings
  }));
}
await report("storygraph", results);
