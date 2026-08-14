import {
  ArrowDown,
  ArrowUpRight,
  Check,
  CheckCircle2,
  ChevronRight,
  CircleDot,
  FileCode2,
  FolderTree,
  Layers3,
  LockKeyhole,
  ShieldCheck,
  X,
} from 'lucide-react';
import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';

type GuideSection = 'overview' | 'blueprint' | 'runtime' | 'boundaries' | 'checklist';

const GUIDE_SECTIONS: readonly {
  id: GuideSection;
  label: string;
  description: string;
}[] = [
  { id: 'overview', label: 'Overview', description: 'The ownership model' },
  { id: 'blueprint', label: 'Blueprint', description: 'Feature, slot, and part files' },
  { id: 'runtime', label: 'Runtime path', description: 'The progressive capability ladder' },
  { id: 'boundaries', label: 'Boundaries', description: 'Allowed and forbidden access' },
  { id: 'checklist', label: 'Checklist', description: 'What Srijika creates and when' },
];

interface StructureGuideDialogProps {
  onClose: () => void;
  onCreateStructure?: (() => void) | undefined;
}

interface TreeLineProps {
  depth: number;
  icon?: ReactNode;
  name: string;
  badge: 'required' | 'conditional' | 'private';
  note: string;
}

function focusableElements(container: HTMLElement): HTMLElement[] {
  return [
    ...container.querySelectorAll<HTMLElement>(
      'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), [tabindex]',
    ),
  ].filter((element) => element.tabIndex >= 0 && !element.hidden);
}

function TreeLine({ depth, icon, name, badge, note }: TreeLineProps) {
  return (
    <li className="code-first-structure-tree-line" style={{ '--tree-depth': depth } as never}>
      <span className="code-first-structure-tree-rail" aria-hidden="true" />
      <span className="code-first-structure-tree-icon" aria-hidden="true">
        {icon ?? <FileCode2 size={14} />}
      </span>
      <code>{name}</code>
      <span className={`code-first-structure-badge is-${badge}`}>
        {badge === 'required' ? 'Required' : badge === 'conditional' ? 'If required' : 'Private'}
      </span>
      <span>{note}</span>
    </li>
  );
}

function AccessMark({ allowed, label }: { allowed: boolean; label: string }) {
  return (
    <span
      className={`code-first-access-mark ${allowed ? 'is-allowed' : 'is-forbidden'}`}
      aria-label={`${allowed ? 'Allowed' : 'Not allowed'}: ${label}`}
      title={`${allowed ? 'Allowed' : 'Not allowed'}: ${label}`}
    >
      {allowed ? <Check size={15} aria-hidden="true" /> : <X size={15} aria-hidden="true" />}
    </span>
  );
}

