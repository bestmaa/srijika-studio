import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { describeReactMigrationCommand } from '../src/lib/project-service';
import { ProjectWelcomeScreen } from '../src/components/code-first/ProjectWelcomeScreen';

const requiredProps = {
  onCreateProject() {},
  onOpenProject() {},
  onOpenStandaloneUi() {},
};

describe('Studio React migration entry', () => {
  it('shows import/resume and status only in desktop Studio', () => {
    const desktop = renderToStaticMarkup(
      <ProjectWelcomeScreen
        mode="desktop"
        {...requiredProps}
        onImportReactProject={() => undefined}
        onInspectReactMigration={() => undefined}
        onVerifyReactMigration={() => undefined}
      />,
    );
    expect(desktop).toContain('Import Existing React Project');
    expect(desktop).toContain('Import or Resume React Project');
    expect(desktop).toContain('Check Existing Migration Status');
    expect(desktop).toContain('Verify Converted Project');
    expect(desktop).toContain('read-only React source');

    const browser = renderToStaticMarkup(
      <ProjectWelcomeScreen
        mode="browser"
        {...requiredProps}
        onImportReactProject={() => undefined}
        onInspectReactMigration={() => undefined}
        onVerifyReactMigration={() => undefined}
      />,
    );
    expect(browser).not.toContain('Import Existing React Project');
  });

  it('keeps status parsing tolerant to added session fields', () => {
    expect(
      describeReactMigrationCommand({
        operation: 'status',
        targetPath: '/workspace/srijika',
        stdout: '',
        stderr: '',
        result: { phase: 'planned', futureField: { retained: true } },
      }),
    ).toBe('Status phase: planned.');
  });
});
