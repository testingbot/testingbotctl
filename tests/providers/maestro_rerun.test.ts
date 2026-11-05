import Maestro from '../../src/providers/maestro';
import MaestroOptions from '../../src/models/maestro_options';
import Credentials from '../../src/models/credentials';
import logger from '../../src/logger';
import axios from 'axios';

jest.mock('axios');
jest.mock('../../src/logger');
jest.mock('socket.io-client', () => ({
  io: jest.fn(() => ({
    on: jest.fn(),
    emit: jest.fn(),
    disconnect: jest.fn(),
  })),
}));
jest.mock('../../src/utils', () => ({
  __esModule: true,
  default: {
    getUserAgent: jest.fn().mockReturnValue('TestingBot-CTL-test'),
    getCurrentVersion: jest.fn().mockReturnValue('1.0.0'),
    compareVersions: jest.fn().mockReturnValue(0),
    checkForUpdate: jest.fn(),
    isInteractive: jest.fn().mockReturnValue(false),
  },
}));

const flow = (
  id: number,
  name: string,
  status: string,
  success = 0,
  extra: Record<string, unknown> = {},
) => ({ id, name, status, success, ...extra });
const run = (id: number, status: string, flows: unknown[]) => ({
  id,
  status,
  capabilities: { deviceName: `Device ${id}`, platformName: 'Android' },
  success: 0,
  flows,
});
const statusOf = (runs: unknown[]) => ({
  data: { runs, success: false, completed: true },
  headers: {},
});

const URL = 'https://api.testingbot.com/v1/app-automate/maestro';

