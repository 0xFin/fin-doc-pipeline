/**
 * docx.mjs — read a Word document into plain text.
 *
 * Paragraph style names are used to keep headings recognisable: a paragraph
 * styled as Heading 1 or Title becomes its own line, which is what the chapter
 * parser needs. Everything else becomes body lines.
 */

import { readZip } from '../zip.mjs';
import { decodeEntities, elementText, tidyText } from '../xml.mjs';

const HEADING_STYLES = /^(?:heading|Heading)\s*([1-9])?$/;

function paragraphText(fragment) {
  const parts = [];
  const re = /<w:(t|br|tab|cr)(?:\s[^>]*)?>([\s\S]*?)<\/w:\1>|<w:(br|cr)\s*\/>/g;
  let m;
  while ((m = re.exec(fragment)) !== null) {
    if (m[3]) {
      parts.push('\n');
    } else if (m[1] === 't') {
      parts.push(decodeEntities(m[2]));
    } else if (m[1] === 'br' || m[1] === 'cr') {
      parts.push('\n');
    } else if (m[1] === 'tab') {
      parts.push(' ');
    }
  }
  if (!parts.length) {
    // Run without an explicit <w:t> wrapper (rare, but valid).
    const plain = fragment.replace(/<[^>]+>/g, '');
    if (plain.trim()) parts.push(decodeEntities(plain));
  }
  return parts.join('');
}

function firstText(zipEntries, name) {
  const entry = zipEntries.find((e) => e.name === name);
  return entry ? entry.data.toString('utf8') : '';
}

/**
 * @param {Buffer} buffer
 * @returns {{text: string, meta: {title?:string, author?:string, language?:string}, format: string}}
 */
export function loadDocx(buffer) {
  const entries = readZip(buffer);
  const document = firstText(entries, 'word/document.xml');
  if (!document) throw new Error('docx 中找不到 word/document.xml');

  const bodyMatch = document.match(/<w:body[^>]*>([\s\S]*)<\/w:body>/);
  const body = bodyMatch ? bodyMatch[1] : document;

  const lines = [];
  const paragraphRe = /<w:p(?:\s[^>]*)?>([\s\S]*?)<\/w:p>/g;
  let match;
  while ((match = paragraphRe.exec(body)) !== null) {
    const fragment = match[1];
    const styleMatch = fragment.match(/<w:pStyle\s+w:val="([^"]+)"/);
    const styleName = styleMatch ? styleMatch[1] : '';
    const text = paragraphText(fragment).trim();
    if (!text) continue;
    if (HEADING_STYLES.test(styleName)) {
      // Emit the style level as Markdown so the parser keeps the hierarchy.
      // A "Title" style is the book title, not a heading, so it stays a plain
      // line and lands in front matter.
      const level = Number((styleName.match(/([1-9])$/) || [])[1] || 1);
      lines.push('');
      lines.push('#'.repeat(Math.min(6, level)) + ' ' + text);
    } else {
      lines.push(text);
    }
  }

  const core = firstText(entries, 'docProps/core.xml');
  const meta = {
    title: core ? elementText(core, 'dc:title') : '',
    author: core ? elementText(core, 'dc:creator') : '',
    language: core ? elementText(core, 'dc:language') : '',
  };

  return { text: tidyText(lines.join('\n')), meta, format: 'docx' };
}