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
import { lintDocument, lintRawText, fixDocument, fixRawText, CLEAN_FIXES } from '../src/lint.mjs';
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
import { encodeOutput, normalizeEncoding, isSupportedEncoding } from '../src/output.mjs';
import { prepareInput, markupFormatOf } from '../src/input.mjs';
import { render as renderWebIndex, bundle as bundleWeb } from '../scripts/build-web.mjs';
import {
  toSimplified, traditionalChars, normalizeChinesePunctuation,
  normalizeEnglishWords, normalizeDateAndTime, findTypos,
} from '../src/chinese.mjs';
import { deriveChapterTitle, fillChapterTitles, extractKeyphrases } from '../src/titles.mjs';

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
   output encoding
   ========================================================= */
group('output encoding', () => {
  test('utf-8 with BOM', () => {
    const out = encodeOutput('中文\n', { encoding: 'utf-8', bom: true });
    assert.deepEqual(Array.from(out.bytes.slice(0, 3)), [0xef, 0xbb, 0xbf]);
    assert.equal(new TextDecoder().decode(out.bytes.subarray(3)), '中文\n');
  });

  test('utf-16le gets a BOM by default', () => {
    const out = encodeOutput('ab', { encoding: 'utf-16le' });
    assert.deepEqual(Array.from(out.bytes), [0xff, 0xfe, 0x61, 0x00, 0x62, 0x00]);
  });

  test('utf-16be can be written without a BOM', () => {
    const out = encodeOutput('ab', { encoding: 'utf-16be', bom: false });
    assert.deepEqual(Array.from(out.bytes), [0x00, 0x61, 0x00, 0x62]);
  });

  test('crlf is applied before encoding', () => {
    const out = encodeOutput('a\nb', { encoding: 'utf-8', eol: 'crlf' });
    assert.equal(new TextDecoder().decode(out.bytes), 'a\r\nb');
  });

  test('latin1 reports characters it cannot represent', () => {
    const out = encodeOutput('a中', { encoding: 'latin1' });
    assert.equal(out.lossy, 1);
    assert.equal(out.bytes[0], 0x61);
  });

  test('names that need a mapping table throw E_ENCODING', () => {
    assert.throws(() => normalizeEncoding('gbk'), (error) => error.code === 'E_ENCODING');
    assert.equal(isSupportedEncoding('utf8'), true);
    assert.equal(isSupportedEncoding('gbk'), false);
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

  test('prose that looks like a chapter is not a heading', () => {
    assert.equal(classifyLine('第一回合的比赛开始了。'), null);
    assert.equal(classifyLine('第一回合'), null);
    assert.equal(classifyLine('第一节课很有意思。'), null);
    assert.equal(classifyLine('第一章讲述了一个故事。'), null);
    assert.equal(classifyLine('第一章 开端').kind, 'chapter');
    assert.equal(classifyLine('第12回 风起').kind, 'chapter');
  });

  test('parenthesised list numbers are sections', () => {
    const hit = classifyLine('（三）小节标题');
    assert.equal(hit.kind, 'section');
    assert.equal(hit.num, 3);
    assert.equal(hit.subtitle, '小节标题');
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
/* =========================================================
   input preparation
   ========================================================= */
group('input preparation', () => {
  test('html becomes markdown headings and plain paragraphs', () => {
    const res = prepareInput('book.html', Buffer.from('<html><body><h1>第1章 开端</h1><p>他打开MacBook。</p></body></html>'));
    assert.equal(res.format, 'html');
    assert.ok(res.text.startsWith('# 第1章 开端'));
    assert.ok(res.text.includes('他打开MacBook。'));
    assert.ok(!res.text.includes('<h1>'));
  });

  test('rtf control words are removed', () => {
    const res = prepareInput('book.rtf', Buffer.from('{\\rtf1\\ansi 第1章 开端\\par 他说{\\b hello}。\\par}'));
    assert.equal(res.format, 'rtf');
    assert.ok(res.text.includes('第1章 开端'));
    assert.ok(!res.text.includes('\\rtf1'));
  });

  test('raw repairs run before parsing', () => {
    const res = prepareInput('dirty.txt', Buffer.from('\uFEFF第1章\r\n\r\n\r\n正文。   \r\n\t第二段\r\n', 'utf8'));
    assert.ok(!res.text.includes('\r'));
    assert.ok(!/[ \t]+\n/.test(res.text));
    assert.ok(res.fixed.some((f) => f.id === 'R001'));
    assert.ok(res.rawIssues.some((i) => i.id === 'R002'));
  });

  test('markup format is chosen from the extension', () => {
    assert.equal(markupFormatOf('a.HTML'), 'html');
    assert.equal(markupFormatOf('a.xhtml'), 'html');
    assert.equal(markupFormatOf('a.rtf'), 'rtf');
    assert.equal(markupFormatOf('a.md'), 'text');
  });
});

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
    const issues = lintRawText('\uFEFFa\r\nb\n\n\n\nc   \n\td\n');
    const ids = issues.map((i) => i.id);
    ['R001', 'R002', 'R003', 'R004', 'R005'].forEach((id) => assert.ok(ids.includes(id), id));
  });

  test('raw text repairs normalise line endings and whitespace', () => {
    const res = fixRawText('\uFEFF第一章\r\n\r\n\r\n\r\n正文。   \r\n\t第二段\r\n', { bom: true });
    assert.ok(!res.text.startsWith('\uFEFF'));
    assert.ok(!res.text.includes('\r'));
    assert.ok(!/[ \t]+\n/.test(res.text));
    assert.ok(!/\n\t/.test(res.text));
    const ids = res.fixed.map((f) => f.id);
    ['R001', 'R002', 'R003', 'R004', 'R005'].forEach((id) => assert.ok(ids.includes(id), id));
  });

  test('detects and fixes Chinese-Latin spacing', () => {
    const doc = parseDocument('[第1章]\n他打开MacBook说hello世界');
    assert.ok(lintDocument(doc).issues.some((i) => i.id === 'C010'));
    const fixed = fixDocument(doc, { rules: ['C010'] });
    assert.equal(fixed.doc.chapters[0].paragraphs[0], '他打开 MacBook 说 hello 世界');
  });

  test('number-unit spacing leaves percent alone', () => {
    const doc = parseDocument('[第1章]\n重量5kg，进度50%。');
    assert.ok(lintDocument(doc).issues.some((i) => i.id === 'C012'));
    const fixed = fixDocument(doc, { rules: ['C012'] });
    assert.equal(fixed.doc.chapters[0].paragraphs[0], '重量5 kg，进度50%。');
  });

  test('line-start punctuation is reported but never rewritten', () => {
    const doc = parseDocument('[第1章]\n”他走了。\n“这是对话。”');
    const c011 = lintDocument(doc).issues.filter((i) => i.id === 'C011');
    assert.equal(c011.length, 1);
    const fixed = fixDocument(doc, { rules: ['C011'] });
    assert.equal(fixed.fixed.length, 0);
  });

  test('detects nested book titles, brackets and quotes', () => {
    const doc = parseDocument('[第1章]\n《小说《名称》嵌套》\n（外层（内层））\n“他说“你好””');
    const ids = lintDocument(doc).issues.map((i) => i.id);
    assert.ok(ids.includes('C013'));
    assert.ok(ids.includes('C014'));
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

  test('check --fix repairs raw text problems', () => {
    const input = fixture('cli-raw.txt', '\uFEFF第一章 开端\r\n\r\n\r\n\r\n正文。   \r\n\t第二段。\r\n');
    const out = path.join(TMP, 'cli-raw-fixed.txt');
    const stdout = run(['check', input, '--fix', '-o', out]);
    assert.ok(stdout.includes('R001'));
    const bytes = fs.readFileSync(out);
    assert.ok(!bytes.toString('utf8').startsWith('\uFEFF'));
    assert.ok(!bytes.includes(13));
  });

  test('format applies raw-text repairs before parsing', () => {
    const input = path.join(TMP, 'cli-dirty.txt');
    fs.writeFileSync(input, Buffer.from('\uFEFF第1章 开端\r\n\r\n正文。   \r\n\t第二段\r\n', 'utf8'));
    const out = path.join(TMP, 'cli-dirty.out.txt');
    run(['format', input, '-o', out]);
    const bytes = fs.readFileSync(out);
    assert.ok(!(bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf));
    const text = bytes.toString('utf8');
    assert.ok(!text.includes('\r'));
    assert.ok(!/[ \t]+\n/.test(text));
    assert.ok(!text.includes('\t第二段'));
  });

  test('--encoding utf-16le writes a BOM and little endian bytes', () => {
    const input = fixture('cli-utf16.txt', '第1章 开端\n\n正文。\n');
    const out = path.join(TMP, 'cli-utf16.out.txt');
    run(['format', input, '-o', out, '--encoding', 'utf-16le']);
    const bytes = fs.readFileSync(out);
    assert.equal(bytes[0], 0xff);
    assert.equal(bytes[1], 0xfe);
    const text = new TextDecoder('utf-16le').decode(bytes.subarray(2));
    assert.ok(text.includes('开端'));
  });

  test('--encoding gbk uses the system iconv when available', () => {
    const hasIconv = (() => {
      try { execFileSync('iconv', ['-l'], { stdio: 'ignore' }); return true; } catch { return false; }
    })();
    const input = fixture('cli-gbk.txt', '第1章 开端\n\n正文。\n');
    const out = path.join(TMP, 'cli-gbk.out.txt');
    if (!hasIconv) {
      assert.throws(() => execFileSync(process.execPath, [CLI, 'format', input, '-o', out, '--encoding', 'gbk'], { stdio: 'pipe' }));
      return;
    }
    run(['format', input, '-o', out, '--encoding', 'gbk']);
    const detected = detectEncoding(fs.readFileSync(out));
    assert.equal(detected.encoding, 'gbk');
    assert.ok(detected.text.includes('开端'));
  });

  test('an unknown encoding fails loudly instead of writing UTF-8', () => {
    const input = fixture('cli-bad-enc.txt', '第1章\n\n正文。\n');
    const out = path.join(TMP, 'cli-bad-enc.out.txt');
    let failure = null;
    try {
      execFileSync(process.execPath, [CLI, 'format', input, '-o', out, '--encoding', 'nope'], { stdio: 'pipe' });
    } catch (error) {
      failure = error;
    }
    assert.ok(failure, 'expected a non-zero exit');
    assert.ok(String(failure.stderr).includes('E_ENCODING'));
    assert.ok(!fs.existsSync(out));
  });

  test('the page pipeline and the CLI agree byte for byte', () => {
    const input = path.join(TMP, 'parity.txt');
    fs.writeFileSync(input, Buffer.from('\uFEFF第1章 开端\r\n\r\n\r\n正文。   \r\n\t第二段\r\n', 'utf8'));
    const cliOut = path.join(TMP, 'parity-cli.bin');
    run(['format', input, '-o', cliOut, '--encoding', 'utf-16le', '--bom', '--eol', 'crlf']);

    const prepared = prepareInput('parity.txt', fs.readFileSync(input));
    let doc = parseDocument(prepared.text);
    doc = fixDocument(doc, { rules: CLEAN_FIXES }).doc;
    const text = renderDocument(doc, DEFAULT_FORMAT);
    const page = encodeOutput(text, { encoding: 'utf-16le', bom: true, eol: 'crlf' });

    assert.deepEqual(Array.from(fs.readFileSync(cliOut)), Array.from(page.bytes));
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

group('chinese proofreading', () => {
  test('traditional characters become simplified', () => {
    assert.equal(toSimplified('繁體字轉換與標點符號'), '繁体字转换与标点符号');
  });

  test('context sensitive characters keep their correct form', () => {
    assert.equal(toSimplified('乾隆與乾坤'), '乾隆与乾坤');
    assert.ok(toSimplified('我們乾杯').includes('干杯'));
    assert.ok(toSimplified('這本著名的著作').includes('著作'));
    assert.ok(toSimplified('他著急地睡著了').includes('着急'));
    assert.ok(toSimplified('尋求慰藉').includes('慰藉'));
    assert.ok(toSimplified('找個藉口').includes('借口'));
  });

  test('traditional characters are reported for lint', () => {
    assert.deepEqual(traditionalChars('繁體字'), ['體']);
    assert.deepEqual(traditionalChars('简体字'), []);
  });

  test('corner brackets become curly quotes', () => {
    assert.equal(normalizeChinesePunctuation('「你好」「再見」'), '“你好”“再見”');
  });

  test('repeated punctuation collapses but the ellipsis survives', () => {
    assert.equal(normalizeChinesePunctuation('真的！！！'), '真的！');
    assert.equal(normalizeChinesePunctuation('他說……然後走了！！！'), '他說……然後走了！');
    assert.equal(normalizeChinesePunctuation('真的，，，'), '真的，');
  });

  test('half-width punctuation next to Chinese becomes full-width', () => {
    assert.equal(normalizeChinesePunctuation('他說,好;真的'), '他說，好；真的');
  });

  test('english words are half-width, title case, acronyms upper case', () => {
    assert.equal(normalizeEnglishWords('hello world'), 'Hello World');
    assert.equal(normalizeEnglishWords('kfc 和 usdt'), 'KFC 和 USDT');
    assert.equal(normalizeEnglishWords('iphone'), 'iPhone');
    assert.equal(normalizeEnglishWords('１２３ＡＢＣ'), '123ABC');
  });

  test('dates become yyyy-MM-dd and keep the time', () => {
    assert.equal(normalizeDateAndTime('2024年3月5日'), '2024-03-05');
    assert.equal(normalizeDateAndTime('2024/3/5 12:30'), '2024-03-05 12:30');
    assert.equal(normalizeDateAndTime('2024.12.31'), '2024-12-31');
  });

  test('common typos are found and fixed', () => {
    assert.deepEqual(findTypos('按耐不住').map((t) => t.right), ['按捺']);
  });

  test('chapter titles summarise the whole section, not its opening', () => {
    const chapter = {
      paragraphs: [
        '近年來，平台經濟快速發展，靈活就業成為許多勞動者的選擇。',
        '平台經濟依託數字技術，把需求與供給即時匹配起來。',
        '靈活就業的好處是時間自由，但社會保障往往跟不上。',
        '不少平台從業者沒有簽訂勞動合同，工傷保障成為空白。',
        '因此，完善靈活就業的社會保障制度，是平台經濟健康發展的關鍵。',
      ],
    };
    const title = deriveChapterTitle(chapter);
    assert.equal(title, '平台經濟');
    assert.ok(title.length <= 6);
    const ranked = extractKeyphrases(chapter);
    assert.ok(ranked[0].count > 1, 'a titled term should repeat in the section');
  });

  test('chapter titles prefer the longer phrase of a term', () => {
    const chapter = {
      paragraphs: [
        '短期主義讓人只看眼前。',
        '短期主義的代價會在幾年後顯現。',
        '企業被短期主義綁住，就不敢投入長期研發。',
        '擺脫短期主義，需要改變考核方式。',
      ],
    };
    assert.equal(deriveChapterTitle(chapter), '短期主義');
  });

  test('chapter titles ignore wording shared by every chapter', () => {
    const doc = {
      chapters: [
        {
          id: 'c1', kind: 'chapter', subtitle: '',
          paragraphs: [
            '這個問題值得討論。',
            '垃圾分類需要居民長期配合。',
            '垃圾分類的難點在於習慣養成。',
            '垃圾分類的宣傳必須持續。',
            '這個問題在小區裡爭議很大。',
          ],
        },
        {
          id: 'c2', kind: 'chapter', subtitle: '',
          paragraphs: [
            '這個問題同樣困擾著用人單位。',
            '就業是民生之本。',
            '就業形勢總體穩定。',
            '就業結構仍然需要調整。',
            '這個問題要靠政策解決。',
          ],
        },
      ],
    };
    const filled = fillChapterTitles(doc);
    assert.deepEqual(filled.filled.map((item) => item.title), ['垃圾分類', '就業']);
  });

  test('a narrative section without a repeated term uses its opening clause', () => {
    const chapter = {
      paragraphs: [
        '夜色深沉，他獨自走在街上，風從巷口吹過來。',
        '他不知道該去哪裡，只知道不能停下來。',
        '身後的腳步聲越來越近，他的手心開始出汗。',
        '轉過街角，一盞昏黃的路燈下站著一個人。',
        '那人抬起頭，露出一張他再熟悉不過的臉。',
      ],
    };
    assert.equal(deriveChapterTitle(chapter), '夜色深沉');
  });

  test('short chapters fall back to the opening noun phrase', () => {
    assert.equal(deriveChapterTitle({ paragraphs: ['他推開門，看見屋裡空無一人。'] }), '推開門');
    assert.equal(deriveChapterTitle({ paragraphs: ['數據備份是系統運維中最容易被忽視的環節。'] }), '數據備份');
  });

  test('lint reports the chinese rules', () => {
    const doc = parseDocument('第一章 開端\n\n他說：「真的？！！」2024年3月5日。\n');
    const ids = new Set(lintDocument(doc, { level: 'info' }).issues.map((i) => i.id));
    for (const id of ['C001', 'C002', 'C003', 'C005']) assert.ok(ids.has(id), 'missing ' + id);
  });

  test('fixDocument applies the proofreading rules', () => {
    const doc = parseDocument('第一章 開始\n\n他說：「真的？！！」他按耐不住。\n');
    const res = fixDocument(doc, { rules: ['C001', 'C002', 'C003', 'C006'] });
    const text = res.doc.chapters[0].paragraphs.join('');
    assert.ok(text.includes('“真的？！”'));
    assert.ok(text.includes('按捺'));
    assert.ok(res.doc.chapters[0].subtitle.includes('开始'));
  });

  test('missing chapter titles fall back to the opening clause', () => {
    const doc = parseDocument('第一章\n\n夜色深沉，他獨自走在街上。\n');
    const filled = fillChapterTitles(doc);
    assert.equal(filled.filled.length, 1);
    assert.equal(filled.doc.chapters[0].subtitle, '夜色深沉');
  });

  test('--proofread fixes a messy file end to end', () => {
    const input = fixture('proofread.txt', '第一章 開始\n\n他說：「真的？！！」他著急地走了。\n\n2024年3月5日 12:30 出發。\n');
    const out = path.join(TMP, 'proofread.out.txt');
    execFileSync(process.execPath, [CLI, 'format', input, '--proofread', '-o', out], { encoding: 'utf8' });
    const text = fs.readFileSync(out, 'utf8');
    assert.ok(text.includes('开始'));
    assert.ok(text.includes('“真的？！”'));
    assert.ok(text.includes('2024-03-05 12:30'));
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
    assert.ok(modules.includes('src/loaders/markup.mjs'));
    assert.ok(modules.includes('src/output.mjs'));
    assert.ok(modules.includes('src/input.mjs'));
    assert.ok(!modules.includes('src/loaders/index.mjs'));
    assert.ok(!modules.some((id) => /^src\/loaders\/(docx|epub|pdf)\.mjs$/.test(id)));
    assert.ok(source.includes("__require('web/app.mjs');"));
    assert.ok(source.includes("__require('web/buffer.mjs').installBuffer();"));
  });

  test('the page wires markup removal, raw repairs and encoding controls', () => {
    const html = fs.readFileSync(indexFile, 'utf8');
    ['htmlToPlainText', 'rtfToPlainText', 'lintRawText', 'renderLintReport', 'encodeOutput'].forEach((name) => {
      assert.ok(html.includes(name), name);
    });
    ['outEncoding', 'outBom', 'outEol', 'btnIssues', 'issuesBox'].forEach((id) => {
      assert.ok(html.includes('id="' + id + '"'), id);
    });
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