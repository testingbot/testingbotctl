#!/usr/bin/env python3
"""Runs a command in a pseudo-terminal and prints what the screen shows.

usage: screen.py [--cols N] [--rows N] [--raw FILE] -- cmd args...

The output is fed through pyte (a terminal emulator), so in-place redraws,
cursor movement and line clearing are applied exactly as a terminal would:
what is printed is the final screen plus everything scrolled off the top.
"""
import os, pty, sys, select, argparse, pyte

ap = argparse.ArgumentParser()
ap.add_argument('--cols', type=int, default=100)
ap.add_argument('--rows', type=int, default=40)
ap.add_argument('--raw')
ap.add_argument('cmd', nargs=argparse.REMAINDER)
a = ap.parse_args()
cmd = a.cmd[1:] if a.cmd and a.cmd[0] == '--' else a.cmd

screen = pyte.HistoryScreen(a.cols, a.rows, history=5000)
stream = pyte.ByteStream(screen)
pid, fd = pty.fork()
if pid == 0:
    os.environ['COLUMNS'] = str(a.cols)
    os.environ['LINES'] = str(a.rows)
    import fcntl, termios, struct
    fcntl.ioctl(1, termios.TIOCSWINSZ, struct.pack('HHHH', a.rows, a.cols, 0, 0))
    os.execvp(cmd[0], cmd)
raw = b''
while True:
    try:
        r, _, _ = select.select([fd], [], [], 0.2)
        if fd in r:
            data = os.read(fd, 65536)
            if not data:
                break
            raw += data
            stream.feed(data)
    except OSError:
        break
_, status = os.waitpid(pid, 0)
if a.raw:
    open(a.raw, 'wb').write(raw)
lines = [''.join(row[x].data for x in range(a.cols)).rstrip() for row in screen.history.top]
lines += [l.rstrip() for l in screen.display]
while lines and not lines[-1]:
    lines.pop()
print('\n'.join(lines))
print(f'[exit {os.waitstatus_to_exitcode(status)}]')
