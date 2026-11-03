#!/usr/bin/env node
/**
 * test/run.mjs — dependency free test runner.
 *
 * Run with: npm test   (or: node test/run.mjs)
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { execFileSync, execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { detectEncoding } from '../src/encoding.mjs';
import { cnToInt, classifyLine, parseDocument, findDuplicateNumbers } from '../src/parser.mjs';
import { detectHeading, buildContext, romanToInt, DEFAULT_RULES } from '../src/rules.mjs';
import { renderDocument, renderTitle, markdownMarker, DEFAULT_FORMAT, reflowParagraphs, normalizePunctuation, countText } from '../src/typography.mjs';
import { mergeDocuments, dedupeParagraphs, renderMergeReport } from '../src/merge.mjs';
import { lintDocument, lintRawText, fixDocument } from '../src/lint.mjs';
import { toMarkdown, toHtml, guessMetaFromFilename, renderFormat, SUPPORTED_FORMATS } from '../src/converters.mjs';
import { readZip } from '../src/zip.mjs';
import { toDocx } from '../src/formats/docx.mjs';
import { toEpub } from '../src/formats/epub.mjs';
import { toRtf } from '../src/formats/rtf.mjs';
import { toPdf } from '../src/formats/pdf.mjs';
import { loadPdf } from '../src/loaders/pdf.mjs';
import { loadDocx } from '../src/loaders/docx.mjs';
import { loadEpub } from '../src/loaders/epub.mjs';
import { isContainer, isKnownInput, loadDocument, formatOf, loadMarkup } from '../src/loaders/index.mjs';
import { toJson, toYaml, toXml, toCsv, toJs } from '../src/formats/data.mjs';
import { render as renderWebIndex, bundle as bundleWeb } from '../scripts/build-web.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const CLI = path.join(HERE, '..', 'src', 'cli.mjs');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'fin-doc-pipeline-test-'));

let passed = 0;
let failed = 0;
const failures = [];

function test(name, fn) {
  try {
    fn();
    passed += 1;
    process.stdout.write('  ok   ' + name + '\n');
  } catch (err) {
    failed += 1;
    failures.push({ name, err });
    process.stdout.write('  FAIL ' + name + '\n');
  }
}

function group(name, fn) {
  process.stdout.write('\n' + name + '\n');
  fn();
}

function fixture(name, content, encoding) {
  const file = path.join(TMP, name);
  fs.writeFileSync(file, Buffer.from(content, encoding || 'utf8'));
  return file;
}

/* =========================================================
   encoding
   ========================================================= */
group('encoding', () => {
  test('pure ASCII is detected as ASCII', () => {
    const r = detectEncoding(Buffer.from('hello world\n'));
    assert.equal(r.encoding, 'ascii');
    assert.equal(r.text, 'hello world\n');
  });

  test('UTF-8 with BOM strips the BOM', () => {
    const buf = Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from('第一章 开始')]);
    const r = detectEncoding(buf);
    assert.equal(r.encoding, 'utf-8');
    assert.equal(r.text, '第一章 开始');
    assert.equal(r.bom, true);
  });

  test('UTF-16LE BOM is honoured', () => {
    const buf = Buffer.from('\ufeff第一章', 'utf16le');
    const r = detectEncoding(buf);
    assert.equal(r.encoding, 'utf-16le');
    assert.equal(r.text, '第一章');
  });

  test('GBK text with one broken byte is still detected as GBK', () => {
    let iconvOk = true;
    try { execSync('iconv -l > /dev/null 2>&1'); } catch { iconvOk = false; }
    if (!iconvOk) { process.stdout.write('       (skipped: iconv missing)\n'); return; }
    const src = path.join(TMP, 'gbk-src.txt');
    const dst = path.join(TMP, 'gbk.txt');
    fs.writeFileSync(src, '第一章　开始\n　　这是一个关于时间和国家的故事，我们都知道。\n', 'utf8');
    execSync('iconv -f UTF-8 -t GBK "' + src + '" > "' + dst + '"');
    const buf = fs.readFileSync(dst);
    const broken = Buffer.concat([buf, Buffer.from([0x81])]);
    const r = detectEncoding(broken);
    assert.equal(r.encoding, 'gbk');
    assert.ok(r.text.startsWith('第一章'));
  });

  test('real BIG5 file decodes as Big5', () => {
    let iconvOk = true;
    try { execSync('iconv -l > /dev/null 2>&1'); } catch { iconvOk = false; }
    if (!iconvOk) { process.stdout.write('       (skipped: iconv missing)\n'); return; }
    const src = path.join(TMP, 'big5-src.txt');
    const dst = path.join(TMP, 'big5.txt');
    fs.writeFileSync(src, '第一章　開始\n　　這是一個關於時間與國家的故事，我們都知道。\n', 'utf8');
    execSync('iconv -f UTF-8 -t BIG5 "' + src + '" > "' + dst + '"');
    const r = detectEncoding(fs.readFileSync(dst));
    assert.equal(r.encoding, 'big5');
    assert.ok(r.text.startsWith('第一章'));
  });

  test('empty input does not throw', () => {
    const r = detectEncoding(Buffer.alloc(0));
    assert.equal(r.text, '');
  });
});

