/**
 * Masking for `--secret-env` values before anything is printed or logged.
 *
 * The API stores secret values encrypted and never returns them, but the
 * request body and the local options object hold them in plain text. Every
 * code path that serialises either of those for display goes through here.
 */

export const SECRET_MASK = '***';

const MAX_DEPTH = 8;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return (
    typeof value === 'object' &&
    value !== null &&
    !Array.isArray(value) &&
    Object.getPrototypeOf(value) === Object.prototype
  );
}

function maskKeys(
  env: Record<string, unknown>,
  keys: ReadonlySet<string> | 'all',
): Record<string, unknown> {
  const masked: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(env)) {
    masked[key] = keys === 'all' || keys.has(key) ? SECRET_MASK : value;
  }
  return masked;
}

/**
 * Returns a deep copy of `value` in which every `secretEnv` object has all of
 * its values replaced by `***`, and every `env` object has the values of the
 * given secret keys (plus any key that sits next to it in a `secretEnv`)
 * replaced by `***`. Everything else is copied unchanged.
 *
 * Works on the run request body (`{ maestroOptions: { env, secretEnv } }`),
 * on `MaestroRunOptions` itself, and on API responses that carry
 * `options.env`.
 */
export function maskSecretEnv<T>(value: T, secretKeys: Iterable<string>): T {
  const keys = new Set(secretKeys);
  return walk(value, keys, 0) as T;
}

function walk(value: unknown, keys: Set<string>, depth: number): unknown {
  if (depth > MAX_DEPTH) return value;
  if (Array.isArray(value)) {
    return value.map((item) => walk(item, keys, depth + 1));
  }
  if (!isPlainObject(value)) return value;

  const siblingSecretKeys = new Set(keys);
  if (isPlainObject(value.secretEnv)) {
    for (const key of Object.keys(value.secretEnv)) siblingSecretKeys.add(key);
  }

  const result: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(value)) {
    if (key === 'secretEnv' && isPlainObject(child)) {
      result[key] = maskKeys(child, 'all');
    } else if (key === 'env' && isPlainObject(child)) {
      result[key] = maskKeys(child, siblingSecretKeys);
    } else {
      result[key] = walk(child, keys, depth + 1);
    }
  }
  return result;
}
