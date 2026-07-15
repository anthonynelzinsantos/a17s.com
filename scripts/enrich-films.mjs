#!/usr/bin/env node
// Backfills director + genres onto the /watched/ films.
//
//   node scripts/enrich-films.mjs
//
// TMDb's API needs a key we shouldn't handle in chat, but Letterboxd sources its
// data FROM TMDb and exposes it on each public film page — and we already store
// every film's Letterboxd URL. So we fetch each page and read the director from
// its JSON-LD and the genres from its analytics payload, filling in `director`,
// `by` (creator taxonomy) and `about` (genre taxonomy). The slug is the original
// date's epoch, so enrichment never renames a file or changes a URL.
import { readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseFrontMatter, serialize } from "./lib.mjs";

const WATCHED = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "content", "Watched");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function extract(html) {
  const dm = html.match(/"director":\[(.*?)\]/s);
  const directors = dm
    ? [...dm[1].matchAll(/"name":"([^"]*)"/g)].map((m) => { try { return JSON.parse(`"${m[1]}"`); } catch { return m[1]; } })
    : [];
  const genres = [...new Set([...html.matchAll(/genre: '([^']+)'/g)].map((m) => m[1]))];
  return { directors, genres };
}

const files = (await readdir(WATCHED)).filter((f) => f.endsWith(".md") && f !== "_index.md");
let enriched = 0, skipped = 0;

for (const file of files) {
  const full = path.join(WATCHED, file);
  const { data, body } = parseFrontMatter(await readFile(full, "utf8"));
  if (!data.external || data.director) { skipped++; continue; }  // already enriched → skip
  try {
    const res = await fetch(data.external, { redirect: "follow" });
    const { directors, genres } = extract(await res.text());
    if (!directors.length && !genres.length) { console.warn("  no data:", data.title); skipped++; continue; }
    if (directors.length) { data.director = directors.join(", "); data.by = data.director; }   // by = creator taxonomy
    if (genres.length) data.about = genres;  // about = genre taxonomy

    // The slug is the original date's epoch, so it is unaffected by enrichment:
    // no rename, the file keeps its name and URL.
    await writeFile(full, serialize(data, body));
    enriched++;
  } catch (e) {
    console.warn("  failed:", data.title, e.message); skipped++;
  }
  await sleep(250);   // be polite to Letterboxd
}
console.log(`[enrich-films] ${enriched} enriched, ${skipped} skipped`);
