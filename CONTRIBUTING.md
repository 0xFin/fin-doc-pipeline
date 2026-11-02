# Contributing

Thanks for taking a look. This project deliberately has **zero third-party dependencies**, and keeping it that way is the main design constraint.

## Development

```sh
git clone https://github.com/0xFin/fin-doc-pipeline.git
cd fin-doc-pipeline
node test/run.mjs      # 88 checks, no install step
node src/cli.mjs --help
```

Node.js 18 or newer. There is nothing to install: `node_modules` never exists.

## Ground rules

1. **No dependencies.** Use Node built-ins (`node:zlib`, `node:crypto`, `node:fs`). ZIP, OOXML, EPUB and PDF are implemented in-repo for this reason.
2. **Never lose content silently.** If something is dropped, renamed or deduplicated, record it in the report object.
3. **Reports stay out of the book.** Provenance belongs in `.report.md`, never in the output document.
4. **Destructive actions are opt-in.** Source deletion needs `--clean-sources --yes` and goes to the trash.
5. **Tests first.** Every behaviour change needs a check in `test/run.mjs`; the runner is homemade on purpose.

## Adding a format

- **Input**: add a loader under `src/loaders/`, register the extension in `src/loaders/index.mjs` (`CONTAINER_FORMATS`, `MARKUP_FORMATS` or `PLAIN_FORMATS`).
- **Output**: add a writer under `src/formats/`, then register it in `SUPPORTED_FORMATS` and the `renderFormat()` switch in `src/converters.mjs`.
- Both registries feed the CLI help and validation, so a single registration is enough.

## Adding a heading rule

Rules live in `src/rules.mjs`. Implement `RULE_IMPL.<id>(line, ctx)` returning `null` or a `hit(kind, level, marker, extra)` object, then add the id to `DEFAULT_RULES`. Keep the function pure: detection must not depend on document state other than `ctx`.

## Commit messages

Conventional Commits (`feat:`, `fix:`, `docs:`, `test:`, `refactor:`). Keep the subject in the imperative mood.

## Reporting bugs

A useful report includes: the command you ran, the detected encoding from `inspect --json`, and the smallest text sample that reproduces the problem. Please do not attach copyrighted books.
