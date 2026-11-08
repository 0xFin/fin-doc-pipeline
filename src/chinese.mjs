/**
 * chinese.mjs — Simplified Chinese proofreading rules.
 *
 * The pipeline knows how Simplified Chinese should look: simplified characters,
 * full-width punctuation, consistent English casing, ISO dates, no repeated
 * punctuation and no obvious typos. Everything here is a pure function over a
 * string, so the same rules run in the CLI, the browser build and the tests.
 *
 * Ambiguous conversions (乾/干, 著/着, 瞭/了, 藉/借) are handled with a small
 * phrase guard: the per-character table is generated once from Unicode CLDR and
 * lives in data/t2s.mjs, while context corrections stay readable here.
 */

import { TRADITIONAL, SIMPLIFIED } from './data/t2s.mjs';

const T2S = (() => {
  const map = new Map();
  const traditional = Array.from(TRADITIONAL);
  const simplified = Array.from(SIMPLIFIED);
  for (let i = 0; i < traditional.length; i += 1) map.set(traditional[i], simplified[i]);
  return map;
})();

export const TRADITIONAL_CHARS = new Set(T2S.keys());

const PUA_START = 0xE000;
const PUA_END = 0xF8FF;
const CJK = '\u4e00-\u9fff';

/**
 * Characters whose per-character mapping is wrong in some very common words.
 * The guard replaces the character with a private-use placeholder before the
 * table runs, so the table cannot touch it.
 */
const GUARDS = [
  // 乾隆, 乾坤, 乾卦, 乾陵, 乾清宮, 乾嘉, 乾元 keep 乾
  [/乾(?=[隆坤卦陵清嘉元])/g, '乾'],
  // 著 is correct in 著作 / 著名 / 显著; only verb uses become 着 (see ZHE)
  [/著/g, '著'],
  // 瞭望 keeps 瞭; 瞭解 becomes 了解 through the table
  [/瞭(?=望)/g, '瞭'],
  // 慰藉 keeps 藉; 藉口 becomes 借口 through the table
  [/慰藉/g, '慰藉'],
];

/** Verb and particle uses of 著 that are 着 in Simplified Chinese. */
const ZHE = [
  ['执著', '执着'], ['著急', '着急'], ['著凉', '着凉'], ['著涼', '着凉'],
  ['著火', '着火'], ['著陆', '着陆'], ['著陸', '着陆'], ['著手', '着手'],
  ['著眼', '着眼'], ['著重', '着重'], ['著想', '着想'], ['著迷', '着迷'],
  ['著實', '着实'], ['著力', '着力'], ['睡著', '睡着'],
  ['沉著', '沉着'], ['附著', '附着'], ['黏著', '黏着'], ['穿著', '穿着'],
  ['接著', '接着'], ['沿著', '沿着'], ['顺著', '顺着'], ['順著', '顺着'],
  ['向著', '向着'], ['随著', '随着'], ['隨著', '随着'], ['为著', '为着'],
  ['為著', '为着'], ['本著', '本着'], ['系著', '系着'], ['繫著', '系着'],
  ['占著', '占着'], ['佔著', '占着'], ['盖著', '盖着'], ['蓋著', '盖着'],
];

function protect(text) {
  let s = text;
  const restored = new Map();
  let code = PUA_START;
  for (const pair of GUARDS) {
    s = s.replace(pair[0], () => {
      if (code > PUA_END) return pair[1];
      const marker = String.fromCharCode(code);
      code += 1;
      restored.set(marker, pair[1]);
      return marker;
    });
  }
  return { text: s, restored };
}

/** Convert Traditional Chinese to Simplified Chinese. */
export function toSimplified(text) {
  const source = String(text === null || text === undefined ? '' : text);
  if (!source) return source;
  const { text: guarded, restored } = protect(source);
  let out = '';
  for (const ch of guarded) out += T2S.get(ch) || ch;
  out = out.replace(/[\uE000-\uF8FF]/g, (ch) => restored.get(ch) || ch);
  for (const pair of ZHE) out = out.split(pair[0]).join(pair[1]);
  return out;
}

/** Traditional characters present in the text, in order of appearance. */
export function traditionalChars(text) {
  const source = String(text === null || text === undefined ? '' : text);
  const { text: guarded } = protect(source);
  const found = [];
  const seen = new Set();
  for (const ch of guarded) {
    if (T2S.has(ch) && !seen.has(ch)) {
      seen.add(ch);
      found.push(ch);
    }
  }
  return found;
}

