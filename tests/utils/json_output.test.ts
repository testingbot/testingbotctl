import fs from 'node:fs';
import path from 'node:path';
import {
  EXIT_ERROR,
  EXIT_SUCCESS,
  EXIT_TEST_FAILURE,
  JsonOutput,
  defaultJsonFileName,
  resolveExitCode,
  validateJsonOptions,
  writeJsonOutput,
} from '../../src/utils/json_output';
import TestingBotError from '../../src/models/testingbot_error';

const passed: JsonOutput = {
  provider: 'maestro',
  outcome: 'passed',
  success: true,
  appId: 1234,
  runs: [],
};
const failed: JsonOutput = { ...passed, outcome: 'failed', success: false };
const errored: JsonOutput = {
  provider: 'maestro',
  outcome: 'error',
  success: false,
  error: 'boom',
  runs: [],
};

describe('resolveExitCode', () => {
  it('returns 0 when all tests passed', () => {
    expect(resolveExitCode(passed, {})).toBe(EXIT_SUCCESS);
    expect(resolveExitCode(passed, { json: true })).toBe(EXIT_SUCCESS);
  });

  it('returns 2 when tests failed so CI can tell it apart from CLI errors', () => {
    expect(resolveExitCode(failed, {})).toBe(EXIT_TEST_FAILURE);
    expect(resolveExitCode(failed, { json: true })).toBe(EXIT_TEST_FAILURE);
  });

  it('returns 0 for failed tests with --json-file (the file is the contract)', () => {
    expect(resolveExitCode(failed, { jsonFile: true })).toBe(EXIT_SUCCESS);
  });

  it('returns 1 for CLI/infrastructure errors regardless of json flags', () => {
    expect(resolveExitCode(errored, {})).toBe(EXIT_ERROR);
    expect(resolveExitCode(errored, { jsonFile: true })).toBe(EXIT_ERROR);
  });

  it('treats async and dry-run as success', () => {
    expect(resolveExitCode({ ...passed, outcome: 'started' }, {})).toBe(
      EXIT_SUCCESS,
    );
    expect(resolveExitCode({ ...passed, outcome: 'dry-run' }, {})).toBe(
      EXIT_SUCCESS,
    );
  });
});

describe('validateJsonOptions', () => {
  it('rejects --json-file-name without --json-file', () => {
    expect(() => validateJsonOptions({ jsonFileName: 'out.json' })).toThrow(
      TestingBotError,
    );
    expect(() => validateJsonOptions({ jsonFileName: 'out.json' })).toThrow(
      '--json-file-name requires --json-file',
    );
  });

  it('accepts valid combinations', () => {
    expect(() => validateJsonOptions({})).not.toThrow();
    expect(() => validateJsonOptions({ json: true })).not.toThrow();
    expect(() =>
      validateJsonOptions({ jsonFile: true, jsonFileName: 'out.json' }),
    ).not.toThrow();
    expect(() =>
      validateJsonOptions({ json: true, jsonFile: true }),
    ).not.toThrow();
  });
});

describe('defaultJsonFileName', () => {
  it('uses the app id when known', () => {
    expect(defaultJsonFileName(passed)).toBe('1234_testingbot.json');
  });

  it('falls back to the provider name when the command failed early', () => {
    expect(defaultJsonFileName(errored)).toBe('maestro_testingbot.json');
  });
});

describe('writeJsonOutput', () => {
  let stdoutSpy: jest.SpyInstance;
  let writeFileSpy: jest.SpyInstance;
  let mkdirSpy: jest.SpyInstance;

  beforeEach(() => {
    stdoutSpy = jest
      .spyOn(process.stdout, 'write')
      .mockImplementation(() => true);
    writeFileSpy = jest
      .spyOn(fs.promises, 'writeFile')
      .mockResolvedValue(undefined);
    mkdirSpy = jest.spyOn(fs.promises, 'mkdir').mockResolvedValue(undefined);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('does nothing without json flags', async () => {
    await expect(writeJsonOutput(passed, {})).resolves.toBeUndefined();
    expect(stdoutSpy).not.toHaveBeenCalled();
    expect(writeFileSpy).not.toHaveBeenCalled();
  });

  it('prints a single parseable JSON document on stdout for --json', async () => {
    await writeJsonOutput(failed, { json: true });
    expect(stdoutSpy).toHaveBeenCalledTimes(1);
    const printed = stdoutSpy.mock.calls[0][0] as string;
    expect(JSON.parse(printed)).toEqual(failed);
    expect(printed.endsWith('\n')).toBe(true);
    expect(writeFileSpy).not.toHaveBeenCalled();
  });

  it('writes <appId>_testingbot.json in the cwd for --json-file', async () => {
    const written = await writeJsonOutput(passed, { jsonFile: true });
    expect(written).toBe(path.resolve('1234_testingbot.json'));
    expect(mkdirSpy).toHaveBeenCalledWith(path.resolve('.'), {
      recursive: true,
    });
    expect(writeFileSpy).toHaveBeenCalledWith(
      path.resolve('1234_testingbot.json'),
      `${JSON.stringify(passed, null, 2)}\n`,
      'utf8',
    );
    expect(stdoutSpy).not.toHaveBeenCalled();
  });

  it('honours --json-file-name and creates parent directories', async () => {
    const written = await writeJsonOutput(passed, {
      jsonFile: true,
      jsonFileName: 'reports/nested/results.json',
    });
    expect(written).toBe(path.resolve('reports/nested/results.json'));
    expect(mkdirSpy).toHaveBeenCalledWith(path.resolve('reports/nested'), {
      recursive: true,
    });
  });

  it('can write both stdout and file', async () => {
    await writeJsonOutput(passed, { json: true, jsonFile: true });
    expect(stdoutSpy).toHaveBeenCalledTimes(1);
    expect(writeFileSpy).toHaveBeenCalledTimes(1);
  });

  it('wraps write failures in a TestingBotError naming the target path', async () => {
    writeFileSpy.mockRejectedValue(new Error('EACCES'));
    await expect(
      writeJsonOutput(passed, { jsonFile: true, jsonFileName: 'out.json' }),
    ).rejects.toThrow(
      `Failed to write JSON results to ${path.resolve('out.json')}`,
    );
  });
});
