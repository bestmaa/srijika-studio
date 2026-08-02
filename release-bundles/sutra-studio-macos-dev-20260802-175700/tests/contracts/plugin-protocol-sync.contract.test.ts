import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  CAPABILITIES,
  DOCUMENT_FORMAT_VERSION,
  PROTOCOL_VERSION,
  SUTRA_TOOL_NAMES,
  TOOL_VERSION,
} from '../../packages/automation-protocol/src/index';

interface PluginProtocolManifest {
  protocolVersion: string;
  toolVersion: string;
  documentFormatVersions: number[];
  features: Record<string, boolean>;
  canonicalTools: string[];
  deprecatedTools: string[];
}

describe('installed plugin protocol metadata', () => {
  it('stays synchronized with the canonical automation package', () => {
    const manifest = JSON.parse(
      readFileSync(resolve('plugins/sutra-studio/assets/protocol-manifest.json'), 'utf8'),
    ) as PluginProtocolManifest;

    expect(manifest.protocolVersion).toBe(PROTOCOL_VERSION);
    expect(manifest.toolVersion).toBe(TOOL_VERSION);
    expect(manifest.documentFormatVersions).toEqual([DOCUMENT_FORMAT_VERSION]);
    expect(manifest.features).toMatchObject(CAPABILITIES.features);
    expect(manifest.canonicalTools).toEqual(
      Object.values(SUTRA_TOOL_NAMES).filter(
        (toolName) => !CAPABILITIES.deprecated.toolNames.includes(toolName as never),
      ),
    );
    expect(manifest.deprecatedTools).toEqual(CAPABILITIES.deprecated.toolNames);
  });
});
