# Anthony's Archive — prototype

A permanent, self-contained archive: music, books, films. One reverse-chronological
timeline, but every item lives at its own URL under a media-type section.
Built with Hugo.

## The idea in one sentence

The media type *is* the content section, so an item is a Markdown file at
`content/<section>/<slug>.md` and lives at `/<section>/<slug>/` — a real,
permanent page you land on *before* any external source.

## Sections

Folders keep the readable category names; the short URLs come from `[permalinks]`
in the config (both `permalinks.section` and `permalinks.page`), so the folder
name and the URL slug stay decoupled:

| Folder (`.Section`) | URL   | Item label | Repeat verb  |
| ------------------- | ----- | ---------- | ------------ |
| `Listened`          | `/l/` | Album      | Re-listened  |
| `Read`              | `/r/` | Book       | Re-read      |
| `Watched`           | `/w/` | Film       | Re-watched   |

Code that keys off the section (the importers' `section` arg, `CREATOR` and the
repeat-tag map in `lib.mjs`) uses these folder names.

## Faceted taxonomies

Four taxonomies (plus `tags`) classify every item. Their URL slugs are prefixed
with `~` so they don't collide with the one-letter section URLs:

| Taxonomy | Front matter | URL     | Meaning                               |
| -------- | ------------ | ------- | ------------------------------------- |
| `on`     | `on:`        | `/~o/`  | format — Album, Film, Ebook, …        |
| `by`     | `by:`        | `/~b/`  | creator — artist / author / director  |
| `about`  | `about:`     | `/~a/`  | genre                                 |
| `from`   | `from:`      | `/~f/`  | country of origin (entered by hand)   |

`on` is shown as the item's label next to the section icon (lists) and above the
title (single); `about` follows it after a `/`; the `by` creator in the single-page
heading links to its term page; `from` shows at the foot of the page with 📍.

Note: a `$` prefix was the original idea, but Hugo strips `$` from URLs, so `~` is
used instead. To change it, edit `[permalinks.taxonomy]` / `[permalinks.term]` in
`hugo.toml`.

Add a section by creating `content/<name>/_index.md` with `weight`, `icon` and
`itemLabel` params — the nav and per-item labels pick it up automatically.

## Entry schema

```yaml
---
title: "Pachinko"            # required
slug: "1704412800"           # required — UNIX epoch (s) of `date`; importers auto-generate it
date: 2026-07-08T00:00:00+02:00   # required — when it happened
on: "Ebook"                  # format taxonomy — also the item's label
by: "Min Jin Lee"            # creator taxonomy (same value as author/artist/director)
about: ["drama"]             # genre taxonomy
from: ["Korea"]              # country of origin (by hand)
author / artist / director:  # creator (author=Read, director=Watched, artist=Listened)
year: 2023
rating: 5                    # optional, 1–5, renders as stars
updated: 2026-07-20T22:00:00+02:00  # set automatically on a repeat (see below)
featured: true               # optional — break out into a full-width image card
image: img/cover.svg         # shown on featured cards and the item page
external: "https://…"        # optional — the outbound source, ONLY on the item page
tags: ["japan"]              # optional, cross-media
hasSummary: false            # hide the body text from listings
---
Body / note in Markdown.
```

### File naming & slugs

Both the file name and the `slug` are the **UNIX epoch in seconds of the item's
original date**, so every URL is the same length (10 digits):
`content/Read/1704412800.md` → `/r/1704412800/`.

Seconds match the real precision of the sources — Last.fm scrobbles are
second-granular and books/films are dated to the day — so sub-second digits would
be pure zero-padding. (Slugs are 10 digits for any date from 2001-09-09 to 2286.)

Books and films are dated to the day (midnight), so two items can land on the
same second; `writeEntry` walks the epoch forward (+1 s) until it's free.

Because the file name is opaque, `writeEntry` matches an item for repeats by a
**content identity** (creator + title, via `makeSlug`) read from each file's
front matter, not by the file name. If an earlier occurrence turns up, the
canonical date moves back and the file/slug follow it. Enrichment never renames
a file — the epoch depends only on the date.

### Creating entries by hand

`archetypes/` has one archetype per section. The slug is generated from the date
with `.Unix`:

```bash
hugo new content "Read/1704412800.md"   # name the file with the epoch too
```

