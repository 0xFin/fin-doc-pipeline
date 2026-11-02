/**
 * xml.mjs — the small amount of XML handling the loaders need.
 *
 * DOCX and EPUB are XML inside ZIP. A full parser is unnecessary: we only need
 * text extraction, entity decoding and a few attribute lookups, all of which
 * are safe to do with well anchored regular expressions.
 */

const ENTITIES = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: '\u00a0',
};

/** Decode the five XML entities plus numeric character references. */
export function decodeEntities(text) {
  return String(text).replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g, function (match, body) {
    if (body.charAt(0) === '#') {
      const hex = body.charAt(1) === 'x' || body.charAt(1) === 'X';
      const value = parseInt(hex ? body.slice(2) : body.slice(1), hex ? 16 : 10);
      if (!Number.isFinite(value)) return match;
      try { return String.fromCodePoint(value); } catch (err) { return match; }
    }
    const known = ENTITIES[body.toLowerCase()];
    return known === undefined ? match : known;
  });
}

/** Read an attribute value from a tag string. */
export function attribute(tag, name) {
  const re = new RegExp(name + '\\s*=\\s*"([^"]*)"');
  const m = String(tag).match(re);
  if (m) return decodeEntities(m[1]);
  const single = String(tag).match(new RegExp(name + "\\s*=\\s*'([^']*)'"));
  return single ? decodeEntities(single[1]) : null;
}

/** Extract the text of an element by tag name (first match). */
export function elementText(xml, tagName) {
  const m = String(xml).match(new RegExp('<' + tagName + '(?:\\s[^>]*)?>([\\s\\S]*?)</' + tagName + '>'));
  return m ? decodeEntities(m[1].replace(/<[^>]+>/g, '').trim()) : '';
}

/** Normalise whitespace produced by tag stripping. */
export function tidyText(text) {
  return String(text)
    .replace(/\r\n?/g, '\n')
    .replace(/[ \t]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}
