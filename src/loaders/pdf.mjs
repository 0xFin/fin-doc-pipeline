/**
 * pdf.mjs (loader) — best effort text extraction from a PDF.
 *
 * A full PDF text extractor is a large project. This covers the common cases:
 *   - objects with FlateDecode streams
 *   - text operators Tj, TJ, ' and "
 *   - literal and hex strings
 *   - Type0 fonts decoded as UTF-16BE (this is what our own writer emits)
 *   - ToUnicode CMaps (bfchar / bfrange) when a font provides one
 *   - line breaks inferred from text matrix movement
 *
 * It will not recover text from fonts without a usable mapping (scanned pages,
 * broken ToUnicode). In that case it throws instead of returning noise.
 */

import { inflateSync } from 'node:zlib';
import { tidyText } from '../xml.mjs';

function decodeStream(dict, raw) {
  if (!raw) return null;
  try {
    if (/\/FlateDecode/.test(dict)) return inflateSync(raw);
    if (/\/Filter/.test(dict)) return null;
    return raw;
  } catch (err) {
    return null;
  }
}

function parseObjects(buffer, latin) {
  const objects = new Map();
  const re = /(\d+)\s+0\s+obj\b/g;
  let m;
  while ((m = re.exec(latin)) !== null) {
    const id = Number(m[1]);
    const start = m.index + m[0].length;
    const streamIdx = latin.indexOf('stream', start);
    const endobjIdx = latin.indexOf('endobj', start);

    if (streamIdx >= 0 && (endobjIdx < 0 || streamIdx < endobjIdx)) {
      const dict = latin.slice(start, streamIdx);
      let dataStart = streamIdx + 6;
      if (latin[dataStart] === '\r') dataStart += 1;
      if (latin[dataStart] === '\n') dataStart += 1;
      let dataEnd = latin.indexOf('endstream', dataStart);
      if (dataEnd < 0) dataEnd = latin.length;
      const raw = buffer.subarray(dataStart, dataEnd);
      objects.set(id, { id, dict, stream: decodeStream(dict, raw) });
      re.lastIndex = dataEnd;
    } else {
      objects.set(id, {
        id,
        dict: latin.slice(start, endobjIdx < 0 ? Math.min(latin.length, start + 4000) : endobjIdx),
        stream: null,
      });
      if (endobjIdx >= 0) re.lastIndex = endobjIdx + 6;
    }
  }
  return objects;
}

function parseFonts(objects) {
  const fonts = new Map();
  for (const obj of objects.values()) {
    if (!/\/Type\s*\/Font\b/.test(obj.dict)) continue;
    const subtype = (obj.dict.match(/\/Subtype\s*\/([A-Za-z0-9]+)/) || [])[1] || '';
    const toUnicode = (obj.dict.match(/\/ToUnicode\s+(\d+)\s+0\s+R/) || [])[1];
    fonts.set(obj.id, { id: obj.id, subtype, toUnicode: toUnicode ? Number(toUnicode) : null });
  }
  return fonts;
}

/** Map resource names (/F1) to font object ids. Last definition wins. */
function parseFontResources(latin) {
  const map = new Map();
  const re = /\/Font\s*<<([\s\S]*?)>>/g;
  let m;
  while ((m = re.exec(latin)) !== null) {
    const body = m[1];
    const itemRe = /\/([A-Za-z0-9]+)\s+(\d+)\s+0\s+R/g;
    let item;
    while ((item = itemRe.exec(body)) !== null) map.set(item[1], Number(item[2]));
  }
  return map;
}

function parseToUnicode(stream) {
  const map = new Map();
  const text = stream.toString('latin1');

  const bfcharRe = /beginbfchar([\s\S]*?)endbfchar/g;
  let block;
  while ((block = bfcharRe.exec(text)) !== null) {
    const pairRe = /<([0-9a-fA-F]+)>\s*<([0-9a-fA-F]+)>/g;
    let pair;
    while ((pair = pairRe.exec(block[1])) !== null) {
      map.set(parseInt(pair[1], 16), hexToUnicode(pair[2]));
    }
  }

  const bfrangeRe = /beginbfrange([\s\S]*?)endbfrange/g;
  while ((block = bfrangeRe.exec(text)) !== null) {
    const rangeRe = /<([0-9a-fA-F]+)>\s*<([0-9a-fA-F]+)>\s*<([0-9a-fA-F]+)>/g;
    let range;
    while ((range = rangeRe.exec(block[1])) !== null) {
      const from = parseInt(range[1], 16);
      const to = parseInt(range[2], 16);
      const base = parseInt(range[3], 16);
      for (let code = from; code <= to && code - from < 65536; code++) {
        map.set(code, String.fromCodePoint(base + (code - from)));
      }
    }
  }
  return map;
}

