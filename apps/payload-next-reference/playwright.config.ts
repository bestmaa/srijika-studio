import { defineConfig, devices } from '@playwright/test';

const port = Number(process.env['PAYLOAD_REFERENCE_PORT'] ?? 4387);

export default defineConfig({
  testDir: './test/browser',
  reporter: 'list',
  use: { baseURL: `http://127.0.0.1:${port}`, trace: 'retain-on-failure' },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: `pnpm dev -- --hostname 127.0.0.1 --port ${port}`,
    url: `http://127.0.0.1:${port}`,
    reuseExistingServer: !process.env['CI'],
    timeout: 120_000,
  },
});
