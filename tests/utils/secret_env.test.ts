import { maskSecretEnv, SECRET_MASK } from '../../src/utils/secret_env';

describe('maskSecretEnv', () => {
  it('masks every secretEnv value and leaves env alone when keys do not overlap', () => {
    const input = {
      maestroOptions: {
        env: { API_URL: 'https://staging.example.com' },
        secretEnv: { API_KEY: 's3cretValue123', TOKEN: 'abc==' },
      },
    };
    expect(maskSecretEnv(input, ['API_KEY', 'TOKEN'])).toEqual({
      maestroOptions: {
        env: { API_URL: 'https://staging.example.com' },
        secretEnv: { API_KEY: SECRET_MASK, TOKEN: SECRET_MASK },
      },
    });
  });

  it('masks env values whose key is a secret key', () => {
    const input = {
      options: {
        env: { API_URL: 'https://staging.example.com', API_KEY: 'leaked' },
      },
    };
    expect(maskSecretEnv(input, ['API_KEY'])).toEqual({
      options: {
        env: { API_URL: 'https://staging.example.com', API_KEY: SECRET_MASK },
      },
    });
  });

  it('masks env keys that sit next to a secretEnv object even when no keys are given', () => {
    const input = {
      env: { A: '1', B: '2' },
      secretEnv: { B: 's3cretValue123' },
    };
    expect(maskSecretEnv(input, [])).toEqual({
      env: { A: '1', B: SECRET_MASK },
      secretEnv: { B: SECRET_MASK },
    });
  });

  it('does not mutate its input', () => {
    const input = { secretEnv: { API_KEY: 's3cretValue123' } };
    maskSecretEnv(input, ['API_KEY']);
    expect(input.secretEnv.API_KEY).toBe('s3cretValue123');
  });

  it('walks arrays and nested objects', () => {
    const input = {
      runs: [
        { id: 1, options: { env: { API_KEY: 's3cretValue123' } } },
        { id: 2, options: { env: { OTHER: 'kept' } } },
      ],
    };
    expect(maskSecretEnv(input, ['API_KEY'])).toEqual({
      runs: [
        { id: 1, options: { env: { API_KEY: SECRET_MASK } } },
        { id: 2, options: { env: { OTHER: 'kept' } } },
      ],
    });
  });

  it('passes through primitives, null and non-object env values', () => {
    expect(maskSecretEnv('text', ['A'])).toBe('text');
    expect(maskSecretEnv(null, ['A'])).toBeNull();
    expect(maskSecretEnv(undefined, ['A'])).toBeUndefined();
    expect(maskSecretEnv({ env: 'not-an-object' }, ['A'])).toEqual({
      env: 'not-an-object',
    });
  });

  it('does not contain the secret anywhere in the serialised output', () => {
    const body = {
      capabilities: [{ deviceName: 'Pixel 6' }],
      maestroOptions: {
        env: { API_URL: 'https://staging.example.com' },
        secretEnv: { API_KEY: 's3cretValue123' },
      },
    };
    const text = JSON.stringify(maskSecretEnv(body, ['API_KEY']));
    expect(text).not.toContain('s3cretValue123');
    expect(text).toContain('Pixel 6');
  });
});
