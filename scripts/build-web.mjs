#!/usr/bin/env node
/**
 * build-web.mjs — inline the browser app into a single index.html.
 *
 *   node scripts/build-web.mjs           regenerate index.html
 *   node scripts/build-web.mjs --check   fail when index.html is stale
 *
 * Why: the page must work when it is opened straight from disk. Browsers block
 * ES module fetches on file:// URLs, so index.html cannot import src/*.mjs.
 * This script walks the module graph, wraps every module in a factory, and
 * emits one classic <script> block, which file:// is happy to execute.
 *
 * The sources live in web/index.template.html and web/app.mjs; index.html is
 * generated and must not be edited by hand.
 */

import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const TEMPLATE = 'web/index.template.html';
const ENTRY = 'web/app.mjs';
const OUTPUT = 'index.html';

const IMPORT_BLOCK = /^import[ \t]+\{([\s\S]*?)\}[ \t]+from[ \t]+'([^']+)';?[ \t]*$/gm;
const IMPORT_DEFAULT = /^import[ \t]+([A-Za-z_$][\w$]*)[ \t]+from[ \t]+'([^']+)';?[ \t]*$/gm;
const IMPORT_BARE = /^import[ \t]+'([^']+)';?[ \t]*$/gm;
const EXPORT_NAMED = /^export[ \t]+\{([\s\S]*?)\};?[ \t]*$/gm;
const EXPORT_DECL = /^export[ \t]+((?:async[ \t]+)?function\*?|const|let|var|class)[ \t]+([A-Za-z_$][\w$]*)/gm;

/* ------------------------------------------------------------------ graph */

function resolveSpecifier(from, specifier) {
  if (!specifier.startsWith('.')) {
    throw new Error(from + ': cannot bundle non relative import ' + JSON.stringify(specifier));
  }
  const base = path.posix.dirname(from);
  const resolved = path.posix.normalize(path.posix.join(base, specifier));
  if (resolved.startsWith('..')) throw new Error(from + ': import escapes the project: ' + specifier);
  return resolved;
}

function readModule(id) {
  const file = path.join(ROOT, id);
  if (!fs.existsSync(file)) throw new Error('missing module: ' + id);
  return fs.readFileSync(file, 'utf8');
}

/** Depth first walk; returns modules in evaluation order and detects cycles. */
function collect(entry) {
  const order = [];
  const state = new Map();

  function visit(id) {
    const mark = state.get(id);
    if (mark === 'done') return;
    if (mark === 'visiting') throw new Error('circular import: ' + id);
    state.set(id, 'visiting');
    const source = readModule(id);
    for (const specifier of scanImports(id, source)) visit(specifier);
    state.set(id, 'done');
    order.push({ id, source });
  }

  visit(entry);
  return order;
}

function scanImports(id, source) {
  const found = [];
  for (const match of source.matchAll(IMPORT_BLOCK)) found.push(resolveSpecifier(id, match[2]));
  for (const match of source.matchAll(IMPORT_DEFAULT)) found.push(resolveSpecifier(id, match[2]));
  for (const match of source.matchAll(IMPORT_BARE)) found.push(resolveSpecifier(id, match[1]));
  return found;
}

/* -------------------------------------------------------------- transform */

function parseNames(list) {
  return list
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean)
    .map((item) => {
      const parts = item.split(/\s+as\s+/);
      return { imported: parts[0].trim(), local: (parts[1] || parts[0]).trim() };
    });
}

