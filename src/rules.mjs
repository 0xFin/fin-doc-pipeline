/**
 * rules.mjs — heading detection.
 *
 * Detection is a pipeline of small, named rules. The first rule that recognises
 * a line wins, and each rule reports which structural level the line represents:
 *
 *   chapter  top level, page break, table of contents entry
 *   section  sub heading inside a chapter
 *   volume   grouping element (卷 / 部 / Part)
 *   special  front or back matter (前言 / 楔子 / 后记)
 *
 * Rules are ordered and individually switchable, and users can append their own
 * regular expressions. Loaders for docx/epub/html emit Markdown '#' markers, so
 * the markdown rule doubles as the "the document already told us it is a
 * heading" channel.
 */

/* =========================================================
   Shared heading vocabulary
   ========================================================= */

const CN_DIGIT = {
  零: 0, 〇: 0, 一: 1, 二: 2, 两: 2, 三: 3, 四: 4,
  五: 5, 六: 6, 七: 7, 八: 8, 九: 9,
};

/** Convert a Chinese or Arabic numeral string to an integer. */
export function cnToInt(input) {
  const s = (input || '').trim();
  if (!s) return null;
  if (/^\d+$/.test(s)) return parseInt(s, 10);

  let total = 0, section = 0, number = 0;
  for (const ch of s) {
    if (ch in CN_DIGIT) {
      number = CN_DIGIT[ch];
    } else if (ch === '十') {
      section += (number || 1) * 10;
      number = 0;
    } else if (ch === '百') {
      section += (number || 1) * 100;
      number = 0;
    } else if (ch === '千') {
      section += (number || 1) * 1000;
      number = 0;
    } else if (ch === '万') {
      section = (section + number) * 10000;
      total += section;
      section = 0;
      number = 0;
    } else {
      return null;
    }
  }
  return total + section + number;
}

/** Front and back matter names, longest first so "序章" is not read as "序". */
export const DEFAULT_SPECIALS = [
  '大结局', '全文完', '楔子', '引子', '序章', '序言', '前言', '尾声',
  '后记', '终章', '番外篇', '番外', '外传', '附录', '序',
];

/** Strip one pair of surrounding brackets. */
export function stripBrackets(text) {
  const t = (text || '').trim();
  if (t.startsWith('[') && t.endsWith(']')) return t.slice(1, -1).trim();
  if (t.startsWith('【') && t.endsWith('】')) return t.slice(1, -1).trim();
  return t;
}

/** Remove leading Markdown heading markers and trailing space. */
export function stripHeadingMarks(line) {
  return String(line).replace(/^\s{0,8}#{1,6}\s+/, '').replace(/^\s+/, '').trimEnd();
}

/** Order in which rules are tried by default. */
export const DEFAULT_RULES = [
  'manual',
  'markdown',
  'numbered-cn',
  'numbered-en',
  'cn-list',
  'ordered',
  'bracket',
  'special',
  'heuristic',
];

/** Rules that are off unless the user asks for them. */
export const OPT_IN_RULES = ['heuristic'];

const NUM = '[零〇一二三四五六七八九十百千万两0-9]+';
const CN_CHAPTER = /^\[?\s*(?:(番外|外传|前传|后传|正传|续)\s*)?第\s*([零〇一二三四五六七八九十百千万两0-9]+)\s*([章回节话])\s*\]?\s*(.*)$/;
const CN_VOLUME = /^\[?\s*第\s*([零〇一二三四五六七八九十百千万两0-9]+)\s*([卷篇部集册])\s*\]?\s*(.*)$/;
const CN_LIST = /^([零〇一二三四五六七八九十百]+)\s*[、.．]\s*(.*)$/;
const ORDERED = /^(\d{1,3}|[A-Za-z])\s*[).、．]\s+(\S.*)$/;
const MARKDOWN = /^(#{1,6})\s+(.+)$/;
const BRACKET = /^[\[【]\s*([^\]】]{1,40}?)\s*[\]】]\s*(.*)$/;
const EN_CHAPTER = /^(chapter|section|part|book|volume|prologue|epilogue)\b\s*([IVXLCDMivxlcdm]+|\d+)?\s*[:：.、—-]?\s*(.*)$/i;

const ROMAN = { i: 1, v: 5, x: 10, l: 50, c: 100, d: 500, m: 1000 };

/** Roman numeral to integer, for "Chapter IV". */
export function romanToInt(text) {
  const s = String(text || '').toLowerCase();
  if (!/^[ivxlcdm]+$/.test(s)) return null;
  let total = 0;
  for (let i = 0; i < s.length; i++) {
    const value = ROMAN[s[i]];
    const next = ROMAN[s[i + 1]];
    total += next && next > value ? -value : value;
  }
  return total;
}

