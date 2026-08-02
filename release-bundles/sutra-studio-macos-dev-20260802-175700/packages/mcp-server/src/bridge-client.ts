import { readFile, stat } from 'node:fs/promises';
import { homedir, platform } from 'node:os';
import { join, resolve, win32 } from 'node:path';

import { PROTOCOL_VERSION } from '@sutra/automation-protocol';

const DESCRIPTOR_FILE_NAME = 'codex-bridge-v1.json';
const DEFAULT_TIMEOUT_MS = 30_000;

export interface BridgeDescriptor {
  schemaVersion?: number;
  protocolVersion: string;
  endpoint: string;
  token: string;
  pid: number;
  healthPath?: string;
  appName?: string;
  appVersion?: string;
  startedAtUnixMs?: number;
  instanceId?: string;
}

export interface BridgeRpcError {
  code: string;
  message: string;
  retryable?: boolean;
  details?: unknown;
}

interface BridgeRpcSuccess<T> {
  ok: true;
  protocolVersion: string;
  requestId: string;
  result: T;
}

interface BridgeRpcFailure {
  ok: false;
  protocolVersion: string;
  requestId?: string;
  error: BridgeRpcError;
}

type BridgeRpcResponse<T> = BridgeRpcSuccess<T> | BridgeRpcFailure;

export interface SutraBridgeClientOptions {
  descriptorPath?: string;
  /** Ordered implicit discovery paths. Primarily useful for launchers and tests. */
  discoveryPaths?: readonly string[];
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
  environment?: NodeJS.ProcessEnv;
  homeDirectory?: string;
  operatingSystem?: NodeJS.Platform;
}

export class SutraBridgeError extends Error {
  readonly code: string;
  readonly retryable: boolean;
  readonly details: unknown;

