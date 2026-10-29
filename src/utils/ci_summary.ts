/**
 * The results in the CI system's own UI, not only in the log:
 *
 * - GitHub Actions: a markdown table appended to $GITHUB_STEP_SUMMARY (the job
 *   summary page), plus an `::error` annotation per failed run or flow, which
 *   GitHub shows on the run and the pull request.
 * - Azure Pipelines: the same markdown attached to the build's Extensions tab
 *   (`##vso[task.uploadsummary]`) and a `##vso[task.logissue]` per failure.
 *
 * Annotations are workflow commands printed on stdout, so they are left out
 * when --json owns stdout. Set TESTINGBOT_CI_SUMMARY=0 to turn all of it off.
 * Nothing here may fail the command: errors are logged at debug level.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import logger from '../logger';
import type { JsonFlowResult, JsonOutput, JsonRunResult } from './json_output';

type Env = NodeJS.ProcessEnv;

const PROVIDER_LABEL: Record<JsonOutput['provider'], string> = {
  maestro: 'Maestro',
  espresso: 'Espresso',
  xcuitest: 'XCUITest',
};

const MAX_FAILURE_ROWS = 50;
const MAX_ANNOTATIONS = 10; // GitHub shows at most 10 error annotations per step

interface Failure {
  title: string;
  message: string;
  url?: string;
}

/** Flows whose verdict counts: the last attempt of each. */
function countedFlows(run: JsonRunResult): JsonFlowResult[] {
  return (run.flows ?? []).filter((flow) => flow.latest);
}

function deviceLabel(run: JsonRunResult): string {
  const { name, version, platform } = run.device;
  return version ? `${name} (${platform} ${version})` : name;
}

function failuresOf(output: JsonOutput): Failure[] {
  const failures: Failure[] = [];
  for (const run of output.runs) {
    const flows = countedFlows(run);
    const failedFlows = flows.filter((flow) => !flow.passed);
    if (failedFlows.length > 0) {
      for (const flow of failedFlows) {
        failures.push({
          title: `${flow.name} on ${deviceLabel(run)}`,
          message: flow.errors[0] ?? `Flow ${flow.status.toLowerCase()}`,
          url: run.url,
        });
      }
    } else if (!run.passed) {
      failures.push({
        title: `Run ${run.id} on ${deviceLabel(run)}`,
        message: `Run ${run.status.toLowerCase()}`,
        url: run.url,
      });
    }
  }
  return failures;
}

/** One line, no table-breaking pipes, bounded length. */
function cell(text: string, max = 200): string {
  // Backslashes too: otherwise an input `\|` becomes `\\|` and the pipe breaks the table.
  const flat = text.replace(/\s+/g, ' ').replace(/[\\|]/g, '\\$&').trim();
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
}

function link(text: string, url?: string): string {
  return url ? `[${text}](${url})` : text;
}

export function renderMarkdown(output: JsonOutput): string {
  const label = PROVIDER_LABEL[output.provider];
  const failedRuns = output.runs.filter((run) => !run.passed).length;
  const verdict = output.success
    ? '✅ passed'
    : `❌ ${failedRuns} of ${output.runs.length} run(s) failed`;

  const lines = [`### TestingBot ${label}: ${verdict}`, ''];
  if (output.url) lines.push(`[Open in TestingBot](${output.url})`, '');

  const hasFlows = output.runs.some((run) => run.flows?.length);
  lines.push(
    hasFlows
      ? '| | Device | Flows passed | Run |'
      : '| | Device | Result | Run |',
    '|---|---|---|---|',
  );
  for (const run of output.runs) {
    const flows = countedFlows(run);
    const result = hasFlows
      ? `${flows.filter((flow) => flow.passed).length} / ${flows.length}`
      : run.passed
        ? 'passed'
        : run.status.toLowerCase();
    lines.push(
      `| ${run.passed ? '✅' : '❌'} | ${cell(deviceLabel(run))} | ${result} | ${link(`#${run.id}`, run.url)} |`,
    );
  }

  const failures = failuresOf(output);
  if (failures.length > 0) {
    lines.push(
      '',
      `<details${failures.length <= 10 ? ' open' : ''}><summary>Failures (${failures.length})</summary>`,
      '',
      '| Test | Error |',
      '|---|---|',
    );
    for (const failure of failures.slice(0, MAX_FAILURE_ROWS)) {
      lines.push(
        `| ${link(cell(failure.title, 120), failure.url)} | ${cell(failure.message)} |`,
      );
    }
    if (failures.length > MAX_FAILURE_ROWS) {
      lines.push(
        '',
        `…and ${failures.length - MAX_FAILURE_ROWS} more, see TestingBot.`,
      );
    }
    lines.push('', '</details>');
  }
  return `${lines.join('\n')}\n`;
}

