# Changelog

## 0.6.0 — 2026-11-05

- Simplified Chinese proofreading, one switch: `--proofread`
  - `C001` traditional → simplified, from a CLDR derived character table with
    phrase guards for 乾/著/瞭/藉 (乾隆, 著作, 瞭望, 慰藉 keep their form)
  - `C002` 「」『』 become “”‘’; half-width punctuation and parentheses next to
    Chinese become full-width
  - `C003` repeated identical punctuation collapses to one, `……` is preserved
  - `C004` numbers and English words are half-width, plain words capitalised,
    known acronyms and product names upper case (KFC, USD, USDT, iPhone)
  - `C005` dates unify to `yyyy-MM-dd HH:mm`
  - `C006` built-in list of common misspellings (按耐→按捺, 既使→即使…)
  - `C007` doubled particles and words (的的 → 的)
  - `C008` untitled chapters get a generated title from their first paragraph,
    at most 6 characters; `--auto-titles` runs only this rule
  - `C009` wording hints (大约…左右, 原因是…造成的, 通过…使…), report only
- `--simplify` converts characters only; `check --fix-rules` accepts the C rules
- Web UI exposes both switches; the single file page grows to 199 KB
- 109 tests, 14 of which cover the new rules
- Pushing a `v*` tag now publishes the GitHub release and the npm package
  automatically (`.github/workflows/release.yml`), and CI re-creates a missing
  release from `CHANGELOG.md`; CI also keeps the repository description and
  homepage in sync

## 0.5.0 — 2026-11-04

- `index.html` is now one self contained file: the whole browser build
  (encoding detection, parser, merger, linter, typesetters, all twelve writers
  and the Buffer polyfill) is inlined into a single classic `<script>`, so the
  page runs from `file://` with no server, no network and no CORS errors, and
  can be bookmarked like any other page
- Sources moved to `web/index.template.html` + `web/app.mjs`;
  `scripts/build-web.mjs` regenerates `index.html` (`npm run build`, or
  `node scripts/build-web.mjs --check` in CI)
- The old `file://` warning is replaced by a watchdog: if the bundle ever fails
  to run the page says so and explains how to rebuild it
- `index.html` and `web/` now ship in the npm package
- `start.command` is optional: it is only useful for a stable `http://` address
- 95 tests, four of which cover the generated single file

## 0.4.0 — 2026-11-03

- Web UI rebuilt on the original warm-theme design: one batch file slot, merge
  or independent processing, format chips, live preview, stats and merge report
- A single 「下载文档」 button next to 「开始处理」 that appears after a run
- Chapter template default is `## [第 {num} 章]　{title}`; the `##` is treated as a
  Markdown marker, so DOCX/PDF/EPUB get real headings instead of a literal hash
- `sectionPrefix` lets text output mark sections separately from chapters
- Browser build refuses DOCX/EPUB/PDF input with a clear message
- `start.command` launcher; the page explains the `file://` module restriction
  instead of silently ignoring clicks, and the theme toggle no longer depends on
  the module bundle
- Fix merge ordering: a single source is passed through untouched and multi-file
  merges follow the most complete source, so `全文完` no longer jumps to the front
  and volumes no longer precede chapter 1

## 0.3.1

- Simplified Chinese is now the default README; English moved to `README.en.md`
- Centred header with CI, npm, downloads, license and Node badges on both READMEs
- Added table of contents, capability table, format matrix and heading rule table

## 0.3.0

- Configurable heading detection: `manual`, `markdown`, `numbered-cn`, `numbered-en`, `cn-list`, `ordered`, `bracket`, `special`, `heuristic`
- Chapters and sections with separate templates and correct nesting in every output
- Markdown level mapping (`--md-title-level`, `--md-chapter-level`, `--md-section-level`)
- Custom heading regex, `--headings-file`, optional heuristic detection
- Global `--heading-prefix` / `--heading-suffix`, `--md-heading` modes
- `--unnumbered-title` for headings without a number
- PDF output with automatic page numbers
- Input: HTML, RTF, PDF, JSON, YAML, XML, CSV, JS and more
- Output: JSON, YAML, XML, CSV, JS, RTF, DOCX, EPUB, PDF
- `--no-doc-title`, `convert.includeDocTitle` in config
- Fixed: every `--no-*` flag was ignored (argument parser strips the prefix)

## 0.2.0

- PDF output with embedded CJK text
- DOCX and EPUB as input
- `install-skill` command and npm packaging

## 0.1.0

- `inspect`, `format`, `merge`, `check`
- Score based encoding detection
- Three-level dedupe, `versions` and `concat` merge modes
- TXT, Markdown, HTML, RTF, DOCX and EPUB writers