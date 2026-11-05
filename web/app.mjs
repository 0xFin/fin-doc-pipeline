/**
 * app.mjs — the browser front end.
 *
 * It runs the same modules as the CLI: encoding detection, the heading rule
 * engine, the parser, the merger, the linter, the typesetters and the writers.
 * Only the Node specific pieces differ, which is why the codec layer exists.
 *
 * scripts/build-web.mjs inlines this file together with every module it imports
 * into a single self contained index.html, so the page also works from file://.
 *
 * Browser limits: DOCX/EPUB/PDF input needs decompression, which this build
 * does not ship, so those files are rejected with a clear message.
 */

import { installBuffer } from './buffer.mjs';

import { detectEncoding } from '../src/encoding.mjs';
import { parseDocument, documentStats } from '../src/parser.mjs';
import { mergeDocuments, renderMergeReport } from '../src/merge.mjs';
import { lintDocument, fixDocument, PROOFREAD_FIXES } from '../src/lint.mjs';
import { fillChapterTitles } from '../src/chinese.mjs';
import { renderDocument, DEFAULT_FORMAT } from '../src/typography.mjs';
import { renderFormat } from '../src/converters.mjs';

installBuffer();
const FORMATS = ['txt', 'md', 'html', 'json', 'yaml', 'xml', 'csv', 'js', 'rtf', 'docx', 'epub', 'pdf'];
const DEFAULT_SELECTED = ['txt'];
const FW = '\u3000';

const state = {
  files: [],
  mode: 'merge',
  strategy: 'versions',
  outputs: [],
};

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const stemOf = (name) => String(name).replace(/\.[^.]+$/, '');
const bytesText = (n) => (n < 1024 ? n + ' B' : n < 1048576 ? (n / 1024).toFixed(1) + ' KB' : (n / 1048576).toFixed(1) + ' MB');

/* ---------- 主题 ---------- */
/* theme lives in the classic script above so it survives a module failure */

/* ---------- 状态提示 ---------- */
function setStatus(text, kind) {
  const node = $('status');
  node.textContent = text;
  node.style.color = kind === 'error' ? 'var(--error)' : kind === 'ok' ? 'var(--success)' : 'var(--accent)';
}

/* ---------- 文件 ---------- */
const UNSUPPORTED = /\.(docx|doc|epub|pdf|odt)$/i;

async function addFiles(list) {
  const incoming = Array.from(list || []);
  if (!incoming.length) return;

  const accepted = [];
  const rejected = [];
  for (const file of incoming) {
    if (UNSUPPORTED.test(file.name)) { rejected.push(file.name); continue; }
    accepted.push(file);
  }

  for (const file of accepted) {
    const buffer = new Uint8Array(await file.arrayBuffer());
    state.files.push({ name: file.name, size: buffer.length, bytes: buffer });
  }
  renderFiles();

  if (accepted.length) setStatus('已添加 ' + accepted.length + ' 个文件，共 ' + state.files.length + ' 个', 'ok');
  if (rejected.length) {
    setStatus('已跳过 ' + rejected.join('、') + '：浏览器版不解压容器格式，请用命令行处理。', 'error');
  }
}

function resetOutputs() {
  state.outputs = [];
  $('btnDownload').hidden = true;
}

function renderFiles() {
  resetOutputs();
  const box = $('fileList');
  if (!state.files.length) {
    box.innerHTML = '<p class="empty">还没有文件。选择或拖入文本后开始。</p>';
    return;
  }
  box.innerHTML = state.files.map((file, index) => (
    '<div class="file-item">' +
      '<span class="name">' + esc(file.name) + '</span>' +
      '<span class="meta">' + bytesText(file.size) + '</span>' +
      '<button type="button" class="remove" data-index="' + index + '">移除</button>' +
    '</div>'
  )).join('');
  box.querySelectorAll('.remove').forEach((button) => {
    button.addEventListener('click', () => {
      state.files.splice(Number(button.dataset.index), 1);
      renderFiles();
    });
  });
}