function OverviewSection() {
  return (
    <div
      className="code-first-structure-section"
      id="srijika-guide-overview"
      role="tabpanel"
      aria-labelledby="srijika-guide-tab-overview"
    >
      <section className="code-first-structure-hero">
        <div>
          <span className="code-first-dialog-eyebrow">ONE OWNER · ONE DIRECTION</span>
          <h3>Structure that explains itself.</h3>
          <p>
            Every module belongs to the smallest scope that owns it. A parent can serve its
            descendants; a child never leaks into its parent, sibling slot, or another feature.
          </p>
        </div>
        <div className="code-first-scope-orbit" aria-label="Feature ownership flows downward">
          <span className="is-feature">Feature</span>
          <ArrowDown size={18} aria-hidden="true" />
          <span className="is-slot">Slot</span>
          <ArrowDown size={18} aria-hidden="true" />
          <span className="is-part">Part</span>
        </div>
      </section>

      <div className="code-first-structure-principles">
        <article>
          <FileCode2 size={18} aria-hidden="true" />
          <div>
            <h4>UI stays pure</h4>
            <p>
              <code>.ui.tsx</code> renders typed props only. Its matching Connector is the only
              runtime entry allowed to render it.
            </p>
          </div>
        </article>
        <article>
          <Layers3 size={18} aria-hidden="true" />
          <div>
            <h4>Capability creates files</h4>
            <p>
              UI and Connector establish every owner. Hook, Store, Logic, API, and Types appear only
              when that owner needs them.
            </p>
          </div>
        </article>
        <article>
          <ShieldCheck size={18} aria-hidden="true" />
          <div>
            <h4>Boundaries are enforced</h4>
            <p>
              Studio, the VS Code extension, and build validation report imports that cross an
              ownership boundary.
            </p>
          </div>
        </article>
      </div>

      <section className="code-first-downward-rule">
        <div className="code-first-rule-heading">
          <CircleDot size={16} aria-hidden="true" />
          <div>
            <h4>The downward scope rule</h4>
            <p>Read access from left to right, then downward through the owner subtree.</p>
          </div>
        </div>
        <div className="code-first-rule-path" aria-label="Allowed ownership path">
          <span>home.store.ts</span>
          <ChevronRight size={15} aria-hidden="true" />
          <span>Navigation Connector</span>
          <ChevronRight size={15} aria-hidden="true" />
          <span>User Menu Part</span>
          <CheckCircle2 size={17} aria-label="Allowed" />
        </div>
        <div className="code-first-rule-path is-forbidden" aria-label="Forbidden sibling import">
          <span>navigation.store.ts</span>
          <ChevronRight size={15} aria-hidden="true" />
          <span>Header Connector</span>
          <X size={17} aria-label="Not allowed" />
        </div>
      </section>
    </div>
  );
}

