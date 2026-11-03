# Changelog

## Unreleased

- Web UI rewritten on top of the original warm-theme design: one batch file slot,
  merge/independent switch, format chips, live preview, stats and merge report
- Chapter template default is now `## [第 {num} 章]　{title}`; the `##` is treated
  as a Markdown marker, so DOCX/PDF/EPUB get a real heading instead of a literal
  hash sign
- `sectionPrefix` option: text output can mark sections differently from chapters
- Browser build refuses DOCX/EPUB/PDF input with a clear message instead of
  producing garbage

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