function hexToUnicode(hex) {
  let out = '';
  for (let i = 0; i < hex.length; i += 4) {
    const code = parseInt(hex.slice(i, i + 4).padEnd(4, '0'), 16);
    out += String.fromCharCode(code);
  }
  return out;
}

function decodeLiteral(bytes) {
  let out = '';
  for (let i = 0; i < bytes.length; i++) {
    const ch = bytes[i];
    if (ch !== 92) { out += String.fromCharCode(ch); continue; }
    i += 1;
    const next = bytes[i];
    if (next === undefined) break;
    const simple = { 110: '\n', 114: '\r', 116: '\t', 98: '\b', 102: '\f', 40: '(', 41: ')', 92: '\\' };
    if (simple[next] !== undefined) { out += simple[next]; continue; }
    if (next >= 48 && next <= 55) {
      let oct = String.fromCharCode(next);
      while (oct.length < 3 && bytes[i + 1] >= 48 && bytes[i + 1] <= 55) {
        i += 1;
        oct += String.fromCharCode(bytes[i]);
      }
      out += String.fromCharCode(parseInt(oct, 8));
      continue;
    }
    out += String.fromCharCode(next);
  }
  return out;
}

function decodeHexString(hex, font, cmaps) {
  const clean = hex.replace(/[^0-9a-fA-F]/g, '');
  const map = font && font.toUnicode !== null ? cmaps.get(font.toUnicode) : null;
  let out = '';
  for (let i = 0; i + 3 < clean.length + 1; i += 4) {
    const chunk = clean.slice(i, i + 4);
    if (chunk.length < 4) break;
    const code = parseInt(chunk, 16);
    if (map && map.has(code)) out += map.get(code);
    else out += String.fromCharCode(code);
  }
  if (!out && clean.length % 2 === 0) {
    for (let i = 0; i < clean.length; i += 2) {
      out += String.fromCharCode(parseInt(clean.slice(i, i + 2), 16));
    }
  }
  return out;
}