/* =========================================================
   parser
   ========================================================= */
group('parser', () => {
  test('Chinese numerals', () => {
    assert.equal(cnToInt('十二'), 12);
    assert.equal(cnToInt('一百零五'), 105);
    assert.equal(cnToInt('一万二千'), 12000);
    assert.equal(cnToInt('7'), 7);
    assert.equal(cnToInt('abc'), null);
  });

  test('classifies heading variants', () => {
    assert.equal(classifyLine('[第001章]　标题').num, 1);
    assert.equal(classifyLine('## [第001章]').num, 1);
    assert.equal(classifyLine('第十二回').num, 12);
    assert.equal(classifyLine('第3节 开头').unit, '节');
    assert.equal(classifyLine('第一卷 风起').kind, 'volume');
    assert.equal(classifyLine('[前言]').kind, 'special');
    assert.equal(classifyLine('普通正文'), null);
  });

  test('prefixed group headings get their own group', () => {
    const hit = classifyLine('## [番外第001章] 最后');
    assert.equal(hit.prefix, '番外');
    assert.equal(hit.num, 1);
    assert.equal(hit.subtitle, '最后');
  });

  test('parses front matter, specials and chapters', () => {
    const doc = parseDocument('书名\n作者\n[前言]\n前言内容\n[第001章] 开端\n正文一\n[第002章]\n正文二');
    assert.equal(doc.frontMatter.length, 2);
    assert.equal(doc.stats.chapterCount, 2);
    assert.equal(doc.stats.specials.length, 1);
    assert.equal(doc.chapters[0].paragraphs[0], '前言内容');
  });

  test('duplicate numbers are reported per group', () => {
    const doc = parseDocument('[第1章] a\n[第1章] b\n[番外第1章] c');
    const dup = findDuplicateNumbers(doc.chapters);
    assert.equal(dup.length, 1);
    assert.equal(dup[0].group, 'main');
  });
});

/* =========================================================
   typography
   ========================================================= */
group('typography', () => {
  test('renders default novel layout', () => {
    const doc = parseDocument('[第001章] 开端\n第一段\n第二段');
    const text = renderDocument(doc, DEFAULT_FORMAT);
    assert.equal(text, '[第001章]\u3000开端\n\n\u3000\u3000第一段\n\u3000\u3000第二段');
  });

  test('custom title template', () => {
    const doc = parseDocument('[第7章] 标题\n正文');
    const text = renderDocument(doc, { ...DEFAULT_FORMAT, chapterTitle: '第{num}章', numWidth: 1 });
    assert.ok(text.startsWith('第7章\u3000标题'));
  });

  test('indent can be disabled', () => {
    const doc = parseDocument('[第001章]\n正文');
    const text = renderDocument(doc, { ...DEFAULT_FORMAT, indent: '' });
    assert.ok(text.includes('\n正文'));
  });

  test('reflow joins a soft wrapped line', () => {
    const out = reflowParagraphs(['他走进房间，看见', '桌子上放着一封信。']);
    assert.equal(out.length, 1);
    assert.equal(out[0], '他走进房间，看见桌子上放着一封信。');
  });

  test('reflow keeps real paragraph breaks', () => {
    const out = reflowParagraphs(['他说完了。', '她沉默了。']);
    assert.equal(out.length, 2);
  });

  test('punctuation normalisation', () => {
    assert.equal(normalizePunctuation('等等...'), '等等……');
    assert.equal(normalizePunctuation('他说--然后'), '他说——然后');
  });

  test('countText counts', () => {
    const c = countText('你好世界\n第二行');
    assert.equal(c.chinese, 7);
    assert.equal(c.paragraphs, 2);
  });
});

/* =========================================================
   merge
   ========================================================= */
