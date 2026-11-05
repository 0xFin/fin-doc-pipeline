/**
 * typography.mjs — cleaning, title rendering and final assembly.
 *
 * This module owns the "how the book looks" decisions. It never reorders
 * chapters and never drops content: ordering and deduplication belong to
 * merge.mjs, structural parsing belongs to parser.mjs.
 */

import { stripBrackets } from './parser.mjs';
import { padNum } from './util.mjs';
import { normalizeChinesePunctuation } from './chinese.mjs';

/** Default formatting options. Every field can be overridden by config. */
export const DEFAULT_FORMAT = {
  /** Main-story chapter title. {num} is zero padded, {title} is the subtitle. */
  chapterTitle: '[第{num}章]',
  /** Title for prefixed groups such as 番外. */
  groupChapterTitle: '[{prefix}第{num}章]',
  /** Volume heading. */
  volumeTitle: '[第{num}卷]',
  /** Special sections (前言 / 楔子 / 后记 ...). {title} is the heading text. */
  specialTitle: '[{title}]',
  /** Chapters with no recognisable number, e.g. a Markdown heading. */
  unnumberedTitle: '{title}',
  /** Sub headings inside a chapter. */
  sectionTitle: '{title}',
  /** Literal decoration around every rendered heading (all outputs). */
  headingPrefix: '',
  headingSuffix: '',
  /** Optional overrides for sections; empty means reuse the heading prefix. */
  sectionPrefix: '',
  sectionSuffix: '',
  /** Markdown heading markers for md output: auto | none | preserve | level:N. */
  mdHeading: 'auto',
  /** Placed between the bracketed number and the subtitle. */
  titleSeparator: '\u3000',
  /** Prefix for every body paragraph. Empty string disables indentation. */
  indent: '\u3000\u3000',
  /** Blank lines before a heading. */
  blankBeforeTitle: 1,
  /** Blank lines after a heading. */
  blankAfterTitle: 1,
  /** Chapter number width; older files in the wild use 1, 2 or 3. */
  numWidth: 3,
  /** Join soft-wrapped lines back into paragraphs. Off by default: destructive. */
  reflow: false,
  /** Normalise punctuation. Off by default. */
  normalizePunctuation: false,
  /** Remove leftover control / zero width characters. */
  stripInvisible: true,
};

