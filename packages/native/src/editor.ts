/** Static Native entry point for editor hosts. No runtime, scaffold or UI dependencies. */
export { compileSrijikaNativeTsx } from './compiler.js';
export { NATIVE_COMPONENTS, nativeStyleProperties } from './registry.js';
export {
  assertNativePackage,
  nativeRuntimeDiagnostics,
  parseNativeProjectConfig,
  parseNativeTypeScriptPathAliases,
} from './profile.js';
export type {
  NativeCompileResult,
  NativeDiagnostic,
  NativeProjectConfig,
  NativeSourceSpan,
  NativeUiDocument,
  NativeUiNode,
} from './types.js';
