#!/usr/bin/env node
// Letterboxd has no public API, but every profile exposes an RSS feed of
// recent diary entries, including star rating. That's enough for the archive.
//
//   LETTERBOXD_USER=anthony node scripts/fetch-letterboxd.mjs
//
// Feed: https://letterboxd.com/<user>/rss/
import { writeEntry, report } from "./lib.mjs";

const USER = process.env.LETTERBOXD_USER;
if (!USER) { console.error("Set LETTERBOXD_USER."); process.exit(1); }

const res = await fetch(`https://letterboxd.com/${USER}/rss/`);
if (!res.ok) { console.error("Letterboxd error", res.status); process.exit(1); }
const xml = await res.text();

// Decode the HTML entities the feed carries (e.g. &#039; &amp;), so titles like
// "Breakfast at Tiffany's" and "Wallace & Gromit" don't leak "039" / "amp" into
// slugs. &amp; is done last to avoid double-decoding.
const decode = (s) => s
  .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
  .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
  .replace(/&quot;/g, '"').replace(/&apos;/g, "'")
  .replace(/&lt;/g, "<").replace(/&gt;/g, ">")
  .replace(/&amp;/g, "&");

// Tiny, dependency-free RSS parse. The feed is well-formed and stable enough
// for a prototype; swap in a real XML parser if it ever bites you.
const items = [...xml.matchAll(/<item>([\s\S]*?)<\/item>/g)].map((m) => m[1]);
const pick = (block, tag) => {
  const m = block.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`));
  if (!m) return undefined;
  return decode(m[1].replace(/^<!\[CDATA\[/, "").replace(/\]\]>$/, "").trim());
};

const results = [];
for (const it of items) {
  const filmTitle = pick(it, "letterboxd:filmTitle") || pick(it, "title");
  const year = pick(it, "letterboxd:filmYear");
  const rating = pick(it, "letterboxd:memberRating"); // e.g. "4.5"
  const pubDate = pick(it, "pubDate");
  const link = pick(it, "link");
  if (!filmTitle || !pubDate) continue;
  results.push(await writeEntry({
    date: new Date(pubDate),
    section: "watched",           // default label "Film"
    title: filmTitle,
    year: year ? Number(year) : undefined,
    rating: rating ? Math.round(Number(rating)) : undefined,
    external: link,
    hasSummary: false,
  }));
}
await report("letterboxd", results);
