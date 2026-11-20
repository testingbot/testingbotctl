#!/usr/bin/env python3
"""Presses the live-run keys in a real pseudo-terminal."""
import pexpect, re, sys

def start():
    return pexpect.spawn('testingbot', ['maestro', 'app.apk', 'flows', '--device', 'Pixel 9'],
                         encoding='utf-8', timeout=40, dimensions=(40, 120),
                         env={**__import__('os').environ, 'TERM': 'xterm-256color'})

def plain(s):
    return re.sub(r'\x1b\[[0-9;?]*[A-Za-z]|\x1b\][^\x07]*\x07', '', s)

# o, then d
p = start()
p.expect('open dashboard')
print('hint:', plain(p.before.splitlines()[-1] + 'open dashboard' + p.readline()).strip())
p.send('o')
p.send('d')
p.expect(pexpect.EOF)
p.close()
out = plain(p.before)
print('detach output:', [l.strip() for l in out.splitlines() if 'Detached' in l or 'Dashboard:' in l])
print('detach exit:', p.exitstatus)

# Ctrl-C
p = start()
p.expect('open dashboard')
p.send('\x03')
p.expect(pexpect.EOF)
p.close()
out = plain(p.before)
print('ctrl-c output:', [l.strip() for l in out.splitlines() if 'interrupt' in l.lower() or 'stopp' in l.lower()][:3])
print('ctrl-c exit:', p.exitstatus, p.signalstatus)
print('cancel calls:', [l for l in open('/tmp/mock.log').read().splitlines() if 'cancel' in l])
