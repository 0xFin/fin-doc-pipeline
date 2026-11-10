/**
 * app.mjs — the browser front end.
 *
 * It runs the same modules as the CLI: encoding detection, markup removal,
 * raw-text repairs, the heading rule engine, the parser, the merger, the
 * linter, the typesetters and the writers. Only the pieces that need a file
 * system or a decompressor differ, which is why the codec and output layers
 * exist. DOCX / EPUB / PDF *input* needs decompression, so those files are
 * rejected with a clear message; all twelve export formats work.
 *
 * scripts/build-web.mjs inlines this file together with every module it imports
 * into a single self contained index.html, so the page also works from file://.
 */

import { installBuffer } from './buffer.mjs';

import { prepareInput, markupFormatOf } from '../src/input.mjs';
import { parseDocument, documentStats } from '../src/parser.mjs';
import { mergeDocuments, renderMergeReport } from '../src/merge.mjs';
import { lintDocument, fixDocument, renderLintReport, CLEAN_FIXES, PROOFREAD_FIXES } from '../src/lint.mjs';
import { fillChapterTitles } from '../src/titles.mjs';
import { DEFAULT_FORMAT } from '../src/typography.mjs';
import { renderFormat } from '../src/converters.mjs';
import { encodeOutput, OUTPUT_ENCODINGS, OUTPUT_ENCODING_LABELS } from '../src/output.mjs';

installBuffer();
const FORMATS = ['txt', 'md', 'html', 'json', 'yaml', 'xml', 'csv', 'js', 'rtf', 'docx', 'epub', 'pdf'];
const TEXT_FORMATS = new Set(['txt', 'md', 'html', 'json', 'yaml', 'xml', 'csv', 'js']);
const DEFAULT_SELECTED = ['txt'];
const FW = '\u3000';
const LOADER_MARKDOWN = { titleLevels: [], chapterLevels: [1], sectionLevels: [2, 3, 4, 5, 6] };

const state = {
  files: [],
  mode: 'merge',
  strategy: 'versions',
  outputs: [],
  issueText: '',
};

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const stemOf = (name) => String(name).replace(/\.[^.]+$/, '');
const bytesText = (n) => (n < 1024 ? n + ' B' : n < 1048576 ? (n / 1024).toFixed(1) + ' KB' : (n / 1048576).toFixed(1) + ' MB');

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
    state.files.push({ name: file.name, size: buffer.length, bytes: buffer, format: markupFormatOf(file.name) });
  }
  renderFiles();

  if (accepted.length) setStatus('已添加 ' + accepted.length + ' 个文件，共 ' + state.files.length + ' 个', 'ok');
  if (rejected.length) {
    setStatus('已跳过 ' + rejected.join('、') + '：浏览器版不解压 DOCX / EPUB / PDF（.doc 请先转成 .docx 或 .txt），请用命令行处理。', 'error');
  }
}

function resetOutputs() {
  state.outputs = [];
  state.issueText = '';
  $('btnDownload').hidden = true;
}

