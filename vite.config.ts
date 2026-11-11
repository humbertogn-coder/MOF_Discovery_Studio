/// <reference types="vitest/config" />
import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';

// Public URL used for social-card (Open Graph) tags. Override with SITE_URL at build time.
const SITE_URL = (process.env.SITE_URL ?? 'https://mof-discovery-studio.humbertogn.workers.dev').replace(/\/$/, '');
// Optional, cookieless Cloudflare Web Analytics: set CF_BEACON_TOKEN as a build variable to enable.
const CF_BEACON_TOKEN = process.env.CF_BEACON_TOKEN ?? '';

function siteMeta(): Plugin {
  return {
    name: 'mds-site-meta',
    transformIndexHtml(html) {
      const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
      const title = 'MOF Discovery Studio';
      const desc = 'Explore, compare and prioritize 131 hypothetical 3D MOF candidates: predicted PBE band gaps, accepted DFT labels, 3D structures and the active-learning logic behind them.';
      const tags = [
        `<link rel="canonical" href="${esc(SITE_URL)}/" />`,
        `<meta property="og:type" content="website" />`,
        `<meta property="og:site_name" content="${title}" />`,
        `<meta property="og:title" content="${title} — low-band-gap 3D MOF candidates" />`,
        `<meta property="og:description" content="${esc(desc)}" />`,
        `<meta property="og:url" content="${esc(SITE_URL)}/" />`,
        `<meta property="og:image" content="${esc(SITE_URL)}/og-image.png" />`,
        `<meta property="og:image:width" content="1200" />`,
        `<meta property="og:image:height" content="630" />`,
        `<meta property="og:image:alt" content="MOF Discovery Studio: a MOF-5 framework rendered in 3D next to the site title and key numbers" />`,
        `<meta name="twitter:card" content="summary_large_image" />`,
        `<meta name="twitter:title" content="${title}" />`,
        `<meta name="twitter:description" content="${esc(desc)}" />`,
        `<meta name="twitter:image" content="${esc(SITE_URL)}/og-image.png" />`,
      ];
      if (/^[A-Za-z0-9]{16,64}$/.test(CF_BEACON_TOKEN)) {
        tags.push(`<script defer src="https://static.cloudflareinsights.com/beacon.min.js" data-cf-beacon='{"token": "${CF_BEACON_TOKEN}"}'></script>`);
      }
      return html.replace('</head>', `    ${tags.join('\n    ')}\n  </head>`);
    },
  };
}

// BASE_PATH lets the same build run at the domain root (Cloudflare) or under a
// sub-path (GitHub Pages project site). The CLI flag --base overrides it.
export default defineConfig({
  base: process.env.BASE_PATH ?? '/',
  plugins: [react(), siteMeta()],
  build: {
    target: 'es2020',
    sourcemap: false,
    chunkSizeWarningLimit: 1200,
  },
  test: {
    include: ['tests/unit/**/*.test.ts', 'tests/unit/**/*.test.tsx', 'tests/integration/**/*.test.ts'],
    environment: 'node',
  },
});
