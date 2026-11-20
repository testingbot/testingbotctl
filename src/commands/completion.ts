import type { Command, Option } from 'commander';
import type { DeviceFramework } from '../providers/account';
import { cachedDevices } from '../utils/device_check';

/**
 * Shell completion for bash, zsh and fish.
 *
 * `testingbot completion <shell>` prints a small script that calls back into
 * `testingbot __complete <words...>` on every Tab. That hidden entry point
 * knows the commands and options from the Commander definitions, and device
 * names and OS versions from the device catalog cached by the last run or
 * `testingbot devices`, so completing never waits on the network.
 *
 * Output: one candidate per line as `value<TAB>description`, or the single
 * line `__files__` when the shell should complete file names itself.
 */

export const FILES = '__files__';

const VALUE_CHOICES: Record<string, string[]> = {
  '--platform': ['Android', 'iOS'],
  '--report': ['html', 'html-detailed', 'junit', 'allure'],
  '--orientation': ['PORTRAIT', 'LANDSCAPE'],
  '--throttle-network': ['4G', '3G', 'Edge', 'airplane', 'disable'],
  '--priority': ['high', 'normal', 'low'],
  '--framework': ['maestro', 'espresso', 'xcuitest'],
  '--download-artifacts': ['all', 'failed'],
  '--size': ['small', 'medium', 'large'],
  '--retry': ['0', '1', '2'],
};

const FILE_OPTIONS = new Set([
  '--app',
  '--test-app',
  '--other-app',
  '--config',
  '--report-output-dir',
  '--artifacts-output-dir',
  '--json-file-name',
  '--exclude-flows',
]);

const VERSION_OPTIONS = new Set([
  '--deviceVersion',
  '--device-version',
  '--platform-version',
]);

const RUN_COMMANDS = new Set(['maestro', 'espresso', 'xcuitest']);

function takesValue(option: Option): boolean {
  return Boolean(option.required || option.optional);
}

function findOption(command: Command, flag: string): Option | undefined {
  return command.options.find((o) => o.long === flag || o.short === flag);
}