function BlueprintSection() {
  return (
    <div
      className="code-first-structure-section"
      id="srijika-guide-blueprint"
      role="tabpanel"
      aria-labelledby="srijika-guide-tab-blueprint"
    >
      <header className="code-first-guide-section-heading">
        <div>
          <span className="code-first-dialog-eyebrow">CANONICAL FEATURE BLUEPRINT</span>
          <h3>Home feature, fully expanded</h3>
          <p>
            Every feature, slot, and part receives a required UI and Connector. Hook, Store, Logic,
            API, and Types remain optional progressive capabilities.
          </p>
        </div>
        <div className="code-first-structure-legend" aria-label="Blueprint legend">
          <span className="code-first-structure-badge is-required">Required</span>
          <span className="code-first-structure-badge is-conditional">If required</span>
          <span className="code-first-structure-badge is-private">Private</span>
        </div>
      </header>

      <div className="code-first-blueprint-layout">
        <section className="code-first-structure-tree" aria-label="Annotated feature file tree">
          <header>
            <FolderTree size={16} aria-hidden="true" />
            <strong>src/features/home</strong>
            <span>HOME OWNER SCOPE</span>
          </header>
          <ul aria-label="Annotated feature file tree">
            <TreeLine
              depth={0}
              name="Home.ui.tsx"
              badge="required"
              note="Pure page layout and typed slot contract"
            />
            <TreeLine
              depth={0}
              name="Home.connector.tsx"
              badge="required"
              note="The only runtime entry allowed to render HomeUI"
            />
            <TreeLine
              depth={0}
              name="useHome.ts"
              badge="conditional"
              note="Senior React lifecycle, query, cache, and orchestration gateway"
            />
            <TreeLine
              depth={0}
              name="home.store.ts"
              badge="conditional"
              note="Shared client state and actions for the complete Home subtree"
            />
            <TreeLine
              depth={0}
              name="home.logic.ts"
              badge="conditional"
              note="Business rules, validation, transformation, and orchestration"
            />
            <TreeLine
              depth={0}
              name="home.api.ts"
              badge="conditional"
              note="HTTP request and response boundary only"
            />
            <TreeLine
              depth={0}
              name="home.types.ts"
              badge="conditional"
              note="Owner-safe contracts shared by the progressive layers"
            />
            <TreeLine
              depth={0}
              icon={<FolderTree size={14} />}
              name="slots/"
              badge="conditional"
              note="Named visual regions owned by Home"
            />
            <TreeLine
              depth={1}
              icon={<FolderTree size={14} />}
              name="navigation/"
              badge="private"
              note="A private slot owner scope"
            />
            <TreeLine
              depth={2}
              name="Navigation.ui.tsx"
              badge="required"
              note="Required after the navigation slot is created"
            />
            <TreeLine
              depth={2}
              name="Navigation.connector.tsx"
              badge="required"
              note="The only runtime entry allowed to render NavigationUI"
            />
            <TreeLine
              depth={2}
              name="useNavigation.ts"
              badge="conditional"
              note="Navigation React lifecycle, query, cache, and orchestration"
            />
            <TreeLine
              depth={2}
              name="navigation.store.ts"
              badge="conditional"
              note="Shared state for Navigation and its parts only"
            />
            <TreeLine
              depth={2}
              name="navigation.logic.ts"
              badge="conditional"
              note="Navigation business rules and transformations"
            />
            <TreeLine
              depth={2}
              name="navigation.api.ts"
              badge="conditional"
              note="Navigation server communication"
            />
            <TreeLine
              depth={2}
              name="navigation.types.ts"
              badge="conditional"
              note="Navigation-owned contracts"
            />
            <TreeLine
              depth={2}
              icon={<FolderTree size={14} />}
              name="parts/"
              badge="conditional"
              note="Meaningful visual units when Navigation grows"
            />
            <TreeLine
              depth={3}
              name="UserMenu.ui.tsx"
              badge="required"
              note="Required after the UserMenu part is created"
            />
            <TreeLine
              depth={3}
              name="UserMenu.connector.tsx"
              badge="required"
              note="The only runtime entry allowed to render UserMenuUI"
            />
            <TreeLine
              depth={3}
              name="useUserMenu.ts"
              badge="conditional"
              note="Part-local React lifecycle and orchestration"
            />
            <TreeLine
              depth={3}
              name="userMenu.store.ts"
              badge="conditional"
              note="State private to UserMenu only"
            />
            <TreeLine
              depth={3}
              name="userMenu.logic.ts"
              badge="conditional"
              note="Business behavior private to UserMenu"
            />
            <TreeLine
              depth={3}
              name="userMenu.api.ts"
              badge="conditional"
              note="Server communication private to UserMenu"
            />
            <TreeLine
              depth={3}
              name="userMenu.types.ts"
              badge="conditional"
              note="Contracts private to UserMenu"
            />
          </ul>
        </section>

        <aside className="code-first-blueprint-notes" aria-label="Blueprint explanations">
          <article>
            <span>01</span>
            <div>
              <h4>Feature root</h4>
              <p>
                The root stays flat and readable: UI, Connector, optional progressive behavior
                files, and slots.
              </p>
            </div>
          </article>
          <article>
            <span>02</span>
            <div>
              <h4>Slot owner</h4>
              <p>
                A slot is a named region such as Navigation, Header, Hero, Body, or Footer. Its UI
                is required only after the slot exists.
              </p>
            </div>
          </article>
          <article>
            <span>03</span>
            <div>
              <h4>Part owner</h4>
              <p>
                Parts are optional. Create one only when a large slot contains a meaningful visual
                unit such as User Menu—not for every div or button.
              </p>
            </div>
          </article>
          <article>
            <span>04</span>
            <div>
              <h4>Promotion, never leakage</h4>
              <p>
                If Header also needs Navigation state, move that state to <code>home.store.ts</code>
                instead of importing sideways.
              </p>
            </div>
          </article>
        </aside>
      </div>
    </div>
  );
}

