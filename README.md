<h1 align="center">fin-doc-pipeline</h1>

<p align="center"><b>零依赖的文本处理流水线：识别编码 · 去重合并 · 校验纠错 · 统一排版 · 多格式互转</b></p>

<p align="center">
  <a href="https://github.com/0xFin/fin-doc-pipeline/actions/workflows/ci.yml"><img src="https://github.com/0xFin/fin-doc-pipeline/actions/workflows/ci.yml/badge.svg" alt="CI"></a>
  <a href="https://www.npmjs.com/package/fin-doc-pipeline"><img src="https://img.shields.io/npm/v/fin-doc-pipeline.svg" alt="npm version"></a>
  <a href="https://www.npmjs.com/package/fin-doc-pipeline"><img src="https://img.shields.io/npm/dm/fin-doc-pipeline.svg" alt="npm downloads"></a>
  <a href="LICENSE"><img src="https://img.shields.io/npm/l/fin-doc-pipeline.svg" alt="license"></a>
  <a href="package.json"><img src="https://img.shields.io/node/v/fin-doc-pipeline.svg" alt="node"></a>
</p>

<p align="center"><b>简体中文</b> · <a href="README.en.md">English</a></p>

---

把一堆杂乱的真实文本变成一份干净、排版一致、可以直接阅读或发布的文档。
支持纯文本、结构化数据、富文本、电子书与 PDF 之间的任意转换。

```sh
npm i -g fin-doc-pipeline

fin-doc-pipeline inspect 某书.txt                       # 体检：编码 / 结构 / 问题
fin-doc-pipeline merge 第一卷.txt 第二卷.txt -o 全书.txt   # 去重合并
fin-doc-pipeline convert 全书.txt --to epub,docx,pdf      # 导出成品
```

## Web 版

Web 版完全在浏览器本地运行，没有后端、不上传文件：

```sh
git clone https://github.com/0xFin/fin-doc-pipeline.git
cd fin-doc-pipeline
python3 -m http.server 8000   # 或 npx serve .
```

然后打开 <http://localhost:8000/>。可以拖入或粘贴文本、实时预览，并导出全部 12 种格式。

> 直接双击 `index.html` 不行：浏览器会拦截 `file://` 下的 ES 模块加载，必须用一个静态服务器。
> 托管版本（GitHub Pages）的部署工作流已随仓库提供，账号权限恢复后会自动上线。
## 目录