  constructor(error: BridgeRpcError, options?: ErrorOptions) {
    super(error.message, options);
    this.name = 'SutraBridgeError';
    this.code = error.code;
    this.retryable = error.retryable ?? false;
    this.details = error.details;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function validateDescriptor(value: unknown, source: string): BridgeDescriptor {
  if (!isRecord(value)) {
    throw new SutraBridgeError({
      code: 'invalid_bridge_descriptor',
      message: `Sutra Studio bridge descriptor at ${source} is not a JSON object.`,
    });
  }

  const endpoint = value['endpoint'];
  const token = value['token'];
  const descriptorProtocolVersion = value['protocolVersion'];
  const pid = value['pid'];
  if (
    typeof endpoint !== 'string' ||
    typeof token !== 'string' ||
    typeof descriptorProtocolVersion !== 'string' ||
    typeof pid !== 'number'
  ) {
    throw new SutraBridgeError({
      code: 'invalid_bridge_descriptor',
      message: `Sutra Studio bridge descriptor at ${source} is missing required fields.`,
    });
  }
  if (descriptorProtocolVersion !== PROTOCOL_VERSION) {
    throw new SutraBridgeError({
      code: 'unsupported_protocol_version',
      message: `Sutra Studio bridge uses protocol ${descriptorProtocolVersion}; this plugin requires ${PROTOCOL_VERSION}.`,
      details: { expected: PROTOCOL_VERSION, actual: descriptorProtocolVersion },
    });
  }

  let parsedEndpoint: URL;
  try {
    parsedEndpoint = new URL(endpoint);
  } catch (cause) {
    throw new SutraBridgeError(
      {
        code: 'invalid_bridge_descriptor',
        message: `Sutra Studio bridge endpoint at ${source} is invalid.`,
      },
      { cause },
    );
  }
  if (
    parsedEndpoint.protocol !== 'http:' ||
    !['127.0.0.1', 'localhost', '[::1]'].includes(parsedEndpoint.hostname)
  ) {
    throw new SutraBridgeError({
      code: 'unsafe_bridge_endpoint',
      message: 'Sutra Studio bridge must use a loopback HTTP endpoint.',
    });
  }
  if (token.length < 43) {
    throw new SutraBridgeError({
      code: 'invalid_bridge_descriptor',
      message: 'Sutra Studio bridge token is malformed.',
    });
  }

  return {
    ...(typeof value['schemaVersion'] === 'number'
      ? { schemaVersion: value['schemaVersion'] }
      : {}),
    protocolVersion: descriptorProtocolVersion,
    endpoint: parsedEndpoint.origin,
    token,
    pid,
    ...(typeof value['healthPath'] === 'string' ? { healthPath: value['healthPath'] } : {}),
    ...(typeof value['appName'] === 'string' ? { appName: value['appName'] } : {}),
    ...(typeof value['appVersion'] === 'string' ? { appVersion: value['appVersion'] } : {}),
    ...(typeof value['startedAtUnixMs'] === 'number'
      ? { startedAtUnixMs: value['startedAtUnixMs'] }
      : {}),
    ...(typeof value['instanceId'] === 'string' ? { instanceId: value['instanceId'] } : {}),
  };
}

export function descriptorCandidates(options: SutraBridgeClientOptions = {}): string[] {
  const environment = options.environment ?? process.env;
  const explicit = options.descriptorPath ?? environment['SUTRA_STUDIO_BRIDGE_DESCRIPTOR'];
  if (explicit) return [resolve(explicit)];
  if (options.discoveryPaths) return options.discoveryPaths.map((candidate) => resolve(candidate));

  const currentPlatform = options.operatingSystem ?? platform();
  const userHome = options.homeDirectory ?? homedir();
  if (currentPlatform === 'win32') {
    const localAppData = environment['LOCALAPPDATA'];
    const windowsUser = environment['SUTRA_STUDIO_WSL_USER'] ?? win32.basename(userHome);
    const wslDistribution = environment['SUTRA_STUDIO_WSL_DISTRO'] ?? 'Ubuntu';
    const wslDataHome =
      environment['SUTRA_STUDIO_WSL_DATA_HOME'] ??
      win32.join(`\\\\wsl.localhost\\${wslDistribution}`, 'home', windowsUser, '.local', 'share');
    return [
      ...(localAppData
        ? [win32.join(localAppData, 'studio.sutra.desktop', DESCRIPTOR_FILE_NAME)]
        : []),
      win32.join(wslDataHome, 'studio.sutra.desktop', DESCRIPTOR_FILE_NAME),
    ];
  }
  if (currentPlatform === 'darwin') {
    return [
      join(
        userHome,
        'Library',
        'Application Support',
        'studio.sutra.desktop',
        DESCRIPTOR_FILE_NAME,
      ),
    ];
  }

  const localData = environment['XDG_DATA_HOME'] ?? join(userHome, '.local', 'share');
  return [join(localData, 'studio.sutra.desktop', DESCRIPTOR_FILE_NAME)];
}

async function readDescriptor(candidate: string): Promise<BridgeDescriptor | null> {
  try {
    const metadata = await stat(candidate);
    if (!metadata.isFile()) return null;
    const value: unknown = JSON.parse(await readFile(candidate, 'utf8'));
    return validateDescriptor(value, candidate);
  } catch (error) {
    if (isRecord(error) && error['code'] === 'ENOENT') return null;
    if (error instanceof SyntaxError) {
      throw new SutraBridgeError(
        {
          code: 'invalid_bridge_descriptor',
          message: `Sutra Studio bridge descriptor at ${candidate} contains invalid JSON.`,
        },
        { cause: error },
      );
    }
    throw error;
  }
}

function rpcPath(endpoint: string): string {
  return new URL('/v1/rpc', `${endpoint}/`).toString();
}

async function assertHealthy(
  descriptor: BridgeDescriptor,
  fetchImpl: typeof fetch,
  signal: AbortSignal,
): Promise<void> {
  const response = await fetchImpl(
    new URL(descriptor.healthPath ?? '/v1/health', `${descriptor.endpoint}/`),
    {
      method: 'GET',
      headers: {
        accept: 'application/json',
        authorization: `Bearer ${descriptor.token}`,
      },
      signal,
    },
  );
  const body: unknown = await response.json().catch(() => null);
  if (!response.ok || !isRecord(body) || body['ok'] !== true) {
    throw new SutraBridgeError({
      code: 'bridge_health_failed',
      message: `Sutra Studio bridge health check failed with HTTP ${response.status}.`,
      retryable: true,
    });
  }
  if (
    (descriptor.instanceId && body['instanceId'] !== descriptor.instanceId) ||
    body['pid'] !== descriptor.pid
  ) {
    throw new SutraBridgeError({
      code: 'stale_bridge_descriptor',
      message: 'The Sutra Studio bridge descriptor belongs to an old process.',
      retryable: true,
    });
  }
  if (body['frontendReady'] !== true) {
    throw new SutraBridgeError({
      code: 'frontend_not_ready',
      message: 'Sutra Studio is running but its editor bridge is still initializing.',
      retryable: true,
    });
  }
}

function parseResponse<T>(value: unknown): BridgeRpcResponse<T> {
  if (!isRecord(value) || typeof value['ok'] !== 'boolean') {
    throw new SutraBridgeError({
      code: 'invalid_bridge_response',
      message: 'Sutra Studio returned an invalid bridge response.',
    });
  }
  if (value['ok']) {
    if (typeof value['requestId'] !== 'string' || !('result' in value)) {
      throw new SutraBridgeError({
        code: 'invalid_bridge_response',
        message: 'Sutra Studio returned an incomplete success response.',
      });
    }
    return {
      ok: true,
      protocolVersion:
        typeof value['protocolVersion'] === 'string' ? value['protocolVersion'] : PROTOCOL_VERSION,
      requestId: value['requestId'],
      result: value['result'] as T,
    };
  }

  const rawError = value['error'];
  if (!isRecord(rawError) || typeof rawError['code'] !== 'string') {
    throw new SutraBridgeError({
      code: 'invalid_bridge_response',
      message: 'Sutra Studio returned an incomplete error response.',
    });
  }
  return {
    ok: false,
    protocolVersion:
      typeof value['protocolVersion'] === 'string' ? value['protocolVersion'] : PROTOCOL_VERSION,
    ...(typeof value['requestId'] === 'string' ? { requestId: value['requestId'] } : {}),
    error: {
      code: rawError['code'],
      message:
        typeof rawError['message'] === 'string'
          ? rawError['message']
          : 'Sutra Studio rejected the request.',
      ...(typeof rawError['retryable'] === 'boolean' ? { retryable: rawError['retryable'] } : {}),
      ...('details' in rawError ? { details: rawError['details'] } : {}),
    },
  };
}

function normalizedCallError(error: unknown): SutraBridgeError {
  if (error instanceof SutraBridgeError) return error;
  if (error instanceof Error && error.name === 'AbortError') {
    return new SutraBridgeError({
      code: 'bridge_timeout',
      message: 'Sutra Studio did not answer before the local bridge timeout.',
      retryable: true,
    });
  }
  return new SutraBridgeError(
    {
      code: 'bridge_unreachable',
      message: 'Could not reach the authenticated Sutra Studio bridge.',
      retryable: true,
    },
    { cause: error },
  );
}

function canTryNextImplicitDescriptor(error: SutraBridgeError): boolean {
  return ['stale_bridge_descriptor', 'bridge_unreachable', 'bridge_timeout'].includes(error.code);
}

async function callDescriptor<T>(
  descriptor: BridgeDescriptor,
  method: string,
  params: unknown,
  options: SutraBridgeClientOptions,
): Promise<T> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), options.timeoutMs ?? DEFAULT_TIMEOUT_MS);

  try {
    const fetchImpl = options.fetchImpl ?? fetch;
    await assertHealthy(descriptor, fetchImpl, controller.signal);
    const response = await fetchImpl(rpcPath(descriptor.endpoint), {
      method: 'POST',
      headers: {
        accept: 'application/json',
        authorization: `Bearer ${descriptor.token}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        protocolVersion: PROTOCOL_VERSION,
        method,
        params,
      }),
      signal: controller.signal,
    });
    const body: unknown = await response.json().catch(() => null);
    const parsed = parseResponse<T>(body);
    if (!parsed.ok) throw new SutraBridgeError(parsed.error);
    if (!response.ok) {
      throw new SutraBridgeError({
        code: 'bridge_http_error',
        message: `Sutra Studio bridge returned HTTP ${response.status}.`,
        retryable: response.status >= 500,
      });
    }
    return parsed.result;
  } catch (error) {
    throw normalizedCallError(error);
  } finally {
    clearTimeout(timeout);
  }
}

export class SutraBridgeClient {
  readonly #options: SutraBridgeClientOptions;

  constructor(options: SutraBridgeClientOptions = {}) {
    this.#options = options;
  }

  async call<T>(method: string, params: unknown = {}): Promise<T> {
    const candidates = descriptorCandidates(this.#options);
    const environment = this.#options.environment ?? process.env;
    const explicit = Boolean(
      this.#options.descriptorPath ?? environment['SUTRA_STUDIO_BRIDGE_DESCRIPTOR'],
    );
    let lastRecoverableError: SutraBridgeError | null = null;

    for (const candidate of candidates) {
      const descriptor = await readDescriptor(candidate);
      if (!descriptor) continue;
      try {
        return await callDescriptor<T>(descriptor, method, params, this.#options);
      } catch (error) {
        const normalized = normalizedCallError(error);
        if (!explicit && canTryNextImplicitDescriptor(normalized)) {
          lastRecoverableError = normalized;
          continue;
        }
        throw normalized;
      }
    }

    if (lastRecoverableError) throw lastRecoverableError;
    throw new SutraBridgeError({
      code: 'studio_not_running',
      message:
        'Sutra Studio is not connected. Start the desktop application and wait for its Codex bridge to become ready.',
      retryable: true,
      details: { checked: candidates },
    });
  }
}
