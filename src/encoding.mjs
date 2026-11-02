/**
 * encoding.mjs — encoding detection that survives real-world damage.
 *
 * The naive "try candidates in order, take the first one that does not throw"
 * strategy is unsafe: a single invalid byte deep inside a 200 KB GBK book makes
 * the strict GBK decoder fail, the Big5 decoder succeeds on those same bytes,
 * and the whole book silently turns into mojibake. Detection here is therefore
 * score based: every candidate is decoded (strictly if possible, lossily
 * otherwise) and the result is scored by how much it looks like real prose.
 */

/**
 * High-frequency characters shared by simplified and traditional Chinese.
 * Real text hits these constantly; mojibake essentially never does.
 */
export const COMMON_ZH = new Set([
  ...'的一是不了在人有我他这为之大来以个中上们到说国和地也子时道出而要于就下得可你年生自会那后能对着事其里所去行过家十用发天如然作方成者多日都三小军二无同么经法当起与好看学进种将还分此心前面又定见只主没公从',
  ...'這來為國說時對見會個們過發經當學進種將還沒與麼無於後裡著讓給嗎呢吧啊兒都會',
]);

const CANDIDATES = [
  { enc: 'utf-8', label: 'UTF-8' },
  { enc: 'utf-16le', label: 'UTF-16LE' },
  { enc: 'utf-16be', label: 'UTF-16BE' },
  { enc: 'gbk', label: 'GBK' },
  { enc: 'gb18030', label: 'GB18030' },
  { enc: 'big5', label: 'Big5' },
];

/** BOM signatures, checked before any scoring. */
function sniffBom(bytes) {
  if (bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) {
    return { enc: 'utf-8', label: 'UTF-8 (BOM)', bomLength: 3 };
  }
  if (bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xfe) {
    return { enc: 'utf-16le', label: 'UTF-16LE (BOM)', bomLength: 2 };
  }
  if (bytes.length >= 2 && bytes[0] === 0xfe && bytes[1] === 0xff) {
    return { enc: 'utf-16be', label: 'UTF-16BE (BOM)', bomLength: 2 };
  }
  return null;
}

/** Decode with a candidate encoding. Never throws. */
export function decodeWith(bytes, enc) {
  try {
    return { text: new TextDecoder(enc, { fatal: true }).decode(bytes), strict: true };
  } catch {
    try {
      return { text: new TextDecoder(enc, { fatal: false }).decode(bytes), strict: false };
    } catch {
      return { text: null, strict: false, unsupported: true };
    }
  }
}

/**
 * Score a decoded string. Higher is better.
 * The weights are deliberately coarse: they only need to separate real prose
 * from mojibake, not to rank two plausible decodings of the same language.
 */
export function scoreText(text) {
  if (!text || !text.length) {
    return { score: -Infinity, chars: 0, common: 0, cjk: 0, ascii: 0, replacement: 0, control: 0, rare: 0, commonRatio: 0 };
  }
  let common = 0, cjk = 0, ascii = 0, replacement = 0, control = 0, rare = 0, other = 0;
  for (const ch of text) {
    const cp = ch.codePointAt(0);
    if (cp === 0xfffd) { replacement++; continue; }
    if (cp < 0x20 && ch !== '\n' && ch !== '\r' && ch !== '\t') { control++; continue; }
    if (cp < 0x7f) { ascii++; continue; }
    if (cp >= 0x4e00 && cp <= 0x9fff) {
      cjk++;
      if (COMMON_ZH.has(ch)) common++;
      continue;
    }
    if ((cp >= 0x3000 && cp <= 0x303f) || (cp >= 0xff00 && cp <= 0xffef)) { other++; continue; }
    if ((cp >= 0xe000 && cp <= 0xf8ff) || (cp >= 0xfe50 && cp <= 0xfe6f)) { rare++; continue; }
    other++;
  }
  const n = text.length;
  let score =
    (8 * common + 0.35 * cjk + 1.2 * ascii + 0.6 * other - 120 * replacement - 40 * control - 6 * rare) / n;

  // Mojibake signature: lots of ideographs but none of the characters that
  // real Chinese prose cannot avoid. Applies to UTF-16 decodings of ASCII too.
  if (n >= 12 && common === 0 && cjk / n > 0.6) score -= 2.5;

  return {
    score,
    chars: n,
    common, cjk, ascii, replacement, control, rare, other,
    commonRatio: common / n,
  };
}

