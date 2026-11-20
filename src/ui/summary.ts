import pc from 'picocolors';
import type {
  JsonFlowResult,
  JsonOutput,
  JsonRunResult,
} from '../utils/json_output';
import { linkUrl } from './terminal';

/**
 * The end-of-run summary card: one verdict line, a row per device, flaky and
 * slow flows, and the commands that help next (re-run the failures, fetch the
 * videos, open the dashboard). Rendered from the same document as --json, so
 * every provider gets the same summary.
 */

export interface SummaryContext {
  /** Wall-clock time of the command, used when flows carry no timestamps. */
  elapsedMs: number;
  /** --download-artifacts was given, so do not suggest fetching them. */
  artifactsDownloaded?: boolean;
  /** OSC 8 links; defaults to what the terminal supports. */
  hyperlinks?: boolean;
  /** Colours; picocolors already honours NO_COLOR / FORCE_COLOR. */
  color?: boolean;
  /** Terminal width; long lines are shortened to fit. */
  columns?: number;
}

const SLOWEST_COUNT = 3;
const SLOWEST_MIN_FLOWS = 6;
const MAX_FLAKY_NAMES = 5;
/** Flows shorter than this are not worth calling "slow". */
const SLOW_MIN_SECONDS = 5;

export function formatDuration(ms: number): string {
  const total = Math.max(0, Math.round(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  if (h > 0) return `${h}h ${String(m).padStart(2, '0')}m`;
  if (m > 0) return `${m}m ${String(s).padStart(2, '0')}s`;
  return `${s}s`;
}

function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? '' : 's'}`;
}

/** Flows whose verdict counts: the last attempt of each. */
function countedFlows(run: JsonRunResult): JsonFlowResult[] {
  return (run.flows ?? []).filter((flow) => flow.latest);
}

function deviceLabel(run: JsonRunResult): string {
  const { name, platform, version } = run.device;
  return [name, version ? `${platform} ${version}` : platform]
    .filter(Boolean)
    .join(' · ');
}

/**
 * How long the tests took: from the first flow starting to the last one
 * finishing when the API reports flow times, else the command's own time.
 */
export function testDurationMs(output: JsonOutput, elapsedMs: number): number {
  let start = Infinity;
  let end = -Infinity;
  for (const run of output.runs) {
    for (const flow of run.flows ?? []) {
      if (flow.startedAt) start = Math.min(start, Date.parse(flow.startedAt));
      if (flow.completedAt) end = Math.max(end, Date.parse(flow.completedAt));
    }
  }
  return Number.isFinite(start) && Number.isFinite(end) && end >= start
    ? end - start
    : elapsedMs;
}

/** Flows that failed at least once but passed on a later attempt. */
export function flakyFlows(output: JsonOutput): string[] {
  const names = new Set<string>();
  for (const run of output.runs) {
    for (const flow of countedFlows(run)) {
      if (flow.passed && flow.attempt > 1) names.add(flow.name);
    }
  }
  return [...names];
}

/** The slowest counted flows, longest first. */
export function slowestFlows(
  output: JsonOutput,
  count = SLOWEST_COUNT,
): Array<{ name: string; seconds: number }> {
  const flows: Array<{ name: string; seconds: number }> = [];
  // The same flow runs once per device: name the device when there are several.
  const devices = new Set(output.runs.map((r) => r.device.name)).size;
  for (const run of output.runs) {
    for (const flow of countedFlows(run)) {
      if (
        flow.durationSeconds != null &&
        flow.durationSeconds >= SLOW_MIN_SECONDS
      ) {
        flows.push({
          name: devices > 1 ? `${flow.name} (${run.device.name})` : flow.name,
          seconds: flow.durationSeconds,
        });
      }
    }
  }
  return flows.sort((a, b) => b.seconds - a.seconds).slice(0, count);
}

export function renderSummary(
  output: JsonOutput,
  context: SummaryContext,
): string[] {
  const c = pc.createColors(context.color ?? pc.isColorSupported);
  const url = (u: string) => linkUrl(u, context.hyperlinks);
  const passed = output.outcome === 'passed';
  const lines: string[] = [];

  const allFlows = output.runs.flatMap(countedFlows);
  const hasFlows = allFlows.length > 0;
  const failedFlows = allFlows.filter((f) => !f.passed).length;
  const failedRuns = output.runs.filter((r) => !r.passed).length;
  const duration = formatDuration(testDurationMs(output, context.elapsedMs));

  // Verdict line
  const badge = passed
    ? c.bold(c.inverse(c.green(' PASSED ')))
    : c.bold(c.inverse(c.red(' FAILED ')));
  const scope = hasFlows
    ? passed
      ? `${plural(allFlows.length, 'flow')} passed`
      : `${failedFlows} of ${plural(allFlows.length, 'flow')} failed`
    : passed
      ? `${plural(output.runs.length, 'run')} passed`
      : `${failedRuns} of ${plural(output.runs.length, 'run')} failed`;
  const devices = new Set(output.runs.map((r) => r.device.name)).size;
  const where =
    output.runs.length > 0 ? ` on ${plural(devices || 1, 'device')}` : '';
  lines.push(`${badge} ${c.bold(scope)}${where} ${c.dim(`· ${duration}`)}`);

  // One row per run (device)
  if (output.runs.length > 1 || hasFlows) {
    const labels = output.runs.map(deviceLabel);
    const width = Math.min(40, Math.max(...labels.map((l) => l.length)));
    output.runs.forEach((run, i) => {
      const symbol = run.passed ? c.green('✔') : c.red('✘');
      const flows = countedFlows(run);
      const count =
        flows.length > 0
          ? `${flows.filter((f) => f.passed).length}/${flows.length}`
          : run.passed
            ? 'passed'
            : run.status === 'WAITING' || run.status === 'READY'
              ? 'unfinished'
              : 'failed';
      lines.push(
        `  ${symbol} ${labels[i].padEnd(width)}  ${run.passed ? c.dim(count) : c.red(count)}`,
      );
    });
  }

  // Insights
  const insights: string[] = [];
  const flaky = flakyFlows(output);
  if (flaky.length > 0) {
    const shown = flaky.slice(0, MAX_FLAKY_NAMES).join(', ');
    const more =
      flaky.length > MAX_FLAKY_NAMES
        ? ` and ${flaky.length - MAX_FLAKY_NAMES} more`
        : '';
    insights.push(
      `${c.yellow('◆ Flaky')}    ${shown}${more} ${c.dim('(passed on retry)')}`,
    );
  }
  const slowest = slowestFlows(output);
  // With a handful of flows the table above already shows this.
  if (allFlows.length >= SLOWEST_MIN_FLOWS && slowest.length > 1) {
    // As many as fit on one line (a wrapped line is hard to scan).
    const budget = (context.columns ?? 100) - '  ◷ Slowest  '.length;
    const items: string[] = [];
    let used = 0;
    for (const f of slowest) {
      const time = formatDuration(f.seconds * 1000);
      const width = f.name.length + 1 + time.length + (items.length ? 3 : 0);
      if (items.length > 0 && used + width > budget) break;
      items.push(`${f.name} ${c.dim(time)}`);
      used += width;
    }
    insights.push(`${c.cyan('◷ Slowest')}  ${items.join(c.dim(' · '))}`);
  }
  if (insights.length > 0) {
    lines.push('');
    for (const line of insights) lines.push(`  ${line}`);
  }

  // Next steps
  const steps: Array<[string, string]> = [];
  const dashboard = output.url;
  if (!passed && output.provider === 'maestro' && output.appId) {
    steps.push(['↻ Re-run failed', `testingbot rerun --id ${output.appId}`]);
    if (!context.artifactsDownloaded) {
      steps.push([
        '⬇ Videos & logs',
        `testingbot artifacts --id ${output.appId} --download-artifacts failed`,
      ]);
    }
  }
  if (!passed && output.provider !== 'maestro') {
    // Point straight at the failed runs: that is where the logs are.
    for (const run of output.runs.filter((r) => !r.passed && r.url)) {
      steps.push([`↗ ${run.device.name}`, url(run.url as string)]);
    }
  }
  if (dashboard) steps.push(['↗ Dashboard', url(dashboard)]);
  if (steps.length > 0) {
    const width = Math.max(...steps.map(([label]) => label.length));
    lines.push('');
    for (const [label, value] of steps) {
      lines.push(`  ${c.dim(label.padEnd(width))}  ${value}`);
    }
  }

  return lines;
}

/** One-line message for a desktop notification. */
export function notificationText(output: JsonOutput): string {
  const allFlows = output.runs.flatMap(countedFlows);
  if (output.outcome === 'passed') {
    return allFlows.length > 0
      ? `TestingBot: ${plural(allFlows.length, 'flow')} passed`
      : `TestingBot: ${plural(output.runs.length, 'run')} passed`;
  }
  const failed = allFlows.filter((f) => !f.passed).length;
  return allFlows.length > 0
    ? `TestingBot: ${failed} of ${plural(allFlows.length, 'flow')} failed`
    : `TestingBot: ${output.runs.filter((r) => !r.passed).length} run(s) failed`;
}
