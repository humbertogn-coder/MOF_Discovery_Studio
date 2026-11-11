import { defineConfig, devices } from '@playwright/test';

// E2E_BASE lets the suite run against a sub-path build (e.g. GitHub Pages): build and preview
// with BASE_PATH=/MOF_Discovery_Studio/ and set E2E_BASE to the same value.
const base = process.env.E2E_BASE ?? '/';
const port = 4173;
const webgl = { launchOptions: { args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] } };

export default defineConfig({
  testDir: 'tests/e2e',
  timeout: 60_000,
  expect: { timeout: 15_000 },
  fullyParallel: true,
  retries: process.env.CI ? 1 : 0,
  reporter: [['list']],
  use: { baseURL: `http://localhost:${port}${base}`, trace: 'retain-on-failure', acceptDownloads: true },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'], viewport: { width: 1360, height: 900 }, ...webgl } },
    { name: 'mobile', use: { ...devices['Pixel 7'], ...webgl }, grep: /@mobile/ },
  ],
  webServer: {
    command: `npx vite preview --port ${port} --strictPort`,
    url: `http://localhost:${port}${base}`,
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
  },
});
