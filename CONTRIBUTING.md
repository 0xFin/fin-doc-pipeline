# Contributing

Thanks for taking a look. This project deliberately has **zero third-party dependencies**, and keeping it that way is the main design constraint.

## Development

```sh
git clone https://github.com/0xFin/fin-doc-pipeline.git
cd fin-doc-pipeline
node test/run.mjs      # 109 checks, no install step
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

## Adding a proofreading rule

Text rules live in `src/chinese.mjs`; the lint ids (`C001`…`C009`) are wired in `src/lint.mjs`.
Add the check in `lintDocument` and, when it is deterministic and safe, the repair in `fixDocument` plus the id to `SAFE_FIXES`. Rules that rewrite meaning should report only.

## Web build

`index.html` is generated. Edit `web/index.template.html` or `web/app.mjs`, then:

```sh
npm run build          # regenerate index.html
node scripts/build-web.mjs --check   # fail if it is stale
```

Run the build before committing; the test suite also fails on a stale `index.html`.

## Commit messages

Conventional Commits (`feat:`, `fix:`, `docs:`, `test:`, `refactor:`). Keep the subject in the imperative mood.

## Syncing the installed skill (maintainer)

The skill directory holds a **copy**, not a symlink, so `src/` changes are invisible to the agent until it is reinstalled. One command does tests, sync, commit, push and tag:

```sh
./scripts/ship.sh                    # auto commit message
./scripts/ship.sh "fix: 章节排序"     # custom message
./scripts/ship.sh --no-push          # commit locally only
./scripts/status.sh                  # or npm run status
```

`ship.sh` runs the build, the tests, `install.sh`, then commits, pushes and creates/pushes the version tag when `package.json` has a new version.

Pushing a `v*` tag triggers `.github/workflows/release.yml`, which publishes the GitHub release (notes from `CHANGELOG.md`) and, when the `NPM_TOKEN` secret is present, `npm publish`.

### Deletion does not propagate

The three copies are independent: `rm` only affects the working tree, a later `git push` updates GitHub, and a later `./install.sh` updates the skill directory (it removes the destination first). `./scripts/ship.sh` brings all three back in sync.

With `./install.sh --link` the skill directory *is* this checkout, so only the GitHub push remains.

## Reporting bugs

A useful report includes: the command you ran, the detected encoding from `inspect --json`, and the smallest text sample that reproduces the problem. Please do not attach copyrighted books.