group('merge', () => {
  const a = parseDocument('[第1章] 开端\n短内容\n[第2章] 二\n共同内容');
  const b = parseDocument('[第1章] 开端\n这是一个更长更完整的版本内容\n[第2章] 二\n共同内容');

  test('versions mode picks the longer chapter', () => {
    const { doc, report } = mergeDocuments([
      { label: 'a.txt', doc: a },
      { label: 'b.txt', doc: b },
    ], { mode: 'versions' });
    assert.equal(doc.chapters.length, 2);
    assert.ok(doc.chapters[0].paragraphs.join('').includes('更长'));
    // Both chapter 1 and chapter 2 exist in both sources, so both are conflicts.
    assert.equal(report.chapters.length, 2);
  });

  test('pick=first keeps the first source', () => {
    const { doc } = mergeDocuments([
      { label: 'a.txt', doc: a },
      { label: 'b.txt', doc: b },
    ], { mode: 'versions', pick: 'first' });
    assert.equal(doc.chapters[0].paragraphs.join(''), '短内容');
  });

  test('concat mode keeps every chapter', () => {
    const { doc } = mergeDocuments([
      { label: 'a.txt', doc: a },
      { label: 'b.txt', doc: b },
    ], { mode: 'concat' });
    assert.equal(doc.chapters.length, 4);
  });

  test('identical files are dropped', () => {
    const { report } = mergeDocuments([
      { label: 'a.txt', doc: a },
      { label: 'copy.txt', doc: a },
    ], { mode: 'versions' });
    assert.equal(report.duplicateFiles.filter((d) => d.dropped.length).length, 1);
  });

  test('paragraph dedupe keeps short repeats', () => {
    // "……" is shorter than the threshold, so both copies survive on purpose.
    const res = dedupeParagraphs(['……', '……', '这是一段足够长的重复段落内容用于测试'], 20);
    assert.equal(res.paragraphs.length, 3);
    const dup = '这是一段足够长的重复段落内容用于测试';
    const res2 = dedupeParagraphs([dup, dup], 10);
    assert.equal(res2.removed, 1);
  });

  test('a single source keeps its document order', () => {
    const doc = parseDocument('前言\n前言正文\n[第1章] 开端\n正文\n[第2卷] 卷二\n[第3章] 卷内\n卷内正文\n全文完');
    const { doc: merged } = mergeDocuments([{ label: 'book.txt', doc }], { mode: 'versions' });
    const idx = (needle) => merged.chapters.findIndex((c) => c.rawTitle.includes(needle));
    assert.equal(idx('前言'), 0);
    assert.equal(idx('全文完'), merged.chapters.length - 1);
    assert.ok(idx('第1章') < idx('第2卷'));
    assert.ok(idx('第2卷') < idx('第3章'));
  });

  test('merging versions keeps the base document order', () => {
    const short = parseDocument('前言\n短文\n[第1章] 一\n甲\n[第2卷] 卷二\n[第3章] 二\n乙\n全文完');
    const long = parseDocument('前言\n更长的前言文字\n[第1章] 一\n甲，更完整\n[第2卷] 卷二\n[第3章] 二\n乙，更完整\n全文完');
    const { doc } = mergeDocuments([
      { label: 'short.txt', doc: short },
      { label: 'long.txt', doc: long },
    ], { mode: 'versions' });
    const idx = (needle) => doc.chapters.findIndex((c) => c.rawTitle.includes(needle));
    assert.equal(idx('前言'), 0);
    assert.equal(idx('全文完'), doc.chapters.length - 1);
    assert.ok(idx('第1章') < idx('第2卷'));
    assert.ok(idx('第2卷') < idx('第3章'));
    assert.ok(doc.chapters[0].paragraphs.join('').includes('更长'));
  });

  test('report renders as markdown', () => {
    const { report } = mergeDocuments([
      { label: 'a.txt', doc: a },
      { label: 'b.txt', doc: b },
    ], { mode: 'versions' });
    const md = renderMergeReport(report);
    assert.ok(md.includes('# 合并报告'));
    assert.ok(md.includes('## 章节取舍'));
  });
});

/* =========================================================
   lint
   ========================================================= */
group('lint', () => {
  test('detects replacement characters and fixes them', () => {
    const doc = parseDocument('[第1章]\n这里有\uFFFD坏字符');
    const res = lintDocument(doc);
    assert.ok(res.issues.some((i) => i.id === 'T001'));
    const fixed = fixDocument(doc, { rules: ['T001'] });
    assert.ok(!fixed.doc.chapters[0].paragraphs[0].includes('\uFFFD'));
  });

  test('detects duplicate chapter numbers', () => {
    const doc = parseDocument('[第1章] a\n[第1章] b');
    const res = lintDocument(doc);
    assert.ok(res.issues.some((i) => i.id === 'T012'));
  });

  test('detects missing chapter numbers', () => {
    const doc = parseDocument('[第1章] a\n[第3章] c');
    const res = lintDocument(doc);
    assert.ok(res.issues.some((i) => i.id === 'T013'));
  });

  test('detects half width punctuation', () => {
    const doc = parseDocument('[第1章]\n他说,你好.');
    const res = lintDocument(doc);
    assert.ok(res.issues.some((i) => i.id === 'T005'));
  });

  test('raw text checks', () => {
    const issues = lintRawText('\uFEFFa\r\nb\n\n\n\nc   \n');
    const ids = issues.map((i) => i.id);
    assert.ok(ids.includes('R001'));
    assert.ok(ids.includes('R002'));
    assert.ok(ids.includes('R003'));
    assert.ok(ids.includes('R004'));
  });

  test('zero width characters are removed by default clean', () => {
    const doc = parseDocument('[第1章]\n有\u200B零宽');
    const fixed = fixDocument(doc);
    assert.ok(!fixed.doc.chapters[0].paragraphs[0].includes('\u200B'));
  });
});

/* =========================================================
   converters
   ========================================================= */
