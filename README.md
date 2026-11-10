<h1 align="center">fin-doc-pipeline</h1>

<p align="center"><b>零依赖的中文文本处理流水线</b><br>
编码识别 · 去重合并 · 简体中文校对 · 统一排版 · 12 种格式互转</p>

<p align="center">
  <a href="https://github.com/0xFin/fin-doc-pipeline/actions/workflows/ci.yml"><img src="https://github.com/0xFin/fin-doc-pipeline/actions/workflows/ci.yml/badge.svg" alt="CI"></a>
  <a href="https://www.npmjs.com/package/fin-doc-pipeline"><img src="https://img.shields.io/npm/v/fin-doc-pipeline.svg" alt="npm"></a>
  <a href="https://www.npmjs.com/package/fin-doc-pipeline"><img src="https://img.shields.io/npm/dm/fin-doc-pipeline.svg" alt="downloads"></a>
  <a href="https://github.com/0xFin/fin-doc-pipeline/releases"><img src="https://img.shields.io/github/v/release/0xFin/fin-doc-pipeline?label=release" alt="release"></a>
  <a href="https://0xFin.github.io/fin-doc-pipeline/"><img src="https://img.shields.io/badge/%E5%9C%A8%E7%BA%BF%E7%89%88-demo-brightgreen" alt="demo"></a>
  <a href="LICENSE"><img src="https://img.shields.io/npm/l/fin-doc-pipeline.svg" alt="license"></a>
  <a href="package.json"><img src="https://img.shields.io/node/v/fin-doc-pipeline.svg" alt="node"></a>
</p>

<p align="center"><b>简体中文</b> · <a href="README.en.md">English</a></p>

---

> 把一堆杂乱的真实文本，变成干净、排版一致、可以直接阅读或发布的文档。

```sh
npm i -g fin-doc-pipeline

fin-doc-pipeline inspect 某书.txt                           # 体检：编码 / 结构 / 问题
fin-doc-pipeline merge 第一卷.txt 第二卷.txt -o 全书.txt      # 去重合并
fin-doc-pipeline format 全书.txt --proofread -o 全书.校对.txt  # 中文校对
fin-doc-pipeline convert 全书.txt --to epub,docx,pdf         # 导出成品
```

**在线版：<https://0xFin.github.io/fin-doc-pipeline/>** · 也可以双击仓库里的 `index.html`，完全离线运行。

## 为什么值得用

- **评分制编码探测**：所有候选编码都解一遍再打分。200 KB 的 GBK 小说里一个坏字节，不会把整本书变成乱码。
- **章节身份 =（分组, 编号）**：`番外第001章` 与正文 `第001章` 是两个章节，不会互相覆盖。
- **零依赖 · 完全离线 · 确定性**：只用 Node 内置模块，同样的输入永远得到同样的输出。
- **不静默丢内容**：被丢弃的段落、文件、章节版本都写进旁路报告，成品保持干净。

## 功能一览

| | 能力 |
| :-- | :-- |
| 🔍 | **编码探测** UTF-8(BOM) / UTF-16 / GBK / GB18030 / Big5，评分制而非「先到先得」 |
| 🧱 | **结构解析** 章 / 节 / 卷 / 特殊篇目 / 番外分组；兼容 Markdown、DOCX、EPUB、HTML 的层级 |
| 🧹 | **三级去重** 相同文件、跨文件同号章节、章内重复段落 |
| 🔀 | **两种合并** `versions`（同书多版本逐章择优）与 `concat`（多书拼接） |
| ✅ | **校对** 20 条结构与文本规则 + 9 条简体中文规则（繁转简、标点、英文、日期、错别字、语病、拟标题） |
| 🖋 | **排版** 标题模板、缩进、空行策略、软换行重排、标点规范化 |
| 📦 | **20+ 种输入 · 12 种输出**，一条命令任意组合 |
| 🤖 | **面向 Agent** 全部命令支持 `--json` / `--dry-run`，自带 `SKILL.md` |
| 🛡 | **安全默认** 不删源文件；删除需要两个开关，且默认进废纸篓 |

## 快速开始

### 1. 先体检

```sh
fin-doc-pipeline inspect 某书.txt
```

```text
■ 某书.txt
   大小   2.8 MB   编码 GBK（置信度 100%）
   结构   章节 293   小节 12   特殊篇目 1   卷 3   段落 15272   字数 802531
   检查   错误 0   警告 10   提示 0
```

### 2. 合并同一本书的分卷

```sh
fin-doc-pipeline merge 第一卷.txt 第二卷.txt 第三卷.txt -o 全书.txt
```

同一章出现在多个文件里时，自动采用最完整的那一版；每个取舍都写进 `.report.md`。

### 3. 校对并导出

```sh
fin-doc-pipeline format 全书.txt --proofread -o 全书.校对.txt
fin-doc-pipeline convert 全书.校对.txt --to epub,docx,pdf
```

## 简体中文校对

`--proofread` 一个开关跑完全部规则：

