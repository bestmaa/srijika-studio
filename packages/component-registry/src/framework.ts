import type { ValueType } from '@srijika/contracts';

export const SRIJIKA_NEXT_FRAMEWORK_ADAPTER = 'srijika.next-app-router' as const;

export type FrameworkComponentPropType = Exclude<ValueType, 'event' | 'color'>;

export interface FrameworkComponentPropSpec {
  type: FrameworkComponentPropType;
  required: boolean;
  /** Preview prop name. Omit when the prop is validated but intentionally not rendered. */
  previewProp?: string;
}

export type FrameworkComponentPreview =
  | {
      kind: 'container';
      element: 'a' | 'div' | 'section';
    }
  | {
      kind: 'image';
    }
  | {
      kind: 'text';
    };

/**
 * A source-level component contract. Implementations are deliberately absent:
 * the restricted compiler derives only a safe core-component preview.
 */
export interface FrameworkComponentManifest {
  id: string;
  version: number;
  moduleSpecifier: string;
  exportName: string;
  displayName: string;
  props: Readonly<Record<string, FrameworkComponentPropSpec>>;
  children: 'required' | 'optional' | 'forbidden';
  preview: FrameworkComponentPreview;
  source: 'framework' | 'project';
}

export interface FrameworkAdapterManifest {
  id: string;
  version: number;
  framework: string;
  components: readonly FrameworkComponentManifest[];
}

const identifierPattern = /^[A-Za-z_$][A-Za-z0-9_$]*$/;
const componentIdPattern = /^[A-Za-z][A-Za-z0-9_-]*(?:\.[A-Za-z][A-Za-z0-9_-]*)+$/;
const packageSpecifierPattern = /^[A-Za-z@][A-Za-z0-9@._/-]*$/;
const projectSpecifierPattern = /^(?:\.\.?\/|@\/)[A-Za-z0-9._/-]+$/;
const MAX_ADAPTER_COMPONENTS = 128;
const MAX_PROJECT_COMPONENTS = 128;
const MAX_REGISTRY_COMPONENTS = MAX_ADAPTER_COMPONENTS + MAX_PROJECT_COMPONENTS;
const MAX_PROPS = 64;

function allowedPreviewProps(manifest: FrameworkComponentManifest): ReadonlySet<string> {
  const common = ['className', 'style', 'ariaLabel'];
  if (manifest.preview.kind === 'container') {
    return new Set(
      manifest.preview.element === 'a' ? [...common, 'href', 'target', 'rel'] : common,
    );
  }
  if (manifest.preview.kind === 'image') {
    return new Set([...common, 'src', 'alt', 'width', 'height', 'sizes', 'loading', 'fit']);
  }
  return new Set([...common, 'text']);
}

function assertManifest(manifest: FrameworkComponentManifest): void {
  if (!componentIdPattern.test(manifest.id)) {
    throw new Error(`Framework component ID ${manifest.id} must be namespaced.`);
  }
  if (!Number.isInteger(manifest.version) || manifest.version < 1) {
    throw new Error(`Framework component ${manifest.id} must have a positive integer version.`);
  }
  const specifierPattern =
    manifest.source === 'project' ? projectSpecifierPattern : packageSpecifierPattern;
  if (
    !specifierPattern.test(manifest.moduleSpecifier) ||
    manifest.moduleSpecifier.includes('//') ||
    manifest.moduleSpecifier.endsWith('/') ||
    manifest.moduleSpecifier.split('/').some((segment) => segment === '..')
  ) {
    throw new Error(
      `Framework component ${manifest.id} has an invalid ${manifest.source} module specifier.`,
    );
  }
  if (manifest.exportName !== 'default' && !identifierPattern.test(manifest.exportName)) {
    throw new Error(`Framework component ${manifest.id} has an invalid export name.`);
  }
  const props = Object.entries(manifest.props);
  if (props.length > MAX_PROPS) {
    throw new Error(`Framework component ${manifest.id} supports at most ${MAX_PROPS} props.`);
  }
  const previewProps = allowedPreviewProps(manifest);
  for (const [name, prop] of props) {
    if (!identifierPattern.test(name) && name !== 'aria-label') {
      throw new Error(`Framework component ${manifest.id} has invalid prop ${name}.`);
    }
    if (
      prop.previewProp &&
      !identifierPattern.test(prop.previewProp) &&
      prop.previewProp !== 'aria-label'
    ) {
      throw new Error(
        `Framework component ${manifest.id} has invalid preview prop ${prop.previewProp}.`,
      );
    }
    if (prop.previewProp && !previewProps.has(prop.previewProp)) {
      throw new Error(
        `Framework component ${manifest.id} cannot forward unsafe preview prop ${prop.previewProp}.`,
      );
    }
  }
}

function registryKey(moduleSpecifier: string, exportName: string): string {
  return `${moduleSpecifier}\0${exportName}`;
}

export class FrameworkComponentRegistry {
  readonly #components = new Map<string, FrameworkComponentManifest>();
  readonly #componentIds = new Set<string>();
  readonly #adapters = new Map<string, FrameworkAdapterManifest>();

