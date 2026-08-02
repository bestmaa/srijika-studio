import { BookOpenCheck, Braces, CheckCircle2, Layers3, X } from 'lucide-react';
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
} from 'react';

import {
  studioLearningExamples,
  type LearningExample,
  type LearningExampleCategory,
} from '../lib/learning-examples';

interface LearnGalleryProps {
  open: boolean;
  onClose: () => void;
  onUseExample: (example: LearningExample) => void;
}

type LearningFilter = 'All' | LearningExampleCategory;

const learningFilters: readonly LearningFilter[] = [
  'All',
  'Props',
  'Loops',
  'Conditions',
  'Expressions',
  'Events',
];

function focusableElements(container: HTMLElement): HTMLElement[] {
  return [
    ...container.querySelectorAll<HTMLElement>('button:not([disabled]), [href], [tabindex]'),
  ].filter((element) => element.tabIndex >= 0);
}

export function LearnGallery({ open, onClose, onUseExample }: LearnGalleryProps) {
  const dialogRef = useRef<HTMLElement>(null);
  const [activeFilter, setActiveFilter] = useState<LearningFilter>('All');
  const examples = useMemo(
    () =>
      studioLearningExamples.map((example) => ({
        example,
        nodeCount: Object.keys(example.createDocument().nodes).length,
      })),
    [],
  );
  const visibleExamples =
    activeFilter === 'All'
      ? examples
      : examples.filter(({ example }) => example.category === activeFilter);
  const visibleGroups = learningFilters
    .filter((filter): filter is LearningExampleCategory => filter !== 'All')
    .map((category) => ({
      category,
      examples: visibleExamples.filter(({ example }) => example.category === category),
    }))
    .filter((group) => group.examples.length > 0);

  useEffect(() => {
    if (!open) return;
    const previousFocus =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const frame = window.requestAnimationFrame(() => {
      dialogRef.current?.querySelector<HTMLElement>('[data-learning-primary]')?.focus();
    });
    const handleKeyDown = (event: globalThis.KeyboardEvent): void => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.cancelAnimationFrame(frame);
      window.removeEventListener('keydown', handleKeyDown);
      previousFocus?.focus();
    };
  }, [onClose, open]);

  if (!open) return null;

  const trapFocus = (event: KeyboardEvent<HTMLElement>): void => {
    if (event.key !== 'Tab' || !dialogRef.current) return;
    const focusable = focusableElements(dialogRef.current);
    const first = focusable[0];
    const last = focusable.at(-1);
    if (!first || !last) return;
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  };

  return (
    <div
      className="template-gallery-backdrop"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <section
        ref={dialogRef}
        className="template-gallery learn-gallery"
        role="dialog"
        aria-modal="true"
        aria-labelledby="learn-gallery-title"
        aria-describedby="learn-gallery-description"
        onKeyDown={trapFocus}
      >
        <header className="template-gallery-header">
          <div className="template-gallery-title-group">
            <span className="template-gallery-icon learn-gallery-icon" aria-hidden="true">
              <BookOpenCheck size={19} />
            </span>
            <div>
              <span className="eyebrow">LEARN BY INSPECTING</span>
              <h2 id="learn-gallery-title">Working React examples</h2>
            </div>
          </div>
          <button className="icon-button" type="button" aria-label="Close Learn" onClick={onClose}>
            <X size={17} />
          </button>
        </header>

        <div className="template-gallery-scroll learn-gallery-scroll">
          <div className="learn-workflow" id="learn-gallery-description">
            <div>
              <Braces size={18} aria-hidden="true" />
              <span>
                <strong>Load a real AST</strong>
                <small>A new page is created, so your current work stays untouched.</small>
              </span>
            </div>
            <i aria-hidden="true" />
            <div>
              <Layers3 size={18} aria-hidden="true" />
              <span>
                <strong>Edit and inspect</strong>
                <small>Change page props, select hierarchy nodes, then compare JSX and JSON.</small>
              </span>
            </div>
          </div>

          <div className="template-gallery-section-heading learn-section-heading">
            <div>
              <h3>Choose one concept</h3>
              <p>Every card opens its own small, editable page.</p>
            </div>
            <span>{examples.length} separate examples</span>
          </div>

          <nav className="learn-filter-list" aria-label="Learning example categories">
            {learningFilters.map((filter) => {
              const count =
                filter === 'All'
                  ? examples.length
                  : examples.filter(({ example }) => example.category === filter).length;
              return (
                <button
                  key={filter}
                  type="button"
                  aria-pressed={activeFilter === filter}
                  onClick={() => setActiveFilter(filter)}
                >
                  {filter}
                  <span>{count}</span>
                </button>
              );
            })}
          </nav>

          <div className="learn-example-groups" data-testid="learning-example-groups">
            {visibleGroups.map((group) => (
              <section
                className="learn-example-group"
                key={group.category}
                aria-labelledby={`learn-group-${group.category.toLowerCase()}`}
              >
                <header className="learn-example-group-heading">
                  <h3 id={`learn-group-${group.category.toLowerCase()}`}>{group.category}</h3>
                  <span>
                    {group.examples.length} {group.examples.length === 1 ? 'example' : 'examples'}
                  </span>
                </header>

                <div className="learn-example-grid" data-testid="learning-example-grid">
                  {group.examples.map(({ example, nodeCount }) => {
                    const exampleIndex = studioLearningExamples.findIndex(
                      (candidate) => candidate.id === example.id,
                    );
                    return (
                      <article
                        className="learn-example-card"
                        key={example.id}
                        data-example-id={example.id}
                        aria-labelledby={`learn-example-${example.id}`}
                      >
                        <div
                          className="learn-example-preview"
                          style={{ '--template-accent': example.accent } as CSSProperties}
                          aria-hidden="true"
                        >
                          <span className="learn-preview-number">
                            {String(exampleIndex + 1).padStart(2, '0')}
                          </span>
                          <span className="learn-preview-kind">ONE CONCEPT</span>
                          <code>{example.syntax[0]}</code>
                          <span className="learn-preview-mini-result">
                            <i />
                            <i />
                          </span>
                        </div>

                        <div className="learn-example-copy">
                          <div className="template-card-heading">
                            <div>
                              <span>EXAMPLE {String(exampleIndex + 1).padStart(2, '0')}</span>
                              <h3 id={`learn-example-${example.id}`}>{example.name}</h3>
                            </div>
                            <span className="template-node-count">{nodeCount} nodes</span>
                          </div>
                          <p>{example.description}</p>

                          <div className="learn-concepts" aria-label={`${example.name} concepts`}>
                            {example.concepts.map((concept) => (
                              <span key={concept}>
                                <CheckCircle2 size={12} aria-hidden="true" />
                                {concept}
                              </span>
                            ))}
                          </div>

                          <div className="learn-syntax-list" aria-label={`${example.name} syntax`}>
                            {example.syntax.map((syntax) => (
                              <code key={syntax}>{syntax}</code>
                            ))}
                          </div>

                          <button
                            className="template-use-button learn-open-button"
                            type="button"
                            data-learning-primary={exampleIndex === 0 ? 'true' : undefined}
                            aria-label={`Open ${example.name} example`}
                            onClick={() => onUseExample(example)}
                          >
                            Open example
                          </button>
                        </div>
                      </article>
                    );
                  })}
                </div>
              </section>
            ))}
          </div>
        </div>

        <footer className="template-gallery-footer learn-gallery-footer">
          <span>
            Tip: select the page first, change Props, then open JSX to see the React pattern.
          </span>
          <button className="secondary-button" type="button" onClick={onClose}>
            Close
          </button>
        </footer>
      </section>
    </div>
  );
}