group('converters', () => {
  const doc = parseDocument('[第1章] 开端\n正文一段\n[第2章] 继续\n正文二段');

  test('markdown output', () => {
    const md = toMarkdown(doc, { meta: { title: '测试书', author: '某人' } });
    assert.ok(md.startsWith('# 测试书'));
    assert.ok(md.includes('## [第001章]\u3000开端'));
  });

  test('html output escapes content', () => {
    const bad = parseDocument('[第1章]\n<script>alert(1)</script>');
    const html = toHtml(bad, { meta: { title: 'T' } });
    assert.ok(html.includes('&lt;script&gt;'));
    assert.ok(!html.includes('<script>alert'));
  });

  test('metadata guessed from filename', () => {
    const meta = guessMetaFromFilename('《妻如针刺我心》-魔师.txt');
    assert.equal(meta.title, '妻如针刺我心');
    assert.equal(meta.author, '魔师');
  });
});

/* =========================================================
   CLI end to end
   ========================================================= */
group('cli', () => {
  const run = (args) => execFileSync(process.execPath, [CLI, ...args], { encoding: 'utf8' });

  test('format writes a file', () => {
    const input = fixture('cli-in.txt', '[第001章] 开端\n正文内容\n');
    const out = path.join(TMP, 'cli-out.txt');
    run(['format', input, '-o', out]);
    const text = fs.readFileSync(out, 'utf8');
    assert.ok(text.startsWith('[第001章]\u3000开端'));
  });

  test('merge writes output and report', () => {
    const a = fixture('cli-a.txt', '[第1章] 一\n短\n');
    const b = fixture('cli-b.txt', '[第1章] 一\n这一章内容明显更长一些\n[第2章] 二\n第二章内容\n');
    const out = path.join(TMP, 'cli-merged.txt');
    run(['merge', a, b, '-o', out]);
    assert.ok(fs.existsSync(out));
    assert.ok(fs.existsSync(path.join(TMP, 'cli-merged.report.md')));
  });

  test('inspect --json is machine readable', () => {
    const input = fixture('cli-inspect.txt', '[第001章] 开端\n正文\n');
    const json = JSON.parse(run(['inspect', input, '--json']));
    assert.equal(json.command, 'inspect');
    assert.equal(json.files[0].chapters, 1);
  });

  test('convert emits markdown and html', () => {
    const input = fixture('《测试书》-作者.txt', '[第001章] 开端\n正文\n');
    run(['convert', input, '--to', 'md', '-o', path.join(TMP, 'conv.md')]);
    const md = fs.readFileSync(path.join(TMP, 'conv.md'), 'utf8');
    assert.ok(md.includes('# 测试书'));
  });

  test('convert writes docx and epub', () => {
    const input = fixture('cli-fmt.txt', '[第001章] 开端\n正文\n');
    run(['convert', input, '--to', 'docx,epub', '-o', path.join(TMP, 'fmt.out')]);
    assert.ok(fs.existsSync(path.join(TMP, 'fmt.docx')));
    assert.ok(fs.existsSync(path.join(TMP, 'fmt.epub')));
  });

  test('convert appends the extension when the output has none', () => {
    const input = fixture('cli-ext.txt', '[第001章] 开端\n正文\n');
    const base = path.join(TMP, 'noext');
    run(['convert', input, '--to', 'epub', '-o', base]);
    assert.ok(fs.existsSync(base + '.epub'));
  });

  test('dry run writes nothing', () => {
    const input = fixture('cli-dry.txt', '[第001章]\n正文\n');
    const out = path.join(TMP, 'dry-out.txt');
    run(['format', input, '-o', out, '--dry-run']);
    assert.ok(!fs.existsSync(out));
  });

  test('install-skill copies into a target root', () => {
    const dest = path.join(TMP, 'skills');
    run(['install-skill', '--dest', dest]);
    assert.ok(fs.existsSync(path.join(dest, 'fin-doc-pipeline', 'SKILL.md')));
    run(['install-skill', '--dest', dest, '--uninstall']);
    assert.ok(!fs.existsSync(path.join(dest, 'fin-doc-pipeline')));
  });

  test('convert never overwrites the source file', () => {
    const input = fixture('guard.txt', '[第001章] 开端\n正文\n');
    const before = fs.readFileSync(input, 'utf8');
    run(['convert', input, '--to', 'txt', '-o', input]);
    assert.equal(fs.readFileSync(input, 'utf8'), before, 'source must stay untouched');
    assert.ok(fs.existsSync(path.join(TMP, 'guard.out.txt')), 'a distinct output name is used');
  });

  test('json input is accepted and converted', () => {
    const input = fixture('data.json', JSON.stringify({ chapters: ['a', 'b'] }, null, 2));
    const out = path.join(TMP, 'fromjson.md');
    run(['convert', input, '--to', 'md', '-o', out]);
    assert.ok(fs.existsSync(out));
    assert.ok(fs.readFileSync(out, 'utf8').includes('chapters'));
  });

  test('html input is stripped to text', () => {
    const input = fixture('page.html', '<html><body><h1>第一章</h1><p>正文一</p></body></html>');
    const out = path.join(TMP, 'fromhtml.txt');
    run(['format', input, '-o', out]);
    const text = fs.readFileSync(out, 'utf8');
    assert.ok(text.includes('正文一'));
    assert.ok(!text.includes('<p>'));
  });

  test('headings-file overrides automatic detection', () => {
    const input = fixture('manual.md', '任意一行\n正文一\n别的行\n正文二\n');
    const list = path.join(TMP, 'headings.txt');
    fs.writeFileSync(list, '任意一行\n');
    const out = path.join(TMP, 'manual-out.txt');
    run(['format', input, '--headings-file', list, '--rules', 'manual', '-o', out]);
    const text = fs.readFileSync(out, 'utf8');
    assert.ok(text.startsWith('任意一行'));
  });

  test('heading prefix appears in text output', () => {
    const input = fixture('prefix.md', '## 第一章 开端\n正文\n');
    const out = path.join(TMP, 'prefix-out.txt');
    run(['format', input, '--heading-prefix', '## ', '-o', out]);
    assert.ok(fs.readFileSync(out, 'utf8').includes('## [第001章]'));
  });

  test('unknown command exits non zero', () => {
    let code = 0;
    try { execFileSync(process.execPath, [CLI, 'nope'], { stdio: 'pipe' }); } catch (err) { code = err.status; }
    assert.equal(code, 2);
  });
});

