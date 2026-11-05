/**
 * Chapter title generation.
 *
 * A missing title is produced by ranking keyphrases extracted from the whole
 * section, not by cutting the first sentence: every 2..maxLength character
 * term is scored by frequency, by how many paragraphs and sentences it spans,
 * by whether it sits in the opening or closing lines, by how specific it is
 * against the other chapters of the same document, and by whether it reads
 * like a noun phrase. The best ranked term becomes the title, so the result
 * describes what the section is about rather than how it happens to start.
 *
 * Terms are matched on a Simplified copy of the text, so the stop-word and
 * function-character rules work for Traditional sources as well; the title
 * itself keeps the script of the source.
 */

import { toSimplified } from './chinese.mjs';

const CJK_RUN = /[\u3400-\u4dbf\u4e00-\u9fff]{2,}/g;
const SENTENCE_CHUNK = /[^。！？!?…；;]+/g;
const LEADING_PUNCT = /^[\s\u3000"'“”‘’「」『』（）()【】《》〈〉.,，。！？!?；;：:…—\-]+/;
const TRAILING_PUNCT = /[\s\u3000"'“”‘’「」『』（）()【】《》〈〉.,，。！？!?；;：:…—\-]+$/;

/** Characters that never begin a usable title. */
const LEAD_STOP = new Set(
  '的了着过地得是在和与及而但并或虽则即且所由这那我你他她它们您咱很太更最不没无有只才再已经将要会能可却便仍每各某哪谁何如若因故'.split(''),
);

/** Characters that never end a usable title. */
const TAIL_STOP = new Set(
  '的了着过地得是在和与及而但并或虽则即且所由这那我你他她它们您咱很太更最不没无有只才再已经将要会能可却便仍每各某哪谁何如若因故就都也又还把被让给对从向于之其'.split(''),
);

/** Characters that make a multi-character term a clause rather than a phrase. */
const MID_STOP = new Set('的是了着过地得在把被让给对从向而但却便即所由'.split(''));

/** Function words and discourse markers that make a poor title. */
const STOP_WORDS = new Set([
  '一个', '一种', '一些', '一样', '一般', '一切', '一直', '一起', '一下', '一点', '一定', '一边',
  '这个', '那个', '这些', '那些', '这样', '那样', '这么', '那么', '这里', '那里', '这种', '那种',
  '什么', '怎么', '为什么', '怎样', '如何', '哪些', '哪个',
  '我们', '你们', '他们', '她们', '它们', '自己', '大家', '别人', '人们', '对方',
  '已经', '曾经', '正在', '可以', '可能', '应该', '必须', '需要', '能够', '不能', '不会', '不要', '不用',
  '不是', '没有', '就是', '还是', '只是', '但是', '不过', '因为', '所以', '因此', '于是', '然后', '而且',
  '并且', '或者', '虽然', '即使', '如果', '只要', '只有', '无论', '不管', '而是', '似的', '的话', '之类',
  '等等', '以及', '由于', '对于', '关于', '根据', '通过', '按照', '随着', '为了', '除了', '直到', '终于',
  '竟然', '居然', '果然', '其实', '当然', '也许', '大概', '似乎', '好像', '仿佛', '突然', '忽然', '立刻',
  '马上', '这时', '那时', '此时', '当时', '后来', '从前', '现在', '今天', '明天', '昨天', '目前', '首先',
  '其次', '再次', '另外', '此外', '同时', '最后', '第一', '第二', '第三', '说道', '问道', '回答', '开始',
  '继续', '进行', '出现', '发现', '觉得', '认为', '知道', '看到', '听到', '想到', '时候', '地方', '东西',
  '事情', '有些', '有的', '没有人',
]);

/** Endings that usually mark a noun phrase. */
const NOUN_SUFFIX = [
  '主义', '制度', '模式', '体系', '系统', '结构', '机制', '方法', '方式', '手段', '工具', '技术', '科学',
  '经济', '文化', '教育', '政治', '社会', '历史', '地理', '心理', '行为', '关系', '能力', '水平', '标准',
  '规则', '政策', '法律', '市场', '企业', '政府', '行业', '领域', '方面', '角度', '层面', '原则', '目标',
  '计划', '方案', '措施', '办法', '过程', '阶段', '类型', '特征', '因素', '原因', '结果', '影响', '意义',
  '作用', '特点', '优势', '劣势', '风险', '挑战', '机会', '策略', '路径', '现象', '问题', '矛盾', '变化',
  '发展', '趋势', '现状', '背景', '经验', '教训', '案例', '实例', '数据', '资源', '环境', '条件', '基础',
  '前提', '目的', '任务', '项目', '工程', '产品', '服务', '需求', '供给', '价格', '成本', '利润', '收入',
  '支出', '投资', '消费', '生产', '管理', '组织', '团队', '人才', '培训', '学习', '就业', '保障', '金融',
  '家庭', '婚姻', '人口', '城市', '乡村', '农区', '生态', '能源', '安全', '质量', '效率', '权利', '责任',
];

const LENGTH_WEIGHT = { 2: 0.72, 3: 0.96, 4: 1.12, 5: 0.94, 6: 0.78 };

/** Trim punctuation and function characters from both ends of a title. */
function trimTitle(value, maxLen) {
  let title = String(value || '').replace(LEADING_PUNCT, '');
  title = title.replace(TRAILING_PUNCT, '');
  while (title && LEAD_STOP.has(toSimplified(title[0]))) title = title.slice(1);
  while (title && TAIL_STOP.has(toSimplified(title[title.length - 1]))) title = title.slice(0, -1);
  if (maxLen && title.length > maxLen) {
    title = title.slice(0, maxLen);
    while (title && TAIL_STOP.has(toSimplified(title[title.length - 1]))) title = title.slice(0, -1);
  }
  return title.length >= 2 ? title : null;
}

/** First clause-breaking character inside a term, or -1. */
function midStopIndex(gram) {
  for (let index = 1; index < gram.length - 1; index++) {
    if (MID_STOP.has(gram[index])) return index;
  }
  return -1;
}

/**
 * Collect every 2..maxGram character term of one section with its statistics.
 * Runs are matched on the simplified copy, so the stop lists only need one
 * script, while the stored gram keeps the source spelling for the title.
 */
function collectTerms(paragraphs, maxGram) {
  const stats = new Map();
  let sentenceOrder = 0;
  paragraphs.forEach((paragraph, paragraphIndex) => {
    const raw = String(paragraph);
    const plain = toSimplified(raw);
    for (const sentence of plain.matchAll(SENTENCE_CHUNK)) {
      if (!sentence[0].trim()) continue;
      const order = sentenceOrder++;
      for (const run of sentence[0].matchAll(CJK_RUN)) {
        const offset = sentence.index + run.index;
        const upTo = Math.min(maxGram, run[0].length);
        for (let length = 2; length <= upTo; length++) {
          for (let start = 0; start + length <= run[0].length; start++) {
            const term = run[0].slice(start, start + length);
            if (LEAD_STOP.has(term[0]) || TAIL_STOP.has(term[length - 1])) continue;
            if (STOP_WORDS.has(term)) continue;
            if (midStopIndex(term) >= 0) continue;
            let record = stats.get(term);
            if (!record) {
              record = {
                gram: raw.slice(offset + start, offset + start + length),
                plain: term,
                count: 0,
                sentences: new Set(),
                paragraphs: new Set(),
                firstSentence: order,
                firstParagraph: paragraphIndex,
              };
              stats.set(term, record);
            }
            record.count++;
            record.sentences.add(order);
            record.paragraphs.add(paragraphIndex);
          }
        }
      }
    }
  });
  return { stats, sentenceCount: sentenceOrder };
}

/** Score one term; higher means more central to the section. */
function scoreTerm(record, context) {
  const length = record.plain.length;
  const frequency = 1 + Math.log(record.count);
  const coverage = 1 + 0.3 * (record.paragraphs.size - 1) + 0.1 * (record.sentences.size - 1);
  let position = 1;
  if (record.firstParagraph === 0) position += 0.12;
  if (context.paragraphCount > 1 && record.firstParagraph === context.paragraphCount - 1) position += 0.08;
  if (record.firstSentence === 0) position += 0.1;
  if (record.sentences.size === 1) position -= 0.05;
  const suffix = NOUN_SUFFIX.some((ending) => record.plain.endsWith(ending)) ? 1.12 : 1;
  const documentFrequency = context.chapterDf ? context.chapterDf.get(record.plain) || 0 : 0;
  const chapterCount = context.chapterCount || 1;
  const idf = chapterCount > 1 ? Math.max(0.3, Math.log((chapterCount + 1) / (documentFrequency + 0.9))) : 1;
  return frequency * coverage * LENGTH_WEIGHT[length] * position * suffix * idf;
}

/** Ranked keyphrases of one section, best first. Exported for inspection. */
export function extractKeyphrases(chapter, options) {
  const opts = options || {};
  const paragraphs = (chapter && chapter.paragraphs ? chapter.paragraphs : []).map((p) => String(p)).filter((p) => p.trim());
  if (!paragraphs.length) return [];
  const maxLength = opts.maxLength || 6;
  const { stats } = collectTerms(paragraphs, maxLength);
  const context = { paragraphCount: paragraphs.length, chapterDf: opts.chapterDf, chapterCount: opts.chapterCount };
  return Array.from(stats.values())
    .map((record) => ({ gram: record.gram, count: record.count, paragraphs: record.paragraphs.size, sentences: record.sentences.size, score: scoreTerm(record, context) }))
    .sort((a, b) => b.score - a.score || b.gram.length - a.gram.length || (a.gram < b.gram ? -1 : a.gram > b.gram ? 1 : 0));
}

/** Characters that usually end a noun phrase and start the predicate. */
const CLAUSE_CUT = new Set('的是了着过地得在有不没就都也又还和与而但可会把被让给对从向为'.split(''));

/**
 * Fall back to the opening clause when a section has no repeated term to rank.
 * The clause is cut where the predicate starts, so a sentence such as
 * "数据备份是运维中最容易被忽视的环节" yields "数据备份" rather than a
 * mid-word slice of the first six characters.
 */
function openingTitle(paragraphs, maxLen) {
  const first = paragraphs.find((p) => String(p).trim());
  if (!first) return null;
  const raw = String(first);
  const plain = toSimplified(raw);
  const lead = plain.match(LEADING_PUNCT);
  const base = lead ? lead[0].length : 0;
  const rest = plain.slice(base);
  const stop = rest.search(/[。！？!?…；;，,]/);
  const sentenceEnd = stop < 0 ? rest.length : stop;
  const sentence = rest.slice(0, sentenceEnd);
  const pronoun = sentence.match(/^(?:我们|你们|他们|她们|它们|咱们|我|你|他|她|它)/);
  const skip = pronoun ? pronoun[0].length : 0;
  const body = sentence.slice(skip);
  const start = base + skip;
  for (let index = 2; index < body.length; index++) {
    if (CLAUSE_CUT.has(body[index]) && !CLAUSE_CUT.has(body[index - 1])) {
      const head = trimTitle(raw.slice(start, start + index), maxLen);
      if (head) return head;
      break;
    }
  }
  return trimTitle(raw.slice(start, start + body.length), maxLen);
}

/**
 * Suggest a chapter title from the section as a whole.
 *
 * The chapter is a parsed chapter object with paragraph strings, maxLen is the
 * longest accepted title (6 by default), and the optional context carries the
 * chapter document frequencies and count, so that terms appearing in every
 * chapter of the document are discounted.
 */
export function deriveChapterTitle(chapter, maxLen, context) {
  const limit = maxLen || 6;
  const paragraphs = (chapter && chapter.paragraphs ? chapter.paragraphs : []).map((p) => String(p)).filter((p) => p.trim());
  if (!paragraphs.length) return null;

  const ranked = extractKeyphrases(chapter, { maxLength: limit, chapterDf: context && context.chapterDf, chapterCount: context && context.chapterCount });
  if (!ranked.length) return openingTitle(paragraphs, limit);

  const top = ranked[0];
  // A section where nothing repeats has no reliable topic term: narrative
  // chapters usually read better under their opening clause.
  if (top.count < 2) return openingTitle(paragraphs, limit);
  // Prefer the longer phrase when a term is embedded in one that is almost as
  // strong: "平台经济" reads better than "平台".
  let best = top;
  for (const candidate of ranked.slice(0, 40)) {
    if (candidate.gram.length <= best.gram.length) continue;
    if (!candidate.gram.includes(best.gram)) continue;
    if (candidate.score < top.score * 0.7) continue;
    if (candidate.score > best.score) best = candidate;
  }
  return trimTitle(best.gram, limit) || openingTitle(paragraphs, limit);
}

/** Document frequencies of every term, used to discount generic wording. */
function chapterFrequencies(chapters, maxLength) {
  const df = new Map();
  for (const chapter of chapters) {
    const paragraphs = (chapter.paragraphs || []).map((p) => String(p));
    if (!paragraphs.some((p) => p.trim())) continue;
    const seen = new Set();
    for (const paragraph of paragraphs) {
      for (const run of toSimplified(paragraph).matchAll(CJK_RUN)) {
        const upTo = Math.min(maxLength, run[0].length);
        for (let length = 2; length <= upTo; length++) {
          for (let start = 0; start + length <= run[0].length; start++) {
            const term = run[0].slice(start, start + length);
            if (LEAD_STOP.has(term[0]) || TAIL_STOP.has(term[length - 1])) continue;
            if (STOP_WORDS.has(term)) continue;
            if (midStopIndex(term) >= 0) continue;
            if (seen.has(term)) continue;
            seen.add(term);
            df.set(term, (df.get(term) || 0) + 1);
          }
        }
      }
    }
  }
  return df;
}

/**
 * Fill in the subtitle of every chapter that lost its title. Existing titles
 * are never touched.
 */
export function fillChapterTitles(doc, options) {
  const opts = options || {};
  const limit = opts.maxLength || 6;
  const chapters = doc.chapters || [];
  const chapterDf = chapterFrequencies(chapters, limit);
  const filled = [];
  const updated = chapters.map((ch) => {
    if (ch.kind !== 'chapter' || ch.subtitle) return ch;
    const title = deriveChapterTitle(ch, limit, { chapterDf, chapterCount: chapters.length });
    if (!title) return ch;
    filled.push({ id: ch.id, title });
    return { ...ch, subtitle: title, generatedTitle: true };
  });
  return { doc: { ...doc, chapters: updated }, filled };
}