/** Sort special names longest first so "序章" beats "序". */
function sortedSpecials(list) {
  return list.slice().sort(function (a, b) { return b.length - a.length; });
}

function matchSpecial(text, list) {
  const trimmed = String(text || '').trim();
  if (!trimmed) return null;
  const words = sortedSpecials(list);

  const bracket = trimmed.match(BRACKET);
  if (bracket) {
    const inner = bracket[1];
    const word = words.find(function (w) { return inner === w || inner.startsWith(w); });
    if (word) return { title: inner, rest: (bracket[2] || '').trim() };
    return null;
  }

  for (const w of words) {
    if (trimmed === w) return { title: w, rest: '' };
    if (trimmed.startsWith(w)) {
      const tail = trimmed.slice(w.length);
      if (/^[\s:：、·—–-《]/.test(tail)) {
        return { title: w, rest: tail.replace(/^[\s:：、·—–-]+/, '').trim() };
      }
    }
  }
  return null;
}

function hit(kind, level, marker, extra) {
  return Object.assign({
    kind,
    level,
    marker,
    prefix: '',
    num: null,
    unit: null,
    subtitle: '',
    sourceLevel: level,
  }, extra || {});
}

const RULE_IMPL = {
  manual(line, ctx) {
    if (!ctx.headings) return null;
    const text = line.trim();
    if (!ctx.headings.has(text)) return null;
    return hit('chapter', 1, 'manual', { rawTitle: text });
  },

  markdown(line, ctx) {
    const m = line.match(MARKDOWN);
    if (!m) return null;
    const depth = m[1].length;
    const content = m[2].trim();
    // Re-run the textual rules on the heading body so "## [第001章] 开端" keeps
    // its chapter number instead of degrading to an anonymous heading.
    for (const id of ctx.order) {
      if (id === 'markdown' || id === 'manual' || id === 'heuristic') continue;
      const inner = RULE_IMPL[id](content, ctx);
      if (inner) {
        inner.sourceLevel = depth;
        inner.marker = 'markdown+' + inner.marker;
        inner.rawTitle = content;
        return inner;
      }
    }
    const titleLevels = (ctx.markdown && ctx.markdown.titleLevels) || [];
    const chapterLevels = (ctx.markdown && ctx.markdown.chapterLevels) || [1];
    const sectionLevels = (ctx.markdown && ctx.markdown.sectionLevels) || [2, 3, 4, 5, 6];

    if (titleLevels.includes(depth)) {
      return hit('title', 0, 'markdown', { rawTitle: content, sourceLevel: depth });
    }
    if (chapterLevels.includes(depth)) {
      return hit('chapter', 1, 'markdown', { rawTitle: content, sourceLevel: depth });
    }
    if (sectionLevels.includes(depth)) {
      return hit('section', 2, 'markdown', { rawTitle: content, sourceLevel: depth });
    }
    return hit(depth <= 2 ? 'chapter' : 'section', depth <= 2 ? 1 : 2, 'markdown', { rawTitle: content, sourceLevel: depth });
  },

  'numbered-cn'(line, ctx) {
    const m = line.match(CN_CHAPTER);
    if (m) {
      // "第3节" is a sub heading; 章 / 回 / 话 are top level.
      const isSection = m[3] === '节';
      return hit(isSection ? 'section' : 'chapter', isSection ? 2 : 1, 'numbered-cn', {
        prefix: m[1] || '',
        num: cnToInt(m[2]),
        unit: m[3],
        subtitle: (m[4] || '').trim(),
        rawTitle: line.trim(),
      });
    }
    const v = line.match(CN_VOLUME);
    if (v) {
      return hit('volume', 0, 'numbered-cn', {
        num: cnToInt(v[1]),
        unit: v[2],
        subtitle: (v[3] || '').trim(),
        rawTitle: line.trim(),
      });
    }
    return null;
  },

  'numbered-en'(line, ctx) {
    const m = line.match(EN_CHAPTER);
    if (!m) return null;
    const word = m[1].toLowerCase();
    const kind = word === 'part' || word === 'book' || word === 'volume' ? 'volume'
      : word === 'section' ? 'section'
      : 'chapter';
    const rawNum = m[2];
    const num = rawNum ? (romanToInt(rawNum) !== null ? romanToInt(rawNum) : parseInt(rawNum, 10)) : null;
    return hit(kind, kind === 'chapter' ? 1 : kind === 'section' ? 2 : 0, 'numbered-en', {
      num: Number.isFinite(num) ? num : null,
      unit: m[1],
      subtitle: (m[3] || '').trim(),
      rawTitle: line.trim(),
    });
  },

  'cn-list'(line, ctx) {
    const m = line.match(CN_LIST);
    if (!m) return null;
    return hit('section', 2, 'cn-list', {
      num: cnToInt(m[1]),
      subtitle: (m[2] || '').trim(),
      rawTitle: line.trim(),
    });
  },

  ordered(line, ctx) {
    const m = line.match(ORDERED);
    if (!m) return null;
    return hit('section', 2, 'ordered', {
      num: /^\d+$/.test(m[1]) ? parseInt(m[1], 10) : null,
      subtitle: (m[2] || '').trim(),
      rawTitle: line.trim(),
    });
  },

  bracket(line, ctx) {
    const m = line.match(BRACKET);
    if (!m) return null;
    const special = matchSpecial(line, ctx.specials);
    if (!special) return null;
    return hit('special', 0, 'bracket', { subtitle: special.rest, rawTitle: special.title });
  },

  special(line, ctx) {
    const special = matchSpecial(line, ctx.specials);
    if (!special) return null;
    return hit('special', 0, 'special', { subtitle: special.rest, rawTitle: special.title });
  },

  heuristic(line, ctx) {
    if (!ctx.heuristic || !ctx.heuristic.enabled) return null;
    if (!ctx.lineContext) return null;
    const text = line.trim();
    const max = ctx.heuristic.maxLength || 30;
    if (!text || text.length > max) return null;
    if (/[。！？…，、；：,.;:!?]$/.test(text)) return null;
    if (!ctx.lineContext.beforeBlank || !ctx.lineContext.afterBlank) return null;
    return hit('chapter', 1, 'heuristic', { rawTitle: text });
  },
};