/* =========================================================
   output formats
   ========================================================= */
group('formats', () => {
  const doc = parseDocument('[第1章] 开端\n正文一段\n[第2章] 继续\n正文二段');
  const meta = { title: '测试书', author: '某人' };

  test('docx contains the required package parts', () => {
    const buffer = toDocx(doc, { meta });
    const entries = readZip(buffer).map((e) => e.name);
    for (const part of ['[Content_Types].xml', '_rels/.rels', 'word/document.xml', 'word/styles.xml']) {
      assert.ok(entries.includes(part), 'missing ' + part);
    }
    const xml = readZip(buffer).find((e) => e.name === 'word/document.xml').data.toString('utf8');
    assert.ok(xml.includes('测试书'));
    assert.ok(xml.includes('开端'));
  });

  test('epub has a stored mimetype as the first entry', () => {
    const buffer = toEpub(doc, { meta });
    assert.equal(buffer.slice(30, 38).toString('utf8'), 'mimetype');
    assert.equal(buffer.readUInt16LE(8), 0, 'mimetype must be stored, not deflated');
    const entries = readZip(buffer);
    assert.equal(entries[0].data.toString('utf8'), 'application/epub+zip');
    const names = entries.map((e) => e.name);
    assert.ok(names.includes('META-INF/container.xml'));
    assert.ok(names.includes('OEBPS/content.opf'));
    assert.ok(names.includes('OEBPS/nav.xhtml'));
    const opf = entries.find((e) => e.name === 'OEBPS/content.opf').data.toString('utf8');
    assert.ok(opf.includes('测试书'));
    assert.ok(opf.includes('dc:creator'));
  });

  test('epub spine matches the chapter count', () => {
    const buffer = toEpub(doc, { meta });
    const entries = readZip(buffer);
    const opf = entries.find((e) => e.name === 'OEBPS/content.opf').data.toString('utf8');
    const spineCount = (opf.match(/<itemref /g) || []).length;
    assert.equal(spineCount, 2);
  });

  test('rtf starts with a header and escapes CJK', () => {
    const buffer = toRtf(doc, { meta });
    const text = buffer.toString('utf8');
    assert.ok(text.startsWith('{\\rtf1'));
    assert.ok(text.includes('\\u'));
    assert.ok(text.includes('\\par'));
  });

  test('renderFormat dispatches every supported format', () => {
    for (const format of SUPPORTED_FORMATS) {
      const rendered = renderFormat(doc, format, { meta });
      assert.ok(rendered.buffer.length > 0, format + ' produced an empty buffer');
      assert.equal(typeof rendered.binary, 'boolean');
      assert.ok(rendered.extension);
    }
  });

  test('renderFormat rejects unknown formats', () => {
    assert.throws(() => renderFormat(doc, 'mobi', { meta }), /不支持/);
  });
});

/* =========================================================
   input loaders
   ========================================================= */
