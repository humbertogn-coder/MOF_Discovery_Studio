# Operating costs

**Expected monthly cost with the recommended setup: USD 0.**

The site is static: HTML, JS, CSS, JSON and structure files. It has no server code, database, authentication, model inference or third-party API calls, so nothing is billed per request by design.

> Free-plan figures are from the providers' documentation as known in mid-2026. They could not be re-verified from this session. Check the current terms before deploying:
> Cloudflare Pages limits https://developers.cloudflare.com/pages/platform/limits/ · GitHub Pages limits https://docs.github.com/en/pages/getting-started-with-github-pages/github-pages-limits

## Footprint

| Item | Size |
|---|---|
| `dist/` total | ≈ 4.2 MB, 164 files |
| Initial page load (HTML + JS + CSS + manifest + candidates.json) | ≈ 100 kB gzipped JS/CSS + ≈ 250 kB JSON (uncompressed; served compressed by both hosts) |
| Plotly (loaded only when a chart is shown) | ≈ 360 kB gzipped |
| 3Dmol.js (loaded only when a structure is opened) | ≈ 165 kB gzipped |
| One CIF / POSCAR | 5–30 kB, fetched on demand |

## Provider comparison (free tiers, to be re-verified)

| | Cloudflare Pages (Free) | GitHub Pages |
|---|---|---|
| Price | free | free for public repositories |
| Static requests / bandwidth | not metered for static assets | soft limit ≈ 100 GB/month |
| Site size | ≤ 20,000 files, ≤ 25 MiB per file | ≤ 1 GB published site |
| Builds | ≈ 500 per month | ≈ 10 per hour (soft) with legacy builds; Actions minutes are free for public repos |
| SPA deep links | native (no 404.html) | via a 404.html copy (returns HTTP 404) |
| Custom domain + HTTPS | yes | yes |

This site uses about 0.4 % of a 1 GB size limit and fewer than 1 % of the file limit.

## What could create costs (and how the architecture avoids them)

| Action | Avoided by |
|---|---|
| Pages Functions / Workers code (billed beyond the free quota) | No functions; `wrangler.jsonc` defines static assets only |
| Databases, KV, R2, D1 | Not used; data are files in the build |
| LLM or inference APIs | Not used; no keys anywhere |
| Excessive bandwidth on GitHub Pages | Lazy loading and small assets; move to Cloudflare if traffic grows |
| Custom domain | Optional. A domain costs about USD 10–20 per year, depending on the registrar and TLD (renewal prices vary). |

## Higher traffic

On Cloudflare Pages, static traffic stays free. On GitHub Pages, sustained traffic far above the soft bandwidth limit may lead to a request to move hosting. No architectural change is needed in either case.

## Separate from site operating costs

- Claude subscriptions or API usage used to *develop* the site are separate from hosting costs and do not cover third-party services.
- HPC allocations (TAMU HPRC/ACES/FASTER) are not used for hosting. Any future research computing is governed by university policy.
- Maintenance is mostly time: re-export the data when the research repository changes, and update dependencies occasionally (`npm outdated`).