function formatBadge(file) {
  if (file.format === 'html') return '<span class="badge">HTML</span>';
  if (file.format === 'rtf') return '<span class="badge">RTF</span>';
  return '';
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
      formatBadge(file) +
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

function readOutputOptions() {
  return {
    encoding: $('outEncoding').value || 'utf-8',
    eol: $('outEol').value || 'lf',
    bom: $('outBom').checked ? true : undefined,
  };
}

function structureOptions() {
  return { markdown: { titleLevels: [1], chapterLevels: [2], sectionLevels: [3] } };
}

function structureForFile(file) {
  /* Markup loaders already encode structure as Markdown depth: H1 is a
     chapter. That is independent of the user's own Markdown mapping. */
  if (file.format === 'html') return { markdown: { ...LOADER_MARKDOWN } };
  return structureOptions();
}

function selectedFormats() {
  return Array.from(document.querySelectorAll('input[name="fmt"]:checked')).map((input) => input.value);
}

/* ---------- 处理 ---------- */
function prepareFiles() {
  for (const file of state.files) {
    const prepared = prepareInput(file.name, file.bytes);
    file.text = prepared.text;
    file.encoding = prepared.label;
    file.format = prepared.format;
    file.meta = prepared.meta || {};
    file.rawIssues = prepared.rawIssues;
    file.fixed = prepared.fixed;
  }
}

function applyProofreading(entries) {
  const simplify = $('proofread').checked;
  const autoTitles = $('autoTitles').checked;
  return entries.map((entry) => {
    let doc = entry.doc;
    let fixed = (entry.fixed || []).slice();

    /* The CLI always applies the safe clean-up set; the page does the same so
       both fronts produce the same bytes for the same input. */
    const clean = fixDocument(doc, { rules: CLEAN_FIXES });
    doc = clean.doc;
    fixed = fixed.concat(clean.fixed);

    if (simplify) {
      const proof = fixDocument(doc, { rules: PROOFREAD_FIXES });
      doc = proof.doc;
      fixed = fixed.concat(proof.fixed);
    }
    if (autoTitles) {
      const filled = fillChapterTitles(doc);
      doc = filled.doc;
      if (filled.filled.length) fixed = fixed.concat([{ id: 'C008', count: filled.filled.length }]);
    }
    return { ...entry, doc, fixed };
  });
}

function buildEntries() {
  prepareFiles();

  if (state.mode === 'separate') {
    const entries = state.files.map((file) => ({
      stem: stemOf(file.name),
      doc: parseDocument(file.text, structureForFile(file)),
      encoding: file.encoding,
      format: file.format,
      meta: file.meta || {},
      rawIssues: file.rawIssues || [],
      fixed: file.fixed || [],
      sourceText: file.text,
      report: '',
    }));
    return applyProofreading(entries);
  }

  const docs = state.files.map((file) => ({
    label: file.name,
    path: file.name,
    encoding: file.encoding,
    doc: parseDocument(file.text, structureForFile(file)),
  }));
  const merged = mergeDocuments(docs, { mode: state.strategy });
  return applyProofreading([{
    stem: state.files.length > 1 ? '合并结果' : stemOf(state.files[0].name),
    doc: merged.doc,
    encoding: state.files.map((f) => f.encoding).join(' / '),
    format: Array.from(new Set(state.files.map((f) => f.format))).join('+'),
    meta: state.files.length === 1 ? state.files[0].meta || {} : {},
    rawIssues: state.files.reduce((all, f) => all.concat(f.rawIssues || []), []),
    fixed: state.files.reduce((all, f) => all.concat(f.fixed || []), []),
    sourceText: state.files.map((f) => f.text).join(''),
    report: state.files.length > 1 ? renderMergeReport(merged.report) : '',
  }]);
}

function formatFor(format, base) {
  if (format === 'txt') return { ...base, headingPrefix: '## ', sectionPrefix: '### ' };
  return base;
}

function renderEntry(entry, format, base, out) {
  const meta = { ...(entry.meta || {}), title: (entry.meta && entry.meta.title) || entry.stem };
  const rendered = renderFormat(entry.doc, format, { format: formatFor(format, base), meta });
  if (!TEXT_FORMATS.has(format)) return { ...rendered, lossy: 0 };
  const encoded = encodeOutput(rendered.buffer.toString('utf8'), out);
  return { buffer: encoded.bytes, extension: rendered.extension, binary: false, lossy: encoded.lossy };
}

function renderPreview(entry, base) {
  const rendered = renderFormat(entry.doc, 'txt', { format: formatFor('txt', base), meta: { title: entry.stem } });
  return rendered.buffer.toString('utf8');
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

function buildOutputs(entries, formats, base, out) {
  const outputs = [];
  let lossy = 0;
  for (const entry of entries) {
    for (const format of formats) {
      const rendered = renderEntry(entry, format, base, out);
      lossy += rendered.lossy || 0;
      outputs.push({
        name: entry.stem + '.' + rendered.extension,
        buffer: rendered.buffer,
        binary: rendered.binary,
      });
    }
  }
  return { outputs, lossy };
}

function processFiles() {
  if (!state.files.length) { setStatus('请先选择或拖入文本文件', 'error'); return; }
  const formats = selectedFormats();
  if (!formats.length) { setStatus('请至少选择一种输出格式', 'error'); return; }

  setStatus('正在处理……', '');
  try {
    const entries = buildEntries();
    const base = readFormatOptions();
    const out = readOutputOptions();
    const built = buildOutputs(entries, formats, base, out);
    state.outputs = built.outputs;
    state.issueText = buildIssueText(entries);

    const previewSource = renderPreview(entries[0], base);
    const truncated = previewSource.length > 2000;
    $('preview').textContent = (truncated ? previewSource.slice(0, 2000) + '\n\n……（已截断，仅显示前 2000 字）' : previewSource);
    $('previewMeta').textContent = '共 ' + previewSource.split('\n').length + ' 行 · ' + previewSource.length + ' 字' + (truncated ? ' · 已截断' : '');
    $('previewBox').hidden = false;
    $('btnDownload').hidden = false;

    renderStats(entries);
    renderReport(entries);
    renderIssues(entries);
    const lossyNote = built.lossy ? '；' + built.lossy + ' 个字符无法用所选编码表示' : '';
    setStatus('处理完成：' + entries.length + ' 个成品 × ' + formats.length + ' 种格式' + lossyNote, built.lossy ? 'error' : 'ok');
  } catch (error) {
    console.error(error);
    setStatus('出错了：' + error.message, 'error');
  }
}

function downloadAll() {
  const outputs = state.outputs || [];
  if (!outputs.length) { setStatus('还没有可下载的成品，请先点击开始处理', 'error'); return; }
  outputs.forEach((item, index) => {
    setTimeout(() => download(item.name, item.buffer, item.binary), index * 150);
  });
  setStatus('已开始下载 ' + outputs.length + ' 个文件', 'ok');
}

function downloadIssues() {
  if (!state.issueText) { setStatus('还没有检查报告，请先点击开始处理', 'error'); return; }
  download('检查报告.txt', Buffer.from(state.issueText, 'utf8'), true);
  setStatus('已开始下载检查报告', 'ok');
}

/* ---------- 渲染结果 ---------- */
function lintEntry(entry) {
  return lintDocument(entry.doc, { level: 'info' });
}

function renderStats(entries) {
  const rows = [['', ...entries.map((entry) => entry.stem)]];
  const statsList = entries.map((entry) => documentStats(entry.doc.frontMatter || [], entry.doc.chapters || []));
  const lintList = entries.map((entry) => lintEntry(entry).counts);
  const formatName = (entry) => String(entry.format || 'text').split('+').map((part) => (
    part === 'html' ? 'HTML' : part === 'rtf' ? 'RTF' : '文本'
  )).join(' + ');

  rows.push(['输入格式', ...entries.map(formatName)]);
  rows.push(['编码', ...entries.map((entry) => entry.encoding || '—')]);
  rows.push(['章节', ...statsList.map((s) => s.chapterBlocks || 0)]);
  rows.push(['小节', ...statsList.map((s) => s.sectionCount || 0)]);
  rows.push(['汉字数', ...statsList.map((s) => (s.chars || 0))]);
  rows.push(['段落数', ...statsList.map((s) => s.paragraphs || 0)]);
  rows.push(['错误数', ...lintList.map((c) => c.error)]);
  rows.push(['警告数', ...lintList.map((c) => c.warn)]);
  rows.push(['提示数', ...lintList.map((c) => c.info)]);
  rows.push(['裸文本修复', ...entries.map((entry) => (
    entry.fixed && entry.fixed.length ? entry.fixed.map((f) => f.id + '×' + f.count).join(' ') : '—'
  ))]);

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

function buildIssueText(entries) {
  return entries.map((entry) => {
    const lines = ['■ ' + entry.stem];
    if (entry.rawIssues && entry.rawIssues.length) {
      lines.push('裸文本：');
      for (const issue of entry.rawIssues) lines.push('  [' + issue.severity + '] ' + issue.id + ' ' + issue.message);
    } else {
      lines.push('裸文本：无问题');
    }
    if (entry.fixed && entry.fixed.length) {
      lines.push('已修复：' + entry.fixed.map((f) => f.id + '×' + f.count).join(' '));
    }
    lines.push('');
    lines.push(renderLintReport(lintEntry(entry)));
    return lines.join('\n');
  }).join('\n\n');
}

function renderIssues(entries) {
  $('issues').textContent = buildIssueText(entries);
  $('issuesBox').hidden = false;
}

/* ---------- 绑定 ---------- */
(function bindFormats() {
  $('formats').innerHTML = FORMATS.map((format) => {
    const checked = DEFAULT_SELECTED.includes(format) ? ' checked' : '';
    return '<label class="chip"><input type="checkbox" name="fmt" value="' + format + '"' + checked + '> ' + format + '</label>';
  }).join('');
})();

(function bindEncodings() {
  $('outEncoding').innerHTML = OUTPUT_ENCODINGS.map((enc) => (
    '<option value="' + enc + '">' + OUTPUT_ENCODING_LABELS[enc] + '</option>'
  )).join('');
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
$('btnIssues').addEventListener('click', downloadIssues);

renderFiles();
setStatus('准备就绪：选择或拖入文本后点击「开始处理」', '');
window.__TEXT_TOOL_READY__ = true;
