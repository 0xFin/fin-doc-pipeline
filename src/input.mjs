/**
 * input.mjs — turn raw bytes into text the parser can consume.
 *
 * Decoding, markup removal and the raw-text repairs (BOM, line endings, blank
 * line runs, trailing spaces, tab indentation) live here so the browser build
 * and the tests share one implementation. The CLI has its own file-aware reader
 * because it also unpacks DOCX / EPUB / PDF containers, which need a zip reader;
 * everything below the container layer is the same code.
 */

import { detectEncoding } from './encoding.mjs';
import { htmlToPlainText, rtfToPlainText } from './loaders/markup.mjs';
import { lintRawText, fixRawText } from './lint.mjs';

/** Lower-case extension of a file name, without the dot. */
export function extensionOf(name) {
  const lower = String(name || '').toLowerCase();
  const dot = lower.lastIndexOf('.');
  return dot < 0 ? '' : lower.slice(dot + 1);
}

/**
 * Format of a text input after decoding.
 * Only markup needs work; everything else is used as is.
 */
export function markupFormatOf(name) {
  const ext = extensionOf(name);
  if (ext === 'html' || ext === 'htm' || ext === 'xhtml') return 'html';
  if (ext === 'rtf') return 'rtf';
  return 'text';
}

/**
 * Prepare one input file.
 *
 * @param {string} name file name, used only to pick the markup stripper
 * @param {Uint8Array} bytes
 * @param {{fixRaw?: boolean}} [options]
 * @returns {{
 *   text: string, rawText: string, format: string, meta: object,
 *   encoding: string, label: string, confidence: number, bom: boolean,
 *   rawIssues: Array, fixed: Array<{id: string, count: number}>
 * }}
 */
export function prepareInput(name, bytes, options) {
  const opts = options || {};
  const detection = detectEncoding(bytes);
  const format = markupFormatOf(name);

  let text = detection.text;
  let meta = {};
  if (format === 'html') {
    const loaded = htmlToPlainText(text);
    text = loaded.text;
    meta = loaded.meta || {};
  } else if (format === 'rtf') {
    const loaded = rtfToPlainText(text);
    text = loaded.text;
    meta = loaded.meta || {};
  }

  const rawIssues = lintRawText(text, { bom: detection.bom });
  const repaired = opts.fixRaw === false
    ? { text, fixed: [] }
    : fixRawText(text, { bom: detection.bom });

  return {
    text: repaired.text,
    rawText: text,
    format,
    meta,
    encoding: detection.encoding,
    label: detection.label,
    confidence: detection.confidence,
    bom: detection.bom,
    rawIssues,
    fixed: repaired.fixed,
  };
}
