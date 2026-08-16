import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

describe('VS Code Srijika Structure contribution', () => {
  it('packages a Structure Activity Bar view with inline Add and Explorer right-click', () => {
    const manifest = JSON.parse(
      readFileSync(new URL('../package.json', import.meta.url), 'utf8'),
    ) as {
      files: string[];
      activationEvents: string[];
      contributes: {
        commands: Array<{ command: string; title?: string }>;
        configuration: { properties: Record<string, unknown> };
        views: Record<string, Array<{ id: string }>>;
        menus: Record<string, Array<{ command: string; when: string }>>;
      };
    };
    expect(manifest.files).toContain('media');
    expect(manifest.activationEvents).toContain('workspaceContains:srijika.config.json');
    expect(manifest.activationEvents).toContain('onView:srijika.structure');
    expect(manifest.contributes.commands).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ command: 'srijika.runApp' }),
        expect.objectContaining({ command: 'srijika.stopApp' }),
        expect.objectContaining({ command: 'srijika.doctor' }),
      ]),
    );
    expect(manifest.contributes.commands).toContainEqual(
      expect.objectContaining({
        command: 'srijika.addOwnershipCapability',
        title: 'Srijika: Add Strict Feature / Shared Owner…',
      }),
    );
    expect(manifest.contributes.configuration.properties).toHaveProperty('srijika.runtime');
    expect(manifest.contributes.views['srijika']).toContainEqual({
      id: 'srijika.structure',
      name: 'Structure',
    });
    expect(manifest.contributes.menus['view/item/context']).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          command: 'srijika.addOwnershipCapability',
          when: 'view == srijika.structure && viewItem == srijikaStructureOwner',
        }),
      ]),
    );
    expect(manifest.contributes.menus['explorer/context']).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ command: 'srijika.addOwnershipCapability' }),
      ]),
    );
    expect(manifest.contributes.menus['explorer/context']?.[0]?.when).toBe(
      'explorerResourceIsFolder',
    );
  });
});
