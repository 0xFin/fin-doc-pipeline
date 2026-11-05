---
name: fin-doc-pipeline
description: 'Universal text-document pipeline for cleaning, de-duplicating, auditing and typesetting plain text and whole books, with import from txt, Markdown, HTML, RTF, DOCX, EPUB, PDF, JSON, YAML, XML, CSV and JavaScript, and export to txt, Markdown, HTML, JSON, YAML, XML, CSV, JS, RTF, DOCX, EPUB or PDF. Use when the user wants to (1) merge several files of the same book and keep the most complete copy of each chapter, (2) repair garbled text or a wrongly detected encoding (GBK/GB18030/Big5/UTF-16 mojibake), (3) reformat a novel or manuscript (chapter titles, indentation, blank lines, punctuation), (4) audit text for duplicate or missing chapters, half-width punctuation, unbalanced quotes, invisible characters or site boilerplate, (5) convert a text document into an ebook, a Word file or a PDF, or (6) open an existing docx/epub/pdf and rebuild it in another format. Runs fully offline with zero dependencies. Every command supports --json and --dry-run. Keywords — 文本排版, 合并, 去重, 编码, 乱码, 章节, 小说, 校对, 格式转换, 电子书, 转 docx, 转 epub, 转 pdf.'
---

# Text Forge

A dependency-free Node CLI that turns messy real-world text into a clean,
consistently typeset document. It exists because a page-based tool silently
turned a 200 KB GBK novel into Big5 mojibake after a single invalid byte.

## Locating the script

Everything lives in this skill directory. Use paths resolved against it:

    node <skill-dir>/src/cli.mjs --help

If installed as a command (`npm link`), call `fin-doc-pipeline` directly.
Requires Node.js 18+. No packages to install.

## Installing and refreshing

Copy the directory into a scanned skills root. Discovery happens within a few
seconds and the **model** catalog refreshes on its own, so the agent can call the
skill immediately.

The **`/` menu in the web UI is cached per session** and only refreshes when the
agent preset changes, a plugin toggles, or the page reconnects. After installing
a new skill, reload the page (Cmd+R / Ctrl+R) before expecting it in the slash
menu.

    cp -R fin-doc-pipeline ~/.dsh/skills/

Scanned roots: `<project>/.dsh/skills`, `<project>/.agents/skills`,
`~/.dsh/skills`, `~/.agents/skills`.

The frontmatter must be valid YAML. An unquoted `description` that contains a
colon followed by a space makes the YAML invalid, and the skill is then skipped
silently with only a log warning. Keep the description quoted.

## Input formats

| Input | Handling |
| --- | --- |
| `.txt` `.md` | encoding is auto detected and scored |
| `.json` `.yaml` `.xml` `.csv` `.js` `.ts` | decoded as text, structure preserved verbatim |
| more plain formats | `rst ini conf cfg log srt ass tex org jsonl tsv jsx tsx` |
| `.html` `.htm` | tags removed, headings become chapter lines, `<title>` becomes the book title |
| `.rtf` | control words removed, unicode escapes decoded |
| `.docx` | unpacked from OOXML; Heading 1 / Title paragraphs become chapter lines |
| `.epub` | unpacked from the container; spine order defines reading order |
| `.pdf` | text extracted from content streams, including ToUnicode maps when present |

DOCX, EPUB and PDF input also yields title/author metadata, so `--meta-title` and
`--meta-author` are usually unnecessary when converting between formats.

PDF extraction cannot recover text from scanned pages or fonts without a usable
ToUnicode map; it fails with a clear error instead of returning noise.
## Installing with npm

```sh
npm install -g fin-doc-pipeline       # once published
npm install -g .                      # from a checkout
npx fin-doc-pipeline install-skill    # copy into ~/.dsh/skills

fin-doc-pipeline install-skill --dest ~/.claude/skills
fin-doc-pipeline install-skill --link     # symlink instead of copy
fin-doc-pipeline install-skill --uninstall
```

`install-skill` works after a global install and copies the package into a
skills root, so the same command serves both the CLI and the agent skill.

## When to use this skill

- Merging several files that claim to be the same book (分卷 / 多个来源 / 不同版本)
- Garbled text: "第01章" rendering as "菴01梒", or boxes and question marks
- Normalising a manuscript: chapter headings, indentation, blank lines
- Auditing: duplicate or missing chapters, half-width punctuation, unbalanced
  quotes, invisible characters, site boilerplate
