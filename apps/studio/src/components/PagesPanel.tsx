import { Check, FilePlus2, FileText, X } from 'lucide-react';
import { useState } from 'react';

import { useStudioStore } from '../store/studio-store';

export function PagesPanel() {
  const pages = useStudioStore((state) => state.pages);
  const selectedPageId = useStudioStore((state) => state.selectedPageId);
  const createPage = useStudioStore((state) => state.createPage);
  const selectPage = useStudioStore((state) => state.selectPage);
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState('');

  const closeForm = (): void => {
    setCreating(false);
    setName('');
  };

  const submit = (): void => {
    const requestedName = name.trim();
    if (!requestedName || !createPage(requestedName)) return;
    closeForm();
  };

  return (
    <section className="pages-panel" aria-labelledby="pages-panel-title">
      <header>
        <div>
          <span className="eyebrow">PROJECT</span>
          <h2 id="pages-panel-title">Pages</h2>
        </div>
        <button
          className="icon-button pages-add-button"
          type="button"
          aria-label="New page"
          title="Create page"
          onClick={() => setCreating(true)}
        >
          <FilePlus2 size={16} />
        </button>
      </header>

      {creating && (
        <div className="pages-create-form">
          <input
            autoFocus
            aria-label="New page name"
            placeholder="Dashboard Page"
            value={name}
            onChange={(event) => setName(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') submit();
              if (event.key === 'Escape') closeForm();
            }}
          />
          <button type="button" disabled={!name.trim()} onClick={submit}>
            Create
          </button>
          <button type="button" aria-label="Cancel new page" title="Cancel" onClick={closeForm}>
            <X size={13} />
          </button>
        </div>
      )}

      <nav className="project-pages" aria-label="Project pages">
        {pages.map((page) => {
          const selected = page.id === selectedPageId;
          return (
            <button
              className={selected ? 'project-page-item is-selected' : 'project-page-item'}
              key={page.id}
              type="button"
              aria-pressed={selected}
              onClick={() => selectPage(page.id)}
            >
              <FileText size={14} />
              <span>
                <strong>{page.name || 'Untitled Page'}</strong>
                <small>React page</small>
              </span>
              {selected && <Check size={13} aria-hidden="true" />}
            </button>
          );
        })}
      </nav>
    </section>
  );
}
