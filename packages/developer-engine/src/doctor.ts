import { inspectSrijikaProject } from './project.js';
import { inspectSrijikaTool, selectSrijikaRuntime } from './runtime.js';
import type {
  SrijikaDoctorReport,
  SrijikaProjectMetadata,
  SrijikaRuntimePreference,
} from './types.js';

export async function createSrijikaDoctorReport(
  startDirectory: string,
  runtime: SrijikaRuntimePreference = 'auto',
): Promise<SrijikaDoctorReport> {
  const tools = (['node', 'bun', 'pnpm', 'npm', 'yarn'] as const).map(inspectSrijikaTool);
  let project: SrijikaProjectMetadata | null = null;
  const issues: string[] = [];
  try {
    project = await inspectSrijikaProject(startDirectory);
    issues.push(...project.warnings);
    const managerTool = tools.find((tool) => tool.name === project?.packageManager);
    if (!managerTool?.available) issues.push(`${project.packageManager} is not available on PATH.`);
    if (!project.scripts['dev']) issues.push('package.json is missing the dev script.');
  } catch (error) {
    issues.push(error instanceof Error ? error.message : String(error));
  }
  if (!tools.find((tool) => tool.name === 'node')?.available) {
    issues.push('Node.js is required for compatibility mode.');
  }
  const selection = project
    ? selectSrijikaRuntime(project, runtime)
    : { runtime: 'node' as const, reason: 'No project was available for runtime selection.' };
  if (runtime === 'bun' && selection.runtime !== 'bun') issues.push(selection.reason);
  return Object.freeze({
    project,
    tools: Object.freeze(tools),
    selectedRuntime: selection.runtime,
    runtimeReason: selection.reason,
    healthy: issues.length === 0,
    issues: Object.freeze(issues),
  });
}
