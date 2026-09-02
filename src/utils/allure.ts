import { randomUUID, createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

/**
 * Converts the JUnit XML TestingBot returns for a Maestro run into Allure
 * result files (`allure-results/*-result.json`), the input format of
 * `allure generate` / `allure serve`.
 *
 * The XML is produced by Maestro itself (one <testcase> per flow, with
 * <property name="step"> entries per command and an optional <failure>), so a
 * small purpose-built reader is enough and avoids pulling in an XML parser.
 */

export type AllureStatus = 'passed' | 'failed' | 'broken' | 'skipped';

export interface AllureStep {
  name: string;
  status: AllureStatus;
  stage: 'finished';
  start?: number;
  stop?: number;
}

export interface AllureResult {
  uuid: string;
  historyId: string;
  name: string;
  fullName: string;
  status: AllureStatus;
  stage: 'finished';
  start: number;
  stop: number;
  labels: { name: string; value: string }[];
  statusDetails?: { message: string; trace?: string };
  steps: AllureStep[];
}

export interface AllureContext {
  runId: number;
  device?: string;
  platform?: string;
  osVersion?: string;
  /** Fallback when the XML carries no step timestamps. */
  startedAt?: string;
}

const XML_ENTITIES: Record<string, string> = {
  '&lt;': '<',
  '&gt;': '>',
  '&quot;': '"',
  '&apos;': "'",
  '&amp;': '&',
};

function decodeXml(value: string): string {
  return value
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, code) =>
      String.fromCodePoint(parseInt(code, 16)),
    )
    .replace(/&(lt|gt|quot|apos|amp);/g, (match) => XML_ENTITIES[match]);
}

function parseAttributes(tag: string): Record<string, string> {
  const attrs: Record<string, string> = {};
  const re = /([\w:.-]+)\s*=\s*"([^"]*)"/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(tag)) !== null) {
    attrs[match[1]] = decodeXml(match[2]);
  }
  return attrs;
}

function stepStatus(status: string | undefined): AllureStatus {
  switch ((status ?? '').toUpperCase()) {
    case 'COMPLETED':
    case 'SUCCESS':
    case 'PASSED':
      return 'passed';
    case 'FAILED':
    case 'ERROR':
      return 'failed';
    case 'SKIPPED':
    case 'PENDING':
      return 'skipped';
    default:
      return 'broken';
  }
}

/** Human-readable step name from Maestro's command name plus its details. */
function stepName(value: string | undefined, details: string | undefined) {
  const command = (value ?? 'step').replace(/Command$/, '');
  if (!details) return command;
  try {
    const parsed = JSON.parse(details) as Record<string, unknown>;
    const summary = Object.entries(parsed)
      .filter(([key]) => key !== 'optional')
      .map(([key, val]) => `${key}=${JSON.stringify(val)}`)
      .join(', ');
    return summary ? `${command} (${summary})` : command;
  } catch {
    return command;
  }
}

/**
 * Parses TestingBot's Maestro JUnit XML into Allure results. Returns one
 * result per <testcase>. Unknown structure yields an empty array rather than
 * throwing so a report download never fails the run.
 */
export function junitToAllureResults(
  xml: string,
  context: AllureContext,
): AllureResult[] {
  const results: AllureResult[] = [];
  const suiteRe = /<testsuite\b([^>]*)>([\s\S]*?)<\/testsuite>/g;
  let suiteMatch: RegExpExecArray | null;
  let sawSuite = false;

  const handleSuite = (suiteAttrs: Record<string, string>, body: string) => {
    const caseRe = /<testcase\b([^>]*?)(?:\/>|>([\s\S]*?)<\/testcase>)/g;
    let caseMatch: RegExpExecArray | null;
    while ((caseMatch = caseRe.exec(body)) !== null) {
      const attrs = parseAttributes(caseMatch[1]);
      const inner = caseMatch[2] ?? '';
      results.push(buildResult(attrs, inner, suiteAttrs, context));
    }
  };

  while ((suiteMatch = suiteRe.exec(xml)) !== null) {
    sawSuite = true;
    handleSuite(parseAttributes(suiteMatch[1]), suiteMatch[2]);
  }
  if (!sawSuite) {
    handleSuite({}, xml);
  }
  return results;
}