- [为什么再造一个文本工具](#为什么再造一个文本工具)
- [功能](#功能)
- [支持的格式](#支持的格式)
- [安装](#安装)
- [快速开始](#快速开始)
- [章节标题自定义](#章节标题自定义)
- [标题识别规则](#标题识别规则)
- [配置文件](#配置文件)
- [设计原则](#设计原则)
- [项目结构](#项目结构)
- [路线图](#路线图)
- [贡献](#贡献)
- [许可](#许可)

## 为什么再造一个文本工具

大多数「合并清理」脚本的做法是：按顺序尝试编码，第一个不报错的就采用。
这种策略会以很隐蔽的方式失败——一本 200KB 的 GBK 小说里只要有一个坏字节，
GBK 解码器就抛异常，而 Big5 解码器恰好能接受同一串字节，于是**整本书静默变成乱码**，
但看上去仍然像中文。

本项目的做法：

1. **评分制编码探测**——所有候选编码都解一遍，按「像不像正常文章」打分（常用字命中率、替换字符惩罚、私有区字符惩罚），取最高分。
2. **章节身份 = (分组, 编号)**——`番外第001章` 与正文的 `第001章` 是两个不同的章节，不会互相覆盖。
3. **不静默丢内容**——每个被丢弃的段落、文件或章节版本都写进旁路报告，成品里不夹带这些信息。

## 功能

| | 能力 |
| :-- | :-- |
| 🔍 | **编码探测**：UTF-8(BOM)、UTF-16LE/BE、GBK、GB18030、Big5，评分制而非「先到先得」 |
| 🧱 | **结构化解析**：章 / 节 / 卷 / 特殊篇目 / 番外分组，兼容 Markdown 标题与 DOCX、EPUB、HTML 的层级信息 |
| 🧹 | **三级去重**：完全相同的文件、跨文件同号章节、章内重复段落 |
| 🔀 | **两种合并**：`versions`（同书多版本逐章择优）与 `concat`（多书拼接） |
| ✅ | **校验纠错**：20 条文本与结构规则，白名单内的安全项可自动修复 |
| 🖋 | **排版**：标题模板、缩进、空行策略、可选软换行重排与标点规范化 |
| 📦 | **12 种输出**、**20+ 种输入**，任意组合一条命令完成 |
| 🤖 | **面向 Agent**：全部命令支持 `--json` / `--dry-run`，自带 `SKILL.md` |
| 🛡 | **安全默认**：不删源文件；开启删除需两个开关，且默认进废纸篓 |

## 支持的格式

| 类别 | 输入 | 输出 |
| :-- | :-- | :-- |
| 纯文本 | `txt` `md` `rst` `ini` `log` `srt` `tex` | `txt` `md` |
| 结构化 | `json` `yaml` `xml` `csv` `js` `ts` | `json` `yaml` `xml` `csv` `js` |
| 标记 | `html` `rtf` | `html` `rtf` |
| Office / 电子书 | `docx` `epub` | `docx` `epub` |
| 版式文档 | `pdf` | `pdf`（A5，自动页码，中文可选中） |

## 安装

三种方式，任选其一：

```sh
# 1. npm（推荐）
npm i -g fin-doc-pipeline

# 2. 从源码
git clone https://github.com/0xFin/fin-doc-pipeline.git
cd fin-doc-pipeline && ./install.sh

# 3. 作为 Agent 技能
fin-doc-pipeline install-skill              # -> ~/.dsh/skills/fin-doc-pipeline
fin-doc-pipeline install-skill --link       # 软链接，改代码立即生效
```

要求 Node.js 18+，**没有任何第三方依赖**，不需要 `npm install`。

## 快速开始

### 1. 先体检

```
$ fin-doc-pipeline inspect 某书.txt
■ 某书.txt
   大小   2808956 字节   编码 GBK（置信度 58%）
   结构   章节 293   小节 12   特殊篇目 1   卷 3   段落 15272   字数 802531
   检查   错误 0   警告 10   提示 0
```

### 2. 合并同一本书的分卷

```sh
fin-doc-pipeline merge 第一卷.txt 第二卷.txt 第三卷.txt -o 全书.txt
```

同一章出现在多个文件里时，会比较完整度并采用最全的那一版；
每个决策都写进输出文件旁边的 `.report.md`，成品本身保持干净。

### 3. 导出成品

```sh
fin-doc-pipeline convert 全书.txt --to epub,docx,pdf
fin-doc-pipeline merge a.txt b.txt -o 合集.txt --merge-mode concat --renumber
```

## 章节标题自定义

```sh
fin-doc-pipeline format 书.txt --title '[第 {num} 章]' --title-sep '　'
fin-doc-pipeline format 书.txt --title '{num:4} | {title}'
fin-doc-pipeline format 书.txt --title '{raw}'            # 保留原标题不动
fin-doc-pipeline format 书.txt --heading-prefix '§ '     # 所有标题统一加前缀
```

| 占位符 | 含义 |
| :-- | :-- |
| `{num}` | 章号，补零到 `--num-width` 位（默认 3） |
| `{num:4}` | 自定义补零宽度 |
| `{title}` | 副标题 |
| `{prefix}` | 分组前缀，如 番外 |
| `{unit}` | 单位：章 / 回 / 节 |
| `{raw}` | 原始标题整行 |

每种标题类型都有独立模板：`--title`（章）、`--unnumbered-title`（无编号章）、
`--section-title`（节）、`--volume-title`（卷）、`--special-title`（前言/后记）、
`--group-title`（番外分组）。

## 标题识别规则

逐条匹配，先命中先用，默认顺序：
`manual` → `markdown` → `numbered-cn` → `numbered-en` → `cn-list` → `ordered` → `bracket` → `special` → `heuristic`

| 规则 | 命中示例 | 判定 |
| :-- | :-- | :-- |
| `manual` | `--headings-file` 中逐行列出的行 | 章（权威） |
| `markdown` | `#` … `######` | 按层级 |
| `numbered-cn` | 第12章 / 第十二回 / 第3节 / 第一卷 | 章 / 节 / 卷 |
| `numbered-en` | Chapter IV / Part II / Section 3 | 章 / 卷 / 节 |
| `cn-list` | 一、总则 / （三） | 节 |
| `ordered` | 1. 范围 / A. 简介 | 节 |
| `bracket` | [楔子] 【后记】 | 特殊篇目 |
| `special` | 前言 / 尾声 / 番外 | 特殊篇目 |
| `heuristic` | 短行 + 前后空行（需显式开启） | 章 |

```sh
fin-doc-pipeline format 书.md --rules markdown,numbered-en
fin-doc-pipeline format 书.md --heading-regex '^◆ (.+)$'
fin-doc-pipeline format 书.md --headings-file headings.txt --rules manual
fin-doc-pipeline format 书.md --md-title-level 1 --md-chapter-level 2 --md-section-level 3
```

## 配置文件

在工作目录放 `fin-doc-pipeline.config.json`，或通过 `--config` 指定；命令行参数优先级更高。
完整示例见 [`examples/fin-doc-pipeline.config.json`](examples/fin-doc-pipeline.config.json)。

```json
{
  "format":  { "chapterTitle": "[第 {num} 章]", "titleSeparator": "　", "indent": "　　" },
  "structure": { "markdown": { "titleLevels": [1], "chapterLevels": [2], "sectionLevels": [3] } },
  "merge":   { "mode": "versions", "pick": "longest" },
  "output":  { "encoding": "utf-8", "bom": false, "eol": "lf" },
  "convert": { "includeDocTitle": false },
  "safety":  { "cleanSources": false, "hardDelete": false }
}
```

## 设计原则

1. **绝不静默丢内容**——每个被丢弃的段落、文件或章节版本都记录在报告里。
2. **默认只读**——先 `inspect`、先 `--dry-run`；写文件要指定输出路径；删除要两个开关。
3. **报告不混进成品**——来源信息对你有用，对读者没用。
4. **零第三方依赖**——只用 Node 内置模块。
5. **确定性**——同样输入必然同样输出，不联网、不往成品里写时间戳。

## 项目结构

```
src/rules.mjs        标题识别规则引擎
src/parser.mjs       文档结构（章 / 节 / 卷 / 特殊篇目）
src/typography.mjs   清洗、标题模板、成文
src/merge.mjs        文件 / 章节 / 段落三级去重
src/lint.mjs         校验规则与安全修复
src/encoding.mjs     评分制编码探测
src/loaders/         docx / epub / pdf / html / rtf / 各类文本输入
src/formats/         docx / epub / pdf / rtf / json / yaml / xml / csv / js 输出
src/zip.mjs          零依赖 ZIP 读写（DOCX / EPUB 的基础）
src/cli.mjs          命令行入口
test/run.mjs         零依赖测试套件（88 项）
```

## 路线图

- [x] inspect / format / merge / check / convert / install-skill
- [x] 12 种输出格式、20+ 种输入格式
- [x] 可配置标题规则、章节分层、Markdown 层级映射
- [x] PDF 自动页码、JSON / YAML / XML / CSV / JS 结构化输出
- [ ] 二次编码乱码自动还原（iconv）
- [ ] 可选封面图
- [ ] PDF 页眉与页脚字段

## 贡献

欢迎提交 bug、格式需求与新的标题规则。项目刻意保持零依赖，这一点不会改变。
详见 [CONTRIBUTING.md](CONTRIBUTING.md) 与 [CHANGELOG.md](CHANGELOG.md)。

## 许可

MIT，见 [LICENSE](LICENSE)。