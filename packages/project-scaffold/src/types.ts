export type SrijikaProjectFileMap = Readonly<Record<string, string>>;

export interface SrijikaProjectScaffoldOptions {
  /** A valid, unscoped npm package name. */
  projectName?: string;
  /** Human-readable application name used by the starter UI. */
  displayName?: string;
  /** Marketplace identifier recommended when the project opens in VS Code. */
  vscodeExtensionId?: string;
  /** Add TanStack React Query and its application provider. Defaults to false. */
  reactQuery?: boolean;
}

export interface WriteSrijikaProjectResult {
  absoluteTarget: string;
  files: readonly string[];
}

export type SrijikaUiSourceKind = 'page' | 'component';

export interface SrijikaUiSourcePairOptions {
  /** The visual contract being scaffolded. Pages use a main landmark. */
  kind: SrijikaUiSourceKind;
  /** A PascalCase TypeScript identifier, for example `PricingPage` or `UserCard`. */
  componentName: string;
}

export interface SrijikaUiSourcePair {
  kind: SrijikaUiSourceKind;
  componentName: string;
  uiFileName: string;
  connectorFileName: string;
  uiSource: string;
  connectorSource: string;
}
