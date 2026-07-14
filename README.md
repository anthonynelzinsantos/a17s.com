# Anthony's Archive — prototype

A permanent, self-contained archive of everything: books, films & TV, music,
places, photos. One reverse-chronological timeline, but every item lives at its
own URL under a media-type section. Built with Hugo.

## The idea in one sentence

The media type *is* the content section, so an item is a Markdown file at
`content/<section>/<slug>.md` and lives at `/<section>/<slug>/` — a real,
permanent page you land on *before* any external source.

## Sections

| Section         | URL             | Default item label |
| --------------- | --------------- | ------------------ |
| `read`          | `/read/`        | Book               |
| `watched`       | `/watched/`     | Film               |
| `listened`      | `/listened/`    | Album              |
| `visited`       | `/visited/`     | Place              |
| `photographed`  | `/photographed/`| Photo              |

Add a section by creating `content/<name>/_index.md` with `weight`, `icon` and
`itemLabel` params — the nav and per-item labels pick it up automatically.

## Entry schema

```yaml
---
title: "Pachinko"            # required
slug: "min-jin-lee-pachinko" # required — the URL segment (creator + title); importers auto-generate it
date: 2026-07-08T00:00:00+02:00   # required — when it happened
label: "Article"             # optional — overrides the section's item label (e.g. TV, Album)
author / artist / director:  # optional creator line (author=read, director=watched, artist=listened)
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

Files are named `YYYYMMDD_<slug>.md` (the date is the item's original date, for
on-disk ordering) but the URL comes from the `slug` field — so URLs stay clean:
`20260708_min-jin-lee-pachinko.md` → `/read/min-jin-lee-pachinko/`. The slug
always leads with the **main creator** (author / director / artist) then the
title, so same-titled works by different creators never collide. `writeEntry`
generates all of this; on a repeat it keeps the original date-prefix (renaming
if an earlier occurrence turns up).

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
LASTFM_API_KEY=xxx LASTFM_USER=you node scripts/fetch-lastfm.mjs        # → content/listened/ (recent, API)
node scripts/import-lastfm.mjs ~/Downloads/recenttracks-you.csv        # → content/listened/ (full history, CSV)
LETTERBOXD_USER=you node scripts/fetch-letterboxd.mjs                   # → content/watched/ (recent ~50)
node scripts/import-letterboxd.mjs ~/Downloads/letterboxd-you-export/  # → content/watched/ (full history)
node scripts/import-storygraph.mjs ~/Downloads/storygraph_export.csv   # → content/read/
```

Photos and notes are written by hand into the matching section.

### Films: RSS vs. export

The Letterboxd **RSS** feed only reaches your ~50 most recent films — use it as
the daily incremental updater (in the GitHub Action). The **CSV export**
(`import-letterboxd.mjs`, reads the unzipped `diary.csv` + `reviews.csv`) is the
one-time full backfill: it dates each film by its *Watched Date*, folds in your
star ratings and reviews, and tags `Rewatch` entries `re-watched`.

### Music is albums, not tracks

`/listened/` is albums. Both the API fetcher (`fetch-lastfm.mjs`, recent plays)
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

## Repeats (re-reads, rewatches, re-listens)

An item has one permanent URL. When a fetcher sees the same slug again, it does
**not** create a second page — it keeps the original `date`, sets `updated` to
the most recent occurrence, and adds a section-appropriate tag
(`re-read` / `re-watched` / `re-listened` / `re-visited`). That tag gets its own
browsable page (e.g. `/tags/re-listened/` — "things I returned to"). The item
holds its original position in the timeline; a `↻` marks it as revisited.

This is all in `writeEntry` (`scripts/lib.mjs`) and is idempotent: re-running a
fetcher over the same history is a no-op.

## Known prototype shortcuts (revisit later)

- The Letterboxd RSS parse is a regex, not a full XML parser — fine for that
  stable feed, swap it if it ever breaks.