- Converting a text document to Markdown or HTML

Do not use it for Office formats (docx/xlsx/pptx) or PDF.

## Commands

| Command | Purpose |
| --- | --- |
| `inspect` | Read-only report: encoding, structure, chapter numbers, issues |
| `format` | Clean and typeset **one** file |
| `merge` | De-duplicate and merge **several** files, then typeset |
| `check` | Audit content; `--fix` writes a repaired copy |
| `convert` | Convert to `txt`, `md`, `html`, `rtf`, `docx` or `epub` |

### inspect — always start here

    node src/cli.mjs inspect book.txt --json

Per file it reports `encoding`, `encodingConfidence`, `encodingCandidates`,
`chapters`, `groups`, `specials`, `volumes`, `duplicates`, `missing`, `issues`.
Read the candidate list before trusting a decode.

### format — one file

    node src/cli.mjs format book.txt -o out.txt

Default title template is `[第{num}章]`, three-digit zero padding, a full-width
space before the subtitle, and two full-width spaces of paragraph indent.

### merge — several files

    node src/cli.mjs merge part1.txt part2.txt part3.txt -o book.txt

Two modes; choosing wrongly loses content:

- `--merge-mode versions` (default) assumes **one book**. Chapters are matched
  by `(group, number)` and the most complete copy wins. Correct for volumes,
  duplicate downloads, draft plus final.
- `--merge-mode concat` assumes **different books**. Every chapter is kept in
  order and nothing competes. Use it for collections, or when a file is a
  sequel whose numbering restarts at 1.

The report warns when many same-numbered chapters have different titles, which
usually means the files are not versions of one book.

Per-chapter provenance is written to `<output>.report.md`. It is **never**
embedded in the book, because it would ruin reading.

### check — audit and repair

    node src/cli.mjs check book.txt
    node src/cli.mjs check book.txt --fix -o fixed.txt

Rules: `T001` replacement chars, `T002` invisible, `T003` control, `T004`
placeholder glyphs, `T005` half-width punctuation after Chinese, `T006`
ellipsis, `T007` dash, `T008` quotes per chapter, `T009` brackets per chapter,
`T010` duplicate paragraphs, `T011` empty chapter, `T012` duplicate chapter
numbers, `T013` missing chapters, `T015` site boilerplate, `T016` full-width
alphanumerics, `T017`/`T018` whitespace, `T019` oversized paragraph, `T020`
very short chapter. Raw-text rules: `R001` BOM, `R002` line endings, `R003`
blank-line runs, `R004` trailing space, `R005` tab indent.

Simplified Chinese proofreading adds `C001` traditional characters, `C002`
punctuation width and corner brackets, `C003` repeated punctuation, `C004`
English casing, `C005` date format, `C006` common misspellings, `C007`
repeated particles, `C008` generated chapter titles and `C009` wording hints.
`C001`–`C007` are safe and run with `--fix`; `C008` needs `--auto-titles`;
`C009` is report only.

`--fix` applies only safe repairs. Content rewriting (punctuation, full-width
digits, boilerplate removal) requires `--rules`.

### proofread — Simplified Chinese rules

    node src/cli.mjs format book.txt --proofread -o out.txt   # everything
    node src/cli.mjs format book.txt --simplify -o out.txt    # characters only
    node src/cli.mjs format book.txt --auto-titles -o out.txt # titles only

| Rule | What it does |
| --- | --- |
| `C001` | Traditional → Simplified. 乾/著/瞭/藉 are context corrected: 乾隆, 乾坤, 著作, 瞭望, 慰藉 stay, 乾杯→干杯, 著急→着急, 藉口→借口 |
| `C002` | 「」『』 become “”‘’; half-width `, ; : ? ! ( )` next to Chinese become full-width |
| `C003` | repeated identical punctuation collapses to one; `……` is preserved |
| `C004` | numbers and English words go half-width, plain words are capitalised, known acronyms and product names are upper case (KFC, USD, USDT, iPhone) |
| `C005` | dates unify to `yyyy-MM-dd HH:mm`: 2024年3月5日 12:30 → 2024-03-05 12:30 |
| `C006` | built-in misspelling list: 按耐→按捺, 既使→即使, 迫不急待→迫不及待 … |
| `C007` | doubled particles and words: 的的→的, 看看看看 flagged |
| `C008` | untitled chapters get a title from their first paragraph, at most 6 characters |
| `C009` | wording hints (大约…左右, 原因是…造成的, 通过…使…), report only |

