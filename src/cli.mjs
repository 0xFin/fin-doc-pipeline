#!/usr/bin/env node
/**
 * cli.mjs — the single entry point.
 *
 * Designed to be called by humans and by agents alike:
 *   - every command accepts --json for machine readable output
 *   - nothing is written unless explicitly asked (except the main output)
 *   - destructive operations need both --clean-sources and --yes
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import os from 'node:os';
import process from 'node:process';

import './codec-node.mjs';
import { detectEncoding, describeDetection } from './encoding.mjs';
import { parseDocument, findDuplicateNumbers, findMissingNumbers, chapterCharCount } from './parser.mjs';
import { renderDocument, DEFAULT_FORMAT, countText } from './typography.mjs';
import { mergeDocuments, renderMergeReport, DEFAULT_MERGE } from './merge.mjs';
import { lintDocument, lintRawText, fixDocument, renderLintReport, CLEAN_FIXES, SAFE_FIXES } from './lint.mjs';
import { renderFormat, SUPPORTED_FORMATS, guessMetaFromFilename } from './converters.mjs';
import { isContainer, isKnownInput, isMarkup, loadDocument, loadMarkup } from './loaders/index.mjs';
import { ForgeError, fail, pretty } from './util.mjs';

const VERSION = '0.3.1';

/* =========================================================
   Presets
   ========================================================= */

const PRESETS = {
  novel: { structure: 'auto' },
  plain: { structure: 'none' },
  article: { structure: 'none' },
};

/* =========================================================
   Argument parsing
   ========================================================= */

const VALUE_FLAGS = new Set([
  'out', 'o', 'config', 'preset', 'report', 'encoding', 'indent', 'title',
  'group-title', 'special-title', 'title-sep', 'level', 'pick', 'eol', 'glob', 'merge-mode',
  'structure', 'num-width', 'blank-before', 'blank-after', 'min-paragraph-length',
  'to', 'meta-title', 'meta-author', 'meta-description', 'dest', 'no-doc-title',
  'section-title', 'volume-title', 'unnumbered-title', 'heading-prefix', 'heading-suffix', 'md-heading',
  'rules', 'fix-rules', 'heading-regex', 'headings-file', 'md-title-level', 'md-chapter-level', 'md-section-level',
]);

function parseArgv(argv) {
  const opts = { command: null, files: [], flags: {} };
  let i = 0;
  while (i < argv.length) {
    const arg = argv[i];
    if (arg === '--') {
      opts.files.push(...argv.slice(i + 1));
      break;
    }
    if (arg.startsWith('--')) {
      let name = arg.slice(2);
      let value = true;
      const eq = name.indexOf('=');
      if (eq >= 0) {
        value = name.slice(eq + 1);
        name = name.slice(0, eq);
      } else if (name.startsWith('no-')) {
        name = name.slice(3);
        value = false;
      } else if (VALUE_FLAGS.has(name) && i + 1 < argv.length && !argv[i + 1].startsWith('-')) {
        value = argv[i + 1];
        i += 1;
      }
      opts.flags[name] = value;
      i += 1;
      continue;
    }
    if (arg.startsWith('-') && arg.length > 1) {
      const short = arg.slice(1);
      if (short === 'o') {
        opts.flags.out = argv[i + 1];
        i += 2;
        continue;
      }
      if (short === 'q') { opts.flags.quiet = true; i += 1; continue; }
      if (short === 'h') { opts.flags.help = true; i += 1; continue; }
      if (short === 'V') { opts.flags.version = true; i += 1; continue; }
      fail('E_ARGS', '未知选项：' + arg);
    }
    if (!opts.command) opts.command = arg;
    else opts.files.push(arg);
    i += 1;
  }
  return opts;
}

/* =========================================================
   Config
   ========================================================= */

function loadConfig(explicitPath) {
  const candidates = [];
  if (explicitPath) candidates.push(path.resolve(explicitPath));
  else {
    candidates.push(path.resolve('fin-doc-pipeline.config.json'));
    candidates.push(path.resolve('textforge.json'));
  }
  for (const file of candidates) {
    if (!fs.existsSync(file)) continue;
    try {
      return { path: file, data: JSON.parse(fs.readFileSync(file, 'utf8')) };
    } catch (err) {
      fail('E_CONFIG', '配置文件解析失败：' + file + ' — ' + err.message);
    }
  }
  if (explicitPath) fail('E_CONFIG', '配置文件不存在：' + explicitPath);
  return { path: null, data: {} };
}

