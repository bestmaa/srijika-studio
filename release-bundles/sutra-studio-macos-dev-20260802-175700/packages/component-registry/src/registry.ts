import { COMMON_REACT_PROPS, type ComponentDefinition, type ComponentManifest } from './types';

const componentIdPattern = /^[A-Za-z][A-Za-z0-9_-]*(?:\.[A-Za-z][A-Za-z0-9_-]*)+$/;
const javascriptIdentifierPattern = /^[A-Za-z_$][A-Za-z0-9_$]*$/;

function assertValidManifest(manifest: ComponentManifest): void {
  if (!componentIdPattern.test(manifest.id)) {
    throw new Error(`Component ID ${manifest.id} must be a namespaced identifier`);
  }
  if (!Number.isInteger(manifest.version) || manifest.version < 1) {
    throw new Error(`Component ${manifest.id} must have a positive integer version`);
  }
  for (const propName of Object.keys(manifest.props)) {
    if (!javascriptIdentifierPattern.test(propName)) {
      throw new Error(`Component ${manifest.id} has invalid prop name ${propName}`);
    }
  }
  for (const eventName of Object.keys(manifest.events)) {
    if (!javascriptIdentifierPattern.test(eventName)) {
      throw new Error(`Component ${manifest.id} has invalid event name ${eventName}`);
    }
  }
}

export class ComponentRegistry<TImplementation = unknown> {
  readonly #definitions = new Map<string, ComponentDefinition<TImplementation>>();

  register(definition: ComponentDefinition<TImplementation>): this {
    const manifest: ComponentManifest = {
      ...definition.manifest,
      props: { ...definition.manifest.props, ...COMMON_REACT_PROPS },
    };
    assertValidManifest(manifest);
    if (this.#definitions.has(manifest.id)) {
      throw new Error(`Component ${manifest.id} is already registered`);
    }
    this.#definitions.set(manifest.id, { ...definition, manifest });
    return this;
  }

  get(componentId: string): ComponentDefinition<TImplementation> | undefined {
    return this.#definitions.get(componentId);
  }

  require(componentId: string): ComponentDefinition<TImplementation> {
    const definition = this.get(componentId);
    if (!definition) throw new Error(`Unknown component ${componentId}`);
    return definition;
  }

  manifests(): ComponentManifest[] {
    return [...this.#definitions.values()]
      .map((definition) => definition.manifest)
      .sort((left, right) =>
        `${left.category}/${left.displayName}`.localeCompare(
          `${right.category}/${right.displayName}`,
        ),
      );
  }

  definitions(): ComponentDefinition<TImplementation>[] {
    return [...this.#definitions.values()];
  }
}
