/**
 * merge.mjs — deduplicate and merge several parsed documents.
 *
 * Three levels of duplication are handled, in this order:
 *
 *   1. file level      identical files (after whitespace normalisation)
 *   2. chapter level   the same (group, number) present in several files
 *   3. paragraph level identical paragraphs inside the chosen chapter
 *
 * A chapter number may legitimately repeat *inside one file* (e.g. "第17章
 * 上/中/下"). Such chapters are treated as sequential parts and are never
 * dropped; only whole files compete with each other.
 *
 * The provenance of every decision is recorded in a report object. That report
 * is written to a separate .report.md file and is never embedded in the book.
 */

import { chapterCharCount, chapterKey, stripBrackets } from './parser.mjs';

export const DEFAULT_MERGE = {
  /**
   * "versions" treats every input as another edition of the same book and picks
   * the best copy of each chapter. "concat" keeps every input intact and simply
   * joins them, which is what you want for a collection of different books.
   */
  mode: 'versions',
  /** How to choose between competing versions of the same chapter. */
  pick: 'longest',
  /** In concat mode, renumber chapters sequentially. */
  renumber: false,
  /** Detect and drop byte-identical files. */
  fileDedupe: true,
  /** Drop exact duplicate paragraphs inside the chosen chapter. */
  paragraphDedupe: true,
  /** Paragraphs shorter than this are never removed: "……" is legitimate. */
  paragraphDedupeMinLength: 20,
};

/** Normalised fingerprint of a parsed document, whitespace insensitive. */
export function documentFingerprint(doc) {
  const parts = [];
  for (const p of doc.frontMatter) parts.push(p);
  for (const c of doc.chapters) {
    parts.push(c.rawTitle);
    for (const p of c.paragraphs) parts.push(p);
  }
  return parts.join('').replace(/\s/g, '');
}

function totalChars(chapters) {
  let n = 0;
  for (const c of chapters) n += chapterCharCount(c);
  return n;
}

/** Remove exact duplicate paragraphs, keeping the first occurrence. */
export function dedupeParagraphs(paragraphs, minLength) {
  const min = typeof minLength === 'number' ? minLength : DEFAULT_MERGE.paragraphDedupeMinLength;
  const seen = new Set();
  const out = [];
  let removed = 0;
  for (const p of paragraphs) {
    const key = p.replace(/\s/g, '');
    if (key.length >= min) {
      if (seen.has(key)) {
        removed += 1;
        continue;
      }
      seen.add(key);
    }
    out.push(p);
  }
  return { paragraphs: out, removed };
}

/** Build a readable candidate list for the report. */
function candidatesOf(entries) {
  return entries.map((e) => ({
    label: e.label,
    chars: totalChars(e.chapters),
    parts: e.chapters.length,
  }));
}

/**
 * Merge several parsed documents into one.
 * @param {Array<{label:string, doc:object, encoding?:string, path?:string}>} sources
 * @param {object} [options]
 * @returns {{doc: object, report: object}}
 */
