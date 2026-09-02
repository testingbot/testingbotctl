import fs from 'node:fs';
import path from 'node:path';
import TestingBotError from '../models/testingbot_error';

/**
 * Process exit codes. Distinguishing "tests failed" from "the CLI or the
 * infrastructure broke" lets CI pipelines gate on the right thing: a red test
 * run should fail the build, while an upload timeout may warrant a retry.
 * Mirrors the convention used by devicecloud.dev so migrating scripts keep
 * working.
 */
export const EXIT_SUCCESS = 0;
export const EXIT_ERROR = 1;
export const EXIT_TEST_FAILURE = 2;

/**
 * How a command ended.
 * - `passed`/`failed`: tests ran to completion.
 * - `started`: --async, tests were submitted but not awaited.
 * - `dry-run`: nothing was sent to the API.
 * - `error`: the CLI or the infrastructure failed before a verdict.
 */
export type RunOutcome = 'passed' | 'failed' | 'started' | 'dry-run' | 'error';

export interface JsonFlowResult {
  id: number;
  runId: number;
  name: string;
  status: string;
  passed: boolean;
  /** 1-based attempt number within the flow; >1 means a retry. */
  attempt: number;
  /** True for the attempt whose verdict counts (last-attempt-wins). */
  latest: boolean;
  shardIndex?: number;
  startedAt?: string;
  completedAt?: string;
  durationSeconds?: number;
  errors: string[];
}

export interface JsonRunResult {
  id: number;
  status: string;
  passed: boolean;
  device: {
    name: string;
    platform: string;
    version?: string;
  };
  url?: string;
  report?: string;
  flows?: JsonFlowResult[];
}

export interface JsonOutput {
  provider: 'maestro' | 'espresso' | 'xcuitest';
  outcome: RunOutcome;
  success: boolean;
  appId?: number;
  url?: string;
  error?: string;
  runs: JsonRunResult[];
}

export interface JsonOutputOptions {
  json?: boolean;
  jsonFile?: boolean;
  jsonFileName?: string;
}

/**
 * Resolves the process exit code for a finished command.
 *
 * With --json-file a failing test run still exits 0: the file is the contract
 * and the pipeline decides what to do with it (devicecloud.dev behaviour).
 * CLI/infrastructure errors always exit 1 so a missing file is never mistaken
 * for a green run.
 */
export function resolveExitCode(
  output: JsonOutput,
  options: JsonOutputOptions,
): number {
  if (output.outcome === 'error') return EXIT_ERROR;
  if (output.success) return EXIT_SUCCESS;
  return options.jsonFile ? EXIT_SUCCESS : EXIT_TEST_FAILURE;
}

/** Validates flag combinations before any work is done. */
export function validateJsonOptions(options: JsonOutputOptions): void {
  if (options.jsonFileName && !options.jsonFile) {
    throw new TestingBotError('--json-file-name requires --json-file');
  }
}

/**
 * Default file name for --json-file: `<appId>_testingbot.json`, or a stable
 * name when the command failed before an app id was assigned.
 */
export function defaultJsonFileName(output: JsonOutput): string {
  return output.appId
    ? `${output.appId}_testingbot.json`
    : `${output.provider}_testingbot.json`;
}

/**
 * Writes the JSON document to stdout (--json) and/or a file (--json-file).
 * Returns the path written, if any.
 */
export async function writeJsonOutput(
  output: JsonOutput,
  options: JsonOutputOptions,
): Promise<string | undefined> {
  const serialized = JSON.stringify(output, null, 2);

  if (options.json) {
    process.stdout.write(`${serialized}\n`);
  }

  if (!options.jsonFile) return undefined;

  const target = path.resolve(
    options.jsonFileName ?? defaultJsonFileName(output),
  );
  try {
    await fs.promises.mkdir(path.dirname(target), { recursive: true });
    await fs.promises.writeFile(target, `${serialized}\n`, 'utf8');
  } catch (error) {
    throw new TestingBotError(`Failed to write JSON results to ${target}`, {
      cause: error,
    });
  }
  return target;
}