/** Merge preset + config + flags into one options object. */
function buildOptions(flags, config) {
  const presetName = flags.preset || config.preset || 'novel';
  const preset = PRESETS[presetName];
  if (!preset) fail('E_ARGS', '未知预设：' + presetName + '（可选：' + Object.keys(PRESETS).join(', ') + '）');

  const fmt = { ...DEFAULT_FORMAT, ...(config.format || {}) };
  if (flags.indent === false) fmt.indent = '';
  else if (typeof flags.indent === 'string') fmt.indent = flags.indent;
  if (flags['title']) fmt.chapterTitle = flags['title'];
  if (flags['group-title']) fmt.groupChapterTitle = flags['group-title'];
  if (flags['special-title']) fmt.specialTitle = flags['special-title'];
  if (flags['title-sep']) fmt.titleSeparator = flags['title-sep'];
  if (flags['num-width']) fmt.numWidth = Number(flags['num-width']);
  if (flags['section-title']) fmt.sectionTitle = flags['section-title'];
  if (flags['unnumbered-title']) fmt.unnumberedTitle = flags['unnumbered-title'];
  if (flags['volume-title']) fmt.volumeTitle = flags['volume-title'];
  if (flags['heading-prefix'] !== undefined) fmt.headingPrefix = flags['heading-prefix'];
  if (flags['heading-suffix'] !== undefined) fmt.headingSuffix = flags['heading-suffix'];
  if (flags['md-heading']) fmt.mdHeading = flags['md-heading'];
  if (flags['blank-before'] !== undefined) fmt.blankBeforeTitle = Number(flags['blank-before']);
  if (flags['blank-after'] !== undefined) fmt.blankAfterTitle = Number(flags['blank-after']);
  if (flags.reflow === true) fmt.reflow = true;
  if (flags.normalize === true) fmt.normalizePunctuation = true;

  const mergeOpts = { ...DEFAULT_MERGE, ...(config.merge || {}) };
  if (flags.pick) mergeOpts.pick = flags.pick;
  if (flags['merge-mode']) mergeOpts.mode = flags['merge-mode'];
  if (flags.renumber === true) mergeOpts.renumber = true;
  if (flags['paragraph-dedupe'] === false) mergeOpts.paragraphDedupe = false;
  if (flags['min-paragraph-length']) mergeOpts.paragraphDedupeMinLength = Number(flags['min-paragraph-length']);

  const output = { encoding: 'utf-8', bom: false, eol: 'lf', ...(config.output || {}) };
  if (flags.encoding) output.encoding = flags.encoding;
  if (flags.eol) output.eol = flags.eol;
  if (flags.bom === true) output.bom = true;
  if (flags.bom === false) output.bom = false;

  const safety = { cleanSources: false, hardDelete: false, ...(config.safety || {}) };
  if (flags['clean-sources'] === true) safety.cleanSources = true;
  if (flags['hard-delete'] === true) safety.hardDelete = true;

  const structure = flags.structure || preset.structure || 'auto';

  /* heading detection options */
  const structureOptions = { ...(config.structure || {}) };
  if (flags.rules) {
    structureOptions.rules = String(flags.rules).split(',').map((s) => s.trim()).filter(Boolean);
  }
  if (flags['heading-regex']) {
    const patterns = String(flags['heading-regex']).split('||').map((s) => s.trim()).filter(Boolean);
    structureOptions.customRules = (structureOptions.customRules || []).concat(
      patterns.map((pattern) => ({ pattern, kind: 'chapter', level: 1 }))
    );
  }
  if (flags['headings-file']) {
    const file = path.resolve(String(flags['headings-file']));
    if (!fs.existsSync(file)) fail('E_NOFILE', '标题列表文件不存在：' + file);
    structureOptions.headings = new Set(
      fs.readFileSync(file, 'utf8').split('\n').map((l) => l.trim()).filter(Boolean)
    );
  }
  if (flags['heuristic-headings'] === true) {
    structureOptions.heuristic = { enabled: true, maxLength: Number(flags['heuristic-max'] || 30) };
  }
  const markdown = { ...(structureOptions.markdown || {}) };
  const levelsOf = (value) => String(value).split(',').map((n) => Number(n.trim())).filter(Number.isFinite);
  if (flags['md-title-level']) markdown.titleLevels = levelsOf(flags['md-title-level']);
  if (flags['md-chapter-level']) markdown.chapterLevels = levelsOf(flags['md-chapter-level']);
  if (flags['md-section-level']) markdown.sectionLevels = levelsOf(flags['md-section-level']);
  if (Object.keys(markdown).length) structureOptions.markdown = markdown;


  return {
    presetName,
    structure,
    fmt,
    mergeOpts,
    output,
    safety,
    config,
    json: Boolean(flags.json),
    quiet: Boolean(flags.quiet),
    dryRun: Boolean(flags['dry-run']),
    yes: Boolean(flags.yes),
    level: flags.level || 'info',
    structureOptions,
    recurse: Boolean(flags.recurse),
    glob: flags.glob || null,
  };
}

/* =========================================================
   Input collection
   ========================================================= */