The chain is deterministic and idempotent: a second run changes nothing.
Word order and semantics are not rewritten automatically; `C009` reports them
instead of guessing. Use `check --fix-rules C001,C002` for individual rules.

### convert — other formats

    node src/cli.mjs convert book.txt --to md
    node src/cli.mjs convert book.txt --to epub,docx,pdf -o out
    node src/cli.mjs merge a.txt b.txt -o book.txt --to epub

| Format | What you get |
| --- | --- |
| `txt` | typeset plain text, UTF-8 |
| `md` | Markdown with chapter headings |
| `html` | standalone printable HTML |
| `json` `yaml` `xml` `csv` `js` | the parsed document as data (meta + chapters + paragraphs) |
| `rtf` | rich text that any word processor opens |
| `docx` | Word document, centred headings, indented body, page break per chapter |
| `epub` | EPUB 3 with navigation document and NCX fallback |
| `pdf` | A5 PDF with centred headings, justified body and automatic page numbers |

Any comma separated combination is allowed in one command. Aliases: `yml` →
`yaml`, `htm` → `html`, `mjs` → `js`, `tsv` → `csv`.

The output name always differs from every input name. If they would collide,
a `.out` marker is inserted before the extension (`book.txt` →
`book.out.txt`), so a conversion can never overwrite its source.
## Heading detection

Detection is a pipeline of named rules; the first match wins. Default order:

    manual, markdown, numbered-cn, numbered-en, cn-list, ordered, bracket, special, heuristic

| Rule | Matches | Kind |
| --- | --- | --- |
| `manual` | exact lines listed with `--headings-file` | chapter |
| `markdown` | `#` .. `######` (also what docx/epub/html loaders emit) | chapter / section by depth |
| `numbered-cn` | 第12章, 第十二回, 第3节, 第一卷 | chapter / section (节) / volume |
| `numbered-en` | Chapter IV, Part II, Section 3, Prologue | chapter / volume / section |
| `cn-list` | 一、总则, （三） | section |
| `ordered` | 1. 范围 ／ A. 简介 | section |
| `bracket` | [楔子] 【后记】 | special |
| `special` | 前言 ／ 尾声 ／ 番外 | special |
| `heuristic` | short line surrounded by blank lines (opt in) | chapter |

Control them with flags:

    --rules markdown,numbered-en          # only these rules
    --heading-regex "^◆ (.+)$"            # custom regex (|| separates several)
    --headings-file headings.txt          # authoritative list, one per line
    --heuristic-headings                  # opt in to the guess based rule
    --md-title-level 1 --md-chapter-level 2 --md-section-level 3

Markdown level mapping is how you say "my H1 is the book title, H2 is a
chapter, H3 is a section". Without mapping, depth 1 is a chapter and deeper
levels are sections.

## Chapters and sections

A section is a sub heading that belongs to the chapter above it. 第3节,
a `###` heading, 一、 and 1. all produce sections. They never start a new
page or a new ebook document, they get their own template, and they are
nested under their chapter in JSON/YAML/XML output.

When a heading has no recognisable number (a plain Markdown heading, a titled
essay), `unnumberedTitle` is used instead of inventing a chapter number.

## Customising titles

| Option | Default | Applies to |
| --- | --- | --- |
| `--title` | `[第{num}章]` | numbered chapters |
| `--unnumbered-title` | `{title}` | chapters without a number |
| `--group-title` | `[{prefix}第{num}章]` | prefixed groups such as 番外 |
| `--section-title` | `{title}` | sections |
| `--volume-title` | `[第{num}卷]` | volumes |
| `--special-title` | `[{title}]` | 前言 / 楔子 / 后记 |
| `--heading-prefix` | empty | literal prefix on every heading |
| `--heading-suffix` | empty | literal suffix on every heading |
| `--title-sep` | full-width space | between heading and subtitle |
| `--md-heading` | `auto` | markdown markers: auto / none / preserve / level:N |

Placeholders: `{num}`, `{num:4}`, `{title}`, `{prefix}`,
`{unit}` (章/回/节), `{raw}` (the original line).

    --title "## [第{num}章] {title}"     # literal ## in text output
    --md-heading auto                    # ## for chapters, ### for sections (md only)
    --heading-prefix "§ "                # decorate every heading

