/**
 * epub.mjs — EPUB 3 writer (with an EPUB 2 NCX fallback for older readers).
 *
 * One XHTML document per chapter keeps the files small and lets readers page
 * quickly. No cover image is included: the pipeline deliberately produces
 * text only.
 */

import { createZip } from '../zip.mjs';
import { escapeXml } from '../util.mjs';
import { renderTitle, cleanParagraph, normalizePunctuation, reflowParagraphs } from '../typography.mjs';

const EPOCH = '2026-01-01T00:00:00Z';

/** Small deterministic hash so the same book always gets the same identifier. */
function hashHex(text) {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, '0');
}

/** Deterministic UUID derived from the book identity. */
function uuidFor(seed) {
  const hex = [0, 1, 2, 3].map((i) => hashHex(seed + '#' + i)).join('');
  return hex.slice(0, 8) + '-' + hex.slice(8, 12) + '-' + hex.slice(12, 16) + '-' +
    hex.slice(16, 20) + '-' + hex.slice(20, 32);
}

const STYLE = [
  'body { margin: 0; padding: 0.8em; line-height: 1.75; text-align: justify;',
  '  font-family: "Songti SC", "Noto Serif CJK SC", serif; }',
  'h1 { font-size: 1.3em; text-align: center; margin: 1.2em 0 1em; font-weight: 600; }',
  'h2 { font-size: 1.1em; text-align: center; margin: 1em 0 0.8em; color: #555; }',
  'p { margin: 0 0 0.3em; text-indent: 2em; }',
  'p.front { text-indent: 2em; }',
  'hr { border: 0; border-top: 1px solid #ccc; margin: 1.5em 20%; }',
].join('\n');

function xhtml(title, bodyHtml, lang) {
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<!DOCTYPE html>',
    '<html xmlns="http://www.w3.org/1999/xhtml" xml:lang="' + lang + '" lang="' + lang + '">',
    '<head>',
    '<meta charset="utf-8"/>',
    '<title>' + escapeXml(title) + '</title>',
    '<link rel="stylesheet" type="text/css" href="../style.css"/>',
    '</head>',
    '<body>',
    bodyHtml,
    '</body>',
    '</html>',
  ].join('\n');
}

function prepare(paragraphs, fmt) {
  let list = (paragraphs || []).map((p) => cleanParagraph(p, fmt)).filter(Boolean);
  if (fmt.normalizePunctuation) list = list.map(normalizePunctuation);
  if (fmt.reflow) list = reflowParagraphs(list);
  return list;
}

function paragraphHtml(text) {
  return '<p>' + escapeXml(text) + '</p>';
}

