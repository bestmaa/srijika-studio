import { Clock3, FileStack, LayoutTemplate, Trash2, X } from 'lucide-react';
import { useEffect, useMemo, useState, type CSSProperties } from 'react';

import {
  loadSavedTemplates,
  removeSavedTemplate,
  studioTemplates,
  type SavedStudioTemplate,
  type StudioTemplate,
} from '../lib/templates';

interface TemplateGalleryProps {
  open: boolean;
  onClose: () => void;
  onUseBuiltIn: (template: StudioTemplate) => void;
  onUseSaved: (template: SavedStudioTemplate) => void;
}

export function TemplateGallery({ open, onClose, onUseBuiltIn, onUseSaved }: TemplateGalleryProps) {
  const [savedTemplates, setSavedTemplates] = useState<SavedStudioTemplate[]>(loadSavedTemplates);
  const builtIns = useMemo(
    () =>
      studioTemplates.map((template) => ({
        template,
        nodeCount: Object.keys(template.createDocument().nodes).length,
      })),
    [],
  );

  useEffect(() => {
    if (!open) return;
    const handleKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onClose, open]);

  if (!open) return null;

  return (
    <div
      className="template-gallery-backdrop"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <section
        className="template-gallery"
        role="dialog"
        aria-modal="true"
        aria-labelledby="template-gallery-title"
      >
        <header className="template-gallery-header">
          <div className="template-gallery-title-group">
            <span className="template-gallery-icon" aria-hidden="true">
              <LayoutTemplate size={19} />
            </span>
            <div>
              <span className="eyebrow">STARTING POINTS</span>
              <h2 id="template-gallery-title">Choose a page template</h2>
            </div>
          </div>
          <button
            className="icon-button"
            type="button"
            aria-label="Close templates"
            onClick={onClose}
          >
            <X size={17} />
          </button>
        </header>

        <div className="template-gallery-scroll">
          <div className="template-gallery-section-heading">
            <div>
              <h3>Built-in templates</h3>
              <p>Real Srijika AST examples with editable hierarchy, props, events and styles.</p>
            </div>
            <span>{builtIns.length} templates</span>
          </div>
          <div className="template-card-grid" data-testid="built-in-template-grid">
            {builtIns.map(({ template, nodeCount }) => (
              <article className="template-card" key={template.id}>
                <div
                  className="template-card-preview"
                  style={{ '--template-accent': template.accent } as CSSProperties}
                >
                  <span className="template-preview-rail" />
                  <span className="template-preview-header" />
                  <span className="template-preview-content">
                    <i />
                    <i />
                    <i />
                  </span>
                </div>
                <div className="template-card-copy">
                  <div className="template-card-heading">
                    <div>
                      <span>{template.category}</span>
                      <h3>{template.name}</h3>
                    </div>
                    <span className="template-node-count">{nodeCount} nodes</span>
                  </div>
                  <p>{template.description}</p>
                  <button
                    className="template-use-button"
                    type="button"
                    onClick={() => onUseBuiltIn(template)}
                  >
                    Use template
                  </button>
                </div>
              </article>
            ))}
          </div>

          <div className="template-gallery-section-heading is-saved">
            <div>
              <h3>My templates</h3>
              <p>Snapshots saved from the File menu stay on this computer.</p>
            </div>
            <span>{savedTemplates.length} saved</span>
          </div>
          {savedTemplates.length > 0 ? (
            <div className="saved-template-list">
              {savedTemplates.map((template) => (
                <article className="saved-template-row" key={template.id}>
                  <span className="saved-template-icon" aria-hidden="true">
                    <FileStack size={17} />
                  </span>
                  <div>
                    <h3>{template.name}</h3>
                    <p>
                      <Clock3 size={12} /> {new Date(template.savedAt).toLocaleString()} ·{' '}
                      {Object.keys(template.document.nodes).length} nodes
                    </p>
                  </div>
                  <button
                    className="template-use-button is-compact"
                    type="button"
                    onClick={() => onUseSaved(template)}
                  >
                    Use
                  </button>
                  <button
                    className="icon-button danger"
                    type="button"
                    aria-label={`Delete saved template ${template.name}`}
                    onClick={() => {
                      removeSavedTemplate(template.id);
                      setSavedTemplates((current) =>
                        current.filter((candidate) => candidate.id !== template.id),
                      );
                    }}
                  >
                    <Trash2 size={15} />
                  </button>
                </article>
              ))}
            </div>
          ) : (
            <div className="saved-template-empty">
              <FileStack size={20} />
              <p>Open File → Save as template to keep the current page here.</p>
            </div>
          )}
        </div>

        <footer className="template-gallery-footer">
          <span>Applying a template replaces the active page document.</span>
          <button className="secondary-button" type="button" onClick={onClose}>
            Cancel
          </button>
        </footer>
      </section>
    </div>
  );
}
