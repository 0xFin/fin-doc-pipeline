/**
 * app.mjs — the browser front end.
 *
 * It reuses the exact modules the CLI uses: encoding detection, the heading
 * rule engine, the parser, the typesetters and the writers. Only the Node
 * specific pieces (compression, filesystem) differ, which is why the codec
 * layer exists.
 *
 * Browser limits: DOCX/EPUB/PDF input needs decompression, which this build
 * does not ship, so those files are rejected with a clear message.
 */

import { detectEncoding } from '../src/encoding.mjs';
import { parseDocument, documentStats } from '../src/parser.mjs';
import { mergeDocuments, renderMergeReport } from '../src/merge.mjs';
import { lintDocument } from '../src/lint.mjs';
import { renderDocument, countText, DEFAULT_FORMAT } from '../src/typography.mjs';
import { renderFormat, SUPPORTED_FORMATS } from '../src/converters.mjs';
import { guessMetaFromFilename } from '../src/converters.mjs';

const TEXT_INPUTS = /\.(txt|text|md|markdown|html|htm|xhtml|rtf|json|jsonl|yaml|yml|xml|csv|tsv|js|mjs|cjs|ts|jsx|tsx|rst|ini|conf|cfg|log|srt|ass|tex|org)$/i;

const el = (id) => document.getElementById(id);

const state = {
  sources: [],
  doc: null,
  meta: {},
};

function readOptions() {
  const numWidth = Number(el('numWidth').value) || 3;
  const format = {
    ...DEFAULT_FORMAT,
    chapterTitle: el('titleTemplate').value || DEFAULT_FORMAT.chapterTitle,
    numWidth,
    indent: el('indent').checked ? '\u3000\u3000' : '',
    titleSeparator: el('separator').value,
    mdHeading: el('mdHeading').value,
  };
  return {
    preset: el('preset').value,
    mergeMode: el('mergeMode').value,
    format,
    structureOptions: {
      markdown: { titleLevels: [1], chapterLevels: [2], sectionLevels: [3] },
    },
  };
}

function status(text, kind) {
  const node = el('status');
  node.textContent = text;
  node.className = kind || '';
}

async function addFiles(fileList) {
  const rejected = [];
  for (const file of fileList) {
    if (!TEXT_INPUTS.test(file.name)) {
      rejected.push(file.name);
      continue;
    }
    const bytes = new Uint8Array(await file.arrayBuffer());
    state.sources.push({
      name: file.name,
      bytes,
      size: bytes.length,
      encoding: '',
      text: '',
      meta: {},
    });
  }
  if (rejected.length) {
    status('已跳过不支持的输入：' + rejected.join('、') + '（浏览器版不支持 DOCX/EPUB/PDF 输入，请用命令行）', 'warn');
  }
  renderFileList();
  if (state.sources.length) parseAll();
}

function renderFileList() {
  const box = el('fileList');
  if (!state.sources.length) {
    box.innerHTML = '<p class="muted">还没有文件。拖进来、选择文件，或直接粘贴文本。</p>';
    return;
  }
  box.innerHTML = state.sources.map((src, index) => (
    '<div class="file-row"><span class="file-name">' + escapeHtml(src.name) + '</span>' +
    '<span class="file-meta">' + (src.encoding || '—') + ' · ' + src.size + ' B</span>' +
    '<button class="link" data-remove="' + index + '">移除</button></div>'
  )).join('');
  box.querySelectorAll('[data-remove]').forEach((button) => {
    button.addEventListener('click', () => {
      state.sources.splice(Number(button.dataset.remove), 1);
      renderFileList();
      parseAll();
    });
  });
}

function escapeHtml(text) {
  return String(text).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}

function decodeSources(options) {
  for (const src of state.sources) {
    const detected = detectEncoding(src.bytes);
    src.encoding = detected.label;
    let text = detected.text;
    if (options.preset === 'plain' || options.preset === 'article') {
      text = text.replace(/\r\n?/g, '\n');
    }
    src.text = text;
  }
}

function buildDocument(sources, options) {
  if (!sources.length) return null;
  const docs = sources.map((src) => ({
    label: src.name,
    path: src.name,
    encoding: src.encoding,
    doc: parseDocument(src.text, options.structureOptions),
  }));
  const merged = mergeDocuments(docs, { mode: options.mergeMode });
  return merged;
}

