import {
  ArrowRight,
  Boxes,
  Code2,
  FileCode2,
  FolderInput,
  FolderTree,
  FolderOpen,
  FolderPlus,
  Globe2,
  Monitor,
  Plug2,
  Settings2,
} from 'lucide-react';
import { useId } from 'react';

export interface ProjectWelcomeScreenProps {
  mode: 'browser' | 'desktop';
  disabled?: boolean;
  statusMessage?: string | null | undefined;
  recentProject?: { displayName: string; path: string } | null | undefined;
  onCreateProject: () => void;
  onOpenProject: () => void;
  onOpenStandaloneUi: () => void;
  onImportReactProject?: (() => void) | undefined;
  onInspectReactMigration?: (() => void) | undefined;
  onVerifyReactMigration?: (() => void) | undefined;
  onResumeProject?: (() => void) | undefined;
  onBackToProject?: (() => void) | undefined;
  onOpenSettings?: (() => void) | undefined;
  onOpenStructure?: (() => void) | undefined;
}

export function ProjectWelcomeScreen({
  mode,
  disabled = false,
  statusMessage,
  recentProject,
  onCreateProject,
  onOpenProject,
  onOpenStandaloneUi,
  onImportReactProject,
  onInspectReactMigration,
  onVerifyReactMigration,
  onResumeProject,
  onBackToProject,
  onOpenSettings,
  onOpenStructure,
}: ProjectWelcomeScreenProps) {
  const createDescriptionId = useId();
  const openDescriptionId = useId();
  const desktop = mode === 'desktop';

  return (
    <main
      className={`code-first-welcome is-${mode}`}
      aria-labelledby="code-first-welcome-title"
      aria-busy={disabled}
    >
      <div className="code-first-welcome-glow" aria-hidden="true" />
      <section className="code-first-welcome-surface">
        <header className="code-first-welcome-hero">
          <div className="code-first-welcome-topline">
            <span className="code-first-welcome-mark" aria-hidden="true">
              <Boxes size={20} />
            </span>
            <span className="code-first-welcome-product">Srijika Studio</span>
            <div className="code-first-welcome-top-actions">
              {onBackToProject && (
                <button type="button" className="code-first-welcome-back" onClick={onBackToProject}>
                  Back to current project
                </button>
              )}
              <span className="code-first-welcome-mode">
                {desktop ? <Monitor size={13} /> : <Globe2 size={13} />}
                {desktop ? 'Desktop · real folders' : 'Browser · in-memory'}
              </span>
              {onOpenStructure && (
                <button
                  type="button"
                  className="code-first-welcome-settings"
                  aria-label="Open structure guide"
                  title="Srijika feature structure and ownership rules"
                  onClick={onOpenStructure}
                >
                  <FolderTree size={15} aria-hidden="true" />
                </button>
              )}
              {onOpenSettings && (
                <button
                  type="button"
                  className="code-first-welcome-settings"
                  aria-label="Open settings"
                  title="Appearance and Studio settings"
                  onClick={onOpenSettings}
                >
                  <Settings2 size={15} aria-hidden="true" />
                </button>
              )}
            </div>
          </div>
          <p className="code-first-welcome-eyebrow">CODE-FIRST · PROJECT WORKSPACE</p>
          <h1 id="code-first-welcome-title">
            {desktop
              ? 'Start with a real project.'
              : 'Explore Srijika without touching your files.'}
          </h1>
          <p className="code-first-welcome-lede">
            {desktop
              ? 'Create a structured React workspace or attach an existing Srijika project. Your TSX files remain authoritative while Studio derives the hierarchy, preview, and Inspector.'
              : 'Create a temporary demo workspace to explore the complete UI workflow, or inspect one local TSX file without attaching a project folder.'}
          </p>
        </header>

        <div className="code-first-welcome-actions">
          <article className="code-first-welcome-action is-primary">
            <span className="code-first-welcome-action-icon" aria-hidden="true">
              <FolderPlus size={22} />
            </span>
            <div>
              <span className="code-first-welcome-action-kicker">
                {desktop ? 'RECOMMENDED' : 'TRY THE WORKFLOW'}
              </span>
              <h2>{desktop ? 'New Project' : 'Create Demo Project'}</h2>
              <p id={createDescriptionId}>
                {desktop
                  ? 'Choose a folder and let Srijika scaffold the React app, UI sources, Connectors, and compiler policy.'
                  : 'Start an in-memory Srijika app with real UI and Connector files. Nothing is written to your computer.'}
              </p>
            </div>
            <button
              type="button"
              disabled={disabled}
              aria-describedby={createDescriptionId}
              onClick={onCreateProject}
            >
              {desktop ? 'Create New Project' : 'Create Demo Project'}
              <ArrowRight size={15} aria-hidden="true" />
            </button>
            <small>
              {desktop ? 'Creates an independent folder on disk' : 'Cleared when this session ends'}
            </small>
          </article>

          <article className="code-first-welcome-action">
            <span className="code-first-welcome-action-icon" aria-hidden="true">
              {desktop ? <FolderOpen size={22} /> : <FileCode2 size={22} />}
            </span>
            <div>
              <span className="code-first-welcome-action-kicker">
                {desktop ? 'CONTINUE' : 'ONE FILE'}
              </span>
              <h2>{desktop ? 'Open Existing Project' : 'Import One .ui.tsx File'}</h2>
              <p id={openDescriptionId}>
                {desktop
                  ? 'Select a Srijika project folder. Studio safely indexes its UI sources and opens the configured entry.'
                  : 'Choose exactly one .ui.tsx file—not a project folder—for source, hierarchy, preview, and Inspector. Browser mode cannot attach folders.'}
              </p>
            </div>
            <button
              type="button"
              disabled={disabled}
              aria-describedby={openDescriptionId}
              onClick={desktop ? onOpenProject : onOpenStandaloneUi}
            >
              {desktop ? 'Open Existing Project' : 'Import One .ui.tsx File'}
              <ArrowRight size={15} aria-hidden="true" />
            </button>
            <small>
              {desktop
                ? 'Design Preview works before dependency install'
                : 'Project folders open in desktop Studio only'}
            </small>
          </article>

          {desktop && onImportReactProject && (
            <article className="code-first-welcome-action is-migration">
              <span className="code-first-welcome-action-icon" aria-hidden="true">
                <FolderInput size={22} />
              </span>
              <div>
                <span className="code-first-welcome-action-kicker">SAFE REACT MIGRATION</span>
                <h2>Import Existing React Project</h2>
                <p>
                  Select a read-only React source and a separate target. Studio runs the canonical
                  migration engine; rerunning the same target resumes its saved session.
                </p>
              </div>
              <button type="button" disabled={disabled} onClick={onImportReactProject}>
                Import or Resume React Project
                <ArrowRight size={15} aria-hidden="true" />
              </button>
              {onInspectReactMigration && (
                <button
                  type="button"
                  className="is-secondary"
                  disabled={disabled}
                  onClick={onInspectReactMigration}
                >
                  Check Existing Migration Status
                  <ArrowRight size={15} aria-hidden="true" />
                </button>
              )}
              {onVerifyReactMigration && (
                <button
                  type="button"
                  className="is-secondary"
                  disabled={disabled}
                  onClick={onVerifyReactMigration}
                >
                  Verify Converted Project
                  <ArrowRight size={15} aria-hidden="true" />
                </button>
              )}
              <small>Source and target must be separate, non-overlapping folders</small>
            </article>
          )}
        </div>

        {desktop && recentProject && onResumeProject && (
          <div className="code-first-welcome-recent" role="region" aria-label="Recent project">
            <FolderOpen size={16} aria-hidden="true" />
            <span>
              <strong>Resume {recentProject.displayName}</strong>
              <small title={recentProject.path}>{recentProject.path}</small>
            </span>
            <button type="button" disabled={disabled} onClick={onResumeProject}>
              Resume Last Project
              <ArrowRight size={14} aria-hidden="true" />
            </button>
          </div>
        )}

        <section className="code-first-welcome-how" aria-labelledby="code-first-welcome-how-title">
          <div className="code-first-welcome-how-heading">
            <span>WORKFLOW</span>
            <h2 id="code-first-welcome-how-title">One source, three clear views</h2>
          </div>
          <ol>
            <li>
              <Code2 size={17} aria-hidden="true" />
              <span>
                <strong>Author in TSX</strong>
                UI files remain the single source of truth.
              </span>
            </li>
            <li>
              <Boxes size={17} aria-hidden="true" />
              <span>
                <strong>Inspect the derived model</strong>
                Hierarchy, preview, props, and diagnostics stay connected.
              </span>
            </li>
            <li>
              <Plug2 size={17} aria-hidden="true" />
              <span>
                <strong>Keep logic in Connectors</strong>
                Pure UI remains reusable without prop drilling through layout shells.
              </span>
            </li>
          </ol>
        </section>

        {!desktop && (
          <p className="code-first-welcome-browser-note">
            Browser mode cannot create or attach real project folders. Use the Srijika desktop app
            when you are ready to work on disk.
          </p>
        )}

        {desktop && (
          <div className="code-first-welcome-standalone">
            <FileCode2 size={15} aria-hidden="true" />
            <span>Only need to inspect one source file?</span>
            <button type="button" disabled={disabled} onClick={onOpenStandaloneUi}>
              Preview standalone .ui.tsx
            </button>
          </div>
        )}

        {statusMessage && (
          <p className="code-first-welcome-status" role="status" aria-live="polite">
            {statusMessage}
          </p>
        )}

        <footer className="code-first-welcome-authority">
          <Code2 size={14} aria-hidden="true" />
          TSX stays authoritative. Studio never replaces your project with a hidden visual format.
        </footer>
      </section>
    </main>
  );
}