/** GitHub workflow-command escaping for the message and for properties. */
function ghData(text: string): string {
  return text.replace(/%/g, '%25').replace(/\r/g, '%0D').replace(/\n/g, '%0A');
}
function ghProperty(text: string): string {
  return ghData(text).replace(/:/g, '%3A').replace(/,/g, '%2C');
}

/** Azure logging commands are one line; `]` and `;` end the properties. */
function azureData(text: string): string {
  return text.replace(/\r?\n/g, ' ');
}

function annotationMessage(failure: Failure): string {
  return failure.url ? `${failure.message}\n${failure.url}` : failure.message;
}

export function githubAnnotations(output: JsonOutput): string[] {
  const failures = failuresOf(output);
  const lines = failures
    .slice(0, MAX_ANNOTATIONS)
    .map(
      (failure) =>
        `::error title=${ghProperty(`TestingBot: ${failure.title}`)}::${ghData(annotationMessage(failure))}`,
    );
  if (failures.length > MAX_ANNOTATIONS) {
    lines.push(
      `::error title=TestingBot::${ghData(`${failures.length - MAX_ANNOTATIONS} more failures, see the job summary.`)}`,
    );
  }
  return lines;
}

export function azureAnnotations(output: JsonOutput): string[] {
  return failuresOf(output)
    .slice(0, MAX_ANNOTATIONS)
    .map(
      (failure) =>
        `##vso[task.logissue type=error]${azureData(`TestingBot: ${failure.title}: ${annotationMessage(failure)}`)}`,
    );
}

export interface CiSummaryOptions {
  /** --json: stdout is the JSON document, so no workflow commands. */
  stdoutReserved?: boolean;
  env?: Env;
  write?: (line: string) => void;
}

/** Publishes the job summary and annotations for a finished test run. */
export async function publishCiSummary(
  output: JsonOutput,
  options: CiSummaryOptions = {},
): Promise<void> {
  const env = options.env ?? process.env;
  if (env.TESTINGBOT_CI_SUMMARY === '0') return;
  if (output.outcome !== 'passed' && output.outcome !== 'failed') return;
  if (output.runs.length === 0) return;
  const write =
    options.write ?? ((line: string) => process.stdout.write(`${line}\n`));
  const commands = !options.stdoutReserved;

  try {
    if (env.GITHUB_ACTIONS === 'true') {
      if (env.GITHUB_STEP_SUMMARY) {
        await fs.promises.appendFile(
          env.GITHUB_STEP_SUMMARY,
          renderMarkdown(output),
        );
      }
      if (commands) githubAnnotations(output).forEach(write);
    } else if (env.TF_BUILD?.toLowerCase() === 'true') {
      if (commands) {
        const dir = env.AGENT_TEMPDIRECTORY || os.tmpdir();
        const file = path.join(
          dir,
          `testingbot-${output.provider}-${output.appId ?? Date.now()}.md`,
        );
        await fs.promises.writeFile(file, renderMarkdown(output));
        write(`##vso[task.uploadsummary]${file}`);
        azureAnnotations(output).forEach(write);
      }
    }
  } catch (error) {
    logger.debug(
      `Could not publish the CI summary: ${error instanceof Error ? error.message : error}`,
    );
  }
}
