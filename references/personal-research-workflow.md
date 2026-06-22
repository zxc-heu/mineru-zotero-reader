# 文献阅读流程：Zotero + Codex + MinerU Markdown

## 4. 文献阅读流程

文献阅读分为三层：快读、精读、写作级精读。

### 4.0 PDF 读取预处理：Zotero PDF -> MinerU Markdown

当 Codex 需要读取 Zotero 中的 PDF 时，不直接对 PDF 原文做阅读分析，而是先使用 MinerU 将 PDF 转换为 Markdown，再把生成的 `.md` 作为后续快读、精读、综述和写作准备的主要输入。

读取规则：

- Zotero 仍然是文献主库，继续负责保存 PDF 原文、题录、标签和 collections。
- Codex 需要阅读 Zotero PDF 时，先定位该 Zotero 条目下的 PDF 附件本地路径。
- 若 PDF 同目录下已经存在同名 `.md` 文件，默认直接使用该 `.md`，不重复解析。
- 若 PDF 同目录下不存在同名 `.md` 文件，先调用 MinerU 将 PDF 转换为同目录 Markdown。

输出保留规则：

- 保留 `论文名.md`，作为 Codex 后续阅读和知识整理的主要输入。
- 保留 `论文名_mineru\` 目录，用于后续查看图表、公式、图片和完整解析资源。
- 删除 `论文名_mineru.zip`，但只能删除当前 PDF 对应的这一个明确文件路径。
- 禁止批量删除 zip、目录或中间文件；不得使用递归删除命令。

示例：

```text
paper.pdf
  -> paper.md
  -> paper_mineru\    保留
  -> paper_mineru.zip 单独删除
```

## 4.1 快读

用于快速判断一篇论文是否值得深入阅读，同时保留后续可回看的关键科研判断信息。快读不是简陋摘要，也不替代精读。

快读分析输入优先使用 MinerU 生成的 `.md` 文件。源 Markdown 存在时默认完整读取一次；只有乱码、缺失摘要/结论或内容明显不完整时，才允许补读一次。快读默认不回查 `_mineru` 目录；只有 Markdown 无法支撑相关性和是否精读判断时，才允许回查一次。

快读正文建议约 1500-2500 中文字；高相关论文可略长，低相关论文应更短。快读阶段不做逐图逐表解释、公式重建、系统证据链整理或多轮关键词探索。

### 快读模板

```markdown
---
title:
authors:
year:
journal:
doi:
zotero_key:
citekey:
status: 快读完成
relevance: 高 / 中 / 低
---

# 快读结论

## 是否相关

高 / 中 / 低

## 适合用途

- 背景综述
- 方法参考
- 数据参考
- 结果讨论
- 选题启发
- 不建议继续阅读

## 一句话总结

## 研究问题

## 主要方法

## 主要结论

## 是否值得精读

是 / 否

## 判断理由

## 快读风险与回查建议

- 精读时应优先回查的图表、公式、方法段或结论段。
- MinerU/OCR 可能影响判断的地方。
```

## 4.2 精读

用于将论文转化为长期可复用的知识资产。

精读分析输入优先使用 MinerU 生成的 `.md` 文件；必要时回查 `_mineru` 目录中的图表、公式和图片资源，以保留页码、图号、表号和关键证据线索。

### 精读模板

```markdown
---
title:
authors:
year:
journal:
doi:
zotero_key:
citekey:
topics:
status: 精读完成
relevance: 高 / 中 / 低
usable_for: [Introduction, Methods, Results, Discussion]
---

# 一句话总结

# 研究背景与问题

# 核心研究目标

# 方法路线

# 数据来源与研究对象

# 关键模型 / 公式

# 关键图表解读

# 主要结果

# 作者结论

# 创新点

# 局限性

# 与我研究方向的关系

# 可复用内容

## 可引用观点

## 可借鉴方法

## 可借鉴图表

## 可借鉴表达

# 对小论文选题的启发

# 后续应追踪文献
```

## 4.3 写作级精读

用于目标期刊论文模仿和小论文写作准备。

写作级精读输入优先使用 MinerU 生成的 `.md` 文件；涉及图表安排、公式呈现和版式模仿时，可回查 `_mineru` 目录中的完整解析资源。

### 写作级精读模板

```markdown
---
title:
authors:
year:
journal:
doi:
zotero_key:
citekey:
target_use: 写作级精读
---

# 文章结构拆解

# Introduction 写法

# Methods 写法

# Results 组织方式

# Discussion 论证方式

# 图表安排

# 公式与模型呈现方式

# 高频表达

# 可模仿但不能照搬的句式

# 该文对我论文写作的启发
```
