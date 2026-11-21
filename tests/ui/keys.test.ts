import { EventEmitter } from 'node:events';
import {
  inForeground,
  keyControlsAvailable,
  keyHint,
  startKeyControls,
} from '../../src/ui/keys';
import utils from '../../src/utils';

class FakeStdin extends EventEmitter {
  isTTY = true;
  raw = false;
  paused = true;
  setRawMode(on: boolean) {
    this.raw = on;
    return this;
  }
  resume() {
    this.paused = false;
    return this;
  }
  pause() {
    this.paused = true;
    return this;
  }
}

describe('key controls', () => {
  beforeEach(() => {
    jest.spyOn(utils, 'isInteractive').mockReturnValue(true);
  });
  afterEach(() => jest.restoreAllMocks());

  it('maps o, d and Ctrl-C, and restores the terminal on stop', () => {
    const stdin = new FakeStdin();
    const actions = {
      open: jest.fn(),
      detach: jest.fn(),
      interrupt: jest.fn(),
    };
    const stop = startKeyControls(
      actions,
      stdin as unknown as NodeJS.ReadStream,
      () => true,
    );
    expect(stdin.raw).toBe(true);
    expect(stdin.paused).toBe(false);

    stdin.emit('data', Buffer.from('o'));
    stdin.emit('data', Buffer.from('D'));
    stdin.emit('data', Buffer.from('\u0003'));
    stdin.emit('data', Buffer.from('x'));
    expect(actions.open).toHaveBeenCalledTimes(1);
    expect(actions.detach).toHaveBeenCalledTimes(1);
    expect(actions.interrupt).toHaveBeenCalledTimes(1);

    stop();
    stop(); // idempotent
    expect(stdin.raw).toBe(false);
    expect(stdin.paused).toBe(true);
    stdin.emit('data', Buffer.from('o'));
    expect(actions.open).toHaveBeenCalledTimes(1);
  });

  it('does nothing without a TTY or outside an interactive terminal', () => {
    const stdin = new FakeStdin();
    stdin.isTTY = false;
    startKeyControls(
      { open: jest.fn() },
      stdin as unknown as NodeJS.ReadStream,
    );
    expect(stdin.raw).toBe(false);

    (utils.isInteractive as jest.Mock).mockReturnValue(false);
    const tty = new FakeStdin();
    startKeyControls({ open: jest.fn() }, tty as unknown as NodeJS.ReadStream);
    expect(tty.raw).toBe(false);
  });

  it('stays off for a backgrounded run, so the shell does not stop it', () => {
    const stdin = new FakeStdin();
    const open = jest.fn();
    startKeyControls(
      { open },
      stdin as unknown as NodeJS.ReadStream,
      () => false,
    );
    expect(stdin.raw).toBe(false);
    expect(stdin.paused).toBe(true);
    stdin.emit('data', Buffer.from('o'));
    expect(open).not.toHaveBeenCalled();
  });

  it('can be turned off with TESTINGBOT_KEYS=0', () => {
    const stdin = new FakeStdin() as unknown as NodeJS.ReadStream;
    expect(keyControlsAvailable(stdin, () => true, {})).toBe(true);
    expect(
      keyControlsAvailable(stdin, () => true, { TESTINGBOT_KEYS: '0' }),
    ).toBe(false);
  });

  it('tells whether it runs in the foreground without throwing', () => {
    expect(typeof inForeground()).toBe('boolean');
  });

  it('only advertises the keys that work', () => {
    const plain = (s: string) => s.replace(/\x1b\[[0-9;]*m/g, '');
    expect(plain(keyHint({ open: jest.fn() }, 'stop the runs'))).toBe(
      '  o open dashboard · Ctrl-C stop the runs',
    );
    expect(
      plain(keyHint({ open: jest.fn(), detach: jest.fn() }, 'stop the runs')),
    ).toContain('d detach (runs keep going)');
  });
});
