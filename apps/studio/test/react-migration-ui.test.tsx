import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import {
  describeOwnerTestCommand,
  describeReactMigrationCommand,
  ownerTestEvidenceSummary,
} from '../src/lib/project-service';
import { ProjectWelcomeScreen } from '../src/components/code-first/ProjectWelcomeScreen';
import { OwnerTestEvidenceDialog } from '../src/components/code-first/OwnerTestEvidenceDialog';

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
    expect(desktop).toContain('native');
    expect(desktop).toContain('Source stays immutable');

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

  it('summarizes fail-closed owner evidence and its bounded repair scope', () => {
    const response = {
      operation: 'evidence' as const,
      projectPath: '/workspace/srijika',
      stdout: '',
      stderr: '',
      result: {
        manifest: {
          framework: 'next-app-router',
          status: 'failed',
          owners: [
            {
              ownerId: 'feature:Home',
              status: 'failed',
              requirements: [
                { requirementId: 'feature:Home:architecture', status: 'not-run' },
                { requirementId: 'feature:Home:browser', status: 'failed' },
              ],
              repair: {
                allowedSourceFiles: ['src/features/home/Home.ui.tsx'],
                failureMessages: ['Expected heading'],
              },
            },
          ],
        },
      },
    };

    expect(ownerTestEvidenceSummary(response)).toMatchObject({
      status: 'failed',
      owners: [
        {
          ownerId: 'feature:Home',
          allowedRepairFiles: ['src/features/home/Home.ui.tsx'],
          failureMessages: ['Expected heading'],
        },
      ],
    });
    expect(describeOwnerTestCommand(response)).toContain('1 failed');
    const dialog = renderToStaticMarkup(
      <OwnerTestEvidenceDialog evidence={ownerTestEvidenceSummary(response)} onClose={() => {}} />,
    );
    expect(dialog).toContain('ENGINE-PRODUCED EVIDENCE');
    expect(dialog).toContain('feature:Home');
    expect(dialog).toContain('AI repair scope');
    expect(dialog).toContain('absent verification gate green');
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
