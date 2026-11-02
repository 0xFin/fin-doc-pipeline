# fin-doc-pipeline

[English](README.md) | **简体中文**

[![CI](https://github.com/0xFin/fin-doc-pipeline/actions/workflows/ci.yml/badge.svg)](https://github.com/0xFin/fin-doc-pipeline/actions/workflows/ci.yml)

零依赖的文本处理流水线：自动识别编码、去重合并多个来源、校验并修复内容、统一排版，
再导出为纯文本、结构化数据、富文本、电子书或 PDF。

```sh
text-forge inspect book.txt
text-forge merge 第一卷.txt 第二卷.txt 第三卷.txt -o 全书.txt
text-forge check book.txt --fix -o fixed.txt
text-forge convert book.txt --to epub,docx,pdf
```

## 为什么要再造一个文本工具

大多数「合并清理」脚本的做法是：按顺序尝试编码，第一个不报错的就采用。
这种策略会以很隐蔽的方式失败——一本 200KB 的 GBK 小说里只要有一个坏字节，
GBK 解码器就抛异常，而 Big5 解码器恰好能接受同一串字节，于是整本书静默变成乱码，
但看上去仍然像中文。

本项目的做法是：**把所有候选编码都解一遍，再按「像不像正常文章」打分**
（常用字命中率、替换字符惩罚、私有区字符惩罚），取最高分。
同时把章节身份定义为 `(分组, 编号)`，所以 `番外第001章` 不会和正文的 `第001章` 撞车。

## 功能

- **编码探测**：UTF-8(BOM)、UTF-16LE/BE、GBK、GB18030、Big5，评分制而非「先到先得」
- **结构化解析**：章、节、卷、特殊篇目、番外分组，支持 Markdown 标题与 DOCX/EPUB/HTML 的层级信息
- **三级去重**：完全相同的文件、跨文件的同号章节、章内重复段落
- **两种合并模式**：`versions`（同一本书的不同版本，逐章择优）与 `concat`（不同的书，原样拼接）
- **校验与修复**：20 条文本与结构规则，白名单内的安全项可自动修复
- **排版**：标题模板、缩进、空行策略、可选软换行重排与标点规范化
- **导入**：txt、md、html、rtf、docx、epub、pdf、json、yaml、xml、csv、js 等
- **导出**：txt、md、html、json、yaml、xml、csv、js、rtf、docx、epub、pdf
- **面向 Agent**：所有命令都支持 `--json` 与 `--dry-run`，并自带 `SKILL.md`
- **安全默认**：不删任何源文件；即使开启删除，也要两个参数同时给，且默认进废纸篓

## 安装

```sh
git clone https://github.com/0xFin/fin-doc-pipeline.git
cd fin-doc-pipeline
node test/run.mjs      # 88 项检查，无需安装依赖
node src/cli.mjs --help
```

暴露为命令：

```sh
npm link                         # 提供 fin-doc-pipeline 与 fdp
npm install -g .                 # 从当前仓库全局安装
npm install -g fin-doc-pipeline  # 发布到 npm 之后
```

作为 Agent 技能安装到技能目录（安装后几秒内自动被发现，无需重启）：

```sh
fin-doc-pipeline install-skill              # -> ~/.dsh/skills/fin-doc-pipeline
fin-doc-pipeline install-skill --dest ~/.claude/skills
fin-doc-pipeline install-skill --link       # 软链接，改代码立即生效
fin-doc-pipeline install-skill --uninstall
```

## 用法

### 先体检

```
$ text-forge inspect book.txt
■ book.txt
   编码   GBK（置信度 100%）
   结构   章节 293   小节 12   特殊篇目 1   卷 3   段落 15272   字数 802531
   检查   错误 0   警告 10   提示 0
```

### 合并同一本书的分卷

```sh
text-forge merge 第一卷.txt 第二卷.txt 第三卷.txt -o 全书.txt
```

同一章出现在多个文件里时，会比较完整度并采用最全的那一版。
每个决策都写进输出文件旁边的 Markdown 报告里；成品本身保持干净，不夹带来源信息。

### 拼接不同的书

```sh
text-forge merge a.txt b.txt --merge-mode concat --renumber -o 合集.txt
```

### 排版与导出

```sh
text-forge format 手稿.txt -o out.txt \
  --title '[第 {num} 章]' --title-sep '　' --indent '　　'

text-forge convert book.txt --to md,html
text-forge convert book.txt --to epub,docx,pdf
text-forge merge a.txt b.txt -o book.txt --to epub
```

### 自定义章节标题

```sh
text-forge format book.txt --title '第{num}章 {title}' --title-sep ' · '
text-forge format book.txt --title '{num:4} | {title}'
text-forge format book.txt --title '{raw}'          # 保持原文标题不动
text-forge format book.txt --group-title '{prefix} {num} {title}'
```

占位符：`{num}`、`{num:N}`、`{title}`、`{prefix}`、`{unit}`、`{raw}`。
模板中没有 `{title}` 时，副标题会按 `--title-sep` 追加在后面。

### 标题识别

识别是逐条规则匹配，先命中先用，默认顺序：
`manual`、`markdown`、`numbered-cn`、`numbered-en`、`cn-list`、`ordered`、`bracket`、`special`、`heuristic`。

```sh
# 只用部分规则
text-forge format book.md --rules markdown,numbered-en

# 自己的正则（|| 分隔多条）
text-forge format book.md --heading-regex '^◆ (.+)$'

# 权威标题清单，一行一个
text-forge format book.md --headings-file headings.txt --rules manual

# H1 是书名，H2 是章，H3 是节
text-forge format book.md --md-title-level 1 --md-chapter-level 2 --md-section-level 3

# 启发式识别（需要显式开启）
text-forge format book.md --heuristic-headings
```

`第3节`、`### 标题`、`一、`、`1.` 会被识别为**小节**：
它们留在所属章节内部，不触发分页、不单独成文件、有独立模板，并在 JSON/YAML/XML 里以嵌套结构呈现。
没有编号的标题（纯 Markdown 标题、独立成篇的文章）使用 `--unnumbered-title`，默认就是标题原文，
不会凭空生成一个章号。

### 输出名不会覆盖源文件

输出路径会与所有输入比对；一旦相同，自动插入 `.out` 标记
（`book.txt` -> `book.out.txt`），转换永远不会写坏原稿。

## 配置

在工作目录放一个 `fin-doc-pipeline.config.json`，或通过 `--config` 指定路径；
命令行参数优先级高于配置文件。

```json
{
  "meta":   { "title": "", "author": "", "language": "zh-CN" },
  "format": { "chapterTitle": "[第 {num} 章]", "titleSeparator": "　", "indent": "　　" },
  "merge":  { "mode": "versions", "pick": "longest", "paragraphDedupe": true },
  "output": { "encoding": "utf-8", "bom": false, "eol": "lf" },
  "convert": { "includeDocTitle": false },
  "safety": { "cleanSources": false, "hardDelete": false }
}
```

## 示例配置

仓库里带了一份可直接使用的中文小说预设：
[`examples/fin-doc-pipeline.config.json`](examples/fin-doc-pipeline.config.json)。
复制到你自己的工作目录并改名为 `fin-doc-pipeline.config.json` 即可生效。

## 设计原则

1. **绝不静默丢内容**：每一个被删掉的段落、文件或章节版本都记录在报告里。
2. **默认只读**：先 inspect、先 dry-run；写文件要指定输出路径；删除要两个开关。
3. **报告不混进成品**：来源信息对你有用，对读者没用。
4. **零第三方依赖**：只用 Node 内置模块。
5. **确定性**：同样输入必然同样输出，不联网、不往成品里写时间戳。

## 兼容性

- Node.js 18 或更高
- macOS / Linux / Windows（删除操作在支持的系统上走废纸篓）
- 非 UTF-8 **输出**需要系统安装 `iconv`；UTF-8 输出不需要

## 项目结构

```
src/rules.mjs        标题识别规则引擎
src/parser.mjs       文档结构（章/节/卷/特殊篇目）
src/typography.mjs   清洗、标题模板、成文
src/merge.mjs        文件/章节/段落三级去重
src/lint.mjs         校验规则与安全修复
src/encoding.mjs     评分制编码探测
src/loaders/         docx / epub / pdf / html / rtf 输入
src/formats/         docx / epub / pdf / rtf / json / yaml / xml / csv / js 输出
src/zip.mjs          零依赖 ZIP 读写（DOCX/EPUB 基础）
src/cli.mjs          命令行入口
test/run.mjs         零依赖测试套件
```

## 路线图

- [x] inspect / format / merge / check / convert
- [x] 12 种输出格式、8 种容器与标记输入
- [x] 可配置的标题规则、章节分层、Markdown 层级映射
- [x] PDF 自动页码、JSON/YAML/XML/CSV/JS 结构化输出
- [ ] 二次编码乱码自动还原（iconv）
- [ ] 可选的封面图
- [ ] PDF 页眉与页脚字段

## 贡献

欢迎提交 bug、格式需求与新的标题规则。项目刻意保持零依赖，这一点不会改变，
所以贡献代码只能使用 Node 内置模块。详见 [CONTRIBUTING.md](CONTRIBUTING.md) 与
[CHANGELOG.md](CHANGELOG.md)。

## 许可

MIT，见 [LICENSE](LICENSE)。
