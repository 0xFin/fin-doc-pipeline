/** Small shared helpers. No third-party dependencies. */

/** Throw a user-facing error with a stable code. */
export class ForgeError extends Error {
  constructor(code, message, detail) {
    super(message);
    this.name = 'ForgeError';
    this.code = code;
    this.detail = detail || null;
  }
}

export function fail(code, message, detail) {
  throw new ForgeError(code, message, detail);
}

/** Strip a UTF-8 BOM from the start of a string. */
export function stripBom(s) {
  return s.charCodeAt(0) === 0xfeff ? s.slice(1) : s;
}

/** Normalise any line ending to LF. */
export function toLf(s) {
  return s.replace(/\r\n?/g, '\n');
}

/** Collapse runs of spaces/tabs (not newlines) into one space. */
export function collapseSpaces(s) {
  return s.replace(/[ \t]{2,}/g, ' ');
}

/** True when the string has no visible characters. */
export function isBlank(s) {
  return !s || !s.trim();
}

/** Number of characters, counting code points (so emoji count as 1). */
export function charLength(s) {
  let n = 0;
  for (const _ of s) n++;
  return n;
}

/** Sort numbers ascending, numerically. */
export function numericSort(arr) {
  return arr.slice().sort((a, b) => a - b);
}

/** Format a chapter number the default way: 1 -> "001". */
export function padNum(num, width) {
  const w = width || 3;
  const s = String(num);
  return s.length >= w ? s : '0'.repeat(w - s.length) + s;
}

/** Safe JSON stringify for terminal output. */
export function pretty(value) {
  return JSON.stringify(value, null, 2);
}

/** Milliseconds -> human readable. */
export function ms(start) {
  return Date.now() - start;
}

/** Escape text for inclusion in XML or XHTML content. */
export function escapeXml(value) {
  return String(value === null || value === undefined ? '' : value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}
