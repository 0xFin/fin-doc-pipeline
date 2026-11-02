/**
 * pdf.mjs — PDF writer with Chinese support, no dependencies.
 *
 * Embedding a CJK font would mean shipping megabytes and parsing TrueType.
 * Instead this uses the mechanism the PDF specification provides for CJK: a
 * Type0 font with the predefined CMap UniGB-UCS2-H and the standard
 * STSong-Light face ordered as Adobe-GB1. Every mainstream viewer substitutes
 * a system Song/Ming font, text stays selectable, and the file stays tiny.
 *
 * Text strings are therefore UTF-16BE hex strings, which is why every line is
 * emitted with Tj and an explicit text matrix.
 */

import { getCodec } from '../codec.mjs';
import { renderTitle, cleanParagraph, normalizePunctuation, reflowParagraphs } from '../typography.mjs';

/** Backslash, built from its code point so no layered escaping is needed. */
const BACKSLASH = String.fromCharCode(92);

const PAGE = {
  width: 419.53,   // A5
  height: 595.28,
  marginTop: 56,
  marginBottom: 56,
  marginLeft: 46,
  marginRight: 46,
  bodySize: 10.5,
  headingSize: 15,
  subHeadingSize: 12,
  lineHeight: 17.5,
  indent: 21,
};

/** Characters that occupy a full em in CJK typography. */
function isWide(codePoint) {
  return (codePoint >= 0x1100 && codePoint <= 0x115f) ||
    (codePoint >= 0x2e80 && codePoint <= 0xa4cf) ||
    (codePoint >= 0xac00 && codePoint <= 0xd7a3) ||
    (codePoint >= 0xf900 && codePoint <= 0xfaff) ||
    (codePoint >= 0xfe30 && codePoint <= 0xfe6f) ||
    (codePoint >= 0xff00 && codePoint <= 0xff60) ||
    (codePoint >= 0xffe0 && codePoint <= 0xffe6);
}

/** Standard Helvetica advance widths for ASCII 32..126, in 1/1000 em. */
const HELVETICA_WIDTHS = [
  278, 278, 355, 556, 556, 889, 667, 191, 333, 333, 389, 584, 278, 333, 278, 278,
  556, 556, 556, 556, 556, 556, 556, 556, 556, 556, 278, 278, 584, 584, 584, 556,
  1015, 667, 667, 722, 722, 667, 611, 778, 722, 278, 500, 667, 556, 833, 722, 778,
  667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611, 278, 278, 278, 469, 556,
  333, 556, 556, 500, 556, 556, 278, 556, 556, 222, 222, 500, 222, 833, 556, 556,
  556, 556, 333, 500, 278, 556, 500, 722, 500, 500, 500, 334, 260, 334, 584,
];

function charWidth(codePoint, size) {
  if (codePoint >= 32 && codePoint <= 126) {
    return (HELVETICA_WIDTHS[codePoint - 32] / 1000) * size;
  }
  return isWide(codePoint) ? size : size * 0.5;
}

function measure(text, size) {
  let width = 0;
  for (const ch of text) width += charWidth(ch.codePointAt(0), size);
  return width;
}

/** Break a paragraph into lines that fit the available width. */
function wrap(text, size, firstWidth, restWidth) {
  const lines = [];
  let current = '';
  let width = 0;
  let limit = firstWidth;
  for (const ch of text) {
    const w = charWidth(ch.codePointAt(0), size);
    if (width + w > limit && current) {
      lines.push(current);
      current = '';
      width = 0;
      limit = restWidth;
    }
    current += ch;
    width += w;
  }
  if (current) lines.push(current);
  return lines;
}

/** UTF-16BE hex string for a PDF text object. Characters outside BMP are dropped. */
function pdfString(text) {
  let hex = '';
  for (const ch of String(text)) {
    const cp = ch.codePointAt(0);
    if (cp > 0xffff) continue;
    hex += cp.toString(16).toUpperCase().padStart(4, '0');
  }
  return '<' + hex + '>';
}

/**
 * Split a line into runs that need different fonts. ASCII uses Helvetica so
 * digits and brackets keep their proper half width instead of being mapped to
 * full width CJK forms by the GB1 CMap.
 */
function runsOf(text) {
  const runs = [];
  let current = null;
  for (const ch of String(text)) {
    const ascii = ch.codePointAt(0) < 0x80;
    const font = ascii ? 'F2' : 'F1';
    if (!current || current.font !== font) {
      current = { font, text: '' };
      runs.push(current);
    }
    current.text += ch;
  }
  return runs;
}

/** Plain PDF literal string for single byte fonts. */
function pdfLiteral(text) {
  let out = '';
  for (const ch of String(text)) {
    const cp = ch.codePointAt(0);
    if (ch === '(' || ch === ')' || ch === BACKSLASH) out += BACKSLASH + ch;
    else if (cp < 0x20 || cp > 0x7e) out += '?';
    else out += ch;
  }
  return '(' + out + ')';
}