const ACRONYMS = new Set([
  'kfc', 'tmd', 'qq', 'ktv', 'av', 'cn', 'us', 'rmb', 'usd', 'usdt',
  'ai', 'api', 'cpu', 'gpu', 'ceo', 'cto', 'cfo', 'vip', 'id', 'ip',
  'url', 'uri', 'http', 'https', 'pdf', 'docx', 'epub', 'json', 'yaml',
  'xml', 'csv', 'html', 'css', 'js', 'ok', 'sms', 'gps', 'usb', 'sim',
  'ppt', 'pc', 'tv', 'ui', 'ux', 'os', 'dna', 'rna', 'atm', 'gdp', 'cpi',
]);

const PRODUCT_CASE = new Map([
  ['iphone', 'iPhone'], ['ipad', 'iPad'], ['ipod', 'iPad'], ['imac', 'iMac'],
  ['ios', 'iOS'], ['ipados', 'iPadOS'], ['macos', 'macOS'], ['macbook', 'MacBook'],
  ['ebay', 'eBay'], ['youtube', 'YouTube'], ['github', 'GitHub'], ['gitlab', 'GitLab'],
  ['javascript', 'JavaScript'], ['typescript', 'TypeScript'], ['wifi', 'Wi-Fi'],
  ['wechat', 'WeChat'], ['tiktok', 'TikTok'], ['android', 'Android'],
  ['windows', 'Windows'], ['linux', 'Linux'], ['chrome', 'Chrome'], ['safari', 'Safari'],
]);

const FULLWIDTH_ALNUM = /[\uFF10-\uFF19\uFF21-\uFF3A\uFF41-\uFF5A]/g;

/**
 * Half-width numbers and letters, title case for plain English words and upper
 * case for the acronyms and product names the convention lists.
 */
const UNIT_CASE = new Map([
  ['kg', 'kg'], ['km', 'km'], ['cm', 'cm'], ['mm', 'mm'], ['ml', 'ml'],
  ['gb', 'GB'], ['mb', 'MB'], ['kb', 'KB'], ['tb', 'TB'],
  ['hz', 'Hz'], ['mhz', 'MHz'], ['ghz', 'GHz'], ['kw', 'kW'], ['mah', 'mAh'],
  ['w', 'W'], ['v', 'V'], ['a', 'A'],
]);

export function normalizeEnglishWords(text) {
  let s = String(text === null || text === undefined ? '' : text);
  s = s.replace(FULLWIDTH_ALNUM, (ch) => String.fromCharCode(ch.charCodeAt(0) - 0xfee0));
  s = s.replace(/[A-Za-z][A-Za-z']*/g, (word, offset, whole) => {
    const lower = word.toLowerCase();
    // A unit right after a number keeps its conventional case: 5kg, 100km.
    if (/(\d)\s*$/.test(whole.slice(0, offset)) && UNIT_CASE.has(lower)) {
      return UNIT_CASE.get(lower);
    }
    if (PRODUCT_CASE.has(lower)) return PRODUCT_CASE.get(lower);
    if (ACRONYMS.has(lower)) return lower.toUpperCase();
    if (word.length > 1 && word === lower) return word.charAt(0).toUpperCase() + word.slice(1);
    return word;
  });
  return s;
}

const DATE_PATTERN = /(\d{4})\s*(?:年|[-/.])\s*(\d{1,2})\s*(?:月|[-/.])\s*(\d{1,2})\s*日?/g;
const TIME_PATTERN = /^[ \t]*(?:T|[ ])?\s*([01]?\d|2[0-3])\s*[:：时点]\s*([0-5]\d)\s*分?/;

/** Unify every common date spelling to yyyy-MM-dd (HH:mm kept when present). */
export function normalizeDates(text) {
  return normalizeDateAndTime(text);
}

/** Normalise dates and their optional time in one pass over a paragraph. */
export function normalizeDateAndTime(text) {
  const source = String(text === null || text === undefined ? '' : text);
  let out = '';
  let index = 0;
  DATE_PATTERN.lastIndex = 0;
  let match;
  while ((match = DATE_PATTERN.exec(source)) !== null) {
    out += source.slice(index, match.index);
    const y = Number(match[1]);
    const m = Number(match[2]);
    const d = Number(match[3]);
    if (y < 1900 || y > 2100 || m < 1 || m > 12 || d < 1 || d > 31) {
      out += match[0];
      index = match.index + match[0].length;
      continue;
    }
    let stamp = match[1] + '-' + String(m).padStart(2, '0') + '-' + String(d).padStart(2, '0');
    const after = source.slice(match.index + match[0].length);
    const time = TIME_PATTERN.exec(after);
    if (time) {
      stamp += ' ' + String(Number(time[1])).padStart(2, '0') + ':' + time[2];
      index = match.index + match[0].length + time[0].length;
      out += stamp;
      DATE_PATTERN.lastIndex = index;
      continue;
    }
    index = match.index + match[0].length;
    out += stamp;
    DATE_PATTERN.lastIndex = index;
  }
  out += source.slice(index);
  return out;
}