const INVISIBLE = /[\u200B-\u200F\u202A-\u202E\uFEFF\u2060-\u2064\u00AD]/g;
const CONTROL = /[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g;

/**
 * Clean one paragraph. Removes invisible characters and trims outer space,
 * but never deletes characters that might be meaningful (unlike the old page
 * based tool, which silently dropped ■ □ ▪ and similar symbols).
 */
export function cleanParagraph(text, fmt) {
  const f = fmt || DEFAULT_FORMAT;
  let s = String(text || '');
  if (f.stripInvisible) {
    s = s.replace(INVISIBLE, '').replace(CONTROL, '');
  }
  s = s.replace(/[ \t]{2,}/g, ' ');
  s = s.replace(/^[\s\u3000]+/, '').replace(/[\s\u3000]+$/, '');
  return s;
}

/**
 * Fill a title template.
 *
 * Supported placeholders: {num} (zero padded), {num:N} (custom width),
 * {prefix} (番外), {unit} (章/回/节), {title} (subtitle), {raw} (original line).
 * When the template has no {title} the subtitle is appended after a separator,
 * which keeps the classic "[第001章]　标题" look while allowing full override.
 */
function applyTemplate(template, values) {
  const source = String(template);
  let out = source.replace(/\{num:(\d+)\}/g, function (_, width) {
    return padNum(Number(values.numRaw === null || values.numRaw === undefined ? 0 : values.numRaw), Number(width));
  });

  for (const key of ['num', 'prefix', 'unit', 'title', 'raw']) {
    out = out.split('{' + key + '}').join(values[key] === undefined || values[key] === null ? '' : String(values[key]));
  }

  out = out.replace(/\{[a-zA-Z]+\}/g, '');
  if (!source.includes('{title}') && !source.includes('{raw}') && values.title) {
    out = out + (values.sep === undefined ? '' : values.sep) + values.title;
  }
  return out.replace(/[ \t]{2,}/g, ' ').trim();
}

/** Placeholder values shared by every heading kind. */
function titleValues(ch, f, subtitle) {
  return {
    num: padNum(ch.num === null || ch.num === undefined ? 0 : ch.num, f.numWidth),
    numRaw: ch.num,
    prefix: ch.prefix || '',
    unit: ch.unit || '章',
    title: subtitle || '',
    raw: ch.rawTitle || '',
    sep: f.titleSeparator,
  };
}

/**
 * Render a heading line for a chapter.
 * @param {import('./parser.mjs').Chapter} ch
 * @param {object} [fmt]
 */
export function renderTitle(ch, fmt) {
  const f = { ...DEFAULT_FORMAT, ...(fmt || {}) };
  let title;

  if (ch.kind === 'special') {
    title = applyTemplate(f.specialTitle, titleValues(ch, f, stripBrackets(ch.rawTitle)));
  } else if (ch.kind === 'volume') {
    title = applyTemplate(f.volumeTitle, titleValues(ch, f, ch.subtitle));
  } else if (ch.kind === 'section') {
    title = applyTemplate(f.sectionTitle, titleValues(ch, f, ch.subtitle || ch.rawTitle));
  } else if (ch.num === null || ch.num === undefined) {
    // Headings without a number ("开篇", "尾声之前", a Markdown heading) must not
    // invent a chapter number.
    title = applyTemplate(f.unnumberedTitle, titleValues(ch, f, ch.subtitle || ch.rawTitle));
  } else {
    const template = ch.prefix ? f.groupChapterTitle : f.chapterTitle;
    title = applyTemplate(template, titleValues(ch, f, ch.subtitle));
  }

  if (ch.kind === 'section') {
    return (f.sectionPrefix || f.headingPrefix || '') + title + (f.sectionSuffix || f.headingSuffix || '');
  }
  return (f.headingPrefix || '') + title + (f.headingSuffix || '');
}

/**
 * Markdown heading marker for a block.
 * @param {object} ch block
 * @param {object} fmt formatting options
 */
export function markdownMarker(ch, fmt) {
  const f = { ...DEFAULT_FORMAT, ...(fmt || {}) };
  const mode = String(f.mdHeading || 'auto');

  if (mode === 'none') return '';
  if (mode === 'preserve') return '#'.repeat(Math.max(1, Math.min(6, ch.sourceLevel || ch.level || 1)));
  if (mode.startsWith('level:')) return '#'.repeat(Math.max(1, Math.min(6, Number(mode.slice(6)) || 2)));
  // auto
  if (ch.kind === 'section') return '###';
  return '##';
}

const TERMINAL = '。！？…”』」）】!?~～';
const OPENING = '「『“"（(【';

/** True when the line looks like it continues into the next one. */
function looksSoftWrapped(line, next) {
  if (!line || !next) return false;
  const last = line[line.length - 1];
  const first = next[0];
  if (TERMINAL.includes(last)) return false;
  if (OPENING.includes(first)) return false;
  if (/^第\s*[零〇一二三四五六七八九十百千万两0-9]+\s*[章回节话卷篇]/.test(next)) return false;
  return true;
}

/**
 * Join lines that were hard wrapped at a fixed column.
 * Best effort: only safe when the previous line does not end a sentence.
 */
export function reflowParagraphs(paragraphs) {
  const out = [];
  for (const p of paragraphs) {
    if (!out.length) {
      out.push(p);
      continue;
    }
    const prev = out[out.length - 1];
    if (looksSoftWrapped(prev, p)) out[out.length - 1] = prev + p;
    else out.push(p);
  }
  return out;
}

/**
 * Apply safe punctuation normalisation: ASCII ellipsis, Chinese full-width
 * marks, curly quotes, repeated marks, dashes and stray spaces between
 * Chinese characters. Shared with the proofreading pass in chinese.mjs.
 */
export function normalizePunctuation(text) {
  let s = String(text === null || text === undefined ? '' : text);
  // ASCII ellipsis first, so the Chinese rules see a real ellipsis.
  s = s.replace(/\.{3,}/g, '……');
  s = normalizeChinesePunctuation(s);
  s = s.replace(/-{2,}/g, '——');
  s = s.replace(/([\u4e00-\u9fff])[ \t]+(?=[\u4e00-\u9fff])/g, '$1');
  return s;
}

/**
 * Render a parsed document to plain text.
 * @param {{frontMatter: string[], chapters: Array}} doc
 * @param {object} [fmt]
 * @returns {string}
 */
export function renderDocument(doc, fmt) {
  const f = { ...DEFAULT_FORMAT, ...(fmt || {}) };
  const blocks = [];

  const prepare = (paragraphs) => {
    let ps = paragraphs.map((p) => cleanParagraph(p, f)).filter(Boolean);
    if (f.normalizePunctuation) ps = ps.map(normalizePunctuation);
    if (f.reflow) ps = reflowParagraphs(ps);
    return ps;
  };

  const renderParagraphs = (paragraphs) => {
    const ps = prepare(paragraphs);
    if (!ps.length) return [];
    return ps.map((p) => (f.indent ? f.indent + p : p));
  };

  // Front matter: title page text, synopsis, etc.
  const front = renderParagraphs(doc.frontMatter || []);
  if (front.length) blocks.push(front);

  for (const ch of doc.chapters) {
    blocks.push({
      title: renderTitle(ch, f),
      body: renderParagraphs(ch.paragraphs || []),
      kind: ch.kind,
      level: ch.level,
    });
    for (const section of ch.sections || []) {
      blocks.push({
        title: renderTitle(section, f),
        body: renderParagraphs(section.paragraphs || []),
        kind: 'section',
        level: section.level,
      });
    }
  }

  const lines = [];
  const blank = (n) => {
    for (let i = 0; i < n; i++) lines.push('');
  };

  for (const block of blocks) {
    if (Array.isArray(block)) {
      if (lines.length) blank(f.blankBeforeTitle);
      lines.push(...block);
      continue;
    }
    if (lines.length) blank(block.kind === 'section' ? 1 : f.blankBeforeTitle);
    lines.push(block.title);
    if (block.body.length) {
      blank(block.kind === 'section' ? 1 : f.blankAfterTitle);
      lines.push(...block.body);
    }
  }

  while (lines.length && lines[lines.length - 1] === '') lines.pop();
  return lines.join('\n');
}

/** Word/character counts used by inspect and by reports. */
export function countText(text) {
  const chinese = (text.match(/[\u4e00-\u9fff]/g) || []).length;
  const total = text.length;
  const noWhitespace = text.replace(/\s/g, '').length;
  const paragraphs = text.split('\n').filter((l) => l.trim()).length;
  return { chinese, total, noWhitespace, paragraphs };
}