group('loaders', () => {
  const doc = parseDocument('[第1章] 开端\n正文一\n[第2章] 继续\n正文二');
  const meta = { title: '往返测试', author: '作者' };

  test('docx round trip preserves chapters and metadata', () => {
    const buffer = toDocx(doc, { meta });
    const loaded = loadDocx(buffer);
    assert.equal(loaded.meta.title, '往返测试');
    assert.equal(loaded.meta.author, '作者');
    assert.equal(parseDocument(loaded.text).stats.chapterCount, 2);
  });

  test('epub round trip preserves chapters and metadata', () => {
    const buffer = toEpub(doc, { meta });
    const loaded = loadEpub(buffer);
    assert.equal(loaded.meta.title, '往返测试');
    assert.equal(parseDocument(loaded.text).stats.chapterCount, 2);
  });

  test('epub text does not duplicate the chapter heading', () => {
    const buffer = toEpub(doc, { meta });
    const lines = loadEpub(buffer).text.split('\n').filter(Boolean);
    const headings = lines.filter((l) => l.includes('开端'));
    assert.equal(headings.length, 1);
  });

  test('extension dispatch', () => {
    assert.equal(isContainer('a.docx'), true);
    assert.equal(isContainer('a.EPUB'), true);
    assert.equal(isContainer('a.txt'), false);
    assert.equal(isKnownInput('a.json'), true);
    assert.equal(isKnownInput('a.yaml'), true);
    assert.equal(isKnownInput('a.unknown'), false);
    assert.equal(formatOf('a.HTM'), 'html');
    assert.equal(formatOf('a.yml'), 'yml');
    assert.equal(loadDocument(toDocx(doc, { meta }), 'x.docx').format, 'docx');
  });

  test('html input keeps headings and drops markup', () => {
    const loaded = loadMarkup('<html><head><title>书名</title></head><body><h1>第一章</h1><p>正文一</p><script>x()</script></body></html>', 'a.html');
    assert.equal(loaded.meta.title, '书名');
    assert.ok(loaded.text.includes('第一章'));
    assert.ok(loaded.text.includes('正文一'));
    assert.ok(!loaded.text.includes('x()'));
  });

  test('rtf input decodes escapes', () => {
    const loaded = loadMarkup('{\\rtf1\\ansi \\u31532?\\u19968?\\u31456?\\par \\u27491?\\u25991?}', 'a.rtf');
    assert.ok(loaded.text.includes('第一章'));
  });
});

/* =========================================================
   pdf
   ========================================================= */
group('pdf', () => {
  const doc = parseDocument('[第1章] 开端\n正文一段\n[第2章] 继续\n正文二段');

  test('pdf has a valid header, catalog and trailer', () => {
    const buffer = toPdf(doc, { meta: { title: 'PDF 测试', author: '作者' } });
    const text = buffer.toString('latin1');
    assert.ok(text.startsWith('%PDF-1.'));
    assert.ok(text.includes('/Type /Catalog'));
    assert.ok(text.includes('/Type /Pages'));
    assert.ok(text.includes('UniGB-UCS2-H'));
    assert.ok(text.includes('WinAnsiEncoding'));
    assert.ok(/\/Count \d+/.test(text));
    assert.ok(text.trimEnd().endsWith('%%EOF'));
  });

  test('pdf page count grows with content', () => {
    const long = parseDocument('[第1章] 长文\n' + ('这是一段用来撑满页面的正文内容。'.repeat(40) + '\n').repeat(30));
    const buffer = toPdf(long, { meta: { title: 'x' } });
    const counts = buffer.toString('latin1').match(/\/Count (\d+)/g) || [];
    const pages = parseInt(counts[counts.length - 1].replace('/Count ', ''), 10);
    assert.ok(pages > 1, 'expected multiple pages, got ' + pages);
  });

  test('pdf escapes parentheses in metadata', () => {
    const buffer = toPdf(doc, { meta: { title: 'A (B) C', author: '' } });
    assert.ok(buffer.toString('latin1').includes('A \\(B\\) C'));
  });
});

/* =========================================================
   structured output
   ========================================================= */
group('structured output', () => {
  const doc = parseDocument('[第1章] 开端\n正文一\n[第2章] 继续\n正文二');
  const meta = { title: '测试', author: '作者' };

  test('json carries meta and chapters', () => {
    const data = JSON.parse(toJson(doc, { meta }));
    assert.equal(data.meta.title, '测试');
    assert.equal(data.chapters.length, 2);
    assert.equal(data.chapters[0].paragraphs[0], '正文一');
  });

  test('yaml, xml, csv and js are produced', () => {
    assert.ok(toYaml(doc, { meta }).includes('chapters:'));
    const xml = toXml(doc, { meta });
    assert.ok(xml.startsWith('<?xml'));
    assert.ok(xml.includes('<chapter'));
    const csv = toCsv(doc, { meta });
    assert.equal(csv.split('\n')[0].split(',').length, 8);
    assert.ok(toJs(doc, { meta }).startsWith('/** Generated'));
  });

  test('xml escapes special characters', () => {
    const risky = parseDocument('[第1章] a\n<tag> & stuff');
    const xml = toXml(risky, { meta: { title: 'A&B' } });
    assert.ok(xml.includes('&amp;'));
    assert.ok(!xml.includes('<tag>'));
  });
});

/* =========================================================
   custom titles and output naming
   ========================================================= */
group('customisation', () => {
  const doc = parseDocument('[第1章] 开端\n正文\n[番外第2章] 分支\n正文');

  test('title template supports {title} and {num:N}', () => {
    const out = doc.chapters.map((ch) => renderTitle(ch, { chapterTitle: '第{num:2}章 {title}' }));
    assert.equal(out[0], '第01章 开端');
  });

  test('{raw} does not duplicate the subtitle', () => {
    const [first] = doc.chapters.map((ch) => renderTitle(ch, { chapterTitle: '{raw}' }));
    assert.equal(first, '[第1章] 开端');
  });

  test('group chapters can use their own template', () => {
    const out = doc.chapters.map((ch) => renderTitle(ch, { groupChapterTitle: '{prefix}-{num}-{title}' }));
    assert.equal(out[1], '番外-002-分支');
  });
});

