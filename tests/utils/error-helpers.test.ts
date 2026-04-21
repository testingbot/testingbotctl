import { AxiosError } from 'axios';
import {
  enhanceNetworkError,
  getStatusCodeMessage,
  handleAxiosError,
  isNetworkError,
  isRetryableError,
} from '../../src/utils/error-helpers';
import TestingBotError from '../../src/models/testingbot_error';

function makeAxiosError(opts: {
  code?: string;
  status?: number;
  data?: unknown;
  url?: string;
}): AxiosError {
  const err = new AxiosError(
    'request failed',
    opts.code,
    opts.url
      ? ({ url: opts.url } as AxiosError['config'])
      : ({ url: 'https://api.testingbot.com/v1/foo' } as AxiosError['config']),
  );
  if (opts.status !== undefined) {
    err.response = {
      status: opts.status,
      statusText: '',
      headers: {},
      config: err.config ?? ({} as AxiosError['config']),
      data: opts.data,
    } as AxiosError['response'];
  }
  return err;
}

describe('enhanceNetworkError', () => {
  it('includes hostname and origin derived from the URL', () => {
    const result = enhanceNetworkError(
      new Error('fetch failed'),
      'https://api.testingbot.com/v1/app',
    );
    expect(result).toBeInstanceOf(TestingBotError);
    expect(result.message).toContain('api.testingbot.com');
    expect(result.message).toContain('https://api.testingbot.com');
    expect(result.message).toContain('Original error: fetch failed');
  });

  it('falls back to the raw string when URL is not parseable', () => {
    const result = enhanceNetworkError(new Error('boom'), 'not-a-url');
    expect(result.message).toContain('not-a-url');
  });

  it('wraps the original error as cause', () => {
    const original = new Error('underlying');
    const result = enhanceNetworkError(original, 'https://x.example/');
    expect(result.cause).toBe(original);
  });
});

describe('getStatusCodeMessage', () => {
  it.each([
    [400, 'Invalid request'],
    [401, 'Invalid TestingBot credentials'],
    [403, 'Access denied'],
    [404, 'Resource not found'],
    [429, 'credits are depleted'],
    [500, 'Server error occurred'],
    [502, 'Bad gateway'],
    [503, 'Service temporarily unavailable'],
    [504, 'Gateway timeout'],
  ])('maps HTTP %i to a friendly message', (status, snippet) => {
    expect(getStatusCodeMessage(status)).toContain(snippet);
  });

  it('includes the server message when provided', () => {
    const msg = getStatusCodeMessage(400, 'missing required field "app"');
    expect(msg).toContain('missing required field "app"');
  });

  it('falls back to a generic message with server detail for unknown status', () => {
    const msg = getStatusCodeMessage(418, 'I am a teapot');
    expect(msg).toBe('Request failed (HTTP 418): I am a teapot');
  });

  it('falls back to a generic message without server detail for unknown status', () => {
    const msg = getStatusCodeMessage(418);
    expect(msg).toBe('Request failed with HTTP status 418');
  });
});

describe('handleAxiosError — network-level errors', () => {
  it.each([
    ['ECONNREFUSED', 'Connection refused'],
    ['ENOTFOUND', 'DNS resolution failed'],
    ['ETIMEDOUT', 'Connection timed out'],
    ['ECONNABORTED', 'Connection timed out'],
    ['CERT_HAS_EXPIRED', 'SSL/TLS certificate error'],
    ['UNABLE_TO_VERIFY_LEAF_SIGNATURE', 'SSL/TLS certificate error'],
  ])('maps %s to a dedicated diagnostic', (code, snippet) => {
    const err = makeAxiosError({ code });
    const result = handleAxiosError(err, 'Upload');
    expect(result.message).toContain('Upload');
    expect(result.message).toContain(snippet);
  });

  it('falls back to enhanceNetworkError for unknown network codes', () => {
    const err = makeAxiosError({
      code: 'SOMETHING_ELSE',
      url: 'https://api.testingbot.com/v1/foo',
    });
    const result = handleAxiosError(err, 'Fetch');
    expect(result.message).toContain('api.testingbot.com');
  });
});

describe('handleAxiosError — HTTP response errors', () => {
  it('extracts the server message from a JSON object with "message"', () => {
    const err = makeAxiosError({
      status: 400,
      data: { message: 'bad payload' },
    });
    const result = handleAxiosError(err, 'Upload');
    expect(result.message).toContain('bad payload');
  });

  it('extracts the server message from an "error" string property', () => {
    const err = makeAxiosError({
      status: 403,
      data: { error: 'quota exceeded' },
    });
    const result = handleAxiosError(err, 'Upload');
    expect(result.message).toContain('quota exceeded');
  });

  it('joins an "errors" array', () => {
    const err = makeAxiosError({
      status: 400,
      data: { errors: ['a', 'b'] },
    });
    const result = handleAxiosError(err, 'Upload');
    expect(result.message).toContain('a, b');
  });

  it('parses a JSON string payload', () => {
    const err = makeAxiosError({
      status: 500,
      data: '{"message":"db down"}',
    });
    const result = handleAxiosError(err, 'Status');
    expect(result.message).toContain('db down');
  });

  it('uses the raw string payload when it is not JSON', () => {
    const err = makeAxiosError({
      status: 500,
      data: 'internal error plain text',
    });
    const result = handleAxiosError(err, 'Status');
    expect(result.message).toContain('internal error plain text');
  });
});

describe('isNetworkError', () => {
  it('returns true when there is no response but a code is set', () => {
    expect(isNetworkError(makeAxiosError({ code: 'ECONNREFUSED' }))).toBe(true);
  });

  it('returns false when a response is present', () => {
    expect(isNetworkError(makeAxiosError({ status: 500 }))).toBe(false);
  });

  it('returns false when neither response nor code is present', () => {
    expect(isNetworkError(makeAxiosError({}))).toBe(false);
  });
});

describe('isRetryableError', () => {
  it.each([408, 429, 500, 502, 503, 504])(
    'treats HTTP %i as retryable',
    (status) => {
      expect(isRetryableError(makeAxiosError({ status }))).toBe(true);
    },
  );

  it.each([400, 401, 403, 404])('treats HTTP %i as not retryable', (status) => {
    expect(isRetryableError(makeAxiosError({ status }))).toBe(false);
  });

  it('treats network errors as retryable', () => {
    expect(isRetryableError(makeAxiosError({ code: 'ETIMEDOUT' }))).toBe(true);
  });
});
