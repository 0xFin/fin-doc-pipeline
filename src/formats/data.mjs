/**
 * data.mjs — structured serialisers.
 *
 * Besides readable document formats the pipeline can emit the parsed document
 * as data, which is useful for agents and for further processing:
 *
 *   json  yaml  xml  csv  js
 *
 * All of them are built from one canonical object so the content is identical
 * across formats.
 */

import { escapeXml } from '../util.mjs';
import { renderTitle, cleanParagraph, normalizePunctuation, reflowParagraphs } from '../typography.mjs';

/**
 * Group blocks into units: a chapter owns the sections that follow it.
 * Sections appearing before any chapter form their own unit with head null.
 */
export function groupBlocks(chapters) {
  const units = [];
  for (const ch of chapters) {
    if (ch.kind === 'section') {
      const last = units[units.length - 1];
      if (last && last.head) last.members.push(ch);
      else units.push({ head: null, members: [ch] });
      continue;
    }
    units.push({ head: ch, members: [] });
  }
  return units;
}

/** Canonical, format independent representation. */
export function documentModel(doc, options) {
  const opts = options || {};
  const fmt = opts.format || {};
  const meta = opts.meta || {};

  const paragraphsOf = (list) => {
    let items = (list || []).map((p) => cleanParagraph(p, fmt)).filter(Boolean);
    if (fmt.normalizePunctuation) items = items.map(normalizePunctuation);
    if (fmt.reflow) items = reflowParagraphs(items);
    return items;
  };

  return {
    meta: {
      title: meta.title || '',
      author: meta.author || '',
      language: meta.language || 'zh-CN',
    },
    frontMatter: paragraphsOf(doc.frontMatter),
    chapters: groupBlocks(doc.chapters).map((unit) => ({
      kind: unit.head ? unit.head.kind : 'section',
      group: unit.head ? unit.head.group : 'main',
      prefix: unit.head ? (unit.head.prefix || '') : '',
      num: unit.head ? unit.head.num : null,
      title: unit.head ? renderTitle(unit.head, fmt) : '',
      subtitle: unit.head ? (unit.head.subtitle || '') : '',
      paragraphs: unit.head ? paragraphsOf(unit.head.paragraphs) : [],
      sections: unit.members.map((section) => ({
        level: section.level,
        title: renderTitle(section, fmt),
        paragraphs: paragraphsOf(section.paragraphs),
      })),
    })),
  };
}

export function toJson(doc, options) {
  return JSON.stringify(documentModel(doc, options), null, 2) + '\n';
}

function yamlScalar(value) {
  if (value === null || value === undefined) return 'null';
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return JSON.stringify(String(value));
}

function toYamlValue(value, indent) {
  const pad = ' '.repeat(indent);

  if (Array.isArray(value)) {
    if (!value.length) return pad + '[]';
    return value.map((item) => {
      if (item !== null && typeof item === 'object') {
        const rendered = toYamlValue(item, indent + 2).split('\n');
        rendered[0] = pad + '- ' + rendered[0].slice(indent + 2);
        return rendered.join('\n');
      }
      return pad + '- ' + yamlScalar(item);
    }).join('\n');
  }

  if (value !== null && typeof value === 'object') {
    const lines = [];
    for (const [key, item] of Object.entries(value)) {
      if (item !== null && typeof item === 'object') {
        lines.push(pad + key + ':');
        lines.push(toYamlValue(item, indent + 2));
      } else {
        lines.push(pad + key + ': ' + yamlScalar(item));
      }
    }
    return lines.join('\n');
  }

  return pad + yamlScalar(value);
}

export function toYaml(doc, options) {
  return toYamlValue(documentModel(doc, options), 0) + '\n';
}

export function toXml(doc, options) {
  const model = documentModel(doc, options);
  const lines = [];
  lines.push('<?xml version="1.0" encoding="UTF-8"?>');
  lines.push('<book>');
  lines.push('  <meta>');
  lines.push('    <title>' + escapeXml(model.meta.title) + '</title>');
  lines.push('    <author>' + escapeXml(model.meta.author) + '</author>');
  lines.push('    <language>' + escapeXml(model.meta.language) + '</language>');
  lines.push('  </meta>');

  if (model.frontMatter.length) {
    lines.push('  <frontMatter>');
    for (const p of model.frontMatter) lines.push('    <p>' + escapeXml(p) + '</p>');
    lines.push('  </frontMatter>');
  }

  lines.push('  <chapters>');
  for (const ch of model.chapters) {
    lines.push('    <chapter kind="' + escapeXml(ch.kind) + '" group="' + escapeXml(ch.group) +
      '" num="' + (ch.num === null ? '' : ch.num) + '" prefix="' + escapeXml(ch.prefix) + '">');
    lines.push('      <title>' + escapeXml(ch.title) + '</title>');
    for (const p of ch.paragraphs) lines.push('      <p>' + escapeXml(p) + '</p>');
    lines.push('    </chapter>');
  }
  lines.push('  </chapters>');
  lines.push('</book>');
  return lines.join('\n') + '\n';
}

function csvCell(value) {
  const text = String(value === null || value === undefined ? '' : value);
  return '"' + text.replace(/"/g, '""') + '"';
}

export function toCsv(doc, options) {
  const model = documentModel(doc, options);
  const rows = [['chapter_index', 'kind', 'group', 'num', 'prefix', 'title', 'paragraph_index', 'text']];
  model.chapters.forEach((ch, chapterIndex) => {
    if (!ch.paragraphs.length) {
      rows.push([chapterIndex + 1, ch.kind, ch.group, ch.num === null ? '' : ch.num, ch.prefix, ch.title, '', '']);
      return;
    }
    ch.paragraphs.forEach((paragraph, paragraphIndex) => {
      rows.push([chapterIndex + 1, ch.kind, ch.group, ch.num === null ? '' : ch.num, ch.prefix, ch.title, paragraphIndex + 1, paragraph]);
    });
  });
  return rows.map((row) => row.map(csvCell).join(',')).join('\n') + '\n';
}

export function toJs(doc, options) {
  const model = documentModel(doc, options);
  return '/** Generated by fin-doc-pipeline. */\nexport default ' +
    JSON.stringify(model, null, 2) + ';\n';
}