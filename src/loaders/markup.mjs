/**
 * markup.mjs — plain text extraction for markup-ish inputs.
 *
 * HTML and RTF are not containers, but they are not "plain text" either: their
 * markup has to go before the chapter parser can see anything useful.
 */

import { decodeEntities, tidyText } from '../xml.mjs';

/** Strip scripts and styles, then turn block tags into line breaks. */
export function htmlToPlainText(html) {
  let body = String(html)
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, '');

  const titleMatch = body.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  const title = titleMatch ? tidyText(decodeEntities(titleMatch[1].replace(/<[^>]+>/g, ''))) : '';

  const bodyMatch = body.match(/<body[^>]*>([\s\S]*?)<\/body>/i);
  body = bodyMatch ? bodyMatch[1] : body;

  const lines = [];
  const headingRe = /<h([1-6])[^>]*>([\s\S]*?)<\/h\1>/gi;
  let lastIndex = 0;
  let m;
  const blocks = [];
  let pendingLevel = 1;

  while ((m = headingRe.exec(body)) !== null) {
    blocks.push({ type: 'text', html: body.slice(lastIndex, m.index) });
    blocks.push({ type: 'heading', html: m[2], level: Number(m[1]) });
    lastIndex = m.index + m[0].length;
  }
  blocks.push({ type: 'text', html: body.slice(lastIndex) });

  for (const block of blocks) {
    let fragment = block.html
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<\/(p|div|li|tr|blockquote|pre)>/gi, '\n')
      .replace(/<[^>]+>/g, '');
    fragment = tidyText(decodeEntities(fragment));
    if (!fragment) continue;
    if (block.type === 'heading') {
      lines.push('');
      lines.push('#'.repeat(Math.min(6, block.level || 1)) + ' ' + fragment);
    } else {
      lines.push(fragment);
    }
  }

  return { text: tidyText(lines.join('\n')), meta: title ? { title } : {} };
}

/** Decode RTF escapes: \uN?, \'hh, \\ \{ \} and \par. */
export function rtfToPlainText(rtf) {
  let text = String(rtf)
    .replace(/\\'([0-9a-fA-F]{2})/g, function (_, hex) {
      return String.fromCharCode(parseInt(hex, 16));
    })
    .replace(/\\u(-?\d+)\??/g, function (_, num) {
      let cp = parseInt(num, 10);
      if (cp < 0) cp += 65536;
      try { return String.fromCodePoint(cp); } catch (err) { return ''; }
    })
    .replace(/\\par[d]?\b/g, '\n')
    .replace(/\\line\b/g, '\n')
    .replace(/\\tab\b/g, ' ')
    .replace(/\{\\\*[\s\S]*?\}/g, '')
    .replace(/\\[a-zA-Z]+-?\d* ?/g, '')
    .replace(/\\([\\{}])/g, '$1')
    .replace(/[{}]/g, '');

  return { text: tidyText(text), meta: {} };
}