/** Build an .epub file as a Buffer. */
export function toEpub(doc, options) {
  const opts = options || {};
  const fmt = opts.format || {};
  const meta = opts.meta || {};
  const lang = meta.language || 'zh-CN';
  const title = meta.title || '未命名';
  const author = meta.author || '';
  const bookId = 'urn:uuid:' + uuidFor(title + '|' + author);

  const files = [];
  const spine = [];
  const navItems = [];
  const ncxPoints = [];

  let index = 0;

  const frontPages = prepare(doc.frontMatter, fmt);
  let frontId = null;
  if (frontPages.length) {
    index += 1;
    frontId = 'front';
    const frontHtml = '<h2>' + escapeXml(title) + '</h2>\n' + frontPages.map((p) => '<p class="front">' + escapeXml(p) + '</p>').join('\n');
    files.push({ name: 'OEBPS/text/front.xhtml', data: xhtml(title, frontHtml, lang) });
  }

  for (const ch of doc.chapters) {
    const heading = renderTitle(ch, fmt);
    const paragraphs = prepare(ch.paragraphs, fmt);
    index += 1;
    const id = 'ch' + String(index).padStart(3, '0');
    const name = 'text/' + id + '.xhtml';
    const tag = ch.kind === 'chapter' ? 'h1' : 'h2';
    const bodyParts = ['<' + tag + '>' + escapeXml(heading) + '</' + tag + '>']
      .concat(paragraphs.map(paragraphHtml));
    for (const section of ch.sections || []) {
      bodyParts.push('<h3>' + escapeXml(renderTitle(section, fmt)) + '</h3>');
      bodyParts.push(...prepare(section.paragraphs, fmt).map(paragraphHtml));
    }
    const body = bodyParts.join('\n');
    files.push({ name: 'OEBPS/' + name, data: xhtml(heading, body, lang) });
    const label = heading || ch.rawTitle;
    spine.push(id);
    navItems.push({ id, href: name, label });
    ncxPoints.push({ id, href: name, label });
  }

  const manifest = [
    '<item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>',
    '<item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml"/>',
    '<item id="css" href="style.css" media-type="text/css"/>',
  ];
  if (frontId) manifest.push('<item id="front" href="text/front.xhtml" media-type="application/xhtml+xml"/>');
  for (const item of navItems) {
    manifest.push('<item id="' + item.id + '" href="' + item.href + '" media-type="application/xhtml+xml"/>');
  }

  const metadata = [
    '<dc:identifier id="bookid">' + escapeXml(bookId) + '</dc:identifier>',
    '<dc:title>' + escapeXml(title) + '</dc:title>',
    author ? '<dc:creator>' + escapeXml(author) + '</dc:creator>' : '',
    '<dc:language>' + escapeXml(lang) + '</dc:language>',
    meta.description ? '<dc:description>' + escapeXml(meta.description) + '</dc:description>' : '',
    '<meta property="dcterms:modified">' + EPOCH + '</meta>',
  ].filter(Boolean).join('\n    ');

  const opf = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="bookid" xml:lang="' + lang + '">',
    '  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">',
    '    ' + metadata,
    '  </metadata>',
    '  <manifest>',
    '    ' + manifest.join('\n    '),
    '  </manifest>',
    '  <spine toc="ncx">',
    spine.map((id) => '    <itemref idref="' + id + '"/>').join('\n'),
    '  </spine>',
    '</package>',
  ].join('\n');

  const navList = navItems.map((item) =>
    '      <li><a href="' + item.href + '">' + escapeXml(item.label) + '</a></li>'
  ).join('\n');

  const nav = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<!DOCTYPE html>',
    '<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" xml:lang="' + lang + '">',
    '<head><meta charset="utf-8"/><title>目录</title></head>',
    '<body>',
    '  <nav epub:type="toc" id="toc">',
    '    <h1>目录</h1>',
    '    <ol>',
    navList,
    '    </ol>',
    '  </nav>',
    '</body>',
    '</html>',
  ].join('\n');

  const ncx = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<ncx xmlns="http://www.daisy.org/z3986/2005/ncx/" version="2005-1">',
    '  <head><meta name="dtb:uid" content="' + escapeXml(bookId) + '"/></head>',
    '  <docTitle><text>' + escapeXml(title) + '</text></docTitle>',
    '  <navMap>',
    ncxPoints.map((p, i) =>
      '    <navPoint id="np' + (i + 1) + '" playOrder="' + (i + 1) + '"><navLabel><text>' +
      escapeXml(p.label) + '</text></navLabel><content src="' + p.href + '"/></navPoint>'
    ).join('\n'),
    '  </navMap>',
    '</ncx>',
  ].join('\n');

  const container = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">',
    '  <rootfiles>',
    '    <rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/>',
    '  </rootfiles>',
    '</container>',
  ].join('\n');

  return createZip([
    { name: 'mimetype', data: 'application/epub+zip', store: true },
    { name: 'META-INF/container.xml', data: container },
    { name: 'OEBPS/content.opf', data: opf },
    { name: 'OEBPS/nav.xhtml', data: nav },
    { name: 'OEBPS/toc.ncx', data: ncx },
    { name: 'OEBPS/style.css', data: STYLE },
  ].concat(files));
}