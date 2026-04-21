import {
  checkInternetConnectivity,
  formatConnectivityResults,
} from '../../src/utils/connectivity';

type FetchMock = jest.Mock<ReturnType<typeof fetch>, Parameters<typeof fetch>>;

describe('checkInternetConnectivity', () => {
  let originalFetch: typeof fetch;
  let fetchMock: FetchMock;

  beforeEach(() => {
    originalFetch = global.fetch;
    fetchMock = jest.fn();
    global.fetch = fetchMock as unknown as typeof fetch;
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it('reports connected when any endpoint succeeds', async () => {
    fetchMock.mockImplementation(async (input) => {
      const url = typeof input === 'string' ? input : (input as URL).toString();
      if (url.includes('cloudflare.com')) {
        return { status: 204 } as unknown as Response;
      }
      throw new Error('fetch failed');
    });

    const result = await checkInternetConnectivity();

    expect(result.connected).toBe(true);
    expect(result.message).toContain('Internet connectivity verified');
    expect(result.endpointResults).toHaveLength(1);
    expect(result.endpointResults[0].success).toBe(true);
  });

  it('reports disconnected when all endpoints fail', async () => {
    fetchMock.mockRejectedValue(new Error('fetch failed'));

    const result = await checkInternetConnectivity();

    expect(result.connected).toBe(false);
    expect(result.message).toContain('No internet connectivity detected');
    expect(result.endpointResults).toHaveLength(3);
    expect(result.endpointResults.every((r) => !r.success)).toBe(true);
  });

  it('maps specific error codes to friendlier messages', async () => {
    fetchMock.mockImplementation(async () => {
      throw new Error('ENOTFOUND www.google.com');
    });

    const result = await checkInternetConnectivity();

    expect(result.connected).toBe(false);
    const errors = result.endpointResults.map((r) => r.error);
    expect(errors).toEqual(
      expect.arrayContaining([
        expect.stringContaining('DNS resolution failed'),
      ]),
    );
  });

  it('maps AbortError to a timeout message', async () => {
    fetchMock.mockImplementation(async () => {
      const err = new Error('aborted');
      err.name = 'AbortError';
      throw err;
    });

    const result = await checkInternetConnectivity();

    expect(result.connected).toBe(false);
    expect(result.endpointResults[0].error).toBe('Request timeout (>3s)');
  });
});

describe('formatConnectivityResults', () => {
  it('renders a single success line when connected', () => {
    const output = formatConnectivityResults({
      connected: true,
      endpointResults: [],
      message: 'Internet OK',
    });
    expect(output).toBe('✓ Internet OK');
  });

  it('renders endpoint results and troubleshooting steps when disconnected', () => {
    const output = formatConnectivityResults({
      connected: false,
      endpointResults: [
        {
          endpoint: 'Google (https://www.google.com/generate_204)',
          success: false,
          error: 'DNS resolution failed',
          latencyMs: 42,
        },
      ],
      message: 'No internet connectivity detected',
    });

    expect(output).toContain('✗ No internet connectivity detected');
    expect(output).toContain('Endpoint results:');
    expect(output).toContain('DNS resolution failed');
    expect(output).toContain('42ms');
    expect(output).toContain('Troubleshooting steps:');
    expect(output).toContain('ping google.com');
  });
});
