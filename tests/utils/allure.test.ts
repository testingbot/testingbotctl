import fs from 'node:fs';
import path from 'node:path';
import {
  junitToAllureResults,
  writeAllureResults,
} from '../../src/utils/allure';

const PASSING_XML = `<?xml version="1.0" encoding="UTF-8"?>
<testsuites tests="1" failures="0" errors="0" time="18.0">
  <testsuite name="Test Suite" device="iPhone - 26.5 - ABC" tests="1" failures="0" time="18.0">
    <testcase id="flow_app" name="flow_app" classname="flow_app" time="18.0" status="SUCCESS">
      <property name="step" details="{&quot;config&quot;:{&quot;appId&quot;:&quot;com.example&quot;},&quot;optional&quot;:false}" value="applyConfigurationCommand" timestamp="1788290360461" status="COMPLETED"/>
      <property name="step" details="{&quot;selector&quot;:{&quot;idRegex&quot;:&quot;btn&quot;},&quot;optional&quot;:false}" value="tapOnElement" timestamp="1788290376347" status="COMPLETED"/>
      <property name="step" details="{&quot;text&quot;:&quot;hello&quot;}" value="inputTextCommand" timestamp="1788290366607" status="COMPLETED"/>
    </testcase>
  </testsuite>
</testsuites>`;

const FAILING_XML = `<testsuites>
  <testsuite name="Suite" tests="2" failures="1">
    <testcase name="login" classname="login" time="5.5" status="FAILED">
      <property name="step" value="launchAppCommand" timestamp="1000" status="COMPLETED"/>
      <property name="step" details="{&quot;selector&quot;:{&quot;text&quot;:&quot;Sign in&quot;}}" value="tapOnElement" timestamp="2000" status="FAILED"/>
      <failure message="Element not found: Sign in">Element not found: Sign in
  at tapOn (login.yaml:4)</failure>
    </testcase>
    <testcase name="checkout" classname="checkout" time="1.0"><skipped/></testcase>
  </testsuite>
</testsuites>`;

describe('junitToAllureResults', () => {
  it('maps a passing Maestro testcase with ordered steps and labels', () => {
    const results = junitToAllureResults(PASSING_XML, {
      runId: 42,
      device: 'iPhone 17 Pro',
      platform: 'iOS',
      osVersion: '26.5',
    });
    expect(results).toHaveLength(1);
    const result = results[0];
    expect(result).toMatchObject({
      name: 'flow_app',
      fullName: 'flow_app#flow_app',
      status: 'passed',
      stage: 'finished',
    });
    expect(result.uuid).toMatch(/^[0-9a-f-]{36}$/);
    expect(result.historyId).toHaveLength(32);
    expect(result.statusDetails).toBeUndefined();

    // Steps sorted by timestamp, command suffix stripped, details summarised.
    expect(result.steps.map((s) => s.name)).toEqual([
      'applyConfiguration (config={"appId":"com.example"})',
      'inputText (text="hello")',
      'tapOnElement (selector={"idRegex":"btn"})',
    ]);
    expect(result.steps.every((s) => s.status === 'passed')).toBe(true);
    expect(result.start).toBe(1788290360461);
    expect(result.stop).toBeGreaterThanOrEqual(1788290376347);
    expect(result.stop).toBe(1788290360461 + 18000);

    const label = (name: string) =>
      result.labels.find((l) => l.name === name)?.value;
    expect(label('framework')).toBe('maestro');
    expect(label('suite')).toBe('Test Suite');
    expect(label('host')).toBe('testingbot-run-42');
    expect(label('device')).toBe('iPhone 17 Pro');
    expect(label('platform')).toBe('iOS');
    expect(label('osVersion')).toBe('26.5');
  });

  it('marks failures with message and trace, and honours <skipped/>', () => {
    const [login, checkout] = junitToAllureResults(FAILING_XML, { runId: 1 });
    expect(login.status).toBe('failed');
    expect(login.statusDetails).toEqual({
      message: 'Element not found: Sign in',
      trace: 'Element not found: Sign in\n  at tapOn (login.yaml:4)',
    });
    expect(login.steps.map((s) => s.status)).toEqual(['passed', 'failed']);
    expect(checkout.status).toBe('skipped');
    expect(checkout.steps).toEqual([]);
  });

  it('uses startedAt as the start when steps carry no timestamps', () => {
    const [checkout] = junitToAllureResults(
      `<testsuite name="s"><testcase name="checkout" time="2"/></testsuite>`,
      { runId: 1, startedAt: '2026-01-01T00:00:00Z' },
    );
    const expectedStart = Date.parse('2026-01-01T00:00:00Z');
    expect(checkout.start).toBe(expectedStart);
    expect(checkout.stop).toBe(expectedStart + 2000);
    expect(checkout.status).toBe('passed');
  });

  it('handles testcases without a surrounding testsuite and empty input', () => {
    expect(
      junitToAllureResults(`<testcase name="lone" time="1"/>`, { runId: 1 }),
    ).toHaveLength(1);
    expect(junitToAllureResults('', { runId: 1 })).toEqual([]);
    expect(junitToAllureResults('not xml at all', { runId: 1 })).toEqual([]);
  });

  it('gives each call fresh uuids but a stable historyId per flow', () => {
    const a = junitToAllureResults(PASSING_XML, { runId: 1 })[0];
    const b = junitToAllureResults(PASSING_XML, { runId: 2 })[0];
    expect(a.uuid).not.toBe(b.uuid);
    expect(a.historyId).toBe(b.historyId);
  });
});

describe('writeAllureResults', () => {
  it('writes one <uuid>-result.json per result under allure-results', async () => {
    const mkdir = jest.spyOn(fs.promises, 'mkdir').mockResolvedValue(undefined);
    const writeFile = jest
      .spyOn(fs.promises, 'writeFile')
      .mockResolvedValue(undefined);
    const results = junitToAllureResults(FAILING_XML, { runId: 1 });

    const dir = await writeAllureResults('/tmp/reports', results);

    expect(dir).toBe(path.join('/tmp/reports', 'allure-results'));
    expect(mkdir).toHaveBeenCalledWith(dir, { recursive: true });
    expect(writeFile).toHaveBeenCalledTimes(2);
    const [file, body] = writeFile.mock.calls[0];
    expect(String(file)).toBe(path.join(dir, `${results[0].uuid}-result.json`));
    expect(JSON.parse(String(body))).toMatchObject({ name: 'login' });
    jest.restoreAllMocks();
  });
});
