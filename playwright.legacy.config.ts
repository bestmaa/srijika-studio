import { createPlaywrightConfig, CURRENT_WEB_E2E_PATTERNS } from './playwright.shared';

export default createPlaywrightConfig({ testIgnore: CURRENT_WEB_E2E_PATTERNS });