function RuntimeSection() {
  return (
    <div
      className="code-first-structure-section"
      id="srijika-guide-runtime"
      role="tabpanel"
      aria-labelledby="srijika-guide-tab-runtime"
    >
      <header className="code-first-guide-section-heading">
        <div>
          <span className="code-first-dialog-eyebrow">HIGHEST AVAILABLE CAPABILITY</span>
          <h3>Use the senior layer. Never jump an existing layer.</h3>
          <p>
            Each owner resolves one progressive path. Missing capabilities collapse naturally; an
            existing intermediate capability becomes mandatory for that owner&apos;s runtime path.
          </p>
        </div>
      </header>

      <section
        className="code-first-downward-rule"
        aria-label="Progressive runtime capability path"
      >
        <div className="code-first-rule-heading">
          <CircleDot size={16} aria-hidden="true" />
          <div>
            <h4>Complete owner path</h4>
            <p>Commands travel right. Results return through the same owner boundary.</p>
          </div>
        </div>
        <div className="code-first-rule-path">
          <span>Connector</span>
          <ChevronRight size={15} aria-hidden="true" />
          <span>Hook</span>
          <ChevronRight size={15} aria-hidden="true" />
          <span>Store</span>
          <ChevronRight size={15} aria-hidden="true" />
          <span>Logic</span>
          <ChevronRight size={15} aria-hidden="true" />
          <span>API</span>
          <CheckCircle2 size={17} aria-label="Allowed" />
        </div>
      </section>

      <div className="code-first-boundary-cards">
        <article>
          <Layers3 size={17} aria-hidden="true" />
          <div>
            <h4>Fallback examples</h4>
            <p>
              <code>Hook absent</code>: Connector → Store → Logic → API
            </p>
            <p>
              <code>Hook + Store absent</code>: Connector → Logic → API
            </p>
            <p>
              <code>Only API exists</code>: Connector → API
            </p>
          </div>
        </article>
        <article>
          <LockKeyhole size={17} aria-hidden="true" />
          <div>
            <h4>No-jump enforcement</h4>
            <p>If Hook exists, Connector cannot import Store, Logic, or API directly.</p>
            <p>If Logic exists below Store, Store cannot skip it to import API.</p>
          </div>
        </article>
      </div>

      <section className="code-first-diagnostic-preview" aria-label="Architecture recommendations">
        <span>SMART GUIDE</span>
        <div>
          <strong>Recommendations stay deterministic and reviewable.</strong>
          <p>
            Srijika recommends Logic for branching, validation, transforms, or multiple API calls;
            Hook for lifecycle, cache, retry, polling, subscriptions, or a heavy Store surface; and
            Store when state is shared by multiple descendants. Recommendations do not rewrite code.
          </p>
        </div>
      </section>
    </div>
  );
}

const ACCESS_ROWS = [
  {
    module: 'home.store.ts',
    scope: 'Home subtree',
    access: [true, true, true, true, true, false],
  },
  {
    module: 'home/hooks/*',
    scope: 'Home subtree',
    access: [true, true, true, true, true, false],
  },
  {
    module: 'navigation.store.ts',
    scope: 'Navigation subtree',
    access: [false, true, true, true, false, false],
  },
  {
    module: 'navigation/hooks/*',
    scope: 'Navigation subtree',
    access: [false, true, true, true, false, false],
  },
  {
    module: 'UserMenu.ui.tsx',
    scope: 'Public part UI entry',
    access: [false, true, true, false, false, false],
  },
  {
    module: 'userMenu.store.ts',
    scope: 'UserMenu only',
    access: [false, false, true, false, false, false],
  },
  {
    module: 'user-menu/hooks/*',
    scope: 'UserMenu only',
    access: [false, false, true, false, false, false],
  },
] as const;

const ACCESS_COLUMNS = [
  'Home',
  'Navigation',
  'UserMenu',
  'Sibling part',
  'Header',
  'Other feature',
] as const;

