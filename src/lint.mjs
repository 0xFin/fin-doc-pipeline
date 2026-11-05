/**
 * lint.mjs — content checks and safe automatic repairs.
 *
 * Two kinds of findings exist:
 *   - structural: duplicate/missing chapter numbers, empty chapters
 *   - textual:    punctuation, invisible characters, duplicated paragraphs
 *
 * Every finding carries a severitly and, where it is safe, a deterministi
 * repair. Destructive opinions (deleting advert lines, rewriting punctuation)
 * are never applied unless explicitly requested.
 */

import { findDuplicateNumbers, findMissingNumbers, chapterCharCount, stripBrackets } from './parser.mjs';
import {
  toSimplified, traditionalChars, normalizeQuotes, collapseRepeats,
  normalizeEnglishWords, normalizeDateAndTime, hasCaseIssue, hasDateIssue,
  applyTypos, findTypos, findRepeats, findGrammarIssues, fillChapterTitles, PROOFREAD_RULES,
} from './chinese.mjs';

export const SEVERITY_ORDER = { error: 0, warn: 1, info: 2 };

/**
 * Applied automatically by format/merge. Only invisible damage is repaired:
 * replacement characters, zero width characters, control characters and
 * whitespace. Content is never rewritten without an explicit request.
 */
export const CLEAN_FIXES = ['T001', 'T002', 'T003', 'T017', 'T018'];

/**
 * Applied by "check --fix": cleaning, conventional punctuation and the
 * Simplified Chinese proofreading rules (C001-C007). Deterministic: every
 * rule either removes damage or rewrites to one documented form.
 */
export const SAFE_FIXES = [
  'T001', 'T002', 'T003', 'T006', 'T007', 'T016', 'T017', 'T018',
  'C001', 'C002', 'C003', 'C004', 'C005', 'C006', 'C007',
];

/** Applied by --proofread: the full Simplified Chinese cleanup chain. */
export { PROOFREAD_RULES };
export const PROOFREAD_FIXES = PROOFREAD_RULES;

/** Only applied when explicitly requested through --rules. */
export const OPT_IN_FIXES = ['T005', 'T010', 'T015', 'C008'];

/** Common web-novel boilerplate. Reported, never removed by default. */
export const DEFAULT_AD_PATTERNS = [
  /本章未完[，,].*点击下一页/,
  /请收藏本站|请记住本站|最新网址|手机用户请|天才一秒记住|一秒记住/,
  /https?:\/\/[^\s]+\.(?:com|net|org|cn)/i,
  /(?:www|m)\.[a-z0-9-]+\.(?:com|net|org|cn)/i,
  /微信(?:公众号|搜索)|QQ群|书友群/,
];