function collectFiles(inputs, options) {
  const files = [];
  for (const input of inputs) {
    const resolved = path.resolve(input);
    if (!fs.existsSync(resolved)) fail('E_NOFILE', '文件或目录不存在：' + input);
    const stat = fs.statSync(resolved);
    if (stat.isDirectory()) {
      const entries = fs.readdirSync(resolved).sort();
      for (const name of entries) {
        if (name.startsWith('.')) continue;
        const full = path.join(resolved, name);
        const st = fs.statSync(full);
        if (st.isDirectory()) {
          if (options.recurse) files.push(...collectFiles([full], options));
          continue;
        }
        if (!isKnownInput(name)) continue;
        files.push(full);
      }
      continue;
    }
    files.push(resolved);
  }
  if (!files.length) fail('E_NOFILE', '没有找到可处理的文本文件');
  return files;
}

/** Read a file, unpacking containers and stripping markup when needed. */
function readSource(file) {
  const buf = fs.readFileSync(file);

  if (isContainer(file)) {
    const loaded = loadDocument(buf, file);
    const label = loaded.format.toUpperCase();
    return {
      path: file,
      label: path.basename(file),
      bytes: buf.length,
      format: loaded.format,
      meta: loaded.meta || {},
      detection: { text: loaded.text, encoding: loaded.format, label, confidence: 1, alternatives: [] },
      raw: loaded.text,
    };
  }

  const detection = detectEncoding(buf);
  let raw = detection.text;
  let meta = {};
  let format = 'text';

  if (isMarkup(file)) {
    const loaded = loadMarkup(raw, file);
    raw = loaded.text;
    meta = loaded.meta || {};
    format = loaded.format;
  }

  return {
    path: file,
    label: path.basename(file),
    bytes: buf.length,
    format,
    meta,
    detection,
    raw,
  };
}

/**
 * Structure options for one source.
 *
 * Loaders (docx/epub/html) already encode the structural level as Markdown
 * depth: level 1 is a chapter, level 2 a section. That is independent of the
 * user's own Markdown mapping, where an H1 may well be the book title, so the
 * loader profile overrides the configured mapping.
 */
function structureFor(source, options) {
  const base = options.structureOptions || {};
  if (source && (source.format === 'docx' || source.format === 'epub' || source.format === 'html')) {
    return {
      ...base,
      markdown: { titleLevels: [], chapterLevels: [1], sectionLevels: [2, 3, 4, 5, 6] },
    };
  }
  return base;
}

function buildDocument(source, options) {
  const raw = typeof source === 'string' ? source : source.raw;
  if (options.structure === 'none') {
    const paragraphs = raw
      .replace(/\r\n?/g, '\n')
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean);
    return { frontMatter: paragraphs, chapters: [], hasChapters: false, stats: { chapterCount: 0, chapters: 0 } };
  }
  return parseDocument(raw, structureFor(source, options));
}

/* =========================================================
   Output
   ========================================================= */

function writeOutput(file, text, outputOptions) {
  const dir = path.dirname(path.resolve(file));
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  let body = text;
  if (outputOptions.eol === 'crlf') body = body.replace(/\n/g, '\r\n');
  let buf = Buffer.from(body, 'utf8');
  if (outputOptions.bom) buf = Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), buf]);
  fs.writeFileSync(file, buf);
  return buf.length;
}

/** Re-read the produced file and make sure it is structurally sane. */
function verifyOutput(file, expectedChapters) {
  const stat = fs.statSync(file);
  if (!stat.size) return { ok: false, reason: '输出文件为空' };
  const detection = detectEncoding(fs.readFileSync(file));
  const doc = parseDocument(detection.text);
  if (expectedChapters > 0 && doc.stats.chapterCount === 0) {
    return { ok: false, reason: '输出文件解析不到任何章节' };
  }
  return { ok: true, chapters: doc.stats.chapterCount, bytes: stat.size };
}

function trashTargetFolder() {
  if (process.platform === 'darwin') return path.join(os.homedir(), '.Trash');
  if (process.platform === 'linux') return path.join(os.homedir(), '.local', 'share', 'Trash', 'files');
  return null;
}

function moveToTrash(file) {
  const folder = trashTargetFolder();
  if (!folder) fail('E_TRASH', '当前系统不支持移动到废纸篓，请使用 --hard-delete');
  fs.mkdirSync(folder, { recursive: true });
  const base = path.basename(file);
  let target = path.join(folder, base);
  let n = 1;
  while (fs.existsSync(target)) {
    const ext = path.extname(base);
    const stem = base.slice(0, base.length - ext.length);
    target = path.join(folder, stem + ' (' + n + ')' + ext);
    n += 1;
  }
  fs.renameSync(file, target);
  return target;
}

function deleteSources(files, options) {
  if (!options.safety.cleanSources) return { removed: [], failed: [] };
  if (!options.yes) {
    fail('E_CONFIRM', '启用 --clean-sources 时必须同时传 --yes，避免误删原始文件');
  }
  const removed = [];
  const failed = [];
  for (const file of files) {
    try {
      if (options.safety.hardDelete) {
        fs.unlinkSync(file);
        removed.push({ file, to: null, hard: true });
      } else {
        removed.push({ file, to: moveToTrash(file), hard: false });
      }
    } catch (err) {
      failed.push({ file, error: err.message });
    }
  }
  return { removed, failed };
}

