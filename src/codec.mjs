/**
 * codec.mjs — pluggable compression.
 *
 * The core modules must run in two environments: Node (where zlib is available)
 * and the browser (where it is not). Rather than branching on the environment
 * everywhere, the ZIP and PDF writers ask this module for a codec.
 *
 * The default codec stores data uncompressed. That is still a perfectly valid
 * ZIP archive and a valid PDF, just larger, and it needs no platform support.
 * Node installs the zlib codec through codec-node.mjs.
 */

function toBytes(input) {
  if (input instanceof Uint8Array) return input;
  if (Array.isArray(input)) return new Uint8Array(input);
  return new Uint8Array(input);
}

const STORE_CODEC = {
  id: 'store',
  canDeflate: false,
  canInflate: false,
  /** Compress for ZIP. Returns the payload and the ZIP method number. */
  deflate(raw) {
    return { data: toBytes(raw), method: 0 };
  },
  /** Decompress a ZIP entry. */
  inflate() {
    throw new Error('当前环境不支持解压：DOCX / EPUB / PDF 输入需要 Node.js 环境');
  },
  /** Compress a PDF content stream. */
  deflateRaw(raw) {
    return toBytes(raw);
  },
  inflateRaw() {
    throw new Error('当前环境不支持解压：PDF 输入需要 Node.js 环境');
  },
};

let current = STORE_CODEC;

export function setCodec(codec) {
  current = codec || STORE_CODEC;
}

export function getCodec() {
  return current;
}

export const storeCodec = STORE_CODEC;