/**
 * Fill in missing Markdown level buckets.
 *
 * If the user says "level 1 is the title" they almost always mean level 2 is a
 * chapter and level 3 a section, so derive those instead of silently falling
 * back to the defaults (which would turn every heading into a section).
 */
export function resolveMarkdownLevels(input) {
  const md = input || {};
  const titleLevels = md.titleLevels || [];
  let chapterLevels = md.chapterLevels;
  let sectionLevels = md.sectionLevels;

  if (titleLevels.length && !chapterLevels) {
    chapterLevels = [Math.max.apply(null, titleLevels) + 1];
  }
  if (titleLevels.length && !sectionLevels) {
    const base = Math.max.apply(null, chapterLevels || [2]);
    sectionLevels = [base + 1, base + 2, base + 3, base + 4];
  }

  return {
    titleLevels,
    chapterLevels: chapterLevels || [1],
    sectionLevels: sectionLevels || [2, 3, 4, 5, 6],
  };
}

/** Build the active rule context once per document. */
export function buildContext(options) {
  const opts = options || {};
  const enabled = opts.rules && opts.rules.length ? opts.rules : DEFAULT_RULES;
  const order = enabled.filter((id) => RULE_IMPL[id] && (!OPT_IN_RULES.includes(id) || opts.heuristic));

  const ctx = {
    order,
    specials: opts.specials || DEFAULT_SPECIALS,
    headings: opts.headings || null,
    heuristic: opts.heuristic || null,
    lineContext: null,
    customRules: opts.customRules || [],
    markdown: resolveMarkdownLevels(opts.markdown),
  };
  return ctx;
}

/**
 * Detect whether a line is a heading.
 * @returns {null|{kind:string, level:number, marker:string, prefix:string, num:number|null, unit:string|null, subtitle:string, rawTitle:string, sourceLevel:number}}
 */
export function detectHeading(line, ctx) {
  const text = String(line || '');
  if (!text.trim()) return null;

  for (const id of ctx.order) {
    const result = RULE_IMPL[id](text, ctx);
    if (result) return result;
  }

  for (const custom of ctx.customRules) {
    let re;
    try {
      re = custom.pattern instanceof RegExp ? custom.pattern : new RegExp(custom.pattern);
    } catch (err) {
      continue;
    }
    const m = text.match(re);
    if (!m) continue;
    return hit(custom.kind || 'chapter', custom.level || (custom.kind === 'section' ? 2 : 1), 'custom', {
      num: m[1] && /^\d+$/.test(m[1]) ? parseInt(m[1], 10) : null,
      subtitle: (m[2] || m[1] || '').trim(),
      rawTitle: text.trim(),
    });
  }

  return null;
}