/* ---------- 选项 ---------- */
function readFormatOptions() {
  const rawTemplate = ($('titleTemplate').value || '').replace(/^#{1,6}\s+/, '').trim();
  return {
    ...DEFAULT_FORMAT,
    chapterTitle: rawTemplate || '[第 {num} 章]' + FW + '{title}',
    sectionTitle: $('sectionTitle').value || '{title}',
    volumeTitle: '[第 {num} 卷]',
    numWidth: Number($('numWidth').value) || 3,
    indent: FW + FW,
    stripInvisible: true,
    mdHeading: 'auto',
  };
}

function structureOptions() {
  return { markdown: { titleLevels: [1], chapterLevels: [2], sectionLevels: [3] } };
}

function selectedFormats() {
  return Array.from(document.querySelectorAll('input[name="fmt"]:checked')).map((input) => input.value);
}

/* ---------- 处理 ---------- */
function decodeFiles() {
  for (const file of state.files) {
    const detected = detectEncoding(file.bytes);
    file.text = detected.text;
    file.encoding = detected.label;
  }
}

function applyProofreading(entries) {
  const simplify = $('proofread').checked;
  const autoTitles = $('autoTitles').checked;
  if (!simplify && !autoTitles) return entries;
  return entries.map((entry) => {
    let doc = entry.doc;
    if (simplify) doc = fixDocument(doc, { rules: PROOFREAD_FIXES }).doc;
    if (autoTitles) doc = fillChapterTitles(doc).doc;
    return { ...entry, doc };
  });
}

function buildEntries() {
  decodeFiles();
  const structure = structureOptions();

  if (state.mode === 'separate') {
    const entries = state.files.map((file) => ({
      stem: stemOf(file.name),
      doc: parseDocument(file.text, structure),
      encoding: file.encoding,
      sourceText: file.text,
      report: '',
    }));
    return applyProofreading(entries);
  }

  const docs = state.files.map((file) => ({
    label: file.name,
    path: file.name,
    encoding: file.encoding,
    doc: parseDocument(file.text, structure),
  }));
  const merged = mergeDocuments(docs, { mode: state.strategy });
  return applyProofreading([{
    stem: state.files.length > 1 ? '合并结果' : stemOf(state.files[0].name),
    doc: merged.doc,
    encoding: state.files.map((f) => f.encoding).join(' / '),
    sourceText: state.files.map((f) => f.text).join(''),
    report: state.files.length > 1 ? renderMergeReport(merged.report) : '',
  }]);
}

function formatFor(format, base) {
  if (format === 'txt') return { ...base, headingPrefix: '## ', sectionPrefix: '### ' };
  return base;
}

function renderEntry(entry, format, base) {
  return renderFormat(entry.doc, format, { format: formatFor(format, base), meta: { title: entry.stem } });
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

function processFiles() {
  if (!state.files.length) { setStatus('请先选择或拖入文本文件', 'error'); return; }
  const formats = selectedFormats();
  if (!formats.length) { setStatus('请至少选择一种输出格式', 'error'); return; }

  setStatus('正在处理……', '');
  try {
    const entries = buildEntries();
    const base = readFormatOptions();
    state.outputs = buildOutputs(entries, formats, base);

    const previewSource = renderEntry(entries[0], 'txt', base).buffer.toString('utf8');
    const truncated = previewSource.length > 2000;
    $('preview').textContent = (truncated ? previewSource.slice(0, 2000) + '\n\n……（已截断，仅显示前 2000 字）' : previewSource);
    $('previewMeta').textContent = '共 ' + previewSource.split('\n').length + ' 行 · ' + previewSource.length + ' 字' + (truncated ? ' · 已截断' : '');
    $('previewBox').hidden = false;
    $('btnDownload').hidden = false;

    renderStats(entries, formats, base);
    renderReport(entries);
    setStatus('处理完成：' + entries.length + ' 个成品 × ' + formats.length + ' 种格式', 'ok');
  } catch (error) {
    console.error(error);
    setStatus('出错了：' + error.message, 'error');
  }
}

function buildOutputs(entries, formats, base) {
  const outputs = [];
  for (const entry of entries) {
    for (const format of formats) {
      const rendered = renderEntry(entry, format, base);
      outputs.push({
        name: entry.stem + '.' + rendered.extension,
        buffer: rendered.buffer,
        binary: rendered.binary,
      });
    }
  }
  return outputs;
}

function downloadAll() {
  const outputs = state.outputs || [];
  if (!outputs.length) { setStatus('还没有可下载的成品，请先点击开始处理', 'error'); return; }
  outputs.forEach((item, index) => {
    setTimeout(() => download(item.name, item.buffer, item.binary), index * 150);
  });
  setStatus('已开始下载 ' + outputs.length + ' 个文件', 'ok');
}

function renderStats(entries, formats, base) {
  const rows = [['', ...entries.map((entry) => entry.stem)]];
  const statsList = entries.map((entry) => documentStats(entry.doc.frontMatter || [], entry.doc.chapters || []));
  const lintList = entries.map((entry) => lintDocument(entry.doc, { level: 'error' }).counts);

  rows.push(['编码', ...entries.map((entry) => entry.encoding || '—')]);
  rows.push(['章节', ...statsList.map((s) => s.chapterBlocks || 0)]);
  rows.push(['小节', ...statsList.map((s) => s.sectionCount || 0)]);
  rows.push(['汉字数', ...statsList.map((s) => (s.chars || 0))]);
  rows.push(['段落数', ...statsList.map((s) => s.paragraphs || 0)]);
  rows.push(['错误数', ...lintList.map((c) => c.error)]);
  rows.push(['警告数', ...lintList.map((c) => c.warn)]);

  let html = '<table class="stats-table">';
  rows.forEach((row, i) => {
    html += '<tr>';
    row.forEach((cell, j) => {
      const tag = (i === 0 || j === 0) ? 'th' : 'td';
      html += '<' + tag + '>' + esc(cell) + '</' + tag + '>';
    });
    html += '</tr>';
  });
  html += '</table>';
  $('stats').innerHTML = html;
  $('statsBox').hidden = false;
}

function renderReport(entries) {
  const withReport = entries.filter((entry) => entry.report);
  if (!withReport.length) { $('reportBox').hidden = true; return; }
  $('report').textContent = withReport.map((entry) => entry.report).join('\n\n');
  $('reportBox').hidden = false;
}

/* ---------- 绑定 ---------- */
(function bindFormats() {
  $('formats').innerHTML = FORMATS.map((format) => {
    const checked = DEFAULT_SELECTED.includes(format) ? ' checked' : '';
    return '<label class="chip"><input type="checkbox" name="fmt" value="' + format + '"' + checked + '> ' + format + '</label>';
  }).join('');
})();

(function bindMode() {
  $('modeSwitch').addEventListener('click', (event) => {
    const button = event.target.closest('button[data-mode]');
    if (!button) return;
    state.mode = button.dataset.mode;
    $('modeSwitch').querySelectorAll('button').forEach((item) => item.classList.toggle('active', item === button));
    $('mergeOptions').hidden = state.mode !== 'merge';
  });
})();

(function bindFiles() {
  const dropzone = $('dropzone');
  const input = $('fileInput');
  input.addEventListener('change', () => { addFiles(input.files); input.value = ''; });
  ['dragenter', 'dragover'].forEach((type) => dropzone.addEventListener(type, (event) => {
    event.preventDefault(); dropzone.classList.add('over');
  }));
  ['dragleave', 'drop'].forEach((type) => dropzone.addEventListener(type, (event) => {
    event.preventDefault(); dropzone.classList.remove('over');
  }));
  dropzone.addEventListener('drop', (event) => addFiles(event.dataTransfer.files));
})();

$('mergeStrategy').addEventListener('change', () => { state.strategy = $('mergeStrategy').value; });
$('btnProcess').addEventListener('click', processFiles);
$('btnDownload').addEventListener('click', downloadAll);

renderFiles();
setStatus('准备就绪：选择或拖入文本后点击「开始处理」', '');
window.__TEXT_TOOL_READY__ = true;