export function mergeDocuments(sources, options) {
  const opts = { ...DEFAULT_MERGE, ...(options || {}) };
  const report = {
    options: opts,
    sources: sources.map((s) => ({
      label: s.label,
      path: s.path || null,
      encoding: s.encoding || null,
      chapters: s.doc.chapters.length,
      chars: totalChars(s.doc.chapters),
    })),
    duplicateFiles: [],
    frontMatter: null,
    specials: [],
    chapters: [],
    paragraphDedupeRemoved: 0,
    warnings: [],
  };

  /* ---------- 1. file level dedupe ---------- */
  let active = [];
  if (opts.fileDedupe) {
    const seen = new Map();
    for (const src of sources) {
      const fp = documentFingerprint(src.doc);
      if (fp && seen.has(fp)) {
        seen.get(fp).dropped.push(src.label);
      } else {
        const entry = { kept: src.label, dropped: [] };
        seen.set(fp, entry);
        report.duplicateFiles.push(entry);
        active.push(src);
      }
    }
  } else {
    active = sources.slice();
  }

  if (!active.length) {
    return { doc: { frontMatter: [], chapters: [] }, report };
  }

  /* ---------- 1b. concat mode: no competition between files ---------- */
  if (opts.mode === 'concat') {
    const frontMatter = [];
    const chapters = [];
    for (const src of active) {
      frontMatter.push(...(src.doc.frontMatter || []));
      for (const c of src.doc.chapters) chapters.push({ ...c, source: src.label });
    }

    if (opts.renumber) {
      const counters = new Map();
      for (const c of chapters) {
        if (c.kind !== 'chapter') continue;
        const n = (counters.get(c.group) || 0) + 1;
        counters.set(c.group, n);
        c.num = n;
      }
    }

    chapters.forEach((c, i) => { c.id = 'c-' + String(i + 1).padStart(3, '0'); });
    report.mode = 'concat';
    report.renumbered = Boolean(opts.renumber);
    return {
      doc: { frontMatter, chapters, hasChapters: chapters.some((c) => c.kind === 'chapter') },
      report,
    };
  }

  /* ---------- 1c. a single source is passed through untouched ---------- */
  if (active.length === 1) {
    const src = active[0];
    const chapters = src.doc.chapters.map((c, i) => ({
      ...c,
      id: 'c-' + String(i + 1).padStart(3, '0'),
      paragraphs: c.paragraphs.slice(),
      sections: (c.sections || []).map((s) => ({ ...s, paragraphs: s.paragraphs.slice() })),
    }));
    report.mode = 'versions';
    report.singleSource = src.label;
    return {
      doc: {
        frontMatter: (src.doc.frontMatter || []).slice(),
        chapters,
        hasChapters: chapters.some((c) => c.kind === 'chapter'),
      },
      report,
    };
  }

  report.mode = 'versions';

  /* ---------- 2. front matter ---------- */
  const frontCandidates = active
    .map((s) => ({ label: s.label, text: (s.doc.frontMatter || []).join('\n') }))
    .filter((c) => c.text.trim());
  let frontMatter = [];
  if (frontCandidates.length) {
    const chosen = frontCandidates.reduce((a, b) => (b.text.length > a.text.length ? b : a));
    frontMatter = (active.find((s) => s.label === chosen.label).doc.frontMatter || []).slice();
    report.frontMatter = { chosen: chosen.label, candidates: frontCandidates.map((c) => ({ label: c.label, chars: c.text.length })) };
  }

  /* ---------- 3. specials ---------- */
  const specialOrder = [];
  const specialMap = new Map();
  for (const src of active) {
    for (const c of src.doc.chapters) {
      if (c.kind !== 'special') continue;
      const key = stripBrackets(c.rawTitle);
      if (!specialMap.has(key)) {
        specialMap.set(key, []);
        specialOrder.push(key);
      }
      specialMap.get(key).push({ label: src.label, chapters: [c] });
    }
  }

  const specialOut = [];
  for (const key of specialOrder) {
    const entries = specialMap.get(key);
    let chosen;
    if (entries.length === 1) {
      chosen = entries[0];
    } else if (opts.pick === 'first') {
      chosen = entries[0];
    } else {
      chosen = entries.reduce((a, b) => (totalChars(b.chapters) > totalChars(a.chapters) ? b : a));
    }
    const src = active.find((s) => s.label === chosen.label);
    const copy = { ...chosen.chapters[0], source: chosen.label };
    specialOut.push(copy);
    if (entries.length > 1) {
      report.specials.push({ title: key, chosen: chosen.label, candidates: candidatesOf(entries) });
    }
  }

  /* ---------- 4. volume headings ---------- */
  const volumeMap = new Map();
  for (const src of active) {
    for (const c of src.doc.chapters) {
      if (c.kind !== 'volume') continue;
      if (!volumeMap.has(c.num)) volumeMap.set(c.num, { label: src.label, chapters: [c] });
    }
  }
  const volumes = Array.from(volumeMap.values())
    .map((v) => ({ ...v.chapters[0], source: v.label }))
    .sort((a, b) => (a.num === null ? 0 : a.num) - (b.num === null ? 0 : b.num));

  /* ---------- 5. chapters ---------- */
  /** key -> [{label, chapters: []}] in source order, parts in document order */
  const chapterMap = new Map();
  const groupOrder = [];
  for (const src of active) {
    for (const c of src.doc.chapters) {
      if (c.kind !== 'chapter') continue;
      const key = chapterKey(c);
      if (!chapterMap.has(key)) {
        chapterMap.set(key, { group: c.group, num: c.num, entries: [] });
      }
      const bucket = chapterMap.get(key);
      const last = bucket.entries[bucket.entries.length - 1];
      if (last && last.label === src.label) last.chapters.push(c);
      else bucket.entries.push({ label: src.label, chapters: [c] });
      if (!groupOrder.includes(c.group)) groupOrder.push(c.group);
    }
  }

  const mergedChapters = [];
  for (const [key, bucket] of chapterMap) {
    const entries = bucket.entries;
    let chosen;
    let reason;
    if (entries.length === 1) {
      chosen = entries[0];
      reason = 'only-source';
    } else if (opts.pick === 'first') {
      chosen = entries[0];
      reason = 'pick-first';
    } else {
      chosen = entries.reduce((a, b) => (totalChars(b.chapters) > totalChars(a.chapters) ? b : a));
      reason = 'longest';
    }

    const parts = chosen.chapters.map((c) => ({
      ...c,
      paragraphs: c.paragraphs.slice(),
      sections: (c.sections || []).map((s) => ({
        ...s,
        paragraphs: s.paragraphs.slice(),
      })),
      source: chosen.label,
    }));

    if (entries.length > 1) {
      const subtitles = entries
        .map((e) => e.chapters.map((c) => c.subtitle).filter(Boolean).join(' / '))
        .filter(Boolean);
      const titleMismatch = subtitles.length > 1 && new Set(subtitles).size === subtitles.length;
      report.chapters.push({
        key,
        group: bucket.group,
        num: bucket.num,
        chosen: chosen.label,
        reason,
        candidates: candidatesOf(entries),
        titleMismatch,
      });
    }

    mergedChapters.push({ key, group: bucket.group, num: bucket.num, parts });
  }

  /* ---------- 6. paragraph dedupe + flatten ---------- */
  const flat = [];
  for (const entry of mergedChapters) {
    if (entry.parts.length === 1) {
      const single = entry.parts[0];
      let paragraphs = single.paragraphs;
      if (opts.paragraphDedupe) {
        const res = dedupeParagraphs(paragraphs, opts.paragraphDedupeMinLength);
        paragraphs = res.paragraphs;
        report.paragraphDedupeRemoved += res.removed;
      }
      const sections = (single.sections || []).map((section) => {
        if (!opts.paragraphDedupe) return section;
        const res = dedupeParagraphs(section.paragraphs, opts.paragraphDedupeMinLength);
        report.paragraphDedupeRemoved += res.removed;
        return { ...section, paragraphs: res.paragraphs };
      });
      flat.push({ ...single, key: entry.key, paragraphs, sections });
      continue;
    }

    // Multi-part chapter: keep every part in order, as one chapter block.
    const combined = [];
    for (const part of entry.parts) combined.push(...part.paragraphs);
    let paragraphs = combined;
    if (opts.paragraphDedupe) {
      const res = dedupeParagraphs(paragraphs, opts.paragraphDedupeMinLength);
      paragraphs = res.paragraphs;
      report.paragraphDedupeRemoved += res.removed;
    }
    flat.push({
      ...entry.parts[0],
      key: entry.key,
      id: entry.parts[0].id,
      subtitle: entry.parts.map((p) => p.subtitle).filter(Boolean).join(' / '),
      paragraphs,
      sections: entry.parts.reduce((acc, part) => acc.concat(part.sections || []), []),
      multiPart: entry.parts.length,
      source: entry.parts[0].source,
    });
  }

  /* ---------- 7. ordering: follow the most complete source ---------- */
  // Hanging every kind of block in its own pile (specials, then volumes, then
  // chapters) scrambles a book whose parts interleave, so walk the reference
  // document and place each block where it originally sat.
  const base = active.reduce((a, b) => (b.doc.chapters.length > a.doc.chapters.length ? b : a));
  report.baseSource = base.label;

  const specialByTitle = new Map(specialOut.map((c) => [stripBrackets(c.rawTitle), c]));
  const volumeByNum = new Map(volumes.map((c) => [c.num, c]));
  const flatByKey = new Map(flat.map((c) => [c.key, c]));

  const ordered = [];
  const placed = new Set();
  const place = (block) => {
    if (!block) return;
    ordered.push(block);
  };

  for (const c of base.doc.chapters) {
    if (c.kind === 'special') {
      const key = stripBrackets(c.rawTitle);
      if (placed.has('s:' + key)) continue;
      placed.add('s:' + key);
      place(specialByTitle.get(key));
    } else if (c.kind === 'volume') {
      if (placed.has('v:' + c.num)) continue;
      placed.add('v:' + c.num);
      place(volumeByNum.get(c.num));
    } else if (c.kind === 'chapter') {
      const key = chapterKey(c);
      if (placed.has('c:' + key)) continue;
      placed.add('c:' + key);
      place(flatByKey.get(key));
    }
  }

  // Blocks that only exist in the other sources go last, keeping their own order.
  for (const c of specialOut) if (!placed.has('s:' + stripBrackets(c.rawTitle))) ordered.push(c);
  for (const v of volumes) if (!placed.has('v:' + v.num)) ordered.push(v);
  for (const c of flat) if (!placed.has('c:' + c.key)) ordered.push(c);

  // Stable ids after the merge.
  ordered.forEach((c, i) => {
    c.id = 'c-' + String(i + 1).padStart(3, '0');
  });

  /* ---------- 8. warnings ---------- */
  for (const src of active) {
    const perKey = new Map();
    for (const c of src.doc.chapters) {
      if (c.kind !== 'chapter') continue;
      const k = chapterKey(c);
      perKey.set(k, (perKey.get(k) || 0) + 1);
    }
    for (const [k, n] of perKey) {
      if (n > 1) report.warnings.push(src.label + ' 中 ' + k + ' 出现 ' + n + ' 次，已作为分段章节保留');
    }
  }

  if (report.chapters.length) {
    const mismatched = report.chapters.filter((c) => c.titleMismatch);
    if (mismatched.length >= 3 && mismatched.length >= report.chapters.length / 2) {
      report.warnings.push(
        '多个文件的同名章节标题几乎都不同（' + mismatched.length + '/' + report.chapters.length +
        '），这些文件可能是不同的书而不是同一本书的不同版本；如确为不同书，请使用 --merge-mode concat'
      );
    }
    const choices = new Map();
    for (const c of report.chapters) choices.set(c.chosen, (choices.get(c.chosen) || 0) + 1);
    if (choices.size > 1 && active.length > 1) {
      const summary = Array.from(choices.entries()).map(([k, v]) => k + ' ' + v + ' 章').join('，');
      report.warnings.push('章节择优结果混合了多个来源：' + summary + '（详见报告）');
    }
  }

  const doc = {
    frontMatter,
    chapters: ordered,
    hasChapters: ordered.some((c) => c.kind === 'chapter'),
  };

  return { doc, report };
}