/* =========================================================
   pdf extras
   ========================================================= */
group('pdf extras', () => {
  const doc = parseDocument('[第1章] 开端\n正文一\n[第2章] 继续\n正文二');

  test('page numbers are embedded by default', () => {
    const buffer = toPdf(doc, { meta: { title: 'T' } });
    const text = buffer.toString('latin1');
    assert.ok(text.includes('/F2'), 'Helvetica font is registered for digits');
    const extracted = loadPdf(buffer).text.split('\n').map((l) => l.trim()).filter(Boolean);
    assert.ok(extracted.includes('1'));
    assert.ok(extracted.includes('2'));
  });

  test('page numbers can be disabled', () => {
    const withNumbers = toPdf(doc, { meta: { title: 'T' } });
    const without = toPdf(doc, { meta: { title: 'T' }, format: { pdfPageNumbers: false } });
    assert.ok(withNumbers.length > without.length);
  });

  test('pdf metadata keeps Chinese', () => {
    const buffer = toPdf(doc, { meta: { title: '中文标题', author: '作者名' } });
    const meta = loadPdf(buffer).meta;
    assert.equal(meta.title, '中文标题');
    assert.equal(meta.author, '作者名');
  });
});

/* =========================================================
   heading rules
   ========================================================= */
group('heading rules', () => {
  const ctx = buildContext({});

  test('recognises many heading styles', () => {
    assert.equal(detectHeading('第12章 风起', ctx).kind, 'chapter');
    assert.equal(detectHeading('第十二回', ctx).kind, 'chapter');
    assert.equal(detectHeading('第3节 小节', ctx).kind, 'section');
    assert.equal(detectHeading('第一卷 风起', ctx).kind, 'volume');
    assert.equal(detectHeading('Chapter IV: Dawn', ctx).num, 4);
    assert.equal(detectHeading('Part II', ctx).kind, 'volume');
    assert.equal(detectHeading('一、总则', ctx).kind, 'section');
    assert.equal(detectHeading('1. 范围', ctx).kind, 'section');
    assert.equal(detectHeading('[前言]', ctx).kind, 'special');
    assert.equal(detectHeading('普通正文', ctx), null);
  });

  test('markdown reuses the inner rule', () => {
    const hit = detectHeading('## [第001章] 开端', ctx);
    assert.equal(hit.kind, 'chapter');
    assert.equal(hit.num, 1);
    assert.equal(hit.sourceLevel, 2);
  });

  test('markdown level mapping can mark a title', () => {
    const mapped = buildContext({ markdown: { titleLevels: [1], chapterLevels: [2], sectionLevels: [3] } });
    assert.equal(detectHeading('# 书名', mapped).kind, 'title');
    assert.equal(detectHeading('## 开端', mapped).kind, 'chapter');
    assert.equal(detectHeading('### 小节', mapped).kind, 'section');
  });

  test('rules can be disabled', () => {
    const only = buildContext({ rules: ['numbered-cn'] });
    assert.equal(detectHeading('## [第001章]', only), null);
    assert.equal(detectHeading('第1章', only).kind, 'chapter');
  });

  test('custom regex rule', () => {
    const custom = buildContext({ customRules: [{ pattern: '^◆ (.+)$', kind: 'section', level: 2 }] });
    const hit = detectHeading('◆ 特殊标题', custom);
    assert.equal(hit.kind, 'section');
    assert.equal(hit.subtitle, '特殊标题');
  });

  test('manual heading list wins', () => {
    const manual = buildContext({ rules: ['manual'], headings: new Set(['任意一行']) });
    assert.equal(detectHeading('任意一行', manual).kind, 'chapter');
    assert.equal(detectHeading('别的行', manual), null);
  });

  test('heuristic is opt in', () => {
    const on = buildContext({ rules: ['heuristic'], heuristic: { enabled: true, maxLength: 20 } });
    on.lineContext = { beforeBlank: true, afterBlank: true };
    assert.equal(detectHeading('短标题', on).kind, 'chapter');
    assert.equal(detectHeading('这是一个很长很长的句子，并且有标点。', on), null);
    assert.equal(detectHeading('短标题', buildContext({})), null);
  });

  test('roman numerals', () => {
    assert.equal(romanToInt('IV'), 4);
    assert.equal(romanToInt('xii'), 12);
    assert.equal(romanToInt('abc'), null);
  });
});

/* =========================================================
   sections
   ========================================================= */