For Markdown output the marker is produced by `--md-heading`, not by
embedding `#` in the template: that keeps docx/pdf/epub output free of literal
hashes while giving you exactly the Markdown you asked for.
## Recipes

### "## [第 001 章] 标题" in Markdown

    fin-doc-pipeline convert book.txt --to md \
      --title "[第 {num} 章]" \
      --title-sep " " \
      --no-doc-title \
      -o out

That produces exactly:

    ## [第 001 章] 开端

Three separate pieces are at work:

| Piece | Flag | Why |
| --- | --- | --- |
| `##` marker | `--md-heading auto` (default) | a Markdown heading marker, not a literal character |
| [第 001 章] | `--title` | the template, spaces included |
| one half-width space | `--title-sep " "` | the separator before the subtitle |

Do not put `##` inside `--title` when the target is Markdown: the marker
would be emitted twice, and docx/pdf/epub would receive a literal hash sign.

### The same look in plain text

Plain text has no heading structure, so add the hash literally:

    fin-doc-pipeline convert book.txt --to txt \
      --title "[第 {num} 章]" --title-sep " " --heading-prefix "## " -o out

### Force every heading to level 2

    --md-heading level:2

### Keep the source heading levels

    --md-heading preserve

### Save the whole style as a config file

Put `fin-doc-pipeline.config.json` in the working directory:

    {
      "format": {
        "chapterTitle": "[第 {num} 章]",
        "titleSeparator": " ",
        "mdHeading": "auto"
      }
    }

Then every later command picks it up:

    fin-doc-pipeline convert book.txt --to md --no-doc-title -o out

Command line flags always win over the config file.

### Other heading kinds

    --group-title "[{prefix}第 {num} 章]"   # 番外 chapters
    --section-title "§ {title}"             # sections
    --volume-title "第 {num} 卷"            # volumes
    --unnumbered-title "{title}"            # headings with no number

## Presets and options

- `--preset novel` (default) full chapter parsing
- `--preset plain` / `article` no chapter parsing, paragraphs only
- `--indent "<chars>"`, `--no-indent`
- `--title "[第{num}章]"` placeholders `{num}` and `{prefix}`
- `--num-width 3`, `--blank-before 1`, `--blank-after 1`
- `--reflow` join soft-wrapped lines (destructive, opt in)
- `--normalize` normalise punctuation (destructive, opt in)
- `--encoding`, `--bom` / `--no-bom`, `--eol lf|crlf`

## Safety rules

- Nothing is written without an output path; `--dry-run` writes nothing.
- Sources are deleted only with `--clean-sources`, which also requires `--yes`.
  Deletion moves files to the system trash; `--hard-delete` is permanent.
- Deletion runs only after the output has been written and re-parsed.
- The merge report always records which source won each chapter.

## Encoding troubleshooting

Detection scores every candidate (`utf-8`, `utf-16le`, `utf-16be`, `gbk`,
`gb18030`, `big5`) instead of taking the first that does not throw. If the
result still looks wrong:

1. Run `inspect --json` and read `encodingCandidates`.
2. Check the decoded sample in the same JSON.
3. For double-encoded files the reliable manual fix is:

       iconv -f BIG5 -t UTF-8 broken.txt | iconv -f UTF-8 -t BIG5 | iconv -f GB18030 -t UTF-8

## Deliberate limits

- Does not delete characters that may be meaningful (`■`, `□`, `＊` are
  reported, not removed).
- Does not merge chapters sharing a number inside one file: those are treated
  as 上/中/下 parts and kept.
- No cover images: DOCX and EPUB output are text only.
- PDF uses the standard CJK mechanism (@@UniGB-UCS2-H@@ + @@STSong-Light@@), so the
  viewer substitutes a system Song/Ming font. Text stays selectable, but exact
  glyph shapes and punctuation spacing follow that font.
- PDF is A5 and text only: no images, no cover, no running headers or page numbers.
- No network access.

## Repo layout

    src/encoding.mjs    score based encoding detection
    src/parser.mjs      document tree, chapter and group recognition
    src/typography.mjs  cleaning, title templates, assembly
    src/merge.mjs       file / chapter / paragraph dedupe
    src/lint.mjs        rules and safe repairs
    src/chinese.mjs     Simplified Chinese rules and chapter title synthesis
    src/data/t2s.mjs    traditional → simplified table (generated, checked in)
    src/converters.mjs  Markdown and HTML output
    src/cli.mjs         command line interface
    test/run.mjs        dependency free test suite