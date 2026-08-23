import { useEffect, useRef } from 'react';

import type { OwnerTestEvidenceStatus, OwnerTestEvidenceSummary } from '../../lib/project-service';

interface OwnerTestEvidenceDialogProps {
  evidence: OwnerTestEvidenceSummary;
  onClose: () => void;
}

function statusLabel(status: OwnerTestEvidenceStatus): string {
  return status === 'not-run' ? 'Not run' : `${status.slice(0, 1).toUpperCase()}${status.slice(1)}`;
}

export function OwnerTestEvidenceDialog({ evidence, onClose }: OwnerTestEvidenceDialogProps) {
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const previousFocus =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    closeRef.current?.focus();
    const handleKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      previousFocus?.focus();
    };
  }, [onClose]);

  return (
    <div
      className="code-first-dialog-backdrop"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <section
        className="code-first-create-dialog code-first-test-evidence-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="owner-test-evidence-title"
      >
        <header>
          <div>
            <span className="code-first-dialog-eyebrow">ENGINE-PRODUCED EVIDENCE</span>
            <h2 id="owner-test-evidence-title">Owner test evidence</h2>
            <p>
              {evidence.framework} · overall {statusLabel(evidence.status)} ·{' '}
              {evidence.owners.length} owner(s)
            </p>
          </div>
          <button
            ref={closeRef}
            type="button"
            className="code-first-dialog-close"
            aria-label="Close owner test evidence"
            onClick={onClose}
          >
            ×
          </button>
        </header>
        <div className="code-first-test-evidence-body">
          {evidence.owners.length === 0 ? (
            <p className="code-first-dialog-note">No canonical owners were discovered.</p>
          ) : (
            <ul className="code-first-test-owner-list">
              {evidence.owners.map((owner) => (
                <li key={owner.ownerId} className={`is-${owner.status}`}>
                  <div>
                    <code>{owner.ownerId}</code>
                    <strong>{statusLabel(owner.status)}</strong>
                  </div>
                  {owner.requirements.some(({ status }) => status !== 'passed') && (
                    <ul>
                      {owner.requirements
                        .filter(({ status }) => status !== 'passed')
                        .map((requirement) => (
                          <li key={requirement.requirementId}>
                            <span>{requirement.requirementId}</span>
                            <span>{statusLabel(requirement.status)}</span>
                          </li>
                        ))}
                    </ul>
                  )}
                  {owner.allowedRepairFiles.length > 0 && (
                    <details>
                      <summary>AI repair scope ({owner.allowedRepairFiles.length} file(s))</summary>
                      {owner.allowedRepairFiles.map((file) => (
                        <code key={file}>{file}</code>
                      ))}
                      {owner.failureMessages.map((message) => (
                        <p key={message}>{message}</p>
                      ))}
                    </details>
                  )}
                </li>
              ))}
            </ul>
          )}
          <p className="code-first-dialog-note">
            Missing reports, architecture checks, or typechecks remain Not run. Studio never turns
            an absent verification gate green.
          </p>
        </div>
      </section>
    </div>
  );
}