group('sections', () => {
  const doc = parseDocument('## 第一章 开端\n正文一\n### 第一节\n小节一\n### 第二节\n小节二\n## 第二章\n正文二');

  test('sections nest under the preceding chapter', () => {
    assert.equal(doc.chapters.length, 2);
    assert.equal(doc.chapters[0].sections.length, 2);
    assert.equal(doc.chapters[0].sections[0].paragraphs[0], '小节一');
    assert.equal(doc.stats.sectionCount, 2);
  });

  test('text output renders section headings', () => {
    const text = renderDocument(doc, {});
    assert.ok(text.includes('第一节'));
    assert.ok(text.includes('小节一'));
  });

  test('markdown uses one level deeper for sections', () => {
    const md = toMarkdown(doc, { meta: { title: 'T' } });
    assert.ok(md.includes('## [第001章]'));
    assert.ok(md.includes('### 第一节'));
  });

  test('epub keeps a chapter and its sections in one document', () => {
    const buffer = toEpub(doc, { meta: { title: 'T' } });
    const entries = readZip(buffer);
    const chapterFile = entries.find((e) => e.name === 'OEBPS/text/ch001.xhtml');
    assert.ok(chapterFile, 'first chapter document exists');
    const html = chapterFile.data.toString('utf8');
    assert.ok(html.includes('第一节'));
    assert.ok(html.includes('小节一'));
  });

  test('merge carries sections with the chosen chapter', () => {
    const other = parseDocument('[第1章] 开端\n正文一\n[第2章] 二\n正文二');
    const { doc: merged } = mergeDocuments([
      { label: 'a.md', doc },
      { label: 'b.txt', doc: other },
    ], { mode: 'versions' });
    const first = merged.chapters.find((c) => c.num === 1);
    assert.ok(first.sections.length === 2, 'sections survive the merge');
  });
});

/* =========================================================
   heading customisation
   ========================================================= */
group('heading customisation', () => {
  const doc = parseDocument('## 第一章 开端\n正文\n### 第一节\n小节');

  test('unnumbered headings do not invent a number', () => {
    const plain = parseDocument('# 书名\n正文');
    assert.equal(renderTitle(plain.chapters[0], {}), '书名');
  });

  test('global prefix and suffix wrap every heading', () => {
    const out = renderDocument(doc, { headingPrefix: '§ ', headingSuffix: ' §' });
    assert.ok(out.includes('§ [第001章]　开端 §'));
    assert.ok(out.includes('§ 第一节 §'));
  });

  test('section and volume templates are separate', () => {
    const [first] = doc.chapters;
    assert.equal(renderTitle(first.sections[0], { sectionTitle: '【{title}】' }), '【第一节】');
  });

  test('section prefix can differ from the chapter prefix', () => {
    const out = renderDocument(doc, { headingPrefix: '## ', sectionPrefix: '### ' });
    assert.ok(out.includes('## [第001章]'));
    assert.ok(out.includes('### 第一节'));
  });

  test('markdown markers follow the configured mode', () => {
    assert.equal(markdownMarker(doc.chapters[0], {}), '##');
    assert.equal(markdownMarker(doc.chapters[0].sections[0], {}), '###');
    assert.equal(markdownMarker(doc.chapters[0], { mdHeading: 'none' }), '');
    assert.equal(markdownMarker(doc.chapters[0], { mdHeading: 'level:4' }), '####');
    assert.equal(markdownMarker(doc.chapters[0], { mdHeading: 'preserve' }), '##');
  });
});

group('web single file', () => {
  const indexFile = path.join(HERE, '..', 'index.html');

  test('index.html matches the sources it is generated from', () => {
    const { html } = renderWebIndex();
    assert.equal(fs.readFileSync(indexFile, 'utf8'), html);
  });

  test('index.html pulls in no external script or stylesheet', () => {
    const html = fs.readFileSync(indexFile, 'utf8');
    const tags = html.match(/<script\b[^>]*>/g) || [];
    assert.equal(tags.length, 2);
    assert.ok(tags.every((tag) => !/\ssrc=/i.test(tag)));
    assert.ok(!html.includes('<script type="module">'));
    const template = fs.readFileSync(path.join(HERE, '..', 'web', 'index.template.html'), 'utf8');
    assert.ok(!/<link[^>]+stylesheet/.test(template));
    assert.ok(!/<script[^>]+\ssrc=/.test(template));
  });

  test('the bundle inlines the browser graph only', () => {
    const { source, modules } = bundleWeb();
    assert.ok(modules.includes('web/buffer.mjs'));
    assert.ok(modules.includes('src/converters.mjs'));
    assert.ok(modules.includes('web/app.mjs'));
    assert.ok(!modules.includes('src/cli.mjs'));
    assert.ok(!modules.includes('src/codec-node.mjs'));
    assert.ok(!modules.some((id) => id.startsWith('src/loaders/')));
    assert.ok(source.includes("__require('web/app.mjs');"));
    assert.ok(source.includes("__require('web/buffer.mjs').installBuffer();"));
  });

  test('the page reports when the bundle did not run', () => {
    const html = fs.readFileSync(indexFile, 'utf8');
    assert.ok(html.includes('__TEXT_TOOL_READY__'));
    assert.ok(html.includes('页面脚本没有加载'));
  });
});

/* =========================================================
   Summary
   ========================================================= */
fs.rmSync(TMP, { recursive: true, force: true });
process.stdout.write('\n' + passed + ' passed, ' + failed + ' failed\n');
if (failed) {
  for (const f of failures) {
    process.stdout.write('\n--- ' + f.name + ' ---\n' + (f.err && f.err.stack ? f.err.stack : String(f.err)) + '\n');
  }
  process.exit(1);
}