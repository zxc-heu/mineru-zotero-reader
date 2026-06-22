# Formula, Figure, and Table Style

Read this file for deep reads, writing-level reads, and formula-heavy quick reads.

## Formula Rendering

- Use `$...$` for inline formulas.
- Use paired `$$` blocks for standalone formulas.
- Do not output bare `\(...\)`.
- Do not output bare `\[` or `\]`.
- Do not leave LaTeX commands as plain text outside formula delimiters.
- Do not leave bare `\times`, `\mathrm`, `\boldsymbol`, `^`, or `_` fragments in prose or table cells.
- In Markdown tables, render compact scientific values as inline formulas, for example `$^{60}\mathrm{Co}$`, `$2.48 \times 10^7\ \mathrm{Bq}$`, and `$\mu\mathrm{Sv}/\mathrm{h}$`.

## MinerU OCR Cleanup

Lightly clean OCR artifacts while preserving scientific meaning:

- `\boldsymbol {H}` -> `\boldsymbol{H}`
- `\mathrm {T}` -> `\mathrm{T}`
- `$^ { 1 3 7 } \mathrm { C s }$` -> `$^{137}\mathrm{Cs}$`
- `\mathrm { L a B r } _ { 3 }` -> `\mathrm{LaBr}_3`

## Tables

- Do not put complete formulas, classification criteria, model equations, or evaluation metric definitions inside Markdown table cells.
- Put complete formulas below the table as standalone `$$` blocks.
- Table cells may contain short rendered inline formulas for nuclides, powers of ten, vectors, matrices, and units.

## Figures

- Use Markdown image syntax with the source Markdown's relative image path when available.
- Keep figure number and caption near the embedded image.
- Explain what question the figure answers, what conclusion it supports, and where it sits in the evidence chain.