function BoundariesSection() {
  return (
    <div
      className="code-first-structure-section"
      id="srijika-guide-boundaries"
      role="tabpanel"
      aria-labelledby="srijika-guide-tab-boundaries"
    >
      <header className="code-first-guide-section-heading">
        <div>
          <span className="code-first-dialog-eyebrow">ENFORCED OWNERSHIP</span>
          <h3>Access travels downward, never sideways.</h3>
          <p>
            Parent modules may serve their descendants. Private slot modules cannot be imported by a
            parent, sibling slot, or another feature.
          </p>
        </div>
        <div className="code-first-access-legend">
          <span>
            <AccessMark allowed label="Allowed" /> Allowed
          </span>
          <span>
            <AccessMark allowed={false} label="Not allowed" /> Not allowed
          </span>
        </div>
      </header>

      <div className="code-first-access-table-scroll">
        <table className="code-first-access-table">
          <caption>Owner scope import permissions</caption>
          <thead>
            <tr>
              <th scope="col">Owned module</th>
              <th scope="col">Scope</th>
              {ACCESS_COLUMNS.map((column) => (
                <th key={column} scope="col">
                  {column}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {ACCESS_ROWS.map((row) => (
              <tr key={row.module}>
                <th scope="row">
                  <code>{row.module}</code>
                </th>
                <td>{row.scope}</td>
                {row.access.map((allowed, index) => (
                  <td key={ACCESS_COLUMNS[index]}>
                    <AccessMark
                      allowed={allowed}
                      label={`${row.module} in ${ACCESS_COLUMNS[index]}`}
                    />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="code-first-boundary-cards">
        <article>
          <LockKeyhole size={17} aria-hidden="true" />
          <div>
            <h4>Pure UI rule</h4>
            <div
              className="code-first-flow-line"
              aria-label="Store and hooks flow through a connector into UI props"
            >
              <span>Highest available layer</span>
              <ChevronRight size={14} aria-hidden="true" />
              <span>Connector</span>
              <ChevronRight size={14} aria-hidden="true" />
              <span>Typed UI props</span>
            </div>
            <p>
              A <code>.ui.tsx</code> file never imports Hook, Store, Logic, or API directly.
            </p>
          </div>
        </article>
        <article>
          <ArrowUpRight size={17} aria-hidden="true" />
          <div>
            <h4>Promotion rule</h4>
            <div className="code-first-promotion-example">
              <code>slots/navigation/navigation.store.ts</code>
              <ArrowUpRight size={14} aria-hidden="true" />
              <code>home.store.ts</code>
            </div>
            <p>When siblings need the same state, move ownership to their nearest common parent.</p>
          </div>
        </article>
      </div>

      <section className="code-first-diagnostic-preview" aria-label="Example boundary diagnostic">
        <span>SRIJIKA4103</span>
        <div>
          <strong>Header cannot import Navigation&apos;s private store.</strong>
          <p>
            Promote shared state to <code>home.store.ts</code>, then import it from both slots.
          </p>
        </div>
      </section>
    </div>
  );
}

function ChecklistItem({ required, children }: { required?: boolean; children: ReactNode }) {
  return (
    <li>
      <span className={required ? 'is-required' : 'is-conditional'}>
        {required ? 'Required' : 'If required'}
      </span>
      <div>{children}</div>
    </li>
  );
}

function ChecklistSection() {
  return (
    <div
      className="code-first-structure-section"
      id="srijika-guide-checklist"
      role="tabpanel"
      aria-labelledby="srijika-guide-tab-checklist"
    >
      <header className="code-first-guide-section-heading">
        <div>
          <span className="code-first-dialog-eyebrow">CREATION CHECKLIST</span>
          <h3>Create only what the capability needs.</h3>
          <p>
            Srijika asks for the capability, derives the correct owner folder, and previews the
            exact files before writing.
          </p>
        </div>
      </header>

      <div className="code-first-checklist-grid">
        <section>
          <header>
            <span>01</span>
            <div>
              <h4>New feature</h4>
              <p>Example: Home</p>
            </div>
          </header>
          <ul>
            <ChecklistItem required>
              <code>Home.ui.tsx</code>
              <small>Pure visual contract and layout</small>
            </ChecklistItem>
            <ChecklistItem required>
              <code>Home.connector.tsx</code>
              <small>Only runtime entry that renders HomeUI</small>
            </ChecklistItem>
            <ChecklistItem>
              <code>useHome.ts</code>
              <small>React lifecycle, server cache, and orchestration</small>
            </ChecklistItem>
            <ChecklistItem>
              <code>home.store.ts</code>
              <small>State shared across Home descendants</small>
            </ChecklistItem>
            <ChecklistItem>
              <code>home.logic.ts</code>
              <small>Business rules, validation, and transformation</small>
            </ChecklistItem>
            <ChecklistItem>
              <code>home.api.ts</code>
              <small>HTTP communication only</small>
            </ChecklistItem>
            <ChecklistItem>
              <code>home.types.ts</code>
              <small>Owner-safe contracts</small>
            </ChecklistItem>
            <ChecklistItem>
              <code>slots/</code>
              <small>Named visual regions</small>
            </ChecklistItem>
          </ul>
        </section>

        <section>
          <header>
            <span>02</span>
            <div>
              <h4>New slot</h4>
              <p>Example: Navigation</p>
            </div>
          </header>
          <ul>
            <ChecklistItem required>
              <code>Navigation.ui.tsx</code>
              <small>Pure slot UI after the slot exists</small>
            </ChecklistItem>
            <ChecklistItem required>
              <code>Navigation.connector.tsx</code>
              <small>Only runtime entry that renders NavigationUI</small>
            </ChecklistItem>
            <ChecklistItem>
              <code>useNavigation.ts</code>
              <small>Slot React lifecycle and server cache</small>
            </ChecklistItem>
            <ChecklistItem>
              <code>navigation.store.ts</code>
              <small>State shared within Navigation</small>
            </ChecklistItem>
            <ChecklistItem>
              <code>navigation.logic.ts / .api.ts / .types.ts</code>
              <small>Progressive private behavior capabilities</small>
            </ChecklistItem>
            <ChecklistItem>
              <code>parts/</code>
              <small>Meaningful units when the slot grows</small>
            </ChecklistItem>
          </ul>
        </section>

        <section>
          <header>
            <span>03</span>
            <div>
              <h4>New private part</h4>
              <p>Example: UserMenu</p>
            </div>
          </header>
          <ul>
            <ChecklistItem required>
              <code>UserMenu.ui.tsx</code>
              <small>Pure part UI after the part exists</small>
            </ChecklistItem>
            <ChecklistItem required>
              <code>UserMenu.connector.tsx</code>
              <small>Only runtime entry that renders UserMenuUI</small>
            </ChecklistItem>
            <ChecklistItem>
              <code>useUserMenu.ts</code>
              <small>Part-local React lifecycle and server cache</small>
            </ChecklistItem>
            <ChecklistItem>
              <code>userMenu.store.ts</code>
              <small>State private to this exact part</small>
            </ChecklistItem>
            <ChecklistItem>
              <code>userMenu.logic.ts / .api.ts / .types.ts</code>
              <small>Progressive behavior private to this exact part</small>
            </ChecklistItem>
          </ul>
        </section>

        <section>
          <header>
            <span>04</span>
            <div>
              <h4>Boundary review</h4>
              <p>Before a module moves</p>
            </div>
          </header>
          <ul className="is-rule-list">
            <li>
              <CheckCircle2 size={15} />
              <span>Owner and descendants may import it.</span>
            </li>
            <li>
              <X size={15} />
              <span>Parent, sibling, and other features may not.</span>
            </li>
            <li>
              <ArrowUpRight size={15} />
              <span>Promote shared behavior to the nearest common owner.</span>
            </li>
            <li>
              <ShieldCheck size={15} />
              <span>Keep stores and hooks out of pure UI files.</span>
            </li>
          </ul>
        </section>
      </div>
    </div>
  );
}

export function StructureGuideDialog({ onClose, onCreateStructure }: StructureGuideDialogProps) {
  const dialogRef = useRef<HTMLElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const tabRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const [section, setSection] = useState<GuideSection>('overview');

  useEffect(() => {
    const previousFocus =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    closeRef.current?.focus();
    const handleEscape = (event: globalThis.KeyboardEvent): void => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleEscape);
    return () => {
      window.removeEventListener('keydown', handleEscape);
      previousFocus?.focus();
    };
  }, [onClose]);

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
      className="code-first-dialog-backdrop code-first-structure-backdrop"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <section
        ref={dialogRef}
        className="code-first-structure-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="srijika-structure-title"
        aria-describedby="srijika-structure-description"
        onKeyDown={trapFocus}
      >
        <header className="code-first-structure-header">
          <div className="code-first-structure-mark" aria-hidden="true">
            <FolderTree size={21} />
          </div>
          <div>
            <span className="code-first-dialog-eyebrow">SRIJIKA ARCHITECTURE GUIDE</span>
            <h2 id="srijika-structure-title">Feature ownership structure</h2>
            <p id="srijika-structure-description">
              Required UI and Connector ownership with an optional Hook → Store → Logic → API
              runtime path at every feature, slot, and part.
            </p>
          </div>
          <button
            ref={closeRef}
            type="button"
            className="code-first-dialog-close"
            aria-label="Close structure guide"
            onClick={onClose}
          >
            <X size={18} />
          </button>
        </header>

        <div className="code-first-structure-body">
          <nav
            className="code-first-structure-nav"
            aria-label="Structure guide sections"
            role="tablist"
          >
            {GUIDE_SECTIONS.map((item) => (
              <button
                key={item.id}
                ref={(element) => {
                  tabRefs.current[
                    GUIDE_SECTIONS.findIndex((candidate) => candidate.id === item.id)
                  ] = element;
                }}
                id={`srijika-guide-tab-${item.id}`}
                type="button"
                role="tab"
                className={section === item.id ? 'is-active' : undefined}
                aria-selected={section === item.id}
                aria-controls={`srijika-guide-${item.id}`}
                tabIndex={section === item.id ? 0 : -1}
                onClick={() => setSection(item.id)}
                onKeyDown={(event) => {
                  const currentIndex = GUIDE_SECTIONS.findIndex(
                    (candidate) => candidate.id === item.id,
                  );
                  let nextIndex: number | null = null;
                  if (event.key === 'ArrowDown' || event.key === 'ArrowRight') {
                    nextIndex = (currentIndex + 1) % GUIDE_SECTIONS.length;
                  } else if (event.key === 'ArrowUp' || event.key === 'ArrowLeft') {
                    nextIndex = (currentIndex - 1 + GUIDE_SECTIONS.length) % GUIDE_SECTIONS.length;
                  } else if (event.key === 'Home') {
                    nextIndex = 0;
                  } else if (event.key === 'End') {
                    nextIndex = GUIDE_SECTIONS.length - 1;
                  }
                  if (nextIndex === null) return;
                  event.preventDefault();
                  const nextSection = GUIDE_SECTIONS[nextIndex];
                  if (!nextSection) return;
                  setSection(nextSection.id);
                  tabRefs.current[nextIndex]?.focus();
                }}
              >
                <span>{item.label}</span>
                <small>{item.description}</small>
                <ChevronRight size={15} aria-hidden="true" />
              </button>
            ))}
            <div className="code-first-structure-nav-note">
              <ShieldCheck size={16} aria-hidden="true" />
              <p>
                <strong>One rule everywhere.</strong> Studio, VS Code, and builds use the same
                ownership model.
              </p>
            </div>
          </nav>

          <main className="code-first-structure-content">
            {section === 'overview' ? <OverviewSection /> : null}
            {section === 'blueprint' ? <BlueprintSection /> : null}
            {section === 'runtime' ? <RuntimeSection /> : null}
            {section === 'boundaries' ? <BoundariesSection /> : null}
            {section === 'checklist' ? <ChecklistSection /> : null}
          </main>
        </div>

        <footer className="code-first-structure-footer">
          <p>
            <strong>Remember:</strong> when two sibling scopes need the same module, promote
            it—never import sideways.
          </p>
          <div>
            {onCreateStructure ? (
              <button type="button" className="is-primary" onClick={onCreateStructure}>
                Create a new feature
              </button>
            ) : null}
            <button type="button" onClick={onClose}>
              Done
            </button>
          </div>
        </footer>
      </section>
    </div>
  );
}
