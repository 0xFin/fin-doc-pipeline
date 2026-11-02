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

export const SEVERITY_ORDER = { error: 0, warn: 1, info: 2 };

/**
 * Applied automatically by format/merge. Only invisible damage is repaired:
 * replacement characters, zero width characters, control characters and
 * whitespace. Content is never rewritten without an explicit request.
 */
export const CLEAN_FIXES = ['T001', 'T002', 'T003', 'T017', 'T018'];

/**
 * Applied by "check --fix": cleaning plus conventional punctuation
 * normalisation (ellipsis, dash, full-width alphanumerics).
 */
export const SAFE_FIXES = ['T001', 'T002', 'T003', 'T006', 'T007', 'T016', 'T017', 'T018'];

/** Only applied when explicitly requested through --rules. */
export const OPT_IN_FIXES = ['T005', 'T010', 'T015'];

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

  const chapters = doc.chapters.map((ch) => {
    let paragraphs = ch.paragraphs.map(fixParagraph).filter((p) => p.trim());

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

    return { ...ch, paragraphs };
  });

  const frontMatter = doc.frontMatter.map(fixParagraph).filter((p) => p.trim());

  const fixed = Array.from(counter.entries()).map(([id, count]) => ({ id, count }));
  return { doc: { ...doc, frontMatter, chapters }, fixed };
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