Note `.Date` is a *string* in archetypes, hence `{{ (time.AsTime .Date).Unix }}`.
If you change the `date` afterwards, regenerate the slug so it still matches.

### Display

On lists, the creator shows in gray after the title (uniform across all media).
On an item page, the heading is `Creator – Title` and the creator is folded into
the `<title>` tag for SEO/search.

- **Default** entries render as a compact row (type · title … date).
- **`featured: true`** entries grow into a full-width card with `image`.
- The `external` link never appears in a listing — only on the item's own page.
  This site is an archive, not a table of contents for other sites.

## Run it

```bash
hugo server    # dev preview
hugo           # build to ./public
```

## Ingestion (the automated half)

Each script emits the same entry files into the right section and is safe to
re-run (it skips anything already imported).

```bash
LASTFM_API_KEY=xxx LASTFM_USER=you node scripts/fetch-lastfm.mjs        # → content/Listened/ (recent, API)
node scripts/import-lastfm.mjs ~/Downloads/recenttracks-you.csv        # → content/Listened/ (full history, CSV)
LETTERBOXD_USER=you node scripts/fetch-letterboxd.mjs                   # → content/Watched/ (recent ~50)
node scripts/import-letterboxd.mjs ~/Downloads/letterboxd-you-export/  # → content/Watched/ (full history)
node scripts/import-storygraph.mjs ~/Downloads/storygraph_export.csv   # → content/Read/
```

Photos and notes are written by hand into the matching section.

### Films: RSS vs. export

The Letterboxd **RSS** feed only reaches your ~50 most recent films — use it as
the daily incremental updater (in the GitHub Action). The **CSV export**
(`import-letterboxd.mjs`, reads the unzipped `diary.csv` + `reviews.csv`) is the
one-time full backfill: it dates each film by its *Watched Date*, folds in your
star ratings and reviews, and tags `Rewatch` entries `re-watched`.

### Music is albums, not tracks

`/l/` (Listened) is albums. Both the API fetcher (`fetch-lastfm.mjs`, recent plays)
and the CSV importer (`import-lastfm.mjs`, full history export) share the same
rollup: they group scrobbles by album and
clusters them into listening *sessions* (a run of tracks with no gap bigger than
`LASTFM_SESSION_GAP_HOURS`, default 6). Each session is one album listen; a
sitting with fewer than `LASTFM_MIN_TRACKS` (default 3) tracks doesn't count.
Playing an album again another day is a separate session → a re-listen.

## Automated deploys (GitHub Actions)

`.github/workflows/archive.yml` runs daily: it fetches, commits any new entries
back to the repo (the Markdown *is* the archive), builds with Hugo, and deploys
to GitHub Pages. To turn it on:

1. **Settings ▸ Pages** → Source: **GitHub Actions**.
2. **Settings ▸ Secrets and variables ▸ Actions** → add the ones you want:
   `LASTFM_API_KEY`, `LASTFM_USER`, `LETTERBOXD_USER`. Missing secrets are
   skipped, so you can enable sources one at a time.
3. Set `baseURL` in `hugo.toml` to your real domain.

StoryGraph has no API, so books stay a manual step: export the CSV, run the
importer locally, commit.

## Film directors & genres

`scripts/enrich-films.mjs` backfills `director` + `genres` onto every film.
TMDb's API needs a key, but Letterboxd sources its data from TMDb and exposes it
on each public film page — so the enricher fetches each film's stored Letterboxd
URL and reads the director (JSON-LD) and genres (page metadata), no key needed.
Genres are a browsable taxonomy (`/genres/drama/`), and the director then leads
the film's slug (`/watched/adam-mckay-the-big-short/`).

## Repeats (re-reads, rewatches, re-listens)

An item has one permanent URL. When a fetcher recognises the same item again (by
its content identity — creator + title), it does **not** create a second page —
it keeps the original `date`, sets `updated` to the most recent occurrence, and
adds a section-appropriate tag (`re-read` / `re-watched` / `re-listened`). That
tag gets its own browsable page (e.g. `/tags/re-listened/` — "things I returned
to"). The item
holds its original position in the timeline; a `↻` marks it as revisited.

This is all in `writeEntry` (`scripts/lib.mjs`) and is idempotent: re-running a
fetcher over the same history is a no-op.

## Known prototype shortcuts (revisit later)

- The Letterboxd RSS parse is a regex, not a full XML parser — fine for that
  stable feed, swap it if it ever breaks.
