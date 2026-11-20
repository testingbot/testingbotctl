#!/usr/bin/env python3
"""Tab-completes in real interactive bash, zsh and fish and prints the result.

Each case types a partial command line, presses Tab, then turns the edited
line into an `echo` (Ctrl-A, "echo ", Enter) so the shell prints exactly what
completion inserted.
"""
import pexpect, sys, subprocess, os

subprocess.run(['testingbot', 'devices'], stdout=subprocess.DEVNULL, check=True)
subprocess.run(['testingbot', 'devices', '--framework', 'espresso'], stdout=subprocess.DEVNULL, check=True)
os.makedirs('/tmp/flows', exist_ok=True)
open('/tmp/flows/login.yaml', 'w').write('x')

SHELLS = {
    'bash': (['bash', '--norc', '--noprofile', '-i'], 'eval "$(testingbot completion bash)"'),
    'zsh': (['zsh', '-f', '-i'], 'autoload -Uz compinit && compinit -u && eval "$(testingbot completion zsh)"'),
    'fish': (['fish', '--no-config', '-i'], 'testingbot completion fish | source'),
}
CASES = [
    ('command', 'testingbot mae', '\t'),
    ('option', 'testingbot maestro --device-mat', '\t'),
    ('device name', 'testingbot maestro --device Galax', '\t'),
    ('device (espresso)', 'testingbot espresso --device Gal', '\t'),
    ('version', 'testingbot maestro --device "Pixel 8" --deviceVersion ', '\t'),
    ('choice', 'testingbot maestro --report jun', '\t'),
    ('file', 'testingbot maestro /tmp/flo', '\t'),
]
failures = 0
for shell, (argv, setup) in SHELLS.items():
    env = dict(os.environ, PS1='$ ', TERM='xterm', HOME='/tmp/home-' + shell,
               XDG_CONFIG_HOME='/root/.config')
    os.makedirs(env['HOME'], exist_ok=True)
    p = pexpect.spawn(argv[0], argv[1:], env=env, encoding='utf-8', timeout=10, dimensions=(40, 200))
    p.send(setup + '\r')
    p.send('echo READY\r')
    p.expect('READY\r\n')
    for name, text, keys in CASES:
        marker = f'__{abs(hash(name)) % 10000}__'
        p.send(text + keys)
        import time; time.sleep(1.2)
        p.send('\x01echo ' + marker + ' ')
        p.send('\r')
        try:
            # The output line, not the echoed input: it starts a line.
            p.expect(r'(?<!echo )' + marker + r' ([^\r\n]*)\r\n')
            got = p.match.group(1)
        except pexpect.TIMEOUT:
            got = '<timeout>'
        print(f'{shell:5} {name:18} {got}')
        p.send('\r')
    p.send('exit\r')
