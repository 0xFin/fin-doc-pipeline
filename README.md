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

Web 版完全在浏览器本地运行，没有后端、不上传文件。

**直接双击 `index.html` 就能用。** 编码识别、解析、合并、排版和 12 种格式导出全部内联在这一个文件里，离线、断网、拷进 U 盘都能跑，不需要本地服务器，也不需要 `start.command`。把文件拖进浏览器标签页打开，收藏那个 `file://` 地址即可当成书签。

`index.html` 是生成产物，不要手改：页面结构与样式在 `web/index.template.html`，交互逻辑在 `web/app.mjs`，改完运行 `npm run build` 重新内联。

只有想固定一个 `http://` 地址（比如让同一局域网的手机打开）或做二次开发时，才需要起本地服务：

```sh
git clone https://github.com/0xFin/fin-doc-pipeline.git
cd fin-doc-pipeline
./start.command                 # macOS：双击也行，自动挑端口并打开浏览器
python3 -m http.server 8000     # 或者手动
```

> 浏览器版只接受文本类输入（txt / md / html / json / csv…）。DOCX / EPUB / PDF **输入**需要解压，请用命令行处理；导出这 12 种格式不受影响。
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
| ✅ | **校验纠错**：20 条结构与文本规则 + 简体中文校对（繁转简、全角标点、英文/日期规范、错别字、语病提示、自动补标题） |
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

## 改完代码怎么同步

技能目录里是**拷贝**，不是软链，所以改完 `src/` 后必须重新安装一次，否则 Agent 跑的还是旧代码。一条命令搞定测试、同步、提交、推送：

```sh
./scripts/ship.sh                       # 自动提交信息
./scripts/ship.sh "fix: 章节排序"        # 自定义提交信息
./scripts/ship.sh --no-push             # 只提交，不推送
```

它依次执行：

1. `node test/run.mjs` —— 测试不通过就停下，不会同步半成品
2. `./install.sh` —— 拷贝到 `~/.dsh/skills/fin-doc-pipeline`
3. `git commit` —— 有改动才提交
4. `git push origin HEAD` —— 推到 GitHub

如果不想每次手动同步，用软链模式安装一次即可：

```sh
./install.sh --link
```

之后仓库里的改动会立刻被技能读到（但**仍需** `ship.sh` 或手动 `git push` 让 GitHub 同步）。

查看三方是否一致：

```sh
./scripts/status.sh          # 或 npm run status
```

输出仓库、GitHub、技能目录三者状态，有差异时以非 0 退出。

### 删除文件会怎样

三处是**独立**的，删除不会自动传导：

| 操作 | 本地仓库 | GitHub | 技能目录 |
| --- | --- | --- | --- |
| `rm 文件` | 没了 | 不变 | 不变 |
| 再 `git push` | 没了 | main 上没了（历史里还在） | 不变 |
| 再 `./install.sh` | 没了 | 没了 | 没了（先删后拷） |

所以「A 有、B 没有」技术上完全可能，但不建议：技能会继续跑旧代码，GitHub 上也是旧的。一条 `./scripts/ship.sh` 就能把三者拉回一致。

> 软链模式（`install.sh --link`）下技能目录就是仓库本身，A 和 C 天然合一，只剩 GitHub 需要 push。

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

## 中文校对

简体中文语境下的校对规则集中在 `--proofread`：

```sh
fin-doc-pipeline format 书.txt --proofread -o 书.校对.txt
fin-doc-pipeline merge 卷一.txt 卷二.txt -o 全书.txt --proofread --to epub
fin-doc-pipeline format 书.txt --simplify      # 只做繁转简
fin-doc-pipeline format 书.txt --auto-titles   # 只补章节标题
```

| 规则 | 处理 |
| --- | --- |
| C001 | 繁体字 → 简体字；乾/著/瞭/藉 等上下文敏感字按常用词修正（乾隆、乾坤、著作、瞭望、慰藉 保留） |
| C002 | `「」『』` → `“”‘’`；中文旁的半角 `, ; : ? ! ( )` → 全角 |
| C003 | 连续重复标点只留一个，`……` 不处理 |
| C004 | 数字与英文半角；单词首字母大写；KFC、USD、USDT 等缩写与产品名全大写 |
| C005 | 日期统一 `yyyy-MM-dd HH:mm`，如 `2024年3月5日 12:30` → `2024-03-05 12:30` |
| C006 | 内置常见错别字表：按耐→按捺、既使→即使… |
| C007 | 重复用字：的的、了了、词词 → 单字 |
| C008 | 缺标题的章节按首段拟定标题，不超过 6 字 |
| C009 | 语病提示（大约…左右、原因是…造成的、通过…使…等），只报告不改写 |

`--proofread` 是一次性开关；也可以 `check --fix-rules C001,C002` 单独选择规则。
检测与修复都是确定性的：同一份文本跑第二遍不会再改动。无词典可依赖，
语序和语义层面的问题只提示、不改写，避免把正确的句子改错。

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
src/chinese.mjs      简体中文校对规则（繁转简、标点、英文、日期、错别字、拟标题）
src/data/t2s.mjs     繁简字表（CLDR 生成，随包固定）
src/encoding.mjs     评分制编码探测
src/loaders/         docx / epub / pdf / html / rtf / 各类文本输入
src/formats/         docx / epub / pdf / rtf / json / yaml / xml / csv / js 输出
src/zip.mjs          零依赖 ZIP 读写（DOCX / EPUB 的基础）
src/cli.mjs          命令行入口
web/index.template.html  单文件页面的结构与样式
web/app.mjs          浏览器端交互逻辑
web/buffer.mjs       浏览器用的最小 Buffer 实现
scripts/build-web.mjs    把 web/ 与 src/ 内联成单文件 index.html
index.html           生成产物：可离线双击打开的单文件页面
test/run.mjs         零依赖测试套件（109 项）
```

## 路线图

- [x] inspect / format / merge / check / convert / install-skill
- [x] 12 种输出格式、20+ 种输入格式
- [x] 可配置标题规则、章节分层、Markdown 层级映射
- [x] PDF 自动页码、JSON / YAML / XML / CSV / JS 结构化输出
- [x] 简体中文校对：繁转简、全角标点、英文/日期、错别字、语病提示、自动补章节标题
- [ ] 二次编码乱码自动还原（iconv）
- [ ] 可选封面图
- [ ] PDF 页眉与页脚字段

## 贡献

欢迎提交 bug、格式需求与新的标题规则。项目刻意保持零依赖，这一点不会改变。
详见 [CONTRIBUTING.md](CONTRIBUTING.md) 与 [CHANGELOG.md](CHANGELOG.md)。

## 许可

MIT，见 [LICENSE](LICENSE)。