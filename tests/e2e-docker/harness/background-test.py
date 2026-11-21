#!/usr/bin/env python3
"""Starts a run with `&` in interactive zsh and bash, writing to the
terminal: it must finish, not be stopped by the shell for switching the
terminal to raw mode."""
import os, pexpect, re

def plain(s):
    return re.sub(r'\x1b\[[0-9;?]*[A-Za-z]|\x1b\][^\x07]*\x07', '', s)

env = {**os.environ, 'TERM': 'xterm-256color', 'PS1': 'PROMPT> ', 'PROMPT': 'PROMPT> '}
for shell, args in (('zsh', ['-f', '-i']), ('bash', ['--norc', '-i'])):
    p = pexpect.spawn(shell, args, encoding='utf-8', timeout=60,
                      dimensions=(40, 120), env=env)
    p.expect('PROMPT> ')
    p.sendline('testingbot maestro app.apk flows --device "Pixel 9" & wait $!; echo "EXIT=$?"')
    i = p.expect([r'EXIT=(\d+)', r'(suspended|Stopped)', pexpect.TIMEOUT])
    out = plain(p.before)
    status = ('finished, exit ' + p.match.group(1) if i == 0
              else 'STOPPED BY SHELL' if i == 1 else 'TIMEOUT')
    print(f'{shell}: {status}; key hint shown: {"open dashboard" in out}; '
          f'verdict: {[l.strip() for l in out.splitlines() if "PASSED" in l and "flows" in l][-1:]}')
    p.sendline('kill %1 2>/dev/null; exit')
    p.close(force=True)