describe('Maestro rerun', () => {
  const credentials = new Credentials('testUser', 'testKey');
  const mockGet = axios.get as jest.Mock;
  const mockPost = axios.post as jest.Mock;

  const makeMaestro = (extra: Record<string, unknown> = {}) => {
    const m = new Maestro(
      credentials,
      MaestroOptions.forExistingProject({ quiet: true, ...extra }),
    );
    m['MIN_POLL_INTERVAL_MS'] = 1;
    m['MAX_POLL_INTERVAL_MS'] = 1;
    return m;
  };

  // Project 1234: run 10 has one failed and one passed flow, run 20 passed.
  const finished = [
    run(10, 'DONE', [
      flow(1, 'login.yaml', 'DONE', 0),
      flow(2, 'checkout.yaml', 'DONE', 1),
    ]),
    run(20, 'DONE', [
      flow(3, 'login.yaml', 'DONE', 1),
      flow(4, 'checkout.yaml', 'DONE', 1),
    ]),
  ];

  beforeEach(() => {
    jest.resetAllMocks();
    (axios.isAxiosError as unknown as jest.Mock).mockImplementation(
      (e: { isAxiosError?: boolean }) => !!e?.isAxiosError,
    );
  });

  it('re-runs only the failed flows and reports only the re-run runs', async () => {
    const m = makeMaestro();
    mockGet
      .mockResolvedValueOnce(statusOf(finished))
      .mockResolvedValueOnce(
        statusOf([
          run(10, 'READY', [
            ...finished[0].flows,
            flow(5, 'login.yaml', 'READY'),
          ]),
          finished[1],
        ]),
      )
      .mockResolvedValue(
        statusOf([
          run(10, 'DONE', [
            ...finished[0].flows,
            flow(5, 'login.yaml', 'DONE', 1),
          ]),
          finished[1],
        ]),
      );
    mockPost.mockResolvedValue({ data: { success: true, flow: { id: 5 } } });

    const result = await m.rerun(1234);

    expect(mockPost).toHaveBeenCalledTimes(1);
    expect(mockPost).toHaveBeenCalledWith(
      `${URL}/1234/10/1/retry`,
      {},
      expect.anything(),
    );
    expect(result.success).toBe(true);
    expect(result.outcome).toBe('passed');
    expect(result.runs.map((r) => r.id)).toEqual([10]);
  });

  it('keeps waiting until the new attempt has surfaced and settled', async () => {
    const m = makeMaestro();
    mockGet
      .mockResolvedValueOnce(statusOf(finished))
      // A stale poll: the run still looks finished and the attempt is missing.
      .mockResolvedValueOnce(statusOf(finished))
      .mockResolvedValue(
        statusOf([
          run(10, 'DONE', [
            ...finished[0].flows,
            flow(5, 'login.yaml', 'DONE', 0),
          ]),
        ]),
      );
    mockPost.mockResolvedValue({ data: { success: true, flow: { id: 5 } } });

    const result = await m.rerun(1234);

    expect(mockGet).toHaveBeenCalledTimes(3);
    expect(result.outcome).toBe('failed');
  });

  it('re-runs a named flow on the selected run even if it passed', async () => {
    const m = makeMaestro({ async: true });
    mockGet.mockResolvedValue(statusOf(finished));
    mockPost.mockResolvedValue({ data: { success: true, flow: { id: 9 } } });

    const result = await m.rerun(1234, { runIds: [20], flows: ['checkout'] });

    expect(mockPost).toHaveBeenCalledTimes(1);
    expect(mockPost).toHaveBeenCalledWith(
      `${URL}/1234/20/4/retry`,
      {},
      expect.anything(),
    );
    expect(result.outcome).toBe('running');
    expect(result.runs.map((r) => r.id)).toEqual([20]);
  });

  it('matches a flow by the id of any of its attempts and retries the latest', async () => {
    const m = makeMaestro({ async: true });
    mockGet.mockResolvedValue(
      statusOf([
        run(10, 'DONE', [
          flow(1, 'login.yaml', 'DONE', 0),
          flow(7, 'login.yaml', 'DONE', 0),
        ]),
      ]),
    );
    mockPost.mockResolvedValue({ data: { success: true, flow: { id: 8 } } });

    await m.rerun(1234, { flows: ['1'] });

    expect(mockPost).toHaveBeenCalledWith(
      `${URL}/1234/10/7/retry`,
      {},
      expect.anything(),
    );
  });

  it('passes without retrying anything when no flow failed', async () => {
    const m = makeMaestro();
    mockGet.mockResolvedValue(statusOf([finished[1]]));

    const result = await m.rerun(1234);

    expect(mockPost).not.toHaveBeenCalled();
    expect(result).toMatchObject({ success: true, outcome: 'passed' });
  });

  it('errors on an unknown flow name or run id', async () => {
    mockGet.mockResolvedValue(statusOf(finished));

    const unknownFlow = await makeMaestro().rerun(1234, { flows: ['nope'] });
    expect(unknownFlow.outcome).toBe('error');
    expect(unknownFlow.error).toMatch(/No flow named "nope".*login\.yaml/);

    const unknownRun = await makeMaestro().rerun(1234, { runIds: [99] });
    expect(unknownRun.outcome).toBe('error');
    expect(unknownRun.error).toMatch(/Run 99 is not part of project 1234/);
    expect(mockPost).not.toHaveBeenCalled();
  });

  it('refuses a flow that is still running', async () => {
    mockGet.mockResolvedValue(
      statusOf([run(10, 'READY', [flow(1, 'login.yaml', 'READY')])]),
    );

    const result = await makeMaestro().rerun(1234, { flows: ['login.yaml'] });

    expect(result.outcome).toBe('error');
    expect(result.error).toMatch(/still running/);
    expect(mockPost).not.toHaveBeenCalled();
  });

  it('skips cancelled runs and surfaces the API refusal for the rest', async () => {
    mockGet.mockResolvedValue(
      statusOf([
        run(10, 'CANCELLED', [flow(1, 'login.yaml', 'CANCELLED')]),
        run(20, 'DONE', [flow(3, 'login.yaml', 'DONE', 0)]),
      ]),
    );
    mockPost.mockRejectedValue({
      isAxiosError: true,
      message: 'Request failed with status code 409',
      response: {
        status: 409,
        data: { error: 'A flow this attempt ran has since been removed' },
      },
    });

    const result = await makeMaestro().rerun(1234);

    expect(mockPost).toHaveBeenCalledTimes(1);
    expect(mockPost).toHaveBeenCalledWith(
      `${URL}/1234/20/3/retry`,
      {},
      expect.anything(),
    );
    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringMatching(/Run 10 was cancelled/),
    );
    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringMatching(/has since been removed/),
    );
    expect(result.outcome).toBe('error');
    expect(result.error).toMatch(/None of the selected flows could be re-run/);
  });
});
