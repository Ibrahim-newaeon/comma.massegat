# Fonts

Place `Cairo-Variable.woff2` here.

1. Download the Cairo variable font (Google Fonts / the upstream repository).
2. Subset it to Arabic + Latin ranges only — the full font is large:
   `pyftsubset Cairo-Variable.ttf --unicodes="U+0000-00FF,U+0600-06FF,U+0750-077F,U+FB50-FDFF,U+FE70-FEFF" --flavor=woff2 --output-file=Cairo-Variable.woff2`
3. ⚠️ Verify the license text before shipping. Do not assume.

Self-hosted deliberately: keeps CSP `font-src 'self'` with no external CDN.

## Quick install (Arabic subset)

```bash
curl -L -o Cairo-Variable.woff2 \
  "https://cdn.jsdelivr.net/fontsource/fonts/cairo:vf@latest/arabic-wght-normal.woff2"
```

⚠️ That is the **Arabic subset only** — Latin falls back to system-ui, so a
mixed `مرحبا Ahmad` message renders in two typefaces with a visible weight and
x-height shift at the boundary. That mismatch is exactly what choosing Cairo
was meant to avoid. Add the Latin subset too, with a second @font-face and a
`unicode-range`, before calling the typography done.