function prepare(paragraphs, fmt) {
  let list = (paragraphs || []).map((p) => cleanParagraph(p, fmt)).filter(Boolean);
  if (fmt.normalizePunctuation) list = list.map(normalizePunctuation);
  if (fmt.reflow) list = reflowParagraphs(list);
  return list;
}

/** Build the page list: each page is an array of drawing commands. */
function paginate(doc, fmt) {
  const pages = [];
  let current = [];
  let y = PAGE.height - PAGE.marginTop;
  const left = PAGE.marginLeft;
  const maxWidth = PAGE.width - PAGE.marginLeft - PAGE.marginRight;

  const pushPage = () => {
    if (current.length) pages.push(current);
    current = [];
    y = PAGE.height - PAGE.marginTop;
  };

  const writeLine = (text, size, x, lineY) => {
    current.push({ text, size, x, y: lineY });
  };

  const ensureSpace = (needed) => {
    if (y - needed < PAGE.marginBottom) pushPage();
  };

  const front = prepare(doc.frontMatter, fmt);
  for (const paragraph of front) {
    const lines = wrap(paragraph, PAGE.bodySize, maxWidth - PAGE.indent, maxWidth);
    for (const line of lines) {
      ensureSpace(PAGE.lineHeight);
      const first = line === lines[0];
      writeLine(line, PAGE.bodySize, first ? left + PAGE.indent : left, y);
      y -= PAGE.lineHeight;
    }
  }

  for (const ch of doc.chapters) {
    // Only top level blocks start a new page; sections flow inside the chapter.
    if (ch.kind !== 'section') pushPage();
    const title = renderTitle(ch, fmt);
    const size = ch.kind === 'chapter' ? PAGE.headingSize
      : ch.kind === 'section' ? PAGE.subHeadingSize - 1
      : PAGE.subHeadingSize;
    const titleWidth = measure(title, size);
    const titleLines = wrap(title, size, maxWidth, maxWidth);
    for (const line of titleLines) {
      const x = left + Math.max(0, (maxWidth - measure(line, size)) / 2);
      writeLine(line, size, x, y);
      y -= size * 1.6;
    }
    y -= PAGE.lineHeight * 0.6;

    for (const paragraph of prepare(ch.paragraphs, fmt)) {
      const lines = wrap(paragraph, PAGE.bodySize, maxWidth - PAGE.indent, maxWidth);
      for (const line of lines) {
        ensureSpace(PAGE.lineHeight);
        const first = line === lines[0];
        writeLine(line, PAGE.bodySize, first ? left + PAGE.indent : left, y);
        y -= PAGE.lineHeight;
      }
    }

    for (const section of ch.sections || []) {
      ensureSpace(PAGE.lineHeight * 2);
      y -= PAGE.lineHeight * 0.4;
      const sectionTitle = renderTitle(section, fmt);
      ensureSpace(PAGE.subHeadingSize * 1.6);
      writeLine(sectionTitle, PAGE.subHeadingSize - 1, left, y);
      y -= (PAGE.subHeadingSize - 1) * 1.6;
      for (const paragraph of prepare(section.paragraphs, fmt)) {
        const lines = wrap(paragraph, PAGE.bodySize, maxWidth - PAGE.indent, maxWidth);
        for (const line of lines) {
          ensureSpace(PAGE.lineHeight);
          const first = line === lines[0];
          writeLine(line, PAGE.bodySize, first ? left + PAGE.indent : left, y);
          y -= PAGE.lineHeight;
        }
      }
    }
  }

  pushPage();
  if (!pages.length) pushPage();
  return pages;
}

