# Deployment

The production build (`npm run build` → `dist/`, about 4 MB and 164 files) is a fully static site. It needs no server code, functions, database or secrets.

> **Before any public deployment**, complete [PUBLIC_RELEASE_CHECKLIST.md](PUBLIC_RELEASE_CHECKLIST.md). The manuscript is unpublished, and the advisor/team must approve publication.

> **Provider limits** below reflect the providers' documentation as known in mid-2026. They could **not** be re-checked from this build session (web access was unavailable). Confirm them at the linked pages before deploying.

## Option A — Cloudflare Pages (recommended)

1. Push this folder to a GitHub repository (for example `humbertogn-coder/MOF_Discovery_Studio`).
2. Cloudflare dashboard → *Workers & Pages* → *Create* → *Pages* → *Connect to Git* → select the repository.
3. Build settings:
   - Framework preset: *Vite* (or none)
   - Build command: `npm run build`
   - Build output directory: `dist`
   - Environment variable: `NODE_VERSION=22`
4. Deploy. The site is served at `https://<project>.pages.dev/`.

Notes:

- **SPA deep links.** Do not add a `404.html`. When none exists, Pages serves `index.html` for unknown paths, so links such as `/candidate/pcu__Zn-N16__short-H` work on reload.
- `public/_headers` sets long-lived caching for hashed assets, short caching for `/data/*`, and basic security headers. Other hosts ignore it.
- Direct upload without Git: `npx wrangler pages deploy dist --project-name mof-discovery-studio` (requires a Cloudflare login on your machine).
- Docs: https://developers.cloudflare.com/pages/ — limits: https://developers.cloudflare.com/pages/platform/limits/

## Option B — Cloudflare Workers static assets

`wrangler.jsonc` is included. It serves `dist/` as static assets with `not_found_handling: "single-page-application"` and defines no Worker script, so no Worker code runs.

```bash
npm run build
npx wrangler deploy
```

## Option C — GitHub Pages (fallback)

A project site lives under a sub-path (`https://<user>.github.io/<repo>/`), so the app must be built with that base path:

```bash
BASE_PATH=/MOF_Discovery_Studio/ npm run build:gh-pages   # also copies index.html -> 404.html for deep links
```

Then publish `dist/` with the official *GitHub Actions* Pages workflow (Settings → Pages → Source: GitHub Actions), for example with `actions/upload-pages-artifact` + `actions/deploy-pages`. The base path was tested: all E2E smoke tests pass with `BASE_PATH=/MOF_Discovery_Studio/` and `E2E_BASE=/MOF_Discovery_Studio/`.

Caveat: GitHub Pages returns HTTP 404 for deep links even though the copied `404.html` renders the right page. Crawlers may treat those pages as missing. Cloudflare Pages does not have this issue.

## Social card and analytics (v0.2)

- Open Graph / Twitter tags point to `${SITE_URL}/og-image.png`. `SITE_URL` defaults to `https://mof-discovery-studio.humbertogn.workers.dev`; set the build variable `SITE_URL` if the domain changes.
- Optional, cookieless **Cloudflare Web Analytics**: create a site in the Cloudflare dashboard (Analytics & Logs → Web Analytics), copy its token, and add the build variable `CF_BEACON_TOKEN`. The beacon script is injected only when that variable is set. Mention it on the Methods page if you enable it.

## Verifying a deployment

1. Open `/` and check that the snapshot commit `e2e71fa` appears in the footer.
2. Open a deep link directly, for example `/candidate/cds__Cu-N409__short-NH2`, and reload.
3. Check that the 3D viewer loads and that *Download CIF* returns a CIF.
4. Active learning: every tab shows the green "✓ … reproduces …" line.
5. Locally, against the production preview: `npm run test:e2e`.

## Updating the data

Re-run the exporter against a **new frozen commit** of the research repository, review `docs/DATA_PROVENANCE.md` and the warnings in `release-manifest.json`, bump `APP_RELEASE` in `scripts/export_research_data.py` if the release changes, run `npm run check`, then commit and redeploy.
