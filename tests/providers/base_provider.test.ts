import { AxiosError } from 'axios';
import BaseProvider, {
  BaseProviderOptions,
} from '../../src/providers/base_provider';
import Credentials from '../../src/models/credentials';

class TestProvider extends BaseProvider<BaseProviderOptions> {
  protected readonly URL = 'https://api.testingbot.com/v1/test';

  public run() {
    return Promise.resolve({ success: true, runs: [] });
  }

  public callWithRetry<T>(operation: string, fn: () => Promise<T>) {
    return this.withRetry(operation, fn);
  }

  public setFastBackoff() {
    (this as unknown as { BASE_RETRY_DELAY_MS: number }).BASE_RETRY_DELAY_MS =
      1;
  }

  public computeInterval(current: number, changed: boolean) {
    return this.computeNextPollInterval(current, changed);
  }

  public get maxRetries() {
    return this.MAX_RETRIES;
  }
}

function makeAxiosError(status?: number, code?: string): AxiosError {
  const err = new AxiosError('failure', code, {} as AxiosError['config']);
  if (status !== undefined) {
    err.response = {
      status,
      statusText: '',
      headers: {},
      config: err.config ?? ({} as AxiosError['config']),
      data: {},
    } as AxiosError['response'];
  }
  return err;
}

describe('BaseProvider.computeNextPollInterval', () => {
  const provider = new TestProvider(new Credentials('u', 'k'), {
    quiet: true,
  } as BaseProviderOptions);

  it('resets to the minimum when status changed', () => {
    expect(provider.computeInterval(20000, true)).toBe(5000);
  });

  it('applies backoff when status is unchanged', () => {
    expect(provider.computeInterval(5000, false)).toBe(7500);
    expect(provider.computeInterval(10000, false)).toBe(15000);
  });

  it('caps at the maximum poll interval', () => {
    expect(provider.computeInterval(25000, false)).toBe(30000);
    expect(provider.computeInterval(100000, false)).toBe(30000);
  });
});

describe('BaseProvider.withRetry', () => {
  let provider: TestProvider;

  beforeEach(() => {
    provider = new TestProvider(new Credentials('u', 'k'), {
      quiet: true,
    } as BaseProviderOptions);
    provider.setFastBackoff();
  });

  it('returns the result on first success without retrying', async () => {
    const fn = jest.fn().mockResolvedValue('ok');
    const result = await provider.callWithRetry('op', fn);
    expect(result).toBe('ok');
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('retries on a 503 and returns the eventual success', async () => {
    const fn = jest
      .fn()
      .mockRejectedValueOnce(makeAxiosError(503))
      .mockResolvedValueOnce('done');
    const result = await provider.callWithRetry('op', fn);
    expect(result).toBe('done');
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('retries network errors and eventually succeeds', async () => {
    const fn = jest
      .fn()
      .mockRejectedValueOnce(makeAxiosError(undefined, 'ECONNRESET'))
      .mockRejectedValueOnce(makeAxiosError(undefined, 'ETIMEDOUT'))
      .mockResolvedValueOnce('final');
    const result = await provider.callWithRetry('op', fn);
    expect(result).toBe('final');
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it('does not retry non-retryable HTTP errors (401)', async () => {
    const err = makeAxiosError(401);
    const fn = jest.fn().mockRejectedValue(err);
    await expect(provider.callWithRetry('op', fn)).rejects.toBe(err);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('does not retry 400 bad-request errors', async () => {
    const err = makeAxiosError(400);
    const fn = jest.fn().mockRejectedValue(err);
    await expect(provider.callWithRetry('op', fn)).rejects.toBe(err);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('gives up after MAX_RETRIES and throws the last error', async () => {
    const err = makeAxiosError(503);
    const fn = jest.fn().mockRejectedValue(err);
    await expect(provider.callWithRetry('op', fn)).rejects.toBe(err);
    // MAX_RETRIES=3 means 1 initial + 3 retries = 4 total attempts
    expect(fn).toHaveBeenCalledTimes(provider.maxRetries + 1);
  });

  it('uses exponential backoff (2s, 4s, 8s)', async () => {
    const realProvider = new TestProvider(new Credentials('u', 'k'), {
      quiet: true,
    } as BaseProviderOptions);
    const sleepSpy = jest
      .spyOn(
        realProvider as unknown as { sleep: (ms: number) => Promise<void> },
        'sleep',
      )
      .mockResolvedValue(undefined);

    const err = makeAxiosError(503);
    const fn = jest.fn().mockRejectedValue(err);

    await expect(realProvider.callWithRetry('op', fn)).rejects.toBe(err);

    const delays = sleepSpy.mock.calls.map((c) => c[0]);
    expect(delays).toEqual([2000, 4000, 8000]);
  });
});
