# Fonts

The landing page (`src/landing.css`) uses **Alliance** by Degarism Studio
(https://fontsarena.com/alliance-by-degarism-studio/). The font files are **not**
committed — drop the self-hosted `.woff2` files here so they're served from
`/fonts/...`:

```
AllianceNo2-Regular.woff2
AllianceNo2-Medium.woff2
AllianceNo2-SemiBold.woff2
AllianceNo1-Regular.woff2
AllianceNo1-Medium.woff2
```

Convert the distributed `.otf`/`.ttf` to `.woff2` (e.g. `woff2_compress`, or
fonttools `ttx`/`woff2`). Until the files are present the page falls back to the
system sans stack defined in `--font`, so it still renders.

> Licensing: confirm Alliance's license covers commercial web embedding before
> shipping a paid/hosted product — verify the terms on the foundry's page.