const INVISIBLE = /[\u200B-\u200F\u202A-\u202E\uFEFF\u2060-\u2064\u00AD]/g;
const CONTROL = /[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g;
const GARBAGE = /[\uFFFD\u25A1\u25A0\u25A2\u25A3\u25AA\u25AB\u25AC\u25AD\u25AE\u25AF]/g;
const FULLWIDTH_ALNUM = /[\uFF10-\uFF19\uFF21-\uFF3A\uFF41-\uFF5A]/g;

function excerpt(text, max) {
  const limit = max || 40;
  const s = String(text);
  return s.length > limit ? s.slice(0, limit) + '…' : s;
}

function makeIssue(id, severity, message, where, extra) {
  return {
    id,
    severity,
    message,
    chapterId: where.chapterId || null,
    chapterTitle: where.chapterTitle || null,
    paragraphIndex: typeof where.paragraphIndex === 'number' ? where.paragraphIndex : null,
    excerpt: where.excerpt || '',
    fixable: Boolean(extra && extra.fixable),
  };
}

/**
 * Lint a parsed document.
 * @param {object} doc
 * @param {{level?: string, adPatterns?: RegExp[], checkStructure?: boolean}} [options]
 */
export function lintDocument(doc, options) {
  const opts = options || {};
  const minLevel = SEVERITY_ORDER[opts.level || 'info'];
  const adPatterns = opts.adPatterns || DEFAULT_AD_PATTERNS;
  const issues = [];

  const push = (issue) => {
    if (SEVERITY_ORDER[issue.severity] <= minLevel) issues.push(issue);
  };

  /* ---------- textual checks ---------- */
  for (const ch of doc.chapters) {
    const title = stripBrackets(ch.rawTitle);
    const where = { chapterId: ch.id, chapterTitle: title };

    if (ch.kind === 'chapter' && ch.paragraphs.length === 0) {
      push(makeIssue('T011', 'warn', '章节没有正文内容', where));
    }

    const seen = new Map();
    let quoteOpen = 0;
    let quoteClose = 0;
    const bracketOpen = new Map();
    const bracketClose = new Map();
    for (let i = 0; i < ch.paragraphs.length; i++) {
      const p = ch.paragraphs[i];
      const at = { ...where, paragraphIndex: i, excerpt: excerpt(p) };

      if (p.includes('\uFFFD')) push(makeIssue('T001', 'error', '包含替换字符 U+FFFD（解码失败痕迹）', at, { fixable: true }));
      if (INVISIBLE.test(p)) push(makeIssue('T002', 'warn', '包含零宽/不可见字符', at, { fixable: true }));
      INVISIBLE.lastIndex = 0;
      if (CONTROL.test(p)) push(makeIssue('T003', 'warn', '包含控制字符', at, { fixable: true }));
      CONTROL.lastIndex = 0;
      if (GARBAGE.test(p)) push(makeIssue('T004', 'info', '包含方块类占位符号', { ...at }));
      GARBAGE.lastIndex = 0;
      if (/\.{3,}|。{2,}/.test(p)) push(makeIssue('T006', 'info', '省略号写法不规范', at, { fixable: true }));
      if (/-{2,}/.test(p)) push(makeIssue('T007', 'info', '破折号写法不规范', at, { fixable: true }));
      if (FULLWIDTH_ALNUM.test(p)) push(makeIssue('T016', 'info', '包含全角数字或字母', at, { fixable: true }));
      FULLWIDTH_ALNUM.lastIndex = 0;
      if (/^[\s\u3000]|[\s\u3000]$/.test(p)) push(makeIssue('T017', 'info', '段落首尾有空白', at, { fixable: true }));
      if (/[ \t]{2,}/.test(p)) push(makeIssue('T018', 'info', '段落内有连续空格', at, { fixable: true }));
      if (p.length > 2000) push(makeIssue('T019', 'info', '段落长度异常（' + p.length + ' 字），可能缺少换行', at));

      if (/([\u4e00-\u9fff])[,;:?!]/.test(p)) {
        push(makeIssue('T005', 'warn', '中文后使用半角标点', at, { fixable: true }));
      }

      /* ---------- Simplified Chinese proofreading ---------- */
      const traditional = traditionalChars(p);
      if (traditional.length) {
        push(makeIssue('C001', 'warn', '包含繁体字：' + traditional.slice(0, 8).join('') + (traditional.length > 8 ? '…' : ''), at, { fixable: true }));
      }
      if (/[「」『』]/.test(p)) {
        push(makeIssue('C002', 'warn', '使用直角引号「」', at, { fixable: true }));
      } else if (/\([^()]*[\u4e00-\u9fff][^()]*\)/.test(p)) {
        push(makeIssue('C002', 'warn', '中文内容使用半角括号', at, { fixable: true }));
      }
      if (/([，、；：！？])\1+/.test(p)) {
        push(makeIssue('C003', 'warn', '连续出现重复标点', at, { fixable: true }));
      }
      if (hasCaseIssue(p)) {
        push(makeIssue('C004', 'info', '英文大小写或字符宽度不规范', at, { fixable: true }));
      }
      if (hasDateIssue(p)) {
        push(makeIssue('C005', 'info', '日期格式不规范', at, { fixable: true }));
      }
      const typos = findTypos(p);
      if (typos.length) {
        push(makeIssue('C006', 'warn', '疑似错别字：' + typos.slice(0, 3).map((t) => t.wrong + '→' + t.right).join('、'), at, { fixable: true }));
      }
      const repeats = findRepeats(p);
      if (repeats.length) {
        push(makeIssue('C007', 'warn', '重复用字：' + repeats.slice(0, 3).map((r) => r.text).join('、'), at, { fixable: true }));
      }
      const grammar = findGrammarIssues(p);
      if (grammar.length) {
        push(makeIssue('C009', 'info', '疑似语病：' + grammar.map((g) => g.message).join('；'), at));
      }

      // Quotes routinely span paragraphs in Chinese dialogue, so balance is
      // checked per chapter rather than per paragraph.
      quoteOpen += (p.match(/\u201C/g) || []).length;
      quoteClose += (p.match(/\u201D/g) || []).length;
      for (const pair of [['（', '）'], ['【', '】'], ['「', '」'], ['《', '》']]) {
        const openKey = pair[0];
        const closeKey = pair[1];
        bracketOpen.set(openKey, (bracketOpen.get(openKey) || 0) + (p.match(new RegExp(openKey, 'g')) || []).length);
        bracketClose.set(closeKey, (bracketClose.get(closeKey) || 0) + (p.match(new RegExp(closeKey, 'g')) || []).length);
      }

      for (const pattern of adPatterns) {
        if (pattern.test(p)) {
          push(makeIssue('T015', 'info', '疑似站点广告或样板文字', { ...at }, { fixable: true }));
          break;
        }
      }

      const key = p.replace(/\s/g, '');
      if (key.length >= 20) {
        if (seen.has(key)) {
          push(makeIssue('T010', 'warn', '本章内出现完全重复段落', at, { fixable: true }));
        } else {
          seen.set(key, i);
        }
      }
    }

    if (quoteOpen !== quoteClose) {
      push(makeIssue('T008', 'warn', '本章中文引号不配对（' + quoteOpen + '/' + quoteClose + '）', { chapterId: ch.id, chapterTitle: title }));
    }
    for (const pair of [['（', '）'], ['【', '】'], ['「', '」'], ['《', '》']]) {
      const n1 = bracketOpen.get(pair[0]) || 0;
      const n2 = bracketClose.get(pair[1]) || 0;
      if (n1 !== n2) push(makeIssue('T009', 'warn', '本章括号不配对：' + pair[0] + pair[1] + '（' + n1 + '/' + n2 + '）', { chapterId: ch.id, chapterTitle: title }));
    }
  }

  /* ---------- structural checks ---------- */
  if (opts.checkStructure !== false) {
    const dupes = findDuplicateNumbers(doc.chapters);
    for (const d of dupes) {
      push(makeIssue('T012', 'warn', (d.group === 'main' ? '' : d.group) + '第 ' + d.num + ' 章出现 ' + d.count + ' 次（分段章节可忽略）', {}));
    }
    const gaps = findMissingNumbers(doc.chapters);
    for (const [group, info] of Object.entries(gaps)) {
      if (!info.missing.length) continue;
      push(makeIssue('T013', 'warn', (group === 'main' ? '' : group) + '缺章 ' + info.missing.length + ' 个（最大 ' + info.max + '）：' + info.missing.slice(0, 10).join(',') + (info.missing.length > 10 ? '…' : ''), {}));
    }
    const shortChapters = doc.chapters.filter((c) => c.kind === 'chapter' && chapterCharCount(c) > 0 && chapterCharCount(c) < 50);
    if (shortChapters.length) {
      push(makeIssue('T020', 'info', '有 ' + shortChapters.length + ' 个章节正文少于 50 字', {}));
    }
    const untitled = doc.chapters.filter((c) => c.kind === 'chapter' && !c.subtitle && c.paragraphs.length);
    for (const ch of untitled) {
      push(makeIssue('C008', 'info', '章节缺少标题，可从正文拟定', { chapterId: ch.id, chapterTitle: stripBrackets(ch.rawTitle) }, { fixable: true }));
    }
  }

  const counts = { error: 0, warn: 0, info: 0 };
  for (const issue of issues) counts[issue.severity] += 1;

  return { issues, counts };
}

/** Lint raw text before parsing: line endings, BOM, blank line runs. */
export function lintRawText(text) {
  const issues = [];
  if (text.startsWith('\uFEFF')) issues.push(makeIssue('R001', 'warn', '文件带 UTF-8 BOM', {}));
  const crlf = (text.match(/\r\n/g) || []).length;
  const cr = (text.match(/\r(?!\n)/g) || []).length;
  if (crlf || cr) issues.push(makeIssue('R002', 'info', '混合或非 Unix 换行（CRLF ' + crlf + ' 处，CR ' + cr + ' 处）', {}));
  if (/\n{3,}/.test(text)) issues.push(makeIssue('R003', 'info', '存在连续 3 行以上空行', {}, { fixable: true }));

  const lines = text.split('\n');
  const trailing = lines.filter((l) => /[ \t]+$/.test(l)).length;
  if (trailing) issues.push(makeIssue('R004', 'info', '有 ' + trailing + ' 行以空白结尾', {}, { fixable: true }));
  const tabs = lines.filter((l) => l.startsWith('\t')).length;
  if (tabs) issues.push(makeIssue('R005', 'info', '有 ' + tabs + ' 行以 Tab 缩进', {}, { fixable: true }));

  return issues;
}

/* =========================================================
   Repairs
   ========================================================= */

/**
 * Apply safe repairs to a parsed document.
 * @param {object} doc
 * @param {{rules?: string[], adPatterns?: RegExp[], minParagraphLength?: number}} [options]
 * @returns {{doc: object, fixed: Array<{id:string, count:number}>}}
 */
export function fixDocument(doc, options) {
  const opts = options || {};
  const rules = new Set(opts.rules && opts.rules.length ? opts.rules : SAFE_FIXES);
  const adPatterns = opts.adPatterns || DEFAULT_AD_PATTERNS;
  const minLen = opts.minParagraphLength || 20;

  const counter = new Map();
  const bump = (id, n) => counter.set(id, (counter.get(id) || 0) + (n || 1));

  const fixParagraph = (p) => {
    let s = p;

    /* Simplified Chinese proofreading (C001-C007). */
    if (rules.has('C001')) { const b = s; s = toSimplified(s); if (s !== b) bump('C001'); }
    if (rules.has('C002')) { const b = s; s = normalizeQuotes(s); if (s !== b) bump('C002'); }
    if (rules.has('C003')) { const b = s; s = collapseRepeats(s); if (s !== b) bump('C003'); }
    if (rules.has('C004')) { const b = s; s = normalizeEnglishWords(s); if (s !== b) bump('C004'); }
    if (rules.has('C005')) { const b = s; s = normalizeDateAndTime(s); if (s !== b) bump('C005'); }
    if (rules.has('C006')) { const b = s; s = applyTypos(s); if (s !== b) bump('C006'); }
    if (rules.has('C007')) { const b = s; s = s.replace(/([的了着过是在和与就也都又还而])\1+/g, '$1'); if (s !== b) bump('C007'); }

    if (rules.has('T001')) { const before = s; s = s.replace(/\uFFFD/g, ''); if (s !== before) bump('T001'); }
    if (rules.has('T002')) {
      INVISIBLE.lastIndex = 0;
      if (INVISIBLE.test(s)) { s = s.replace(INVISIBLE, ''); bump('T002'); }
      INVISIBLE.lastIndex = 0;
    }
    if (rules.has('T003')) {
      CONTROL.lastIndex = 0;
      if (CONTROL.test(s)) { s = s.replace(CONTROL, ''); bump('T003'); }
      CONTROL.lastIndex = 0;
    }
    if (rules.has('T006')) { const b = s; s = s.replace(/\.{3,}/g, '……').replace(/。{2,}/g, '……'); if (s !== b) bump('T006'); }
    if (rules.has('T007')) { const b = s; s = s.replace(/-{2,}/g, '——'); if (s !== b) bump('T007'); }
    if (rules.has('T016')) {
      const b = s;
      s = s.replace(FULLWIDTH_ALNUM, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0));
      if (s !== b) bump('T016');
    }
    if (rules.has('T017')) { const b = s; s = s.replace(/^[\s\u3000]+/, '').replace(/[\s\u3000]+$/, ''); if (s !== b) bump('T017'); }
    if (rules.has('T018')) { const b = s; s = s.replace(/[ \t]{2,}/g, ' '); if (s !== b) bump('T018'); }
    if (rules.has('T005')) {
      const b = s;
      s = s.replace(/([\u4e00-\u9fff])\s*,\s*/g, '$1，')
           .replace(/([\u4e00-\u9fff])\s*;\s*/g, '$1；')
           .replace(/([\u4e00-\u9fff])\s*:\s*/g, '$1：')
           .replace(/([\u4e00-\u9fff])\s*\?\s*/g, '$1？')
           .replace(/([\u4e00-\u9fff])\s*!\s*/g, '$1！');
      if (s !== b) bump('T005');
    }
    return s;
  };

  /* Titles go through the same proofreading chain as body text. */
  const fixTitle = (text) => {
    let s = text || '';
    if (rules.has('C001')) s = toSimplified(s);
    if (rules.has('C002')) s = normalizeQuotes(s);
    if (rules.has('C003')) s = collapseRepeats(s);
    if (rules.has('C004')) s = normalizeEnglishWords(s);
    if (rules.has('C005')) s = normalizeDateAndTime(s);
    return s;
  };

  const fixBlock = (block) => {
    let paragraphs = block.paragraphs.map(fixParagraph).filter((p) => p.trim());

    if (rules.has('T015')) {
      const before = paragraphs.length;
      paragraphs = paragraphs.filter((p) => !adPatterns.some((re) => re.test(p)));
      if (paragraphs.length !== before) bump('T015', before - paragraphs.length);
    }

    if (rules.has('T010')) {
      const seen = new Set();
      const kept = [];
      for (const p of paragraphs) {
        const key = p.replace(/\s/g, '');
        if (key.length >= minLen) {
          if (seen.has(key)) { bump('T010'); continue; }
          seen.add(key);
        }
        kept.push(p);
      }
      paragraphs = kept;
    }

    const sections = (block.sections || []).map((section) => ({
      ...section,
      rawTitle: fixTitle(section.rawTitle),
      subtitle: fixTitle(section.subtitle),
      paragraphs: section.paragraphs.map(fixParagraph).filter((p) => p.trim()),
    }));

    return {
      ...block,
      rawTitle: fixTitle(block.rawTitle),
      subtitle: fixTitle(block.subtitle),
      paragraphs,
      sections,
    };
  };

  const chapters = doc.chapters.map(fixBlock);

  const frontMatter = doc.frontMatter.map(fixParagraph).filter((p) => p.trim());

  let fixedDoc = { ...doc, frontMatter, chapters };
  if (rules.has('C008')) {
    const filled = fillChapterTitles(fixedDoc, { maxLength: opts.titleMaxLength || 6 });
    if (filled.filled.length) {
      bump('C008', filled.filled.length);
      fixedDoc = filled.doc;
    }
  }

  const fixed = Array.from(counter.entries()).map(([id, count]) => ({ id, count }));
  return { doc: fixedDoc, fixed };
}

/** Render lint results as a compact text report. */
export function renderLintReport(result) {
  const lines = [];
  lines.push('检查结果：' + result.counts.error + ' 个错误，' + result.counts.warn + ' 个警告，' + result.counts.info + ' 个提示');
  if (!result.issues.length) return lines.join('\n');
  lines.push('');
  const groups = new Map();
  for (const issue of result.issues) {
    if (!groups.has(issue.id)) groups.set(issue.id, []);
    groups.get(issue.id).push(issue);
  }
  for (const [id, list] of groups) {
    const first = list[0];
    lines.push('[' + first.severity.toUpperCase() + '] ' + id + ' ' + first.message + '（' + list.length + ' 处）');
    for (const item of list.slice(0, 3)) {
      const where = item.chapterTitle ? item.chapterTitle + (item.paragraphIndex !== null ? ' #' + (item.paragraphIndex + 1) : '') : '';
      lines.push('    ' + where + (where && item.excerpt ? '：' : '') + item.excerpt);
    }
    if (list.length > 3) lines.push('    …共 ' + list.length + ' 处');
  }
  return lines.join('\n');
}