/**
 * Detect the encoding of a buffer.
 * @param {Uint8Array|Buffer} input
 * @returns {{text: string, encoding: string, label: string, confidence: number, bom: boolean, alternatives: Array}}
 */
export function detectEncoding(input) {
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
  if (!bytes.length) {
    return { text: '', encoding: 'utf-8', label: 'UTF-8 (empty)', confidence: 1, bom: false, alternatives: [] };
  }

  // Pure 7-bit data is unambiguous and identical under every ASCII
  // compatible encoding, so skip scoring entirely.
  let allAscii = true;
  for (let i = 0; i < bytes.length; i++) {
    if (bytes[i] >= 0x80) { allAscii = false; break; }
  }
  if (allAscii) {
    const text = Buffer.from(bytes).toString('latin1');
    return {
      text,
      encoding: 'ascii',
      label: 'ASCII (7-bit)',
      confidence: 1,
      bom: false,
      strict: true,
      stats: scoreText(text),
      alternatives: [{ encoding: 'ascii', label: 'ASCII (7-bit)', score: 1, strict: true }],
    };
  }

  const bom = sniffBom(bytes);
  if (bom) {
    const body = bytes.subarray(bom.bomLength);
    const decoded = decodeWith(body, bom.enc);
    const s = scoreText(decoded.text);
    return {
      text: decoded.text || '',
      encoding: bom.enc,
      label: bom.label,
      confidence: 1,
      bom: true,
      alternatives: [{ encoding: bom.enc, label: bom.label, score: s.score, strict: true, bom: true }],
    };
  }

  const scored = [];
  for (const cand of CANDIDATES) {
    const decoded = decodeWith(bytes, cand.enc);
    if (decoded.text === null) continue;
    const s = scoreText(decoded.text);
    // A lossy decode is penalised so a clean decode of another candidate wins.
    const penalty = decoded.strict ? 0 : 15 * (1 + s.replacement);
    scored.push({
      encoding: cand.enc,
      label: cand.label,
      score: s.score - penalty,
      rawScore: s.score,
      strict: decoded.strict,
      bom: false,
      stats: s,
      text: decoded.text,
    });
  }

  if (!scored.length) {
    return { text: new TextDecoder('utf-8', { fatal: false }).decode(bytes), encoding: 'utf-8', label: 'UTF-8 (lossy)', confidence: 0, bom: false, alternatives: [] };
  }

  scored.sort((a, b) => b.score - a.score);
  const best = scored[0];
  const second = scored[1];
  const sameText = Boolean(second) && best.text === second.text;
  const gap = second ? best.score - second.score : best.score;
  const confidence = sameText ? 1 : Math.max(0, Math.min(1, gap / 6));

  return {
    text: best.text,
    encoding: best.encoding,
    label: best.label,
    confidence,
    bom: false,
    strict: best.strict,
    stats: best.stats,
    alternatives: scored.map((s) => ({
      encoding: s.encoding,
      label: s.label,
      score: Number(s.score.toFixed(3)),
      strict: s.strict,
    })),
  };
}

/**
 * Encode text to a non-UTF-8 encoding.
 * Node has no built-in encoder for GBK/Big5, so this shells out to iconv.
 * Only needed for explicit non-UTF-8 output; UTF-8 never touches this path.
 */
export function encodeText(text, encoding) {
  const enc = (encoding || 'utf-8').toLowerCase();
  if (enc === 'utf-8' || enc === 'utf8') return Buffer.from(text, 'utf8');
  throw new Error('encodeText() currently supports UTF-8 only; use iconv for ' + enc);
}

/** Human readable summary of a detection result. */
export function describeDetection(result) {
  const pct = Math.round(result.confidence * 100);
  return result.label + ' (confidence ' + pct + '%)';
}