const CORNER_TO_CURLY = [
  ['「', '“'], ['」', '”'], ['『', '‘'], ['』', '’'],
];

/** Corner brackets, half-width marks and parentheses become full-width. */
export function normalizeQuotes(text) {
  let s = String(text === null || text === undefined ? '' : text);
  for (const pair of CORNER_TO_CURLY) s = s.split(pair[0]).join(pair[1]);
  // Half-width parentheses that hold Chinese become full-width.
  s = s.replace(/\(([^()]*[\u4e00-\u9fff][^()]*)\)/g, '（$1）');
  // Half-width punctuation after Chinese or a closing mark.
  s = s.replace(/([\u4e00-\u9fff”’）】》])\s*,\s*/g, '$1，');
  s = s.replace(/([\u4e00-\u9fff”’）】》])\s*;\s*/g, '$1；');
  s = s.replace(/([\u4e00-\u9fff”’）】》])\s*:\s*/g, '$1：');
  s = s.replace(/([\u4e00-\u9fff”’）】》])\s*\?\s*/g, '$1？');
  s = s.replace(/([\u4e00-\u9fff”’）】》])\s*!\s*/g, '$1！');
  return s;
}

/** Repeated identical punctuation keeps one mark; the ellipsis is preserved. */
export function collapseRepeats(text) {
  let s = String(text === null || text === undefined ? '' : text);
  s = s.replace(/([，、；：！？])\1+/g, '$1');
  s = s.replace(/。{2,}/g, '……');
  s = s.replace(/…{3,}/g, '……');
  return s;
}

/** Full-width punctuation, curly quotes, no doubled punctuation. */
export function normalizeChinesePunctuation(text) {
  return collapseRepeats(normalizeQuotes(text));
}

/** True when the English casing or character width differs from the rule. */
export function hasCaseIssue(text) {
  return normalizeEnglishWords(text) !== String(text === null || text === undefined ? '' : text);
}

/** True when a date is written in a non standard way. */
export function hasDateIssue(text) {
  return normalizeDateAndTime(text) !== String(text === null || text === undefined ? '' : text);
}

/** Common misspellings: whole words only, so the replacements stay safe. */
export const TYPO_REPLACEMENTS = [
  ['按耐', '按捺'], ['既使', '即使'], ['做为', '作为'], ['以经', '已经'],
  ['因该', '应该'], ['迫不急待', '迫不及待'], ['一股作气', '一鼓作气'],
  ['食不裹腹', '食不果腹'], ['再接再励', '再接再厉'], ['变本加利', '变本加厉'],
  ['走头无路', '走投无路'], ['自抱自弃', '自暴自弃'], ['谈笑风声', '谈笑风生'],
  ['甘败下风', '甘拜下风'], ['一如继往', '一如既往'], ['挑拔离间', '挑拨离间'],
  ['穿流不息', '川流不息'], ['默守成规', '墨守成规'], ['迫在眉捷', '迫在眉睫'],
  ['轻歌慢舞', '轻歌曼舞'], ['人才倍出', '人才辈出'], ['鬼鬼崇崇', '鬼鬼祟祟'],
  ['提纲契领', '提纲挈领'], ['病入膏盲', '病入膏肓'], ['相形见拙', '相形见绌'],
  ['金榜提名', '金榜题名'], ['出奇不意', '出其不意'], ['不径而走', '不胫而走'],
  ['如火如茶', '如火如荼'], ['世外桃园', '世外桃源'], ['再所难免', '在所难免'],
  ['至理明言', '至理名言'], ['震憾', '震撼'], ['渲泄', '宣泄'], ['装祯', '装帧'],
  ['哈蜜瓜', '哈密瓜'], ['蜇伏', '蛰伏'], ['精萃', '精粹'], ['凑和', '凑合'],
];

/** Misspellings found in the text. */
export function findTypos(text) {
  const source = String(text === null || text === undefined ? '' : text);
  const found = [];
  for (const pair of TYPO_REPLACEMENTS) {
    let index = source.indexOf(pair[0]);
    while (index >= 0) {
      found.push({ wrong: pair[0], right: pair[1], index });
      index = source.indexOf(pair[0], index + pair[0].length);
    }
  }
  found.sort((a, b) => a.index - b.index);
  return found;
}

/** Replace every known misspelling. */
export function applyTypos(text) {
  let s = String(text === null || text === undefined ? '' : text);
  for (const pair of TYPO_REPLACEMENTS) s = s.split(pair[0]).join(pair[1]);
  return s;
}