/** Render the merge report as Markdown. Never part of the book output. */
export function renderMergeReport(report) {
  const lines = [];
  lines.push('# 合并报告');
  lines.push('');
  lines.push('## 来源文件');
  lines.push('');
  lines.push('| 文件 | 编码 | 章节 | 正文字数 |');
  lines.push('| --- | --- | --- | --- |');
  for (const s of report.sources) {
    lines.push('| ' + s.label + ' | ' + (s.encoding || '-') + ' | ' + s.chapters + ' | ' + s.chars + ' |');
  }
  lines.push('');

  if (report.duplicateFiles.length) {
    const dropped = report.duplicateFiles.filter((d) => d.dropped.length);
    if (dropped.length) {
      lines.push('## 重复文件（内容完全相同）');
      lines.push('');
      for (const d of dropped) {
        lines.push('- 保留 ' + d.kept + '，忽略 ' + d.dropped.join('、'));
      }
      lines.push('');
    }
  }

  if (report.frontMatter && report.frontMatter.candidates.length > 1) {
    lines.push('## 前言取舍');
    lines.push('');
    lines.push('采用：' + report.frontMatter.chosen);
    for (const c of report.frontMatter.candidates) lines.push('- ' + c.label + '：' + c.chars + ' 字');
    lines.push('');
  }

  if (report.specials.length) {
    lines.push('## 特殊篇目取舍');
    lines.push('');
    for (const s of report.specials) {
      lines.push('- ' + s.title + '：采用 ' + s.chosen + '（' + s.candidates.map((c) => c.label + ' ' + c.chars + ' 字').join(' / ') + '）');
    }
    lines.push('');
  }

  if (report.chapters.length) {
    lines.push('## 章节取舍');
    lines.push('');
    lines.push('| 章节 | 采用 | 依据 | 候选（字数） |');
    lines.push('| --- | --- | --- | --- |');
    for (const c of report.chapters) {
      const label = (c.group === 'main' ? '' : c.group) + '第' + c.num + '章';
      const cands = c.candidates.map((x) => x.label + ' ' + x.chars + (x.parts > 1 ? '(' + x.parts + '段)' : '')).join(' / ');
      lines.push('| ' + label + ' | ' + c.chosen + ' | ' + c.reason + ' | ' + cands + ' |');
    }
    lines.push('');
  }

  if (report.paragraphDedupeRemoved) {
    lines.push('## 段落去重');
    lines.push('');
    lines.push('移除完全重复段落 ' + report.paragraphDedupeRemoved + ' 段。');
    lines.push('');
  }

  if (report.warnings.length) {
    lines.push('## 提示');
    lines.push('');
    for (const w of report.warnings) lines.push('- ' + w);
    lines.push('');
  }

  return lines.join('\n');
}