```sh
fin-doc-pipeline format 书.txt --proofread -o 校对.txt
fin-doc-pipeline format 书.txt --simplify      # 只做繁转简
fin-doc-pipeline format 书.txt --auto-titles   # 只补章节标题
fin-doc-pipeline check 书.txt                  # 只报告，不改文件
```

| 规则 | 处理 |
| --- | --- |
| `C001` | 繁体字 → 简体字；乾 / 著 / 瞭 / 藉 按上下文修正（乾隆、著作、瞭望、慰藉 保留） |
| `C002` | `「」『』` → `“”‘’`；中文旁的半角 `, ; : ? ! ( )` → 全角 |
| `C003` | 连续重复标点只留一个，`……` 不处理 |
| `C004` | 数字与英文半角；单词首字母大写；KFC / USD / USDT 等缩写与产品名全大写 |
| `C005` | 日期统一 `yyyy-MM-dd HH:mm`：`2024年3月5日 12:30` → `2024-03-05 12:30` |
| `C006` | 内置常见错别字表：按耐→按捺、既使→即使… |
| `C007` | 重复用字：的的、了了、词词 → 单字 |
| `C008` | 缺标题的章节读全章提炼标题：关键词按词频、跨段覆盖、首尾位置打分，各章通用的词降权；全文没有重复词（小说叙事）时取首句主干。不超过 6 字 |
| `C009` | 语病提示（大约…左右、原因是…造成的），只报告不改写 |
| `C010` | 中英文之间补一个空格：中文English → 中文 English。数字不处理，避免拆坏「第1章」 |
| `C011` | 段首出现收尾标点（，。、；：？！）】》」』”’），多为硬换行残渣；行首是开引号 “ 的对话不算问题。只提示不改 |
| `C012` | 数字与单位之间补空格：5kg → 5 kg、100km → 100 km。百分号与 ℃ 不处理 |
| `C013` | 书名号、括号嵌套：内层宜换成 〈〉 或不同层级的括号。只提示不改 |
| `C014` | 双引号内再套双引号，内层宜用单引号 ‘’ 。只提示不改 |

`check` 同时检查原始文本层：BOM、换行风格、连续空行、行尾空白、Tab 缩进；
`check --fix` 会一并修好。

确定性且幂等：同一份文本跑第二遍不会再改动。语序与语义层面的问题只提示，
避免把正确的句子改错。

## 支持的格式

| 类别 | 输入 | 输出 |
| :-- | :-- | :-- |
| 纯文本 | `txt` `md` `rst` `ini` `log` `srt` `tex` | `txt` `md` |
| 结构化 | `json` `yaml` `xml` `csv` `js` `ts` | `json` `yaml` `xml` `csv` `js` |
| 标记 | `html` `rtf` | `html` `rtf` |
| Office / 电子书 | `docx` `epub` | `docx` `epub` |
| 版式文档 | `pdf` | `pdf`（A5，自动页码，中文可选中） |

## 安装

要求 Node.js 18+。**没有任何第三方依赖**，不需要 `npm install`。四种方式按需选择。

### 1. 用 npm 安装（推荐）

```sh
npm i -g fin-doc-pipeline
```

装好后即可使用 `fin-doc-pipeline` 或简写 `fdp`；升级用 `npm i -g fin-doc-pipeline@latest`。

### 2. 从源码安装

```sh
git clone https://github.com/0xFin/fin-doc-pipeline.git && cd fin-doc-pipeline && ./install.sh
```

适合想改代码或不想用 npm 的情况。`install.sh` 会把仓库复制进 `~/.dsh/skills/fin-doc-pipeline`，源码目录保留，也可以直接 `node src/cli.mjs` 运行。

### 3. 安装为 Agent 技能

```sh
fin-doc-pipeline install-skill
```

把当前包复制到 `~/.dsh/skills/fin-doc-pipeline`，几秒内 Agent 就能识别并调用；需要先完成第 1 步。可用 `--dest` 指定别的技能目录。

### 4. 软链模式（开发用）

```sh
fin-doc-pipeline install-skill --link
```

装的是符号链接而不是副本，仓库里改代码立即生效，不用反复重装。

## 常用命令

| 命令 | 用途 |
| :-- | :-- |
| `inspect` | 只读体检：编码、结构、章号、潜在问题 |
| `format` | 清洗 + 排版单个文件 |
| `merge` | 多文件去重合并（`--merge-mode versions` / `concat`） |
| `check` | 内容检查；`--fix` 输出修复副本，`--fix-rules` 选择规则 |
| `convert` | 转换格式，`--to txt,md,html,json,yaml,xml,csv,js,rtf,docx,epub,pdf` |
| `install-skill` | 安装为 Agent 技能 |

## 标题模板

```sh
fin-doc-pipeline format 书.txt --title "[第 {num} 章]" --title-sep "　"
fin-doc-pipeline format 书.txt --title "{raw}"          # 保留原标题
fin-doc-pipeline format 书.txt --heading-prefix "§ "   # 所有标题加前缀
```