/** Assemble the PDF byte stream. */
export function toPdf(doc, options) {
  const opts = options || {};
  const fmt = opts.format || {};
  const meta = opts.meta || {};
  const pages = paginate(doc, fmt);

  // Footer page numbers. Helvetica keeps the digits half width, and the label is
  // drawn near the bottom margin so it never collides with body text.
  if (fmt.pdfPageNumbers !== false) {
    pages.forEach((commands, index) => {
      const label = String(index + 1);
      const size = 9;
      commands.push({
        text: label,
        size,
        x: (PAGE.width - measure(label, size)) / 2,
        y: PAGE.marginBottom / 2,
      });
    });
  }

  const objects = [];          // 1-based object bodies (Buffer or string)
  const add = (body) => {
    objects.push(body);
    return objects.length;
  };

  const catalogId = add('PLACEHOLDER');
  const pagesId = add('PLACEHOLDER');
  const fontId = add('<< /Type /Font /Subtype /Type0 /BaseFont /STSong-Light /Encoding /UniGB-UCS2-H /DescendantFonts [' + 'CIDFONT_ID 0 R] >>');
  const cidFontId = add('<< /Type /Font /Subtype /CIDFontType0 /BaseFont /STSong-Light /CIDSystemInfo << /Registry (Adobe) /Ordering (GB1) /Supplement 2 >> /DW 1000 >>');
  const helveticaId = add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>');
  let infoId = 0;

  if (meta.title || meta.author) {
    infoId = add('<< /Title ' + pdfTextString(meta.title || '') + ' /Author ' + pdfTextString(meta.author || '') + ' /Producer (fin-doc-pipeline) >>');
  }

  objects[fontId - 1] = '<< /Type /Font /Subtype /Type0 /BaseFont /STSong-Light /Encoding /UniGB-UCS2-H /DescendantFonts [' + cidFontId + ' 0 R] >>';

  const pageIds = [];
  for (const commands of pages) {
    const parts = ['BT'];
    for (const cmd of commands) {
      const size = cmd.size.toFixed(2);
      let x = cmd.x;
      for (const run of runsOf(cmd.text)) {
        parts.push('/' + run.font + ' ' + size + ' Tf');
        parts.push('1 0 0 1 ' + x.toFixed(2) + ' ' + cmd.y.toFixed(2) + ' Tm');
        parts.push((run.font === 'F1' ? pdfString(run.text) : pdfLiteral(run.text)) + ' Tj');
        x += measure(run.text, cmd.size);
      }
    }
    parts.push('ET');
    const stream = parts.join('\n');
    const codec = getCodec();
    const rawStream = Buffer.from(stream, 'latin1');
    const payload = codec.canDeflate ? codec.deflateRaw(rawStream) : rawStream;
    const filter = codec.canDeflate ? ' /Filter /FlateDecode' : '';

    const contentId = add(Buffer.concat([
      Buffer.from('<< /Length ' + payload.length + filter + ' >>\nstream\n', 'latin1'),
      payload,
      Buffer.from('\nendstream', 'latin1'),
    ]));

    const pageId = add('<< /Type /Page /Parent ' + pagesId + ' 0 R /MediaBox [0 0 ' +
      PAGE.width.toFixed(2) + ' ' + PAGE.height.toFixed(2) + '] /Resources << /Font << /F1 ' +
      fontId + ' 0 R /F2 ' + helveticaId + ' 0 R >> >> /Contents ' + contentId + ' 0 R >>');
    pageIds.push(pageId);
  }

  objects[catalogId - 1] = '<< /Type /Catalog /Pages ' + pagesId + ' 0 R >>';
  objects[pagesId - 1] = '<< /Type /Pages /Kids [' + pageIds.map((id) => id + ' 0 R').join(' ') +
    '] /Count ' + pageIds.length + ' >>';

  /* ---- serialise with an xref table ---- */
  const chunks = [];
  let offset = 0;
  const pushBuffer = (buffer) => {
    chunks.push(buffer);
    offset += buffer.length;
  };

  pushBuffer(Buffer.from('%PDF-1.7\n%\u00e2\u00e3\u00cf\u00d3\n', 'latin1'));

  const offsets = [];
  for (let i = 0; i < objects.length; i++) {
    offsets[i] = offset;
    const body = objects[i];
    pushBuffer(Buffer.from((i + 1) + ' 0 obj\n', 'latin1'));
    if (Buffer.isBuffer(body)) pushBuffer(body);
    else pushBuffer(Buffer.from(body, 'latin1'));
    pushBuffer(Buffer.from('\nendobj\n', 'latin1'));
  }

  const xrefOffset = offset;
  let xref = 'xref\n0 ' + (objects.length + 1) + '\n0000000000 65535 f \n';
  for (const off of offsets) {
    xref += String(off).padStart(10, '0') + ' 00000 n \n';
  }
  xref += 'trailer\n<< /Size ' + (objects.length + 1) + ' /Root ' + catalogId + ' 0 R' +
    (infoId ? ' /Info ' + infoId + ' 0 R' : '') + ' >>\nstartxref\n' + xrefOffset + '\n%%EOF\n';
  pushBuffer(Buffer.from(xref, 'latin1'));

  return Buffer.concat(chunks);
}

/** PDF text string: ASCII stays literal, anything else becomes UTF-16BE hex. */
function pdfTextString(text) {
  const value = String(text || '');
  let ascii = true;
  for (const ch of value) {
    if (ch.codePointAt(0) > 0x7e || ch.codePointAt(0) < 0x20) { ascii = false; break; }
  }
  if (ascii) return '(' + value.split('').map((ch) => (ch === '(' || ch === ')' || ch === BACKSLASH ? BACKSLASH + ch : ch)).join('') + ')';
  let hex = 'FEFF';
  for (const ch of value) {
    const cp = ch.codePointAt(0);
    if (cp > 0xffff) continue;
    hex += cp.toString(16).toUpperCase().padStart(4, '0');
  }
  return '<' + hex + '>';
}