  registerAdapter(adapter: FrameworkAdapterManifest): this {
    if (!componentIdPattern.test(adapter.id)) {
      throw new Error(`Framework adapter ID ${adapter.id} must be namespaced.`);
    }
    if (!Number.isInteger(adapter.version) || adapter.version < 1) {
      throw new Error(`Framework adapter ${adapter.id} must have a positive integer version.`);
    }
    if (this.#adapters.has(adapter.id)) {
      throw new Error(`Framework adapter ${adapter.id} is already registered.`);
    }
    if (adapter.components.length > MAX_ADAPTER_COMPONENTS) {
      throw new Error(
        `Framework adapter ${adapter.id} supports at most ${MAX_ADAPTER_COMPONENTS} components.`,
      );
    }
    for (const component of adapter.components) this.registerComponent(component);
    this.#adapters.set(
      adapter.id,
      Object.freeze({ ...adapter, components: Object.freeze([...adapter.components]) }),
    );
    return this;
  }

  registerComponent(manifest: FrameworkComponentManifest): this {
    assertManifest(manifest);
    if (this.#components.size >= MAX_REGISTRY_COMPONENTS) {
      throw new Error(
        `Framework component registry supports at most ${MAX_REGISTRY_COMPONENTS} components.`,
      );
    }
    const key = registryKey(manifest.moduleSpecifier, manifest.exportName);
    if (this.#components.has(key)) {
      throw new Error(
        `Framework component ${manifest.moduleSpecifier}#${manifest.exportName} is already registered.`,
      );
    }
    if (this.#componentIds.has(manifest.id)) {
      throw new Error(`Framework component ID ${manifest.id} is already registered.`);
    }
    this.#components.set(
      key,
      Object.freeze({ ...manifest, props: Object.freeze({ ...manifest.props }) }),
    );
    this.#componentIds.add(manifest.id);
    return this;
  }

  resolve(moduleSpecifier: string, exportName: string): FrameworkComponentManifest | undefined {
    return this.#components.get(registryKey(moduleSpecifier, exportName));
  }

  adapters(): readonly FrameworkAdapterManifest[] {
    return Object.freeze(
      [...this.#adapters.values()].sort((left, right) => left.id.localeCompare(right.id)),
    );
  }

  components(): readonly FrameworkComponentManifest[] {
    return Object.freeze(
      [...this.#components.values()].sort((left, right) =>
        `${left.moduleSpecifier}#${left.exportName}`.localeCompare(
          `${right.moduleSpecifier}#${right.exportName}`,
        ),
      ),
    );
  }
}

const nextLink: FrameworkComponentManifest = {
  id: 'srijika.next.link',
  version: 1,
  moduleSpecifier: 'next/link',
  exportName: 'default',
  displayName: 'Next Link',
  props: {
    href: { type: 'string', required: true, previewProp: 'href' },
    replace: { type: 'boolean', required: false },
    scroll: { type: 'boolean', required: false },
    prefetch: { type: 'boolean', required: false },
    locale: { type: 'string', required: false },
    target: { type: 'string', required: false, previewProp: 'target' },
    rel: { type: 'string', required: false, previewProp: 'rel' },
    className: { type: 'string', required: false, previewProp: 'className' },
    style: { type: 'object', required: false, previewProp: 'style' },
    'aria-label': { type: 'string', required: false, previewProp: 'ariaLabel' },
  },
  children: 'required',
  preview: { kind: 'container', element: 'a' },
  source: 'framework',
};

const nextImage: FrameworkComponentManifest = {
  id: 'srijika.next.image',
  version: 1,
  moduleSpecifier: 'next/image',
  exportName: 'default',
  displayName: 'Next Image',
  props: {
    src: { type: 'string', required: true, previewProp: 'src' },
    alt: { type: 'string', required: true, previewProp: 'alt' },
    width: { type: 'number', required: false, previewProp: 'width' },
    height: { type: 'number', required: false, previewProp: 'height' },
    fill: { type: 'boolean', required: false },
    sizes: { type: 'string', required: false, previewProp: 'sizes' },
    quality: { type: 'number', required: false },
    priority: { type: 'boolean', required: false },
    loading: { type: 'string', required: false, previewProp: 'loading' },
    className: { type: 'string', required: false, previewProp: 'className' },
    style: { type: 'object', required: false, previewProp: 'style' },
  },
  children: 'forbidden',
  preview: { kind: 'image' },
  source: 'framework',
};

export const NEXT_APP_ROUTER_ADAPTER_V1: FrameworkAdapterManifest = Object.freeze({
  id: SRIJIKA_NEXT_FRAMEWORK_ADAPTER,
  version: 1,
  framework: 'next-app-router',
  components: Object.freeze([nextLink, nextImage]),
});

export function createFrameworkComponentRegistry(
  projectComponents: readonly FrameworkComponentManifest[] = [],
): FrameworkComponentRegistry {
  if (projectComponents.length > MAX_PROJECT_COMPONENTS) {
    throw new Error(
      `A project can register at most ${MAX_PROJECT_COMPONENTS} framework components.`,
    );
  }
  const registry = new FrameworkComponentRegistry().registerAdapter(NEXT_APP_ROUTER_ADAPTER_V1);
  for (const component of projectComponents) {
    if (component.source !== 'project') {
      throw new Error(`Explicit component ${component.id} must use source "project".`);
    }
    registry.registerComponent(component);
  }
  return registry;
}