| 占位符 | 含义 |
| :-- | :-- |
| `{num}` | 章号，补零到 `--num-width` 位（默认 3） |
| `{num:4}` | 指定补零宽度 |
| `{title}` | 副标题 |
| `{prefix}` | 分组前缀，如「番外」 |
| `{unit}` | 单位：章 / 回 / 节 |
| `{raw}` | 原始标题整行 |

章、节、卷、特殊篇目、番外各自有独立模板（`--title`、`--section-title`、
`--volume-title`、`--special-title`、`--group-title`），完整列表见 `--help`。

## 标题识别

逐条匹配，先命中先用：`manual` → `markdown` → `numbered-cn` → `numbered-en` →
`cn-list` → `ordered` → `bracket` → `special` → `heuristic`。

| 规则 | 命中示例 |
| :-- | :-- |
| `manual` | `--headings-file` 中逐行列出的行（权威） |
| `markdown` | `#` … `######` |
| `numbered-cn` | 第12章 / 第十二回 / 第3节 / 第一卷 |
| `numbered-en` | Chapter IV / Part II / Section 3 |
| `cn-list` | 一、总则 / （三） |
| `ordered` | 1. 范围 / A. 简介 |
| `bracket` | [楔子] 【后记】 |
| `special` | 前言 / 尾声 / 番外 |
| `heuristic` | 短行 + 前后空行（需显式开启） |

```sh
fin-doc-pipeline format 书.md --rules markdown,numbered-en
fin-doc-pipeline format 书.md --heading-regex "^◆ (.+)$"
fin-doc-pipeline format 书.md --md-title-level 1 --md-chapter-level 2 --md-section-level 3
```

## 配置文件

在工作目录放 `fin-doc-pipeline.config.json`（或 `--config` 指定），命令行参数优先。
完整示例见 [`examples/fin-doc-pipeline.config.json`](examples/fin-doc-pipeline.config.json)。

```json
{
  "format":  { "chapterTitle": "[第 {num} 章]", "titleSeparator": "　", "indent": "　　" },
  "merge":   { "mode": "versions", "pick": "longest" },
  "output":  { "encoding": "utf-8", "bom": false, "eol": "lf" },
  "convert": { "includeDocTitle": false },
  "safety":  { "cleanSources": false, "hardDelete": false }
}
```

## Web 版

浏览器版完全本地运行，没有后端、不上传文件：编码识别、HTML/RTF 去标记、裸文本修复、
解析、合并、校对、排版、检查报告和 12 种格式导出全部内联在一个 `index.html` 里，
双击即可离线使用，也能直接收藏。

[![Web 界面](assets/web-ui.jpg)](https://0xFin.github.io/fin-doc-pipeline/)

- **在线版**：<https://0xFin.github.io/fin-doc-pipeline/>
- **离线版**：`index.html`（生成产物，约 200 KB），拷到任何地方双击都能用
- **重新生成**：改 `web/index.template.html` 或 `web/app.mjs`，运行 `npm run build`

> 浏览器版接受文本类输入（txt / md / html / rtf / json / csv…），HTML / RTF 会先
> 去掉标记；DOCX / EPUB / PDF **输入**需要解压，请用命令行处理，导出这 12 种格式不受影响。
> 输出编码可选 UTF-8 / UTF-16LE / UTF-16BE / Latin-1，并支持 BOM 与 CRLF；GBK / Big5 /
> GB18030 输出需要系统 iconv，只能用命令行。

## 项目结构

```text
src/rules.mjs        标题识别规则引擎
src/parser.mjs       文档结构（章 / 节 / 卷 / 特殊篇目）
src/typography.mjs   清洗、标题模板、成文
src/merge.mjs        文件 / 章节 / 段落三级去重
src/lint.mjs         校验规则与安全修复
src/chinese.mjs      简体中文校对规则
src/data/t2s.mjs     繁简字表（CLDR 生成）
src/encoding.mjs     评分制编码探测
src/loaders/         docx / epub / pdf / html / rtf / 文本输入
src/formats/         docx / epub / pdf / rtf / json / yaml / xml / csv / js 输出
src/zip.mjs          零依赖 ZIP 读写
src/cli.mjs          命令行入口
web/                 浏览器界面源码（构建为单文件 index.html）
test/run.mjs         零依赖测试套件（109 项）
```

## 路线图

- [x] inspect / format / merge / check / convert / install-skill
- [x] 12 种输出、20+ 种输入，任意组合
- [x] 可配置标题规则、章节分层、Markdown 层级映射
- [x] 简体中文校对、自动补章节标题
- [x] 离线单文件 Web 版 + GitHub Pages 在线版
- [ ] 二次编码乱码自动还原（iconv）
- [ ] 可选封面图、PDF 页眉页脚

## 贡献与许可

欢迎提交 bug、格式需求与新的识别规则。项目刻意保持零依赖。
见 [CONTRIBUTING.md](CONTRIBUTING.md) 与 [CHANGELOG.md](CHANGELOG.md)。

MIT，见 [LICENSE](LICENSE)。