/** Repeated particles and accidentally doubled words. */
export function findRepeats(text) {
  const source = String(text === null || text === undefined ? '' : text);
  const found = [];
  for (const match of source.matchAll(/([的了着过是在和与就也都又还而])\1/g)) {
    found.push({ kind: 'particle', text: match[0], index: match.index });
  }
  for (const match of source.matchAll(/([\u4e00-\u9fff]{2})\1/g)) {
    found.push({ kind: 'word', text: match[0], index: match.index });
  }
  return found;
}

/** Run the full proofreading chain over one paragraph. */
export function proofreadText(text, options) {
  const opts = options || {};
  let s = String(text === null || text === undefined ? '' : text);
  if (opts.simplify !== false) s = toSimplified(s);
  if (opts.punctuation !== false) s = normalizeChinesePunctuation(s);
  if (opts.english !== false) s = normalizeEnglishWords(s);
  if (opts.dates !== false) s = normalizeDateAndTime(s);
  if (opts.typos !== false) s = applyTypos(s);
  return s;
}

/** Rule ids understood by fixDocument for the proofreading pass. */
export const PROOFREAD_RULES = ['C001', 'C002', 'C003', 'C004', 'C005', 'C006', 'C007', 'C010', 'C012'];

/**
 * Common wording problems. These are reported, never rewritten: deciding
 * whether "通过…使…" really lacks a subject needs a reader.
 */
export const GRAMMAR_PATTERNS = [
  [/大约[^，。；！？]{0,10}左右/, '「大约」与「左右」语义重复，保留其一'],
  [/原因是[^，。；！？]{0,30}造成的/, '「原因是…造成的」句式杂糅，宜删其一'],
  [/通过[^，。；！？]{0,20}(?:使|让)/, '「通过…使/让…」可能缺少主语'],
  [/进行(?:了)?[^，。；！？]{0,12}的动作/, '「进行了…的动作」冗赘，可直接用动词'],
  [/被(?:遭受|受到)/, '「被遭受/被受到」语义重复'],
  [/免费[^，。；！？]{0,6}赠送/, '「免费赠送」语义重复'],
];

/** Wording problems found in the text. */
export function findGrammarIssues(text) {
  const source = String(text === null || text === undefined ? '' : text);
  const found = [];
  for (const pair of GRAMMAR_PATTERNS) {
    const match = pair[0].exec(source);
    if (match) found.push({ text: match[0], message: pair[1], index: match.index });
  }
  return found;
}

/* ---------------------------------------------------------
   Typography spacing and nesting (C010-C014)
   --------------------------------------------------------- */

/**
 * One space between Chinese and Latin letters. Digits are deliberately left
 * alone: "第1章", "2026年" must not be broken apart.
 */
export function spaceCjkLatin(text) {
  const source = String(text === null || text === undefined ? '' : text);
  return source
    .replace(/([\u4e00-\u9fff])([A-Za-z])/g, '$1 $2')
    .replace(/([A-Za-z])([\u4e00-\u9fff])/g, '$1 $2');
}

/** True when C010 would change the text. */
export function hasCjkLatinIssue(text) {
  const source = String(text === null || text === undefined ? '' : text);
  return spaceCjkLatin(source) !== source;
}

/** Units that take a space before them in Chinese typography. */
const UNIT_PATTERN = /(\d)\s*(GHz|MHz|kg|km|cm|mm|ml|GB|MB|KB|TB|kW|mAh|Hz|W|V|A)(?![A-Za-z])/g;

/** "5kg" becomes "5 kg"; percent and temperature are left alone by design. */
export function spaceNumberUnits(text) {
  const source = String(text === null || text === undefined ? '' : text);
  return source.replace(UNIT_PATTERN, '$1 $2');
}

/** True when C012 would change the text. */
export function hasNumberUnitIssue(text) {
  const source = String(text === null || text === undefined ? '' : text);
  return spaceNumberUnits(source) !== source;
}

/** Nested book-title marks: 《...《...》...》 should use 〈〉 inside. */
export function findNestedBookTitles(text) {
  const match = String(text === null || text === undefined ? '' : text).match(/《[^》]{0,40}《/);
  return match ? { index: match.index, text: match[0] } : null;
}

/** Nested full-width parentheses: use a different bracket level inside. */
export function findNestedParentheses(text) {
  const match = String(text === null || text === undefined ? '' : text).match(/（[^）]{0,40}（/);
  return match ? { index: match.index, text: match[0] } : null;
}

/** A second opening double quote before the first one closes. */
export function findNestedQuotes(text) {
  const source = String(text === null || text === undefined ? '' : text);
  let depth = 0;
  for (let i = 0; i < source.length; i += 1) {
    if (source[i] === '“') {
      if (depth > 0) return { index: i, text: source.slice(Math.max(0, i - 8), i + 8) };
      depth += 1;
    } else if (source[i] === '”') {
      depth = Math.max(0, depth - 1);
    }
  }
  return null;
}