function transform(id, source) {
  const imports = [];
  const exported = [];
  let body = source;

  body = body.replace(IMPORT_BLOCK, (_, names, specifier) => {
    imports.push({ module: resolveSpecifier(id, specifier), names: parseNames(names) });
    return '';
  });
  body = body.replace(IMPORT_DEFAULT, (_, name, specifier) => {
    imports.push({ module: resolveSpecifier(id, specifier), names: [{ imported: 'default', local: name }] });
    return '';
  });
  body = body.replace(IMPORT_BARE, (_, specifier) => {
    imports.push({ module: resolveSpecifier(id, specifier), names: [] });
    return '';
  });

  body = body.replace(EXPORT_NAMED, (_, names) => {
    for (const item of parseNames(names)) exported.push({ exported: item.local, local: item.imported });
    return '';
  });
  body = body.replace(EXPORT_DECL, (match, kind, name) => {
    exported.push({ exported: name, local: name });
    return match.replace(/^export[ \t]+/, '');
  });

  const leftover = body.match(/^export\b.*$/m);
  if (leftover) throw new Error(id + ': unsupported export syntax: ' + leftover[0].trim());
  if (/^import\b/m.test(body)) throw new Error(id + ': unsupported import syntax');
  if (/(?:^|[^.\w{])import\s*\(/m.test(body)) throw new Error(id + ': dynamic import() cannot be bundled');

  const prologue = [];
  const loaded = new Map();
  for (const entry of imports) {
    if (!loaded.has(entry.module)) {
      const variable = '__m' + loaded.size;
      prologue.push('const ' + variable + " = __require('" + entry.module + "');");
      loaded.set(entry.module, variable);
    }
    const variable = loaded.get(entry.module);
    for (const name of entry.names) {
      prologue.push('const ' + name.local + ' = ' + variable + '.' + name.imported + ';');
    }
  }

  const epilogue = exported.length
    ? 'return { ' + exported.map((item) => (item.exported === item.local ? item.local : item.exported + ': ' + item.local)).join(', ') + ' };'
    : 'return {};';

  const inner = [prologue.join('\n'), body.trim(), epilogue].filter(Boolean).join('\n\n');
  return "__define('" + id + "', function () {\n'use strict';\n" + inner + '\n});';
}

/* ----------------------------------------------------------------- bundle */

function bundle() {
  const modules = collect(ENTRY);
  const parts = [
    '/* Generated bundle: ' + modules.length + ' modules inlined by scripts/build-web.mjs. */',
    '(function () {',
    "'use strict';",
    'var __registry = Object.create(null);',
    'var __cache = Object.create(null);',
    'function __define(id, factory) { __registry[id] = factory; }',
    'function __require(id) {',
    '  var cached = __cache[id];',
    '  if (cached) return cached;',
    '  var factory = __registry[id];',
    "  if (!factory) throw new Error('bundle: missing module ' + id);",
    '  var exports = factory();',
    '  __cache[id] = exports;',
    '  return exports;',
    '}',
    '',
  ];
  for (const module of modules) parts.push(transform(module.id, module.source), '');
  parts.push("__require('web/buffer.mjs').installBuffer();");
  parts.push("__require('" + ENTRY + "');");
  parts.push('})();', '');
  const source = parts.join('\n');
  if (source.includes('</script')) throw new Error('bundle contains </script and cannot be inlined');
  new Function(source); // syntax check
  return { source, modules: modules.map((module) => module.id) };
}

function render() {
  let html = fs.readFileSync(path.join(ROOT, TEMPLATE), 'utf8');
  const built = bundle();

  const generator =
    '<!-- Generated by scripts/build-web.mjs from web/index.template.html + web/app.mjs. ' +
    'Do not edit this file directly: edit the sources, then run npm run build. -->';
  if (!html.includes('<!--__GENERATOR__-->')) throw new Error('template: missing <!--__GENERATOR__-->');
  if (!html.includes('<!--__APP_BUNDLE__-->')) throw new Error('template: missing <!--__APP_BUNDLE__-->');

  html = html.replace('<!--__GENERATOR__-->', generator);
  html = html.replace('<!--__APP_BUNDLE__-->', '<script>\n' + built.source + '</script>');
  return { html, built };
}

/* ------------------------------------------------------------------- main */

function main() {
  const check = process.argv.includes('--check');
  const { html, built } = render();
  const target = path.join(ROOT, OUTPUT);
  const current = fs.existsSync(target) ? fs.readFileSync(target, 'utf8') : '';

  if (check) {
    if (current === html) {
      console.log('index.html is up to date (' + built.modules.length + ' modules, ' + Buffer.byteLength(html) + ' bytes)');
      return;
    }
    console.error('index.html is stale: run npm run build');
    process.exit(1);
  }

  fs.writeFileSync(target, html);
  const kb = (Buffer.byteLength(html) / 1024).toFixed(1);
  console.log('index.html written: ' + built.modules.length + ' modules, ' + kb + ' KB');
  if (Buffer.byteLength(html) > 512 * 1024) console.warn('warning: index.html is larger than 512 KB');
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();

export { bundle, render, collect, transform };
