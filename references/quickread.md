# Quick Read Rules

Read this file for quick-read tasks.

## Purpose

Create a structured screening note. Quick read decides whether the paper deserves deep reading and preserves decision-critical information.

## Source Scope

- Prefer MinerU-generated `paper.md`.
- If the bridge provides a bounded quick-read digest, use it first and do not read the full Markdown.
- If no digest is available, read bounded material: title/front matter, abstract, introduction/background, methods, results/discussion, and conclusion.
- Perform at most one supplemental read when the material is garbled, lacks abstract/conclusion-level content, or is clearly incomplete.

## Boundaries

- Target roughly 1500-2500 Chinese characters or equivalent information density.
- Do not do figure-by-figure explanation.
- Do not reconstruct complex formulas.
- Do not do exhaustive evidence tracing or repeated keyword searches.

## Template Headings

- YAML frontmatter
- 快读结论
- 是否相关
- 一句话总结
- 研究问题
- 主要方法
- 主要结论
- 是否值得精读
- 判断理由
- 快读风险与回查建议
- 保存前自检

## Formula Note

Use `$...$` for simple inline formulas when needed. If formulas are central to the quick-read judgment, also read `formula-style.md`.
