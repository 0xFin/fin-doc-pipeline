/**
 * docx.mjs — minimal, valid OOXML writer.
 *
 * Produces a Word document with a title page, centred chapter headings,
 * first-line indented justified body text and a page break before every
 * chapter. No external libraries: the package is assembled with zip.mjs.
 */

import { createZip } from '../zip.mjs';
import { escapeXml } from '../util.mjs';
import { renderTitle, cleanParagraph, normalizePunctuation, reflowParagraphs } from '../typography.mjs';

const EPOCH = '2026-01-01T00:00:00.000Z';

function paragraph(text, options) {
  const opts = options || {};
  const runProps = [];
  if (opts.bold) runProps.push('<w:b/>');
  if (opts.size) runProps.push('<w:sz w:val="' + opts.size + '"/>');
  if (opts.color) runProps.push('<w:color w:val="' + opts.color + '"/>');

  const paraProps = [];
  if (opts.style) paraProps.push('<w:pStyle w:val="' + opts.style + '"/>');
  if (opts.indent) paraProps.push('<w:ind w:firstLine="' + opts.indent + '"/>');

  const textRun = '<w:r>' + (runProps.length ? '<w:rPr>' + runProps.join('') + '</w:rPr>' : '') +
    '<w:t xml:space="preserve">' + escapeXml(text) + '</w:t></w:r>';

  return '<w:p>' + (paraProps.length ? '<w:pPr>' + paraProps.join('') + '</w:pPr>' : '') + textRun + '</w:p>';
}

function prepare(paragraphs, fmt) {
  let list = (paragraphs || []).map((p) => cleanParagraph(p, fmt)).filter(Boolean);
  if (fmt.normalizePunctuation) list = list.map(normalizePunctuation);
  if (fmt.reflow) list = reflowParagraphs(list);
  return list;
}

const CONTENT_TYPES = [
  '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>',
  '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">',
  '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>',
  '<Default Extension="xml" ContentType="application/xml"/>',
  '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>',
  '<Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>',
  '<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>',
  '</Types>',
].join('\n');

const ROOT_RELS = [
  '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>',
  '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">',
  '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>',
  '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/>',
  '</Relationships>',
].join('\n');

const DOC_RELS = [
  '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>',
  '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">',
  '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>',
  '</Relationships>',
].join('\n');

const STYLES = [
  '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>',
  '<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">',
  '<w:docDefaults><w:rPrDefault><w:rPr>',
  '<w:rFonts w:ascii="Times New Roman" w:hAnsi="Times New Roman" w:eastAsia="SimSun" w:cs="Times New Roman"/>',
  '<w:sz w:val="22"/><w:szCs w:val="22"/></w:rPr></w:rPrDefault>',
  '<w:pPrDefault><w:pPr><w:spacing w:line="360" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults>',
  '<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/></w:style>',
  '<w:style w:type="paragraph" w:styleId="BodyText"><w:name w:val="Body Text"/>',
  '<w:pPr><w:spacing w:line="360" w:lineRule="auto" w:after="0"/><w:ind w:firstLine="440"/><w:jc w:val="both"/></w:pPr></w:style>',
  '<w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/>',
  '<w:pPr><w:pageBreakBefore/><w:spacing w:before="480" w:after="360"/><w:jc w:val="center"/><w:outlineLvl w:val="0"/></w:pPr>',
  '<w:rPr><w:b/><w:sz w:val="32"/></w:rPr></w:style>',
  '<w:style w:type="paragraph" w:styleId="Heading2"><w:name w:val="heading 2"/>',
  '<w:pPr><w:spacing w:before="360" w:after="240"/><w:jc w:val="center"/><w:outlineLvl w:val="1"/></w:pPr>',
  '<w:rPr><w:b/><w:sz w:val="28"/></w:rPr></w:style>',
  '<w:style w:type="paragraph" w:styleId="Title"><w:name w:val="Title"/>',
  '<w:pPr><w:jc w:val="center"/><w:spacing w:before="2400" w:after="240"/></w:pPr>',
  '<w:rPr><w:b/><w:sz w:val="44"/></w:rPr></w:style>',
  '</w:styles>',
].join('\n');

function coreProps(meta) {
  return [
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>',
    '<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties"',
    ' xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/"',
    ' xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">',
    '<dc:title>' + escapeXml(meta.title || '') + '</dc:title>',
    '<dc:creator>' + escapeXml(meta.author || '') + '</dc:creator>',
    '<dc:language>' + escapeXml(meta.language || 'zh-CN') + '</dc:language>',
    '<dcterms:created xsi:type="dcterms:W3CDTF">' + EPOCH + '</dcterms:created>',
    '<dcterms:modified xsi:type="dcterms:W3CDTF">' + EPOCH + '</dcterms:modified>',
    '</cp:coreProperties>',
  ].join('\n');
}

/** Build a .docx file as a Buffer. */
export function toDocx(doc, options) {
  const opts = options || {};
  const fmt = opts.format || {};
  const meta = opts.meta || {};
  const body = [];

  if (meta.title) body.push(paragraph(meta.title, { style: 'Title', size: 44, bold: true }));
  if (meta.author) body.push(paragraph(meta.author, { size: 21, color: '666666' }));
  if (meta.description) {
    for (const p of String(meta.description).split('\n')) {
      if (p.trim()) body.push(paragraph(p.trim(), {}));
    }
  }

  for (const p of prepare(doc.frontMatter, fmt)) body.push(paragraph(p, { style: 'BodyText' }));

  for (const ch of doc.chapters) {
    const title = renderTitle(ch, fmt);
    const style = ch.kind === 'chapter' ? 'Heading1' : 'Heading2';
    body.push(paragraph(title, { style }));
    for (const p of prepare(ch.paragraphs, fmt)) body.push(paragraph(p, { style: 'BodyText' }));
    for (const section of ch.sections || []) {
      body.push(paragraph(renderTitle(section, fmt), { style: 'Heading2' }));
      for (const p of prepare(section.paragraphs, fmt)) body.push(paragraph(p, { style: 'BodyText' }));
    }
  }

  const sectPr = [
    '<w:sectPr>',
    '<w:pgSz w:w="11906" w:h="16838"/>',
    '<w:pgMar w:top="1440" w:right="1418" w:bottom="1440" w:left="1418" w:header="851" w:footer="992" w:gutter="0"/>',
    '</w:sectPr>',
  ].join('');

  const document = [
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>',
    '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">',
    '<w:body>',
    body.join(''),
    sectPr,
    '</w:body>',
    '</w:document>',
  ].join('\n');

  return createZip([
    { name: '[Content_Types].xml', data: CONTENT_TYPES },
    { name: '_rels/.rels', data: ROOT_RELS },
    { name: 'word/document.xml', data: document },
    { name: 'word/styles.xml', data: STYLES },
    { name: 'word/_rels/document.xml.rels', data: DOC_RELS },
    { name: 'docProps/core.xml', data: coreProps(meta) },
  ]);
}