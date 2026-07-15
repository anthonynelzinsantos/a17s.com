---
title: ""
# The slug is the UNIX epoch (seconds) of the date: fixed length (10 digits).
# If you change the date below, regenerate the slug so it still matches.
slug: "{{ (time.AsTime .Date).Unix }}"
date: {{ .Date }}
on: "Album"        # Album | Podcast | Concert
artist: ""
by: ""             # same value as "artist"
about: []          # genres
from: []           # country of origin
# rating: 5
external: ""
hasSummary: false
---
