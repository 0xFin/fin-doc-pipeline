/**
 * epub.mjs — read an EPUB into plain text.
 *
 * The spine defines reading order, so documents are concatenated in that order
 * and each document's first heading becomes a line of its own. That keeps
 * chapter boundaries intact for the chapter parser.
 */

import { readZip } from '../zip.mjs';
import { attribute, decodeEntities, elementText, tidyText } from '../xml.mjs';

function resolveHref(baseDir, href) {
  const parts = (baseDir ? baseDir.split('/') : []).concat(href.split('/'));
  const stack = [];
  for (const part of parts) {
    if (!part || part === '.') continue;
    if (part === '..') stack.pop();
    else stack.push(part);
  }
  return stack.join('/');
}

function htmlToText(fragment) {
  let html = fragment
    .replace(/<h([1-6])[^>]*>([\s\S]*?)<\/h\1>/gi, function (_, level, inner) {
      return '\n' + '#'.repeat(Math.min(6, Number(level))) + ' ' + inner.replace(/<[^>]+>/g, '') + '\n';
    })
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|li|tr)>/gi, '\n')
    .replace(/<[^>]+>/g, '');
  return tidyText(decodeEntities(html));
}

/**
 * @param {Buffer} buffer
 * @returns {{text: string, meta: {title?:string, author?:string, language?:string}, format: string}}
 */
export function loadEpub(buffer) {
  const entries = readZip(buffer);
  const byName = new Map(entries.map((e) => [e.name, e]));

  const container = byName.get('META-INF/container.xml');
  if (!container) throw new Error('epub 中找不到 META-INF/container.xml');
  const rootfileTag = container.data.toString('utf8').match(/<rootfile\s[^>]*>/);
  const opfPath = rootfileTag ? attribute(rootfileTag[0], 'full-path') : 'OEBPS/content.opf';
  const opfEntry = byName.get(opfPath);
  if (!opfEntry) throw new Error('epub 中找不到 OPF：' + opfPath);

  const opf = opfEntry.data.toString('utf8');
  const opfDir = opfPath.includes('/') ? opfPath.slice(0, opfPath.lastIndexOf('/')) : '';

  const items = new Map();
  const itemRe = /<item\b[^>]*>/g;
  let m;
  while ((m = itemRe.exec(opf)) !== null) {
    const id = attribute(m[0], 'id');
    const href = attribute(m[0], 'href');
    if (id && href) items.set(id, { href, dir: opfDir });
  }

  const order = [];
  const itemrefRe = /<itemref\b[^>]*>/g;
  while ((m = itemrefRe.exec(opf)) !== null) {
    const idref = attribute(m[0], 'idref');
    if (idref && items.has(idref)) order.push(items.get(idref));
  }

  const lines = [];
  let appended = 0;
  for (const item of order) {
    const path = resolveHref(item.dir, item.href);
    const entry = byName.get(path);
    if (!entry) continue;
    const html = entry.data.toString('utf8');
    const bodyMatch = html.match(/<body[^>]*>([\s\S]*?)<\/body>/i);
    const body = bodyMatch ? bodyMatch[1] : html;

    // The first heading is promoted to its own line and must be removed from
    // the fragment, otherwise the chapter title would appear twice and the
    // chapter parser would see two boundaries.
    let content = body;
    const headingMatch = body.match(/<h([1-3])[^>]*>([\s\S]*?)<\/h\1>/i);
    if (headingMatch) {
      const level = Number(headingMatch[1]);
      const heading = tidyText(decodeEntities(headingMatch[2].replace(/<[^>]+>/g, '')));
      if (heading) {
        lines.push('');
        lines.push('#'.repeat(level) + ' ' + heading);
      }
      content = body.replace(headingMatch[0], '');
    }

    const text = htmlToText(content);
    if (text) {
      lines.push(text);
      appended += 1;
    }
  }

  if (!appended) throw new Error('epub 中没有可读的正文内容');

  const meta = {
    title: elementText(opf, 'dc:title'),
    author: elementText(opf, 'dc:creator'),
    language: elementText(opf, 'dc:language'),
  };

  return { text: tidyText(lines.join('\n')), meta, format: 'epub' };
}