/* =========================================================
   Commands
   ========================================================= */

function cmdInspect(files, options, sources) {
  const rows = [];
  for (const src of sources) {
    const doc = buildDocument(src, options);
    const rawIssues = lintRawText(src.raw);
    const lint = lintDocument(doc, { level: options.level, checkStructure: true });
    const dupes = findDuplicateNumbers(doc.chapters);
    const gaps = findMissingNumbers(doc.chapters);
    rows.push({
      path: src.path,
      label: src.label,
      bytes: src.bytes,
      container: src.format || 'text',
      encoding: src.detection.label,
      encodingConfidence: Number(src.detection.confidence.toFixed(2)),
      encodingCandidates: src.detection.alternatives,
      chapters: doc.stats.chapterBlocks === undefined ? doc.stats.chapterCount : doc.stats.chapterBlocks,
      numberedChapters: doc.stats.chapterCount,
      sections: doc.stats.sectionCount || 0,
      groups: doc.stats.groups || [],
      specials: (doc.stats.specials || []).length,
      volumes: (doc.stats.volumes || []).length,
      paragraphs: doc.stats.paragraphs,
      chars: doc.stats.chars,
      duplicates: dupes,
      missing: gaps,
      issues: lint.counts,
      rawIssues: rawIssues.map((i) => ({ id: i.id, severity: i.severity, message: i.message })),
      sampleIssues: lint.issues.slice(0, 12),
    });
  }

  if (options.json) return { command: 'inspect', ok: true, files: rows };

  const lines = [];
  for (const r of rows) {
    lines.push('■ ' + r.label);
    lines.push('   路径   ' + r.path);
    lines.push('   大小   ' + r.bytes + ' 字节   编码 ' + r.encoding + '（置信度 ' + Math.round(r.encodingConfidence * 100) + '%）');
    lines.push('   结构   章节 ' + r.chapters + '   小节 ' + r.sections + '   特殊篇目 ' + r.specials + '   卷 ' + r.volumes + '   段落 ' + r.paragraphs + '   字数 ' + r.chars);
    if (r.groups.length) lines.push('   分组   ' + r.groups.join(', '));
    if (r.duplicates.length) lines.push('   重复章 ' + r.duplicates.map((d) => d.group + '#' + d.num + '×' + d.count).join(' '));
    const gapList = Object.entries(r.missing).filter(([, v]) => v.missing.length);
    if (gapList.length) lines.push('   缺章   ' + gapList.map(([g, v]) => g + ':' + v.missing.length).join(' '));
    lines.push('   检查   错误 ' + r.issues.error + '   警告 ' + r.issues.warn + '   提示 ' + r.issues.info);
    for (const issue of r.sampleIssues.slice(0, 6)) {
      lines.push('      - [' + issue.severity + '] ' + issue.id + ' ' + issue.message);
    }
    lines.push('');
  }
  return { command: 'inspect', ok: true, text: lines.join('\n'), files: rows };
}

function cmdFormat(files, options, sources) {
  if (sources.length !== 1) {
    fail('E_ARGS', 'format 只接受一个文件；合并多个文件请使用 merge 命令');
  }
  const src = sources[0];
  let doc = buildDocument(src, options);
  let fixed = [];

  if (options.flags.fix !== false) {
    const res = fixDocument(doc, { rules: CLEAN_FIXES });
    doc = res.doc;
    fixed = res.fixed;
  }

  const text = renderDocument(doc, options.fmt);
  const outFile = ensureDistinctOutput(options.flags.out || defaultOutput(src.path, 'formatted'), [src.path]);

  const lint = lintDocument(doc, { level: options.level });
  const stats = countText(text);

  if (options.dryRun) {
    return {
      command: 'format', ok: true, dryRun: true,
      input: { path: src.path, encoding: src.detection.label },
      output: { path: outFile, wouldWrite: true },
      stats, fixed, issues: lint.counts,
    };
  }

  const bytes = writeOutput(outFile, text, options.output);
  const verified = verifyOutput(outFile, doc.stats.chapterCount || 0);
  if (!verified.ok) fail('E_VERIFY', '输出校验失败：' + verified.reason);

  return {
    command: 'format', ok: true,
    input: { path: src.path, encoding: src.detection.label },
    output: { path: outFile, bytes, chapters: verified.chapters },
    stats,
    fixed,
    issues: lint.counts,
  };
}

function defaultOutput(inputPath, suffix) {
  const dir = path.dirname(inputPath);
  const base = path.basename(inputPath);
  const ext = path.extname(base);
  const stem = base.slice(0, base.length - ext.length);
  return path.join(dir, stem + '.' + suffix + '.txt');
}

