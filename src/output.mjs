/**
 * output.mjs — encode generated text for disk or download.
 *
 * Encoding, BOM and line ending are applied here, once, for both runtimes:
 * the CLI writes the returned bytes to a file and the browser turns them into
 * a Blob. Keeping this out of the writers is what makes a file produced by the
 * page byte-identical to the one produced by the command line.
 *
 * Only encodings that can be produced without lookup tables live here. GBK and
 * Big5 output needs a Unicode to legacy mapping (hundreds of kilobytes) or a
 * system iconv; the CLI falls back to iconv, the browser reports that it cannot
 * do it instead of silently writing UTF-8.
 */

/** Encodings this module can produce on its own. */
export const OUTPUT_ENCODINGS = ['utf-8', 'utf-16le', 'utf-16be', 'latin1'];

/** Human readable labels for UI selects. */
export const OUTPUT_ENCODING_LABELS = {
  'utf-8': 'UTF-8',
  'utf-16le': 'UTF-16LE',
  'utf-16be': 'UTF-16BE',
  latin1: 'Latin-1',
};

const ALIASES = {
  'utf-8': 'utf-8',
  utf8: 'utf-8',
  'utf-16le': 'utf-16le',
  utf16le: 'utf-16le',
  unicode: 'utf-16le',
  'utf-16be': 'utf-16be',
  utf16be: 'utf-16be',
  latin1: 'latin1',
  'iso-8859-1': 'latin1',
  binary: 'latin1',
  ascii: 'latin1',
};

/** True when encodeOutput can handle the name without external help. */
export function isSupportedEncoding(name) {
  const key = String(name === undefined || name === null || name === '' ? 'utf-8' : name).trim().toLowerCase();
  return Object.prototype.hasOwnProperty.call(ALIASES, key);
}

/**
 * Resolve an encoding name to its canonical form.
 * Throws an error with code E_ENCODING for anything that needs a mapping table.
 */
export function normalizeEncoding(name) {
  const raw = String(name === undefined || name === null || name === '' ? 'utf-8' : name).trim();
  const key = raw.toLowerCase();
  const enc = ALIASES[key];
  if (enc) return enc;
  const error = new Error(
    '不支持的输出编码：' + raw + '（本工具只能直接输出 ' + OUTPUT_ENCODINGS.join(' / ') +
    '；GBK / Big5 / GB18030 需要系统 iconv，命令行会自动尝试，浏览器版不支持）'
  );
  error.code = 'E_ENCODING';
  throw error;
}

/** BOM bytes for an encoding, or null when the encoding has no BOM. */
export function bomFor(encoding) {
  if (encoding === 'utf-8') return new Uint8Array([0xef, 0xbb, 0xbf]);
  if (encoding === 'utf-16le') return new Uint8Array([0xff, 0xfe]);
  if (encoding === 'utf-16be') return new Uint8Array([0xfe, 0xff]);
  return null;
}

/** UTF-16 encoding: every JS code unit maps to exactly two bytes. */
function utf16Bytes(text, bigEndian) {
  const out = new Uint8Array(text.length * 2);
  for (let i = 0; i < text.length; i++) {
    const unit = text.charCodeAt(i);
    const at = i * 2;
    if (bigEndian) {
      out[at] = unit >> 8 & 0xff;
      out[at + 1] = unit & 0xff;
    } else {
      out[at] = unit & 0xff;
      out[at + 1] = unit >> 8 & 0xff;
    }
  }
  return out;
}

/** Latin-1 encoding; characters outside 0x00-0xff are counted as lossy. */
function latin1Bytes(text) {
  const out = new Uint8Array(text.length);
  let lossy = 0;
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    if (code > 0xff) lossy++;
    out[i] = code & 0xff;
  }
  return { bytes: out, lossy };
}

/**
 * Encode text for output.
 *
 * @param {string} text
 * @param {{encoding?: string, bom?: boolean|undefined, eol?: 'lf'|'crlf'}} [options]
 *   bom === undefined keeps the default: UTF-16 gets a BOM, everything else none.
 * @returns {{bytes: Uint8Array, encoding: string, eol: string, bom: boolean, lossy: number}}
 */
export function encodeOutput(text, options) {
  const opts = options || {};
  const encoding = normalizeEncoding(opts.encoding);
  const eol = opts.eol === 'crlf' ? 'crlf' : 'lf';

  let body = String(text === null || text === undefined ? '' : text).replace(/\r\n?/g, '\n');
  if (eol === 'crlf') body = body.replace(/\n/g, '\r\n');

  let bytes;
  let lossy = 0;
  if (encoding === 'utf-8') {
    bytes = new TextEncoder().encode(body);
  } else if (encoding === 'utf-16le' || encoding === 'utf-16be') {
    bytes = utf16Bytes(body, encoding === 'utf-16be');
  } else {
    const result = latin1Bytes(body);
    bytes = result.bytes;
    lossy = result.lossy;
  }

  /* A UTF-16 file without a BOM is legal but almost always misdetected by
     other tools, so the default differs per encoding. */
  const defaultBom = encoding === 'utf-16le' || encoding === 'utf-16be';
  const withBom = opts.bom === undefined ? defaultBom : opts.bom === true;
  const bom = withBom ? bomFor(encoding) : null;
  if (bom) {
    const combined = new Uint8Array(bom.length + bytes.length);
    combined.set(bom, 0);
    combined.set(bytes, bom.length);
    bytes = combined;
  }

  return { bytes, encoding, eol, bom: Boolean(bom), lossy };
}
