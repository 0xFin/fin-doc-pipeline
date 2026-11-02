/**
 * parser.mjs — document structure.
 *
 * Line classification lives in rules.mjs; this module walks the text, builds
 * the block list and provides the small structural queries the rest of the
 * pipeline needs.
 *
 * Blocks have a kind:
 *   chapter  top level, page break
 *   section  sub heading inside a chapter
 *   volume   grouping element
 *   special  front or back matter
 */

import {
  cnToInt, DEFAULT_SPECIALS, stripBrackets, stripHeadingMarks,
  buildContext, detectHeading,
} from './rules.mjs';

export { cnToInt, DEFAULT_SPECIALS, stripBrackets, stripHeadingMarks };

/** Group prefixes that may precede "第N章", e.g. "番外第001章". */
export const GROUP_PREFIXES = ['番外', '外传', '前传', '后传', '正传', '续'];

/** Default rule order used by classifyLine when no options are given. */
export const CLASSIFY_RULES = [
  'markdown', 'numbered-cn', 'numbered-en', 'cn-list', 'ordered', 'bracket', 'special',
];

/**
 * Classify a single line using the default rules.
 * Kept as a stable entry point for callers and tests.
 */
export function classifyLine(line, specialList) {
  const ctx = buildContext({
    rules: CLASSIFY_RULES,
    specials: specialList || DEFAULT_SPECIALS,
  });
  return detectHeading(line, ctx);
}

export function chapterKey(ch) {
  return (ch.group || 'main') + ':' + (ch.num === null ? 'x' : ch.num);
}

/**
 * Parse raw text into a document.
 * @param {string} text
 * @param {{specials?: string[], rules?: string[], customRules?: Array, headings?: Set<string>, heuristic?: {enabled:boolean, maxLength?:number}}} [options]
 */
export function parseDocument(text, options) {
  const opts = options || {};
  const lines = String(text || '').replace(/\r\n?/g, '\n').split('\n');
  const ctx = buildContext(opts);

  const chapters = [];
  const frontMatter = [];
  let current = null;
  let section = null;
  let counter = 0;

  const flushHead = () => {
    if (current) chapters.push(current);
    current = null;
    section = null;
  };

  const makeBlock = (heading) => {
    counter += 1;
    return {
      id: 'c-' + String(counter).padStart(3, '0'),
      kind: heading.kind,
      level: heading.level,
      sourceLevel: heading.sourceLevel === undefined ? heading.level : heading.sourceLevel,
      marker: heading.marker,
      prefix: heading.prefix || '',
      group: heading.prefix || 'main',
      num: heading.num === undefined ? null : heading.num,
      unit: heading.unit,
      rawTitle: heading.rawTitle,
      subtitle: heading.subtitle || '',
      paragraphs: [],
      sections: [],
      source: null,
    };
  };

  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];
    const stripped = stripHeadingMarks(raw).trim();
    let heading = null;

    if (stripped) {
      if (ctx.heuristic && ctx.heuristic.enabled) {
        const before = i === 0 || !lines[i - 1].trim();
        const after = i === lines.length - 1 || !lines[i + 1].trim();
        ctx.lineContext = { beforeBlank: before, afterBlank: after };
      }
      heading = detectHeading(raw.trim(), ctx);
    }

    if (heading && heading.kind === 'title') {
      // A markdown H1 configured as "title" is the book title, not a chapter.
      frontMatter.push(heading.rawTitle);
      continue;
    }

    if (heading && heading.kind === 'section') {
      if (!current) {
        // A section before any chapter still deserves a heading of its own.
        flushHead();
        current = makeBlock(heading);
        section = null;
      } else {
        section = makeBlock(heading);
        current.sections.push(section);
      }
      continue;
    }

    if (heading) {
      flushHead();
      current = makeBlock(heading);
      section = null;
      continue;
    }

    if (!stripped) continue;
    if (section) section.paragraphs.push(stripped);
    else if (current) current.paragraphs.push(stripped);
    else frontMatter.push(stripped);
  }
  flushHead();

  return {
    frontMatter,
    chapters,
    hasChapters: chapters.some((c) => c.kind === 'chapter'),
    stats: documentStats(frontMatter, chapters),
  };
}

/** Structural statistics for a parsed document. */
export function documentStats(frontMatter, chapters) {
  let paragraphs = frontMatter.length;
  let chars = 0;
  const groups = new Map();
  const specials = [];
  const volumes = [];
  let sections = 0;
  const markers = {};

  for (const p of frontMatter) chars += p.length;

  for (const c of chapters) {
    paragraphs += c.paragraphs.length;
    for (const p of c.paragraphs) chars += p.length;
    if (c.marker) markers[c.marker] = (markers[c.marker] || 0) + 1;

    for (const s of c.sections || []) {
      sections += 1;
      paragraphs += s.paragraphs.length;
      for (const p of s.paragraphs) chars += p.length;
      if (s.marker) markers[s.marker] = (markers[s.marker] || 0) + 1;
    }

    if (c.kind === 'chapter' && c.num !== null) {
      if (!groups.has(c.group)) groups.set(c.group, []);
      groups.get(c.group).push(c.num);
    }
    if (c.kind === 'special') specials.push(c.rawTitle);
    if (c.kind === 'volume') volumes.push(c.rawTitle);
  }

  let chapterCount = 0;
  let chapterBlocks = 0;
  for (const c of chapters) if (c.kind === 'chapter') chapterBlocks += 1;
  const groupNumbers = {};
  for (const [g, nums] of groups) {
    groupNumbers[g] = nums.slice().sort((a, b) => a - b);
    chapterCount += nums.length;
  }

  return {
    paragraphs,
    chars,
    chapterCount,
    chapterBlocks,
    sectionCount: sections,
    groups: Object.keys(groupNumbers),
    groupNumbers,
    specials,
    volumes,
    markers,
  };
}

/** Chapter numbers that appear more than once, per group. */
export function findDuplicateNumbers(chapters) {
  const counts = new Map();
  for (const c of chapters) {
    if (c.kind !== 'chapter' || c.num === null) continue;
    const k = chapterKey(c);
    if (!counts.has(k)) counts.set(k, { group: c.group, num: c.num, count: 0 });
    counts.get(k).count += 1;
  }
  const dupes = [];
  for (const v of counts.values()) if (v.count > 1) dupes.push(v);
  dupes.sort((a, b) => (a.group === b.group ? a.num - b.num : a.group.localeCompare(b.group)));
  return dupes;
}

/** Gaps in each group's number sequence (1..max). */
export function findMissingNumbers(chapters) {
  const groups = new Map();
  for (const c of chapters) {
    if (c.kind !== 'chapter' || c.num === null) continue;
    if (!groups.has(c.group)) groups.set(c.group, new Set());
    groups.get(c.group).add(c.num);
  }
  const result = {};
  for (const [g, set] of groups) {
    let max = 0;
    for (const n of set) if (n > max) max = n;
    const missing = [];
    for (let i = 1; i <= max; i++) if (!set.has(i)) missing.push(i);
    result[g] = { max, missing };
  }
  return result;
}

/** Body character count of a block (whitespace excluded). */
export function chapterCharCount(chapter) {
  return chapter.paragraphs.join('').replace(/\s/g, '').length;
}

/** Group total character count for several blocks. */
export function groupCharCount(chapters) {
  let n = 0;
  for (const c of chapters) n += chapterCharCount(c);
  return n;
}