async function cmdMerge(files, options, sources) {
  const docs = sources.map((src) => ({
    label: src.label,
    path: src.path,
    encoding: src.detection.label,
    doc: buildDocument(src, options),
  }));

  const { doc, report } = mergeDocuments(docs, options.mergeOpts);

  let fixed = [];
  const fixRes = fixDocument(doc, { rules: CLEAN_FIXES });
  const finalDoc = fixRes.doc;
  fixed = fixRes.fixed;

  const text = renderDocument(finalDoc, options.fmt);
  const outFile = ensureDistinctOutput(options.flags.out || defaultOutput(sources[0].path, 'merged'), sources.map((s) => s.path));
  const reportFile = options.flags.report || (options.flags.report === false ? null : outFile.replace(/\.[^.]+$/, '') + '.report.md');

  const lint = lintDocument(finalDoc, { level: options.level });
  const stats = countText(text);
  const expectedChapters = finalDoc.chapters.filter((c) => c.kind === 'chapter').length;

  if (options.dryRun) {
    return {
      command: 'merge', ok: true, dryRun: true,
      inputs: report.sources,
      output: { path: outFile, wouldWrite: true },
      reportFile,
      stats,
      fixed,
      duplicateFiles: report.duplicateFiles,
      chapterConflicts: report.chapters.length,
      paragraphDedupeRemoved: report.paragraphDedupeRemoved,
      issues: lint.counts,
    };
  }

  const bytes = writeOutput(outFile, text, options.output);
  const verified = verifyOutput(outFile, expectedChapters);
  if (!verified.ok) fail('E_VERIFY', '输出校验失败：' + verified.reason);

  if (reportFile) {
    fs.writeFileSync(reportFile, renderMergeReport(report) + '\n', 'utf8');
  }

  let converted = [];
  if (options.flags.to) {
    const formats = parseFormats(options.flags.to);
    const meta = { ...guessMetaFromFilename(sources[0].path), ...(sources[0].meta || {}), ...(options.config.meta || {}) };
    const includeTitle = options.flags['doc-title'] === false ? false : !(options.config && options.config.convert && options.config.convert.includeDocTitle === false);
    converted = writeExtraFormats(finalDoc, outFile, formats, options, meta, sources.map((s) => s.path), includeTitle);
  }

  const deletion = deleteSources(sources.map((s) => s.path), options);

  return {
    command: 'merge', ok: true,
    converted,
    inputs: report.sources,
    output: { path: outFile, bytes, chapters: verified.chapters },
    reportFile,
    stats,
    fixed,
    duplicateFiles: report.duplicateFiles.filter((d) => d.dropped.length),
    chapterConflicts: report.chapters.length,
    paragraphDedupeRemoved: report.paragraphDedupeRemoved,
    issues: lint.counts,
    removed: deletion.removed,
    removeFailed: deletion.failed,
  };
}

async function cmdCheck(files, options, sources) {
  if (sources.length !== 1) fail('E_ARGS', 'check 只接受一个文件');
  const src = sources[0];
  let doc = buildDocument(src, options);

  const rawIssues = lintRawText(src.raw);
  const before = lintDocument(doc, { level: options.level });
  let fixed = [];
  let outFile = options.flags.out || null;

  if (options.flags.fix === true) {
    const res = fixDocument(doc, { rules: options.flags['fix-rules'] ? String(options.flags['fix-rules']).split(',') : SAFE_FIXES });
    doc = res.doc;
    fixed = res.fixed;
    outFile = outFile || defaultOutput(src.path, 'fixed');
    if (!options.dryRun) {
      const text = renderDocument(doc, options.fmt);
      writeOutput(outFile, text, options.output);
    }
  }

  const after = options.flags.fix === true ? lintDocument(doc, { level: options.level }) : null;

  if (options.json) {
    return { command: 'check', ok: true, input: src.path, rawIssues, before, after, fixed, output: outFile };
  }

  const lines = [];
  lines.push('■ ' + src.label + '  编码 ' + src.detection.label);
  lines.push('');
  lines.push(renderLintReport(before));
  if (after) {
    lines.push('');
    lines.push('修复后：');
    lines.push(renderLintReport(after));
    if (fixed.length) {
      lines.push('');
      lines.push('已修复：' + fixed.map((f) => f.id + '×' + f.count).join(' '));
    }
    if (outFile) lines.push('输出：' + outFile);
  }
  return { command: 'check', ok: true, text: lines.join('\n'), before, after, fixed, output: outFile, rawIssues };
}

function replaceExtension(file, ext) {
  const base = file.replace(/\.[^.\/\\]+$/, '');
  return base + '.' + ext;
}

/** Validate a comma separated --to list and return normalised format names. */
function parseFormats(raw) {
  const formats = String(raw).split(',').map((s) => s.trim()).filter(Boolean);
  for (const fmt of formats) {
    if (!SUPPORTED_FORMATS.includes(fmt.toLowerCase())) {
      fail('E_FORMAT', '不支持的输出格式：' + fmt + '（可用：' + SUPPORTED_FORMATS.join(', ') + '）');
    }
  }
  return formats;
}