/** Turn one content stream into lines of text. */
function streamToLines(content, fontResources, fonts, cmaps) {
  const bytes = Array.from(content);
  const lines = [];
  let current = '';
  let font = null;
  let lastY = null;
  let operands = [];

  const flush = () => {
    if (current.trim()) lines.push(current);
    current = '';
  };

  const render = (text) => { current += text; };

  const isDelimiter = (code) => {
    if (code <= 32) return true;
    const ch = String.fromCharCode(code);
    return '()<>[]{}/%'.includes(ch);
  };

  let i = 0;
  while (i < bytes.length) {
    const ch = bytes[i];

    if (ch === 40) { // literal string
      let depth = 1;
      let j = i + 1;
      while (j < bytes.length && depth > 0) {
        if (bytes[j] === 92) { j += 2; continue; }
        if (bytes[j] === 40) depth += 1;
        else if (bytes[j] === 41) depth -= 1;
        j += 1;
      }
      operands.push({ type: 'string', value: decodeLiteral(bytes.slice(i + 1, j - 1)) });
      i = j;
      continue;
    }

    if (ch === 60 && bytes[i + 1] !== 60) { // hex string
      const close = bytes.indexOf(62, i + 1);
      if (close < 0) break;
      const hex = bytes.slice(i + 1, close).map((b) => String.fromCharCode(b)).join('');
      operands.push({ type: 'string', value: decodeHexString(hex, font, cmaps) });
      i = close + 1;
      continue;
    }

    if (ch === 47) { // name
      let j = i + 1;
      let name = '';
      while (j < bytes.length && !isDelimiter(bytes[j])) {
        name += String.fromCharCode(bytes[j]);
        j += 1;
      }
      operands.push({ type: 'name', value: name });
      i = j;
      continue;
    }

    if (ch === 91 || ch === 93) { i += 1; continue; }

    if ((ch >= 48 && ch <= 57) || ch === 45 || ch === 46) {
      let j = i;
      let raw = '';
      while (j < bytes.length && ((bytes[j] >= 48 && bytes[j] <= 57) || bytes[j] === 45 || bytes[j] === 46)) {
        raw += String.fromCharCode(bytes[j]);
        j += 1;
      }
      operands.push({ type: 'number', value: Number(raw) });
      i = j;
      continue;
    }

    if (isDelimiter(ch)) { i += 1; continue; }

    // operator
    let j = i;
    let op = '';
    while (j < bytes.length && !isDelimiter(bytes[j])) {
      op += String.fromCharCode(bytes[j]);
      j += 1;
    }
    i = j;

    const numbers = operands.filter((o) => o.type === 'number').map((o) => o.value);
    const strings = operands.filter((o) => o.type === 'string').map((o) => o.value);
    const names = operands.filter((o) => o.type === 'name').map((o) => o.value);

    if (op === 'Tf') {
      const target = names[names.length - 1];
      const fontId = fontResources.get(target);
      font = fontId === undefined ? null : (fonts.get(fontId) || null);
    } else if (op === 'Tm') {
      const y = numbers.length >= 6 ? numbers[5] : null;
      if (y !== null && lastY !== null && Math.abs(y - lastY) > 0.5) flush();
      if (y !== null) lastY = y;
    } else if (op === 'Td' || op === 'TD') {
      const ty = numbers.length >= 2 ? numbers[1] : 0;
      if (Math.abs(ty) > 0.5) flush();
    } else if (op === 'T*') {
      flush();
    } else if (op === 'Tj') {
      if (strings.length) render(strings[strings.length - 1]);
    } else if (op === 'TJ') {
      for (const item of operands) {
        if (item.type === 'string') render(item.value);
        else if (item.type === 'number' && item.value < -200) render(' ');
      }
    } else if (op === "'" || op === '"') {
      flush();
      if (strings.length) render(strings[strings.length - 1]);
    }

    operands = [];
  }

  flush();
  return lines;
}

const varLast = { name: null };

function pdfMetadata(latin) {
  const out = {};
  const read = (key) => {
    const literal = latin.match(new RegExp('/' + key + '\\s*\\(([^)]*)\\)'));
    if (literal) return literal[1].trim();
    const hex = latin.match(new RegExp('/' + key + '\\s*<([0-9a-fA-F]+)>'));
    if (hex) {
      let text = '';
      for (let i = 0; i < hex[1].length; i += 4) {
        text += String.fromCharCode(parseInt(hex[1].slice(i, i + 4).padEnd(4, '0'), 16));
      }
      return text.replace(/^\uFEFF/, '');
    }
    return '';
  };
  const title = read('Title');
  const author = read('Author');
  if (title) out.title = title;
  if (author) out.author = author;
  return out;
}

/**
 * @param {Buffer} buffer
 * @returns {{text: string, meta: object, format: string}}
 */
export function loadPdf(buffer) {
  const latin = buffer.toString('latin1');
  const objects = parseObjects(buffer, latin);
  const fonts = parseFonts(objects);
  const fontResources = parseFontResources(latin);

  const cmaps = new Map();
  for (const font of fonts.values()) {
    if (font.toUnicode === null) continue;
    const obj = objects.get(font.toUnicode);
    if (obj && obj.stream) cmaps.set(font.toUnicode, parseToUnicode(obj.stream));
  }

  const lines = [];
  for (const obj of objects.values()) {
    if (!obj.stream) continue;
    const head = obj.stream.slice(0, 200).toString('latin1');
    if (!/\bBT\b/.test(head) && !/\bET\b/.test(head)) continue;
    lines.push(...streamToLines(obj.stream, fontResources, fonts, cmaps));
  }

  const text = tidyText(lines.join('\n'));
  if (!text) throw new Error('无法从该 PDF 提取文本（可能是扫描件或缺少 ToUnicode 映射）');

  return { text, meta: pdfMetadata(latin), format: 'pdf' };
}