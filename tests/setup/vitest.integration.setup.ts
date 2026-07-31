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
  value: vi.fn().mockImplementation((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    addListener: vi.fn(),
    removeListener: vi.fn(),
    dispatchEvent: vi.fn(),
  })),
});

afterEach(() => {
  cleanup();
  localStorage.clear();
});