/**
 * Make sure the output never overwrites an input file.
 * When it would, a ".out" marker (and a counter) is inserted before the extension.
 */
function ensureDistinctOutput(candidate, inputPaths) {
  const inputs = new Set((inputPaths || []).map((p) => path.resolve(p)));
  let target = candidate;
  if (!inputs.has(path.resolve(target))) return target;

  const dir = path.dirname(target);
  const ext = path.extname(target);
  const stem = path.basename(target, ext);
  let counter = 1;
  while (true) {
    const suffix = counter === 1 ? '.out' : '.out' + counter;
    const next = path.join(dir, stem + suffix + ext);
    if (!inputs.has(path.resolve(next)) && !fs.existsSync(next)) return next;
    counter += 1;
  }
}

/** Render additional formats next to the main output file. */
function writeExtraFormats(doc, baseFile, formats, options, meta, inputPaths, includeTitle) {
  const written = [];
  for (const fmt of formats) {
    const rendered = renderFormat(doc, fmt, { format: options.fmt, meta, includeTitle });
    const target = ensureDistinctOutput(replaceExtension(baseFile, rendered.extension), inputPaths);
    if (options.dryRun) {
      written.push({ format: fmt, path: target, bytes: 0, dryRun: true });
      continue;
    }
    if (rendered.binary) {
      const dir = path.dirname(path.resolve(target));
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(target, rendered.buffer);
      written.push({ format: fmt, path: target, bytes: rendered.buffer.length, binary: true });
    } else {
      const bytes = writeOutput(target, rendered.buffer.toString('utf8'), options.output);
      written.push({ format: fmt, path: target, bytes, binary: false });
    }
  }
  return written;
}

function cmdConvert(files, options, sources) {
  if (sources.length !== 1) fail('E_ARGS', 'convert 只接受一个文件');
  const src = sources[0];
  const base = buildDocument(src, options);
  const cleaned = fixDocument(base, { rules: CLEAN_FIXES }).doc;

  const config = options.config || {};
  const configured = (config.convert && config.convert.to) || null;
  const raw = options.flags.to || (configured ? configured.join(',') : 'txt');
  const formats = parseFormats(raw);
  if (!formats.length) fail('E_ARGS', '请用 --to 指定输出格式，例如 --to docx 或 --to epub,docx');

  const guessed = guessMetaFromFilename(src.path);
  const meta = {
    ...guessed,
    ...(src.meta || {}),
    ...(config.meta || {}),
    ...(options.flags['meta-title'] ? { title: options.flags['meta-title'] } : {}),
    ...(options.flags['meta-author'] ? { author: options.flags['meta-author'] } : {}),
    ...(options.flags['meta-description'] ? { description: options.flags['meta-description'] } : {}),
  };
  const includeTitle = options.flags['doc-title'] === false
    ? false
    : !(config.convert && config.convert.includeDocTitle === false);

  const outputs = [];
  for (const fmt of formats) {
    const rendered = renderFormat(cleaned, fmt, { format: options.fmt, meta, includeTitle });
    let outFile;
    if (options.flags.out) {
      outFile = formats.length === 1 ? options.flags.out : replaceExtension(options.flags.out, rendered.extension);
      if (formats.length === 1 && !path.extname(outFile)) outFile += '.' + rendered.extension;
    } else {
      outFile = replaceExtension(src.path, rendered.extension);
    }
    outFile = ensureDistinctOutput(outFile, sources.map((s) => s.path));
    if (!options.dryRun) {
      let bytes;
      if (rendered.binary) {
        const dir = path.dirname(path.resolve(outFile));
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(outFile, rendered.buffer);
        bytes = rendered.buffer.length;
      } else {
        bytes = writeOutput(outFile, rendered.buffer.toString('utf8'), options.output);
      }
      outputs.push({ format: fmt, path: outFile, bytes, binary: rendered.binary });
    } else {
      outputs.push({ format: fmt, path: outFile, bytes: 0, binary: rendered.binary, dryRun: true });
    }
  }

  return {
    command: 'convert', ok: true,
    input: { path: src.path, encoding: src.detection.label },
    meta,
    outputs,
    dryRun: options.dryRun || false,
  };
}

/* =========================================================
   install-skill
   ========================================================= */

/** Directory that holds this package (works both from a checkout and npm). */
function packageRoot() {
  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
}

function cmdInstallSkill(options) {
  const destRoot = options.flags.dest
    ? path.resolve(String(options.flags.dest))
    : path.join(os.homedir(), '.dsh', 'skills');
  const target = path.join(destRoot, 'fin-doc-pipeline');

  if (options.flags.uninstall) {
    fs.rmSync(target, { recursive: true, force: true });
    return { command: 'install-skill', ok: true, removed: target };
  }

  const source = packageRoot();
  fs.mkdirSync(destRoot, { recursive: true });
  fs.rmSync(target, { recursive: true, force: true });

  if (options.flags.link) {
    fs.symlinkSync(source, target, 'dir');
  } else {
    fs.cpSync(source, target, {
      recursive: true,
      filter: (item) => {
        if (item === target) return false;
        const base = path.basename(item);
        if (base === '.git' || base === 'node_modules' || base === '.DS_Store') return false;
        if (base === 'out' || base === 'out2' || base === 'tmp') return false;
        return true;
      },
    });
  }

  return {
    command: 'install-skill',
    ok: true,
    source,
    target,
    mode: options.flags.link ? 'link' : 'copy',
    destRoot,
  };
}

