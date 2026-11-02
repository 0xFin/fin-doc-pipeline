/**
 * rtf.mjs — Rich Text Format writer.
 *
 * RTF is a plain text container that almost every word processor opens,
 * including legacy Windows tools. Non-ASCII characters are emitted as \uN?
 * escapes so the file is portable regardless of the reader code page.
 */

import { renderTitle, cleanParagraph, normalizePunctuation, reflowParagraphs } from '../typography.mjs';

/** Escape Text For RTF. Non-ASCII becomes a unicode escape with fallback. */
function escapeRtf(value) {
  let out = '';
  for (const ch of String(value === null || value === undefined ? '' : value)) {
    const cp = ch.codePointAt(0);
    if (ch === '\\') out += '\\\\';
    else if (ch === '{') out += '\\{';
    else if (ch === '}') out += '\\}';
    else if (ch === '\n') out += '\\line ';
    else if (cp < 128) out += ch;
    else {
      const signed = cp > 32767 ? cp - 65536 : cp;
      out += '\\u' + signed + '?';
    }
  }
  return out;
}

function prepare(paragraphs, fmt) {
  let list = (paragraphs || []).map((p) => cleanParagraph(p, fmt)).filter(Boolean);
  if (fmt.normalizePunctuation) list = list.map(normalizePunctuation);
  if (fmt.reflow) list = reflowParagraphs(list);
  return list;
}

/** Build an .rtf file as a Buffer. */
export function toRtf(doc, options) {
  const opts = options || {};
  const fmt = opts.format || {};
  const meta = opts.meta || {};
  const parts = [];

  parts.push('{\\rtf1\\ansi\\ansicpg936\\deff0');
  parts.push('{\\fonttbl{\\f0\\fnil\\fcharset134 SimSun;}{\\f1\\fnil\\fcharset134 SimHei;}}');
  parts.push('\\viewkind4\\uc1');

  if (meta.title) {
    parts.push('\\pard\\qc\\sb4800\\sa240\\f1\\fs44\\b ' + escapeRtf(meta.title) + '\\b0\\par');
  }
  if (meta.author) {
    parts.push('\\pard\\qc\\f0\\fs21\\cf2 ' + escapeRtf(meta.author) + '\\cf1\\par');
  }
  if (meta.description) {
    parts.push('\\pard\\qj\\fi440\\f0\\fs22 ' + escapeRtf(meta.description) + '\\par');
  }

  for (const p of prepare(doc.frontMatter, fmt)) {
    parts.push('\\pard\\qj\\fi440\\f0\\fs22 ' + escapeRtf(p) + '\\par');
  }

  for (const ch of doc.chapters) {
    const title = renderTitle(ch, fmt);
    const headingSize = ch.kind === 'chapter' ? 'fs32' : 'fs28';
    parts.push('\\pard\\pagebb\\qc\\sb480\\sa240\\f1\\' + headingSize + '\\b ' + escapeRtf(title) + '\\b0\\par');
    parts.push('\\pard\\qj\\sb120\\f0\\fs22');
    for (const p of prepare(ch.paragraphs, fmt)) {
      parts.push('\\pard\\qj\\fi440\\f0\\fs22 ' + escapeRtf(p) + '\\par');
    }
  }

  parts.push('}');
  return Buffer.from(parts.join('\n'), 'utf8');
}
