import '@testing-library/jest-dom/vitest';

import { cleanup } from '@testing-library/react';
import { afterEach, vi } from 'vitest';

class BroadcastChannelStub {
  readonly name: string;

  constructor(name: string) {
    this.name = name;
  }

  postMessage(): void {}

  addEventListener(): void {}

  removeEventListener(): void {}

  close(): void {}
}

vi.stubGlobal('BroadcastChannel', BroadcastChannelStub);

Object.defineProperty(window, 'matchMedia', {
  configurable: true,
  value: (query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
    addListener: () => undefined,
    removeListener: () => undefined,
    dispatchEvent: () => false,
  }),
});

afterEach(() => {
  cleanup();
  localStorage.clear();
});
