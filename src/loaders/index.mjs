/**
 * loaders/index.mjs — format registry.
 *
 * Three groups:
 *   container  zip or pdf containers that need unpacking (docx, epub, pdf)
 *   markup     text that must have its markup removed (html, rtf)
 *   plain      everything else: decoded and used as is
 *
 * The same registry drives which extensions the CLI accepts as input, so adding
 * a format in one place is enough.
 */

import { loadDocx } from './docx.mjs';
import { loadEpub } from './epub.mjs';
import { loadPdf } from './pdf.mjs';
import { htmlToPlainText, rtfToPlainText } from './markup.mjs';

/** Binary containers. */
export const CONTAINER_FORMATS = {
  docx: 'docx',
  epub: 'epub',
  pdf: 'pdf',
};

/** Text formats that need markup removal. */
export const MARKUP_FORMATS = {
  html: 'html',
  htm: 'html',
  xhtml: 'html',
  rtf: 'rtf',
};

/** Plain text formats: decoded, then used directly. */
export const PLAIN_FORMATS = [
  'txt', 'text', 'md', 'markdown', 'json', 'jsonl', 'yaml', 'yml',
  'xml', 'csv', 'tsv', 'js', 'mjs', 'cjs', 'ts', 'jsx', 'tsx',
  'rst', 'ini', 'conf', 'cfg', 'log', 'srt', 'ass', 'tex', 'org',
];

/** Every extension the CLI accepts as input. */
export const INPUT_EXTENSIONS = Object.keys(CONTAINER_FORMATS)
  .concat(Object.keys(MARKUP_FORMATS))
  .concat(PLAIN_FORMATS)
  .map((ext) => '.' + ext);

function extensionOf(filePath) {
  const lower = String(filePath).toLowerCase();
  const dot = lower.lastIndexOf('.');
  return dot < 0 ? '' : lower.slice(dot + 1);
}

/** Normalised format name for a path, e.g. "html" for x. HTM. */
export function formatOf(filePath) {
  const ext = extensionOf(filePath);
  if (CONTAINER_FORMATS[ext]) return CONTAINER_FORMATS[ext];
  if (MARKUP_FORMATS[ext]) return MARKUP_FORMATS[ext];
  if (PLAIN_FORMATS.includes(ext)) return ext === 'text' ? 'txt' : ext;
  return 'txt';
}

/** True when the file must be read as a binary container. */
export function isContainer(filePath) {
  return Boolean(CONTAINER_FORMATS[extensionOf(filePath)]);
}

/** True when the file needs markup removal after decoding. */
export function isMarkup(filePath) {
  return Boolean(MARKUP_FORMATS[extensionOf(filePath)]);
}

/** True when the extension is accepted as input. */
export function isKnownInput(filePath) {
  const ext = extensionOf(filePath);
  return Boolean(CONTAINER_FORMATS[ext]) || Boolean(MARKUP_FORMATS[ext]) || PLAIN_FORMATS.includes(ext);
}

/**
 * Load a container or markup file into plain text plus metadata.
 * @returns {{text: string, meta: object, format: string}}
 */
export function loadDocument(buffer, filePath) {
  const format = formatOf(filePath);

  if (format === 'docx') return { ...loadDocx(buffer), format: 'docx' };
  if (format === 'epub') return { ...loadEpub(buffer), format: 'epub' };
  if (format === 'pdf') return { ...loadPdf(buffer), format: 'pdf' };
  throw new Error('不是可解包的容器格式：' + filePath);
}

/** Convert decoded markup text to plain text. */
export function loadMarkup(text, filePath) {
  const format = formatOf(filePath);
  if (format === 'html') return { ...htmlToPlainText(text), format: 'html' };
  if (format === 'rtf') return { ...rtfToPlainText(text), format: 'rtf' };
  return { text, meta: {}, format };
}