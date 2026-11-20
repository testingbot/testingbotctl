import fs from 'node:fs';
import path from 'node:path';
import yaml from 'js-yaml';
import type { Command, Option } from 'commander';
import TestingBotError from '../models/testingbot_error';
import { editDistance } from '../utils/device_check';

/**
 * Per-project defaults in `.testingbot.yml`, so a project's usual run is just
 * `testingbot maestro`:
 *
 *   maestro:
 *     app: app/build/outputs/apk/debug/app-debug.apk
 *     flows: [.maestro]
 *     device: Pixel 9
 *     deviceVersion: "15"
 *
 * Keys are option names, camelCase or as the flag (`device-version`). A value
 * typed on the command line always wins. Relative paths are relative to the
 * file, so the defaults work from any subdirectory. Credentials are refused:
 * the file is meant to be committed.
 */

export const CONFIG_FILE_NAMES = ['.testingbot.yml', '.testingbot.yaml'];

/** Commands the file can configure. */
export const CONFIGURABLE_COMMANDS = ['maestro', 'espresso', 'xcuitest'];

const PATH_KEYS = new Set([
  'app',
  'testApp',
  'otherApp',
  'flows',
  'config',
  'reportOutputDir',
  'artifactsOutputDir',
  'jsonFileName',
  'excludeFlows',
]);

const SECRET_KEYS = new Set(['apiKey', 'apiSecret']);

/** File extensions of an app (as opposed to a flow) given on the command line. */
const APP_EXTENSION = /\.(apk|aab|ipa|app|tar\.gz)$/i;

export interface ProjectConfig {
  file: string;
  dir: string;
  commands: Record<string, Record<string, unknown>>;
}

/** Finds `.testingbot.yml` in `cwd` or the nearest parent directory. */
export function findConfigFile(
  cwd: string = process.cwd(),
  env: NodeJS.ProcessEnv = process.env,
): string | undefined {
  const explicit = env.TESTINGBOT_CONFIG;
  if (explicit !== undefined) {
    if (explicit === '' || explicit === 'none') return undefined;
    const file = path.resolve(cwd, explicit);
    if (!fs.existsSync(file)) {
      throw new TestingBotError(
        `TESTINGBOT_CONFIG points to ${file}, which does not exist.`,
      );
    }
    return file;
  }
  let dir = path.resolve(cwd);
  for (;;) {
    for (const name of CONFIG_FILE_NAMES) {
      const file = path.join(dir, name);
      if (fs.existsSync(file)) return file;
    }
    const parent = path.dirname(dir);
    if (parent === dir) return undefined;
    dir = parent;
  }
}

export function camelCase(key: string): string {
  return key
    .replace(/^-+/, '')
    .replace(/-([a-z0-9])/gi, (_, c: string) => c.toUpperCase());
}

export function loadProjectConfig(file: string): ProjectConfig {
  let raw: unknown;
  try {
    raw = yaml.load(fs.readFileSync(file, 'utf8'));
  } catch (error) {
    const reason = error instanceof Error ? error.message.split('\n')[0] : '';
    throw new TestingBotError(`Could not read ${file}: ${reason}`);
  }
  if (raw == null) raw = {};
  if (typeof raw !== 'object' || Array.isArray(raw)) {
    throw new TestingBotError(
      `${file} should map command names (maestro, espresso, xcuitest) to their options.`,
    );
  }
  const commands: ProjectConfig['commands'] = {};
  for (const [name, section] of Object.entries(raw as object)) {
    if (section == null) continue;
    if (typeof section !== 'object' || Array.isArray(section)) {
      throw new TestingBotError(
        `"${name}" in ${file} should be a map of options, e.g. "device: Pixel 9".`,
      );
    }
    const normalized: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(section as object)) {
      normalized[camelCase(key)] = value;
    }
    commands[name] = normalized;
  }
  return { file, dir: path.dirname(file), commands };
}

function closest(key: string, candidates: string[]): string | undefined {
  let best: { name: string; d: number } | undefined;
  for (const name of candidates) {
    const d = editDistance(key.toLowerCase(), name.toLowerCase());
    if (!best || d < best.d) best = { name, d };
  }
  return best && best.d <= Math.max(2, Math.floor(key.length / 3))
    ? best.name
    : undefined;
}

function resolvePath(dir: string, value: unknown): unknown {
  if (typeof value !== 'string' || value === '') return value;
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(value)) return value; // a URL
  return path.isAbsolute(value) ? value : path.resolve(dir, value);
}