function buildResult(
  attrs: Record<string, string>,
  inner: string,
  suiteAttrs: Record<string, string>,
  context: AllureContext,
): AllureResult {
  const name = attrs.name || attrs.id || 'flow';
  const fullName = `${attrs.classname || name}#${name}`;

  const steps: AllureStep[] = [];
  const propRe = /<property\b([^>]*)\/?>/g;
  let propMatch: RegExpExecArray | null;
  while ((propMatch = propRe.exec(inner)) !== null) {
    const p = parseAttributes(propMatch[1]);
    if (p.name !== 'step') continue;
    const ts = p.timestamp ? Number(p.timestamp) : undefined;
    steps.push({
      name: stepName(p.value, p.details),
      status: stepStatus(p.status),
      stage: 'finished',
      ...(ts != null && !Number.isNaN(ts) && { start: ts, stop: ts }),
    });
  }
  // Maestro emits steps in reverse or arbitrary order; sort by timestamp.
  steps.sort((a, b) => (a.start ?? 0) - (b.start ?? 0));

  const failureMatch =
    /<failure\b([^>]*)>([\s\S]*?)<\/failure>/.exec(inner) ??
    /<error\b([^>]*)>([\s\S]*?)<\/error>/.exec(inner);
  const failureAttrs = failureMatch ? parseAttributes(failureMatch[1]) : {};
  const failureText = failureMatch ? decodeXml(failureMatch[2]).trim() : '';
  const skipped = /<skipped\b/.test(inner);

  let status: AllureStatus;
  if (skipped) status = 'skipped';
  else if (failureMatch) status = 'failed';
  else if (attrs.status && stepStatus(attrs.status) !== 'passed')
    status = stepStatus(attrs.status);
  else status = 'passed';

  const timestamps = steps
    .map((s) => s.start)
    .filter((t): t is number => t != null);
  const durationMs = Math.round(Number(attrs.time || 0) * 1000);
  const fallbackStart = context.startedAt
    ? new Date(context.startedAt).getTime()
    : Date.now() - durationMs;
  const start = timestamps.length > 0 ? Math.min(...timestamps) : fallbackStart;
  const stop = Math.max(
    start + durationMs,
    timestamps.length > 0 ? Math.max(...timestamps) : start,
  );

  const labels = [
    { name: 'framework', value: 'maestro' },
    { name: 'language', value: 'yaml' },
    { name: 'suite', value: suiteAttrs.name || 'Maestro' },
    { name: 'testClass', value: attrs.classname || name },
    { name: 'host', value: `testingbot-run-${context.runId}` },
    ...(context.device ? [{ name: 'device', value: context.device }] : []),
    ...(context.platform
      ? [{ name: 'platform', value: context.platform }]
      : []),
    ...(context.osVersion
      ? [{ name: 'osVersion', value: context.osVersion }]
      : []),
  ];

  const message = failureAttrs.message || failureText.split('\n')[0] || '';

  return {
    uuid: randomUUID(),
    historyId: createHash('md5').update(fullName).digest('hex'),
    name,
    fullName,
    status,
    stage: 'finished',
    start,
    stop,
    labels,
    ...(failureMatch && {
      statusDetails: {
        message,
        ...(failureText && failureText !== message && { trace: failureText }),
      },
    }),
    steps,
  };
}

/**
 * Writes results into `<outputDir>/allure-results`, one `<uuid>-result.json`
 * per test, and returns the directory. Existing files are left in place so
 * several runs (or shards) can accumulate into one report.
 */
export async function writeAllureResults(
  outputDir: string,
  results: AllureResult[],
): Promise<string> {
  const dir = path.join(outputDir, 'allure-results');
  await fs.promises.mkdir(dir, { recursive: true });
  await Promise.all(
    results.map((result) =>
      fs.promises.writeFile(
        path.join(dir, `${result.uuid}-result.json`),
        JSON.stringify(result, null, 2),
        'utf-8',
      ),
    ),
  );
  return dir;
}
