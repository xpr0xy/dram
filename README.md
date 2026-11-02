# DRAM — an atlas & journal of the water of life

A local-first web app for exploring and tracking your way through the whiskey world.

- **Browse** — 184 curated bottles across 10 countries: search, filter by country, region, style, and status.
- **Atlas** — 194 real distilleries region by region, including the silent ones, with 20 years of secondary-market data for context.
- **Journal** — mark what you've poured, rate it, keep tasting notes. Export/import as JSON.
- **Flavour map** — rate six flavour axes and watch your own palate constellation take shape.

Your journal lives in your browser (localStorage). Nothing is sent anywhere.

## Data

- Distillery catalog and quarterly auction series: [Whisky Hunter](https://whiskyhunter.net) (free public API).
- Bottle catalog and editorial notes: hand-curated guide. Details vary by bottling and market — trust the bottle.

## Develop

Static site, no build step:

```
python3 -m http.server 8791
```

Files: `index.html`, `styles.css`, `app.js`, and `data.json` (generated).