function coerce(option: Option, value: unknown, key: string): unknown {
  if (option.required || option.optional) {
    const values = Array.isArray(value) ? value : [value];
    if (values.some((v) => v !== null && typeof v === 'object')) {
      throw new TestingBotError(
        `"${key}" in .testingbot.yml should be a value or a list of values.`,
      );
    }
    if (option.parseArg) {
      // Repeatable options accumulate; others keep the last value.
      // Start from a copy of the default so list options (--env) get the
      // array their parser pushes onto.
      let acc: unknown = Array.isArray(option.defaultValue)
        ? [...(option.defaultValue as unknown[])]
        : undefined;
      for (const v of values) acc = option.parseArg(String(v), acc);
      return acc;
    }
    return values.length > 1 ? values.map(String).join(',') : String(values[0]);
  }
  if (typeof value !== 'boolean') {
    throw new TestingBotError(
      `"${key}" in .testingbot.yml is an on/off option: use true or false.`,
    );
  }
  return value;
}

export interface AppliedConfig {
  file: string;
  keys: string[];
  warnings: string[];
}

/**
 * Fills the command's options from the config file, for every option the
 * command line did not set. Returns what was applied, for a one-line notice.
 */
export function applyProjectConfig(
  command: Command,
  config: ProjectConfig,
): AppliedConfig | undefined {
  const name = command.name();
  const section = config.commands[name];
  const warnings: string[] = [];

  for (const other of Object.keys(config.commands)) {
    if (!CONFIGURABLE_COMMANDS.includes(other)) {
      const guess = closest(other, CONFIGURABLE_COMMANDS);
      warnings.push(
        `Ignoring "${other}" in ${path.basename(config.file)}: only ${CONFIGURABLE_COMMANDS.join(', ')} can be configured.${guess ? ` Did you mean "${guess}"?` : ''}`,
      );
    }
  }
  if (!section)
    return warnings.length
      ? { file: config.file, keys: [], warnings }
      : undefined;

  const byAttribute = new Map<string, Option>();
  for (const option of command.options) {
    if (option.long === '--help') continue;
    const attribute = option.attributeName();
    // `--no-x` and `--x` share an attribute; prefer the positive option.
    if (!byAttribute.has(attribute) || !option.negate) {
      byAttribute.set(attribute, option);
    }
  }

  const positional = command.args.length;
  const applied: string[] = [];
  for (const [key, rawValue] of Object.entries(section)) {
    if (SECRET_KEYS.has(key)) {
      warnings.push(
        `Ignoring "${key}" in ${path.basename(config.file)}: keep credentials out of a file you commit (use "testingbot login" or TB_KEY / TB_SECRET).`,
      );
      continue;
    }
    // Maestro flows are positional arguments; the hidden --flows alias takes
    // them comma-separated.
    const attribute = key;
    const option = byAttribute.get(attribute);
    if (!option) {
      const guess = closest(key, [...byAttribute.keys()]);
      warnings.push(
        `Unknown option "${key}" for ${name} in ${path.basename(config.file)}.${guess ? ` Did you mean "${guess}"?` : ''}`,
      );
      continue;
    }
    const source = command.getOptionValueSource(attribute);
    if (source !== undefined && source !== 'default') continue;

    if (name === 'maestro') {
      const firstIsApp =
        positional > 0 && APP_EXTENSION.test(String(command.args[0]));
      // An app on the command line replaces the configured one.
      if (attribute === 'app' && firstIsApp) continue;
      // So do flows: with an app configured every positional is a flow,
      // otherwise the ones after the app are.
      if (attribute === 'flows') {
        const appKnown =
          !firstIsApp &&
          (section.app !== undefined ||
            command.getOptionValue('app') !== undefined ||
            command.getOptionValue('appUrl') !== undefined ||
            command.getOptionValue('appBinaryId') !== undefined);
        const flowCount = appKnown ? positional : Math.max(0, positional - 1);
        if (flowCount > 0) continue;
      }
    }

    let value = rawValue;
    if (PATH_KEYS.has(attribute)) {
      value = Array.isArray(value)
        ? value.map((v) => resolvePath(config.dir, v))
        : resolvePath(config.dir, value);
    }
    command.setOptionValueWithSource(
      attribute,
      coerce(option, value, key),
      'config',
    );
    applied.push(key);
  }
  return { file: config.file, keys: applied, warnings };
}