/* =========================================================
   Help
   ========================================================= */

function helpText() {
  return [
    'fin-doc-pipeline ' + VERSION + ' — 通用文本处理流水线',
    '',
    '用法: fin-doc-pipeline <命令> [文件...] [选项]',
    '',
    '命令:',
    '  inspect   只读体检：编码、结构、章号、潜在问题',
    '  format    清洗 + 排版单个文件',
    '  merge     多文件去重合并 + 排版（来源明细写入旁路报告）',
    '  check     内容检查；加 --fix 输出修复后的文件',
    '  convert   格式转换（文本 / 结构化 / 富文本 / 电子书 / PDF）',
    '  install-skill  把本技能安装到 Agent 技能目录（默认 ~/.dsh/skills）',
    '',
    '输入格式：txt md html docx epub pdf json yaml xml csv js rtf 等',
    '输出格式：txt md html json yaml xml csv js rtf docx epub pdf',
    '',
    '输入输出:',
    '  -o, --out <文件>      输出路径',
    '      --report <文件>   合并报告路径（默认与输出同名 .report.md）',
    '      --no-report       不生成合并报告',
    '      --dry-run         只报告将要做什么，不写文件',
    '      --to <格式>       目标格式，可逗号分隔：txt,md,html,json,yaml,xml,csv,js,rtf,docx,epub,pdf',
    '      --meta-title <s>  书名（默认从文件名推断）',
    '      --meta-author <s> 作者',
    '      --no-doc-title    md/html 输出不生成书名标题行',
    '      --recurse         递归扫描目录',
    '',
    '编码:',
    '      --encoding <enc>  输出编码（默认 utf-8）',
    '      --bom / --no-bom  输出是否带 BOM',
    '      --eol <lf|crlf>   换行风格',
    '',
    '排版:',
    '      --preset <名>     novel | plain | article（默认 novel）',
    '      --structure <s>   auto | none',
    '      --indent <字符>   段首缩进，默认两个全角空格；--no-indent 关闭',
    '      --title <模板>      章标题模板，默认 [第{num}章]',
    '      --section-title <模板>  小节标题模板，默认 {title}',
    '      --unnumbered-title <模板>  无编号章的标题，默认 {title}',
    '      --volume-title <模板>   卷标题模板，默认 [第{num}卷]',
    '      --heading-prefix <s>    所有标题统一加前缀（如 "§ "）',
    '      --heading-suffix <s>    所有标题统一加后缀',
    '      --md-heading <模式>     markdown 标题标记：auto|none|preserve|level:N',
    '',
    '标题识别:',
    '      --rules <列表>      启用的识别规则，逗号分隔（见下）',
    '      --heading-regex <正则>  自定义标题正则，|| 分隔多条',
    '      --headings-file <文件>  逐行列出标题，权威覆盖自动识别',
    '      --heuristic-headings     启用启发式识别（短行+前后空行）',
    '      --md-title-level <n>    markdown 中视为书名的层级',
    '      --md-chapter-level <n>  markdown 中视为章的层级',
    '      --md-section-level <n>  markdown 中视为节的层级',
    '      --num-width <n>   章号补零宽度，默认 3',
    '      --blank-before <n> / --blank-after <n>  标题前后空行数',
    '      --reflow          合并软换行（有风险，默认关闭）',
    '      --normalize       规范化标点（默认关闭）',
    '',
    '合并:',
    '      --to <格式>       合并后同时导出，可逗号分隔（同 convert）',
'      --merge-mode <m>  versions（同书多版本，逐章择优）| concat（多本书拼接，默认 versions）',
    '      --renumber        concat 模式下按顺序重新编号',
    '      --pick <策略>     longest | first（默认 longest）',
    '      --no-paragraph-dedupe        关闭段落级去重',
    '      --min-paragraph-length <n>   去重的最小段落长度，默认 20',
    '',
    '检查:',
    '      --fix             应用安全修复',
    '      --fix-rules <ids> 指定修复规则，逗号分隔（T001,T006…）',
    '      --level <级别>    error | warn | info（默认 info）',
    '',
    '安全:',
    '      --clean-sources   合并成功后删除源文件（必须同时给 --yes）',
    '      --hard-delete     永久删除；默认移入废纸篓',
    '      --yes             确认执行破坏性操作',
    '',
    '识别规则：manual, markdown, numbered-cn, numbered-en, cn-list, ordered,',
    '          bracket, special, heuristic',
    '',
    '通用:',
    '      --json            机器可读输出',
    '  -q, --quiet           静默',
    '      --config <文件>   配置文件路径',
    '  -h, --help            帮助',
    '  -V, --version         版本',
    '',
    'install-skill:',
    '      --dest <目录>     安装目标根目录（默认 ~/.dsh/skills）',
    '      --link            建立符号链接而非复制',
    '      --uninstall       移除已安装的技能',
  ].join('\n');
}

