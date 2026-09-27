# The format specification site

`todopi.com/spec` is a static rendering of `spec/`: the specification, the field table, the implementer notes and the test corpus. The Markdown in `spec/` is normative; the site is generated from it and never edited by hand.

## Build and preview

```sh
make site                         # or: node tools/site/build.mjs [output-dir]
open .site/spec/index.html        # any browser; plain files, no server needed
```

The output is `.site/spec/` (ignored by git). It has no scripts and loads nothing from other hosts — no fonts, no stylesheets, no analytics — and every link is relative, so it works from `file://` and under any path prefix.

| Page | Source |
|---|---|
| `index.html` | `spec/todopi-format-v1.md` |
| `fields.html` | §5.2 of the specification (the twelve fields) |
| `implementing.html` | `spec/IMPLEMENTING.md` |
| `fixtures/index.html` | `spec/fixtures/README.md`, plus one row per fixture |
| `fixtures/<valid\|invalid>/<name>.html` | the fixture and its expected result; the `.md` and `.json` files are copied next to it for download |

`tests/site.test.ts` builds the site and checks that the pages exist, the field table has twelve rows, every fixture has a page and a byte-identical download, every internal link and `#anchor` resolves, and no page loads an outside resource.

## Deploy (maintainer)

Publishing is the maintainer's action; nothing in this repository deploys.

1. Build from the commit being released: `git checkout v<version> && npm ci && make site`.
2. Upload the contents of `.site/spec/` to the `/spec/` path of the site's static host, replacing what is there (the build removes stale pages locally, so a sync with deletion keeps the host identical).
3. Check `https://todopi.com/spec/` and `https://todopi.com/spec/fixtures/`.

Rebuild and upload whenever `spec/` changes on the release branch — a revision under §9.1, a new fixture, a new note in `IMPLEMENTING.md`.