/** A word as the shell passed it: "Pixel 9", 'Pixel 9', Pixel\ 9 → Pixel 9. */
function unquote(word: string): string {
  return word.replace(/^(["'])(.*?)\1?$/, '$2').replace(/\\(.)/g, '$1');
}

/** First sentence of a description, short enough for a completion menu. */
function shorten(description: string | undefined, max = 60): string {
  const flat = (description ?? '').replace(/\s+/g, ' ').trim();
  const sentence = flat.split(/(?<=[.!?])\s/)[0].replace(/\.$/, '');
  return sentence.length > max ? `${sentence.slice(0, max - 1)}…` : sentence;
}

function line(value: string, description?: string): string {
  const desc = shorten(description);
  return desc ? `${value}\t${desc}` : value;
}

function filterPrefix(values: string[], prefix: string): string[] {
  const p = prefix.toLowerCase();
  return values.filter((v) => v.toLowerCase().startsWith(p));
}

function deviceFramework(command: Command, words: string[]): DeviceFramework {
  const name = command.name();
  if (name === 'espresso' || name === 'xcuitest') return name;
  const i = words.indexOf('--framework');
  const fw = i >= 0 ? words[i + 1] : undefined;
  return fw === 'espresso' || fw === 'xcuitest' ? fw : 'maestro';
}

function valueOf(words: string[], flags: string[]): string | undefined {
  for (let i = words.length - 1; i >= 0; i--) {
    if (flags.includes(words[i])) return unquote(words[i + 1] ?? '');
  }
  return undefined;
}

/** Completion candidates for the words typed after `testingbot`. */
export function complete(program: Command, words: string[]): string[] {
  const current = unquote(words[words.length - 1] ?? '');
  const before = words.slice(0, -1);

  // Find the subcommand, skipping global options and their values.
  let command: Command | undefined;
  let commandIndex = -1;
  for (let i = 0; i < before.length; i++) {
    const word = before[i];
    if (word.startsWith('-')) {
      const option = findOption(program, word);
      if (option && takesValue(option)) i++;
      continue;
    }
    command = program.commands.find(
      (c) => c.name() === word || c.aliases().includes(word),
    );
    commandIndex = i;
    break;
  }

  if (!command) {
    if (current.startsWith('-')) {
      return filterPrefix(['--proxy', '--version', '--help'], current);
    }
    return program.commands
      .filter((c) => !(c as unknown as { _hidden?: boolean })._hidden)
      .filter((c) => c.name().startsWith(current))
      .map((c) => line(c.name(), c.description()));
  }

  if (command.name() === 'help') {
    return program.commands
      .filter((c) => c.name().startsWith(current) && c.name() !== 'help')
      .map((c) => line(c.name(), c.description()));
  }
  if (command.name() === 'completion') {
    return filterPrefix(['bash', 'zsh', 'fish'], current);
  }

  const args = before.slice(commandIndex + 1);
  const previous = args[args.length - 1];
  const previousOption =
    previous && previous.startsWith('-')
      ? findOption(command, previous)
      : undefined;

  if (previousOption && takesValue(previousOption)) {
    const flag = previousOption.long ?? '';
    if (flag === '--device') {
      const framework = deviceFramework(command, args);
      const real = args.includes('--real-device') || args.includes('--real');
      const devices =
        (real && cachedDevices(framework, true)) ||
        cachedDevices(framework, false) ||
        [];
      const names = [...new Set(devices.map((d) => d.name))];
      return filterPrefix(names, current).map((name) => {
        const device = devices.find((d) => d.name === name);
        return line(
          name,
          device ? `${device.platform} ${device.versions.join(', ')}` : '',
        );
      });
    }
    if (VERSION_OPTIONS.has(flag)) {
      const framework = deviceFramework(command, args);
      const device = valueOf(args, ['--device']);
      const devices = cachedDevices(framework, false) ?? [];
      const versions = [
        ...new Set(
          devices
            .filter((d) => !device || d.name === device)
            .flatMap((d) => d.versions),
        ),
      ];
      return filterPrefix(versions, current);
    }
    if (VALUE_CHOICES[flag]) return filterPrefix(VALUE_CHOICES[flag], current);
    if (FILE_OPTIONS.has(flag)) return [FILES];
    return [];
  }

  if (current.startsWith('-')) {
    const used = new Set(args);
    return command.options
      .filter((o) => !o.hidden && o.long && !used.has(o.long))
      .filter((o) => (o.long as string).startsWith(current))
      .map((o) => line(o.long as string, o.description));
  }

  // Positional arguments of the run commands and `upload` are files.
  if (RUN_COMMANDS.has(command.name()) || command.name() === 'upload') {
    return [FILES];
  }
  return [];
}

const BASH = `# testingbot completion for bash
# Install: echo 'eval "$(testingbot completion bash)"' >> ~/.bashrc
_testingbot_complete() {
  local cur="\${COMP_WORDS[COMP_CWORD]}" IFS=$'\\n' entry
  local -a out
  out=($(testingbot __complete "\${COMP_WORDS[@]:1:COMP_CWORD}" 2>/dev/null))
  COMPREPLY=()
  if [[ "\${out[0]}" == "${FILES}" ]]; then
    compopt -o filenames 2>/dev/null
    COMPREPLY=($(compgen -f -- "$cur"))
    return 0
  fi
  for entry in "\${out[@]}"; do
    COMPREPLY+=("$(printf '%q' "\${entry%%$'\\t'*}")")
  done
}
complete -F _testingbot_complete testingbot
`;

const ZSH = `#compdef testingbot
# testingbot completion for zsh
# Install: echo 'eval "$(testingbot completion zsh)"' >> ~/.zshrc
_testingbot() {
  local -a out described
  local entry
  out=("\${(@f)$(testingbot __complete "\${(@)words[2,CURRENT]}" 2>/dev/null)}")
  if [[ "\${out[1]}" == "${FILES}" ]]; then
    _files
    return
  fi
  for entry in "\${out[@]}"; do
    [[ -z "$entry" ]] && continue
    if [[ "$entry" == *$'\\t'* ]]; then
      described+=("\${\${entry%%$'\\t'*}//:/\\\\:}:\${entry#*$'\\t'}")
    else
      described+=("\${entry//:/\\\\:}")
    fi
  done
  _describe -t values 'testingbot' described
}
if [[ "\${zsh_eval_context[-1]}" == loadautofunc ]]; then
  _testingbot "$@"
else
  compdef _testingbot testingbot
fi
`;

const FISH = `# testingbot completion for fish
# Install: testingbot completion fish > ~/.config/fish/completions/testingbot.fish
function __testingbot_complete
    set -l tokens (commandline -opc) (commandline -ct)
    set -l out (testingbot __complete $tokens[2..-1] 2>/dev/null)
    if test "$out[1]" = "${FILES}"
        __fish_complete_path (commandline -ct)
        return
    end
    printf '%s\\n' $out
end
complete -c testingbot -f -a '(__testingbot_complete)'
`;

export type Shell = 'bash' | 'zsh' | 'fish';

export function completionScript(shell: Shell): string {
  return { bash: BASH, zsh: ZSH, fish: FISH }[shell];
}

/** The user's shell from $SHELL, when it is one we support. */
export function detectShell(
  env: NodeJS.ProcessEnv = process.env,
): Shell | undefined {
  const name = (env.SHELL ?? '').split('/').pop();
  return name === 'bash' || name === 'zsh' || name === 'fish'
    ? name
    : undefined;
}