/* =========================================================
   Main
   ========================================================= */

async function main(argv) {
  const parsed = parseArgv(argv);
  const flags = parsed.flags;

  if (flags.version) { process.stdout.write(VERSION + '\n'); return 0; }
  if (flags.help || !parsed.command || parsed.command === 'help') {
    process.stdout.write(helpText() + '\n');
    return 0;
  }

  const commands = { inspect: cmdInspect, format: cmdFormat, merge: cmdMerge, check: cmdCheck, convert: cmdConvert };
  const handler = commands[parsed.command];
  if (!handler && parsed.command !== 'install-skill') {
    process.stderr.write('未知命令：' + parsed.command + '\n\n' + helpText() + '\n');
    return 2;
  }

  const config = loadConfig(flags.config);
  const options = buildOptions(flags, config.data);
  options.flags = flags;

  if (parsed.command === 'install-skill') {
    const result = cmdInstallSkill(options);
    if (options.json) process.stdout.write(pretty(result) + '\n');
    else {
      process.stdout.write(
        (result.removed
          ? '已移除：' + result.removed
          : '已安装：' + result.target + '（' + result.mode + '）\n来源：' + result.source) + '\n' +
        '\n技能目录会被自动发现，通常几秒内生效，无需重启。\n'
      );
    }
    return 0;
  }

  const files = collectFiles(parsed.files, options);
  const sources = files.map(readSource);

  const result = await handler(files, options, sources);

  if (options.json) {
    process.stdout.write(pretty(result) + '\n');
  } else if (result && result.text) {
    process.stdout.write(result.text + '\n');
  } else if (result && result.outputs) {
    const lines = [];
    lines.push('书名：' + result.meta.title + (result.meta.author ? '　作者：' + result.meta.author : ''));
    for (const o of result.outputs) {
      lines.push('输出：' + o.path + '（' + o.format + (o.bytes ? '，' + o.bytes + ' 字节' : '') + '）');
    }
    if (result.dryRun) lines.push('（dry-run：未写入任何文件）');
    process.stdout.write(lines.join('\n') + '\n');
  } else if (result && !options.quiet) {
    const lines = [];
    if (result.output) lines.push('输出：' + result.output.path + (result.output.bytes ? '（' + result.output.bytes + ' 字节，' + result.output.chapters + ' 章）' : ''));
    if (result.reportFile) lines.push('报告：' + result.reportFile);
    if (result.stats) lines.push('字数：' + result.stats.chinese + ' 汉字 / ' + result.stats.total + ' 字符 / ' + result.stats.paragraphs + ' 段');
    if (result.duplicateFiles && result.duplicateFiles.length) {
      lines.push('重复文件：' + result.duplicateFiles.map((d) => d.kept + ' ⊃ ' + d.dropped.join('、')).join('；'));
    }
    if (result.converted && result.converted.length) {
      for (const c of result.converted) lines.push('另存：' + c.path + '（' + c.format + (c.bytes ? '，' + c.bytes + ' 字节' : '') + '）');
    }
    if (typeof result.chapterConflicts === 'number' && result.chapterConflicts) lines.push('章节冲突：' + result.chapterConflicts + ' 处（详见报告）');
    if (result.paragraphDedupeRemoved) lines.push('段落去重：' + result.paragraphDedupeRemoved + ' 段');
    if (result.fixed && result.fixed.length) lines.push('自动修复：' + result.fixed.map((f) => f.id + '×' + f.count).join(' '));
    if (result.issues) lines.push('检查：错误 ' + result.issues.error + ' / 警告 ' + result.issues.warn + ' / 提示 ' + result.issues.info);
    if (result.removed && result.removed.length) {
      lines.push('已删除源文件：');
      for (const r of result.removed) lines.push('  - ' + r.file + (r.to ? '  ->  ' + r.to : '  (已永久删除)'));
    }
    if (result.removeFailed && result.removeFailed.length) {
      lines.push('删除失败：');
      for (const r of result.removeFailed) lines.push('  - ' + r.file + '：' + r.error);
    }
    if (result.dryRun) lines.push('（dry-run：未写入任何文件）');
    process.stdout.write(lines.join('\n') + '\n');
  }
  return 0;
}

main(process.argv.slice(2)).then(
  (code) => process.exit(code || 0),
  (err) => {
    if (err instanceof ForgeError) {
      process.stderr.write('错误 [' + err.code + ']：' + err.message + '\n');
      process.exit(1);
    }
    process.stderr.write((err && err.stack ? err.stack : String(err)) + '\n');
    process.exit(1);
  }
);