function parseAll() {
  if (!state.sources.length) {
    state.doc = null;
    el('preview').textContent = '';
    el('stats').textContent = '';
    return;
  }
  try {
    const options = readOptions();
    decodeSources(options);
    const { doc } = buildDocument(state.sources, options);
    state.doc = doc;
    state.meta = guessMetaFromFilename(state.sources[0].name);

    const stats = documentStats(doc.frontMatter || [], doc.chapters || []);
    const lint = lintDocument(doc, { level: 'warn' });
    const preview = renderDocument(doc, options.format);
    el('preview').textContent = preview.slice(0, 4000) + (preview.length > 4000 ? '\n\n…（预览已截断）' : '');
    el('stats').innerHTML =
      '<span>章节 <b>' + (stats.chapterBlocks || 0) + '</b></span>' +
      '<span>小节 <b>' + (stats.sectionCount || 0) + '</b></span>' +
      '<span>汉字 <b>' + countText(preview).chinese + '</b></span>' +
      '<span>段落 <b>' + (stats.paragraphs || 0) + '</b></span>' +
      '<span>编码 <b>' + (state.sources[0] ? state.sources[0].encoding : '—') + '</b></span>' +
      '<span class="' + (lint.counts.error ? 'bad' : 'ok') + '">错误 ' + lint.counts.error +
      ' · 警告 ' + lint.counts.warn + '</span>';
    status('解析完成：' + state.sources.length + ' 个来源，' + (stats.chapterBlocks || 0) + ' 章', 'ok');
  } catch (error) {
    console.error(error);
    status('解析失败：' + error.message, 'bad');
  }
}

function download(name, buffer, binary) {
  const blob = new Blob([buffer], { type: binary ? 'application/octet-stream' : 'text/plain;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

function baseName(name) {
  return String(name).replace(/\.[^.]+$/, '');
}

function exportAll() {
  if (!state.doc) {
    status('请先添加文件或粘贴文本', 'warn');
    return;
  }
  const options = readOptions();
  const formats = Array.from(document.querySelectorAll('input[name="fmt"]:checked')).map((i) => i.value);
  if (!formats.length) {
    status('至少选择一种输出格式', 'warn');
    return;
  }
  const stem = state.sources.length ? baseName(state.sources[0].name) : 'document';
  let done = 0;
  try {
    for (const format of formats) {
      const rendered = renderFormat(state.doc, format, { format: options.format, meta: state.meta });
      download(stem + '.' + rendered.extension, rendered.buffer, rendered.binary);
      done += 1;
    }
    status('已导出 ' + done + ' 个文件：' + formats.join(', '), 'ok');
  } catch (error) {
    console.error(error);
    status('导出失败：' + error.message, 'bad');
  }
}

function exportReport() {
  if (!state.doc) return;
  const options = readOptions();
  const { report } = buildDocument(state.sources, options);
  download((state.sources.length ? baseName(state.sources[0].name) : 'document') + '.report.md', renderMergeReport(report), false);
}

export function start() {
  const drop = el('drop');
  const input = el('fileInput');

  el('pick').addEventListener('click', () => input.click());
  input.addEventListener('change', () => addFiles(input.files));

  ['dragenter', 'dragover'].forEach((type) => drop.addEventListener(type, (event) => {
    event.preventDefault();
    drop.classList.add('over');
  }));
  ['dragleave', 'drop'].forEach((type) => drop.addEventListener(type, (event) => {
    event.preventDefault();
    drop.classList.remove('over');
  }));
  drop.addEventListener('drop', (event) => addFiles(event.dataTransfer.files));

  el('paste').addEventListener('input', () => {
    const text = el('paste').value;
    state.sources = state.sources.filter((s) => s.name !== 'pasted.txt');
    if (text.trim()) {
      state.sources.unshift({
        name: 'pasted.txt',
        bytes: new TextEncoder().encode(text),
        size: text.length,
        encoding: 'UTF-8',
        text,
        meta: {},
      });
    }
    renderFileList();
    parseAll();
  });

  ['titleTemplate', 'numWidth', 'separator', 'mdHeading', 'preset', 'mergeMode'].forEach((id) => {
    el(id).addEventListener('input', parseAll);
  });
  el('indent').addEventListener('change', parseAll);

  el('export').addEventListener('click', exportAll);
  el('report').addEventListener('click', exportReport);
  el('clear').addEventListener('click', () => {
    state.sources = [];
    state.doc = null;
    el('paste').value = '';
    el('preview').textContent = '';
    el('stats').textContent = '';
    renderFileList();
    status('已清空', '');
  });

  el('formats').innerHTML = ['txt', 'md', 'html', 'json', 'yaml', 'xml', 'csv', 'js', 'rtf', 'docx', 'epub', 'pdf']
    .map((format) => {
      const checked = ['txt', 'md', 'epub'].includes(format) ? ' checked' : '';
      return '<label class="chip"><input type="checkbox" name="fmt" value="' + format + '"' + checked + '> ' + format + '</label>';
    })
    .join('');

  el('supported').textContent = SUPPORTED_FORMATS.join(' · ');
  renderFileList();
  status('准备就绪：可以粘贴文本或拖入 .txt / .md / .html / .json / .csv 等文件', '');
}