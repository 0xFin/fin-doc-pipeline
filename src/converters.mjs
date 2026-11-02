/**
 * converters.mjs — turn a parsed document into another file format.
 *
 * Converters work on the document tree, never on the already typeset text, so
 * chapter structure survives the round trip. All converters accept the same
 * optional metadata:
 *
 *   meta = { title, author, description, language }
 */

import { stripBrackets } from './parser.mjs';
import { renderTitle, markdownMarker, cleanParagraph, normalizePunctuation, reflowParagraphs, renderDocument } from './typography.mjs';
import { toDocx } from './formats/docx.mjs';
import { toEpub } from './formats/epub.mjs';
import { toRtf } from './formats/rtf.mjs';
import { toPdf } from './formats/pdf.mjs';
import { toJson, toYaml, toXml, toCsv, toJs } from './formats/data.mjs';

/** Derive a book title and author from a typical file name. */
export function guessMetaFromFilename(filename) {
  const base = String(filename || '').split(/[\\/]/).pop().replace(/\.(txt|md|markdown)$/i, '');
  const bracket = base.match(/^《(.+?)》\s*[-—–]?\s*(.*)$/);
  if (bracket) {
    return { title: bracket[1].trim(), author: (bracket[2] || '').trim() };
  }
  const dash = base.match(/^(.+?)\s*[-—–]\s*(.+)$/);
  if (dash) return { title: dash[1].trim(), author: dash[2].trim() };
  return { title: base.trim(), author: '' };
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function prepareParagraphs(chapter, fmt) {
  let ps = chapter.paragraphs.map((p) => cleanParagraph(p, fmt)).filter(Boolean);
  if (fmt.normalizePunctuation) ps = ps.map(normalizePunctuation);
  if (fmt.reflow) ps = reflowParagraphs(ps);
  return ps;
}

/** Render a document as Markdown. */
export function toMarkdown(doc, options) {
  const opts = options || {};
  const fmt = opts.format || {};
  const meta = opts.meta || {};
  const lines = [];

  const title = meta.title || '';
  const includeTitle = opts.includeTitle !== false;
  if (title && includeTitle) {
    lines.push('# ' + title);
    lines.push('');
    if (meta.author) {
      lines.push('> 作者：' + meta.author);
      lines.push('');
    }
    if (meta.description) {
      lines.push(meta.description);
      lines.push('');
    }
  }

  const front = (doc.frontMatter || []).map((p) => cleanParagraph(p, fmt)).filter(Boolean);
  for (const p of front) {
    lines.push(p);
    lines.push('');
  }

  for (const ch of doc.chapters) {
    const heading = renderTitle(ch, fmt);
    const marker = markdownMarker(ch, fmt);
    lines.push(marker ? marker + ' ' + heading : heading);
    lines.push('');
    for (const p of prepareParagraphs(ch, fmt)) {
      lines.push(p);
      lines.push('');
    }
    for (const section of ch.sections || []) {
      const sectionMarker = markdownMarker(section, fmt);
      lines.push(sectionMarker ? sectionMarker + ' ' + renderTitle(section, fmt) : renderTitle(section, fmt));
      lines.push('');
      for (const p of prepareParagraphs(section, fmt)) {
        lines.push(p);
        lines.push('');
      }
    }
  }

  while (lines.length && lines[lines.length - 1] === '') lines.pop();
  return lines.join('\n') + '\n';
}

/** Base stylesheet used by the HTML output and, later, by EPUB chapters. */
export const BASE_CSS = [
  ':root { --fg: #1c1b1a; --muted: #6b6a66; --bg: #fbfaf7; }',
  '* { box-sizing: border-box; }',
  'html { -webkit-text-size-adjust: 100%; }',
  'body {',
  '  margin: 0 auto; max-width: 38em; padding: 3rem 1.25rem 6rem;',
  '  background: var(--bg); color: var(--fg);',
  '  font-family: "Songti SC", "Noto Serif CJK SC", "Source Han Serif SC", serif;',
  '  font-size: 17px; line-height: 1.9; text-align: justify;',
  '}',
  'h1 { font-size: 1.9em; line-height: 1.4; margin: 1.2em 0 0.2em; text-align: center; letter-spacing: 0.02em; }',
  '.author { text-align: center; color: var(--muted); margin-bottom: 2.5em; font-size: 0.95em; }',
  'h2 { font-size: 1.25em; margin: 2.6em 0 1.2em; text-align: center; font-weight: 600; letter-spacing: 0.04em; }',
  'h3 { font-size: 1.05em; margin: 2.2em 0 1em; text-align: center; color: var(--muted); }',
  'p { margin: 0 0 0.35em; text-indent: 2em; }',
  'p.no-indent { text-indent: 0; }',
  'hr { border: 0; border-top: 1px solid #ddd8cd; margin: 2.5em auto; width: 40%; }',
  '@media (max-width: 600px) { body { padding: 1.5rem 1rem 4rem; font-size: 16px; } }',
  '@media print { body { background: #fff; max-width: none; padding: 0; } h2 { page-break-before: always; } }',
].join('\n');

/** Render a document as a standalone HTML page. */
export function toHtml(doc, options) {
  const opts = options || {};
  const fmt = opts.format || {};
  const meta = opts.meta || {};
  const title = meta.title || '未命名';
  const lang = meta.language || 'zh-CN';
  const parts = [];

  parts.push('<!DOCTYPE html>');
  parts.push('<html lang="' + escapeHtml(lang) + '">');
  parts.push('<head>');
  parts.push('<meta charset="utf-8">');
  parts.push('<meta name="viewport" content="width=device-width, initial-scale=1">');
  parts.push('<title>' + escapeHtml(title) + '</title>');
  if (meta.author) parts.push('<meta name="author" content="' + escapeHtml(meta.author) + '">');
  if (meta.description) parts.push('<meta name="description" content="' + escapeHtml(meta.description) + '">');
  parts.push('<style>');
  parts.push(BASE_CSS);
  parts.push('</style>');
  parts.push('</head>');
  parts.push('<body>');
  if (opts.includeTitle !== false) parts.push('<h1>' + escapeHtml(title) + '</h1>');
  if (meta.author) parts.push('<p class="author no-indent">' + escapeHtml(meta.author) + '</p>');

  const front = (doc.frontMatter || []).map((p) => cleanParagraph(p, fmt)).filter(Boolean);
  for (const p of front) parts.push('<p>' + escapeHtml(p) + '</p>');

  for (const ch of doc.chapters) {
    const heading = renderTitle(ch, fmt);
    const tag = ch.kind === 'chapter' ? 'h2' : 'h3';
    if (ch.kind !== 'section') parts.push('<hr>');
    parts.push('<' + tag + '>' + escapeHtml(heading) + '</' + tag + '>');
    for (const p of prepareParagraphs(ch, fmt)) {
      parts.push('<p>' + escapeHtml(p) + '</p>');
    }
    for (const section of ch.sections || []) {
      parts.push('<h4>' + escapeHtml(renderTitle(section, fmt)) + '</h4>');
      for (const p of prepareParagraphs(section, fmt)) {
        parts.push('<p>' + escapeHtml(p) + '</p>');
      }
    }
  }

  parts.push('</body>');
  parts.push('</html>');
  return parts.join('\n') + '\n';
}

/** Every format the converter can produce. */
export const SUPPORTED_FORMATS = ['txt', 'md', 'html', 'json', 'yaml', 'xml', 'csv', 'js', 'rtf', 'docx', 'epub', 'pdf'];

const EXTENSIONS = {
  txt: 'txt', text: 'txt',
  md: 'md', markdown: 'md',
  html: 'html', htm: 'html',
  json: 'json',
  jsonl: 'json',
  yaml: 'yaml', yml: 'yaml',
  xml: 'xml',
  csv: 'csv', tsv: 'csv',
  js: 'js', mjs: 'js',
  rtf: 'rtf',
  docx: 'docx',
  epub: 'epub',
  pdf: 'pdf',
};

/** File extension for a format name. */
export function extensionFor(format) {
  const key = String(format || '').toLowerCase();
  return EXTENSIONS[key] || key;
}

/**
 * Render a document in one target format.
 * @param {object} doc parsed document
 * @param {string} format one of SUPPORTED_FORMATS
 * @param {{format?: object, meta?: object}} [options]
 * @returns {{buffer: Buffer, binary: boolean, extension: string}}
 */
export function renderFormat(doc, format, options) {
  const key = String(format || '').toLowerCase();
  const opts = options || {};
  const extension = extensionFor(key);

  switch (key) {
    case 'txt':
    case 'text': {
      const text = renderDocument(doc, opts.format);
      return { buffer: Buffer.from(text + '\n', 'utf8'), binary: false, extension };
    }
    case 'md':
    case 'markdown':
      return { buffer: Buffer.from(toMarkdown(doc, opts), 'utf8'), binary: false, extension };
    case 'html':
    case 'htm':
      return { buffer: Buffer.from(toHtml(doc, opts), 'utf8'), binary: false, extension };
    case 'rtf':
      return { buffer: toRtf(doc, opts), binary: true, extension };
    case 'docx':
      return { buffer: toDocx(doc, opts), binary: true, extension };
    case 'epub':
      return { buffer: toEpub(doc, opts), binary: true, extension };
    case 'pdf':
      return { buffer: toPdf(doc, opts), binary: true, extension };
    case 'json':
      return { buffer: Buffer.from(toJson(doc, opts), 'utf8'), binary: false, extension };
    case 'yaml':
      return { buffer: Buffer.from(toYaml(doc, opts), 'utf8'), binary: false, extension };
    case 'xml':
      return { buffer: Buffer.from(toXml(doc, opts), 'utf8'), binary: false, extension };
    case 'csv':
      return { buffer: Buffer.from(toCsv(doc, opts), 'utf8'), binary: false, extension };
    case 'js':
      return { buffer: Buffer.from(toJs(doc, opts), 'utf8'), binary: false, extension };
    default:
      throw new Error('不支持的输出格式：' + format + '（可用：' + SUPPORTED_FORMATS.join(', ') + '）');
  }
}

export { stripBrackets };