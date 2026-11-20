import fs from 'node:fs';
import {
  cachedDevices,
  checkDevice,
  editDistance,
  suggestDevices,
  verifyDevices,
} from '../../src/utils/device_check';
import { stateDir } from '../../src/utils/state';
import * as account from '../../src/providers/account';
import type { CatalogDevice } from '../../src/providers/account';

const catalog: CatalogDevice[] = [
  { name: 'Pixel 9', platform: 'Android', versions: ['15', '14'], real: false },
  { name: 'Pixel 8', platform: 'Android', versions: ['14'], real: false },
  { name: 'Galaxy S24', platform: 'Android', versions: ['14'], real: false },
  { name: 'iPhone 16', platform: 'iOS', versions: ['18.2'], real: false },
  { name: 'iPhone 16 Pro', platform: 'iOS', versions: ['18.2'], real: false },
];

beforeEach(() => {
  fs.rmSync(stateDir(), { recursive: true, force: true });
  jest.restoreAllMocks();
});

describe('editDistance', () => {
  it('counts single-character edits', () => {
    expect(editDistance('pixel', 'pixel')).toBe(0);
    expect(editDistance('pixle', 'pixel')).toBe(2);
    expect(editDistance('', 'abc')).toBe(3);
  });
});

describe('suggestDevices', () => {
  it('finds names despite typos, spacing and case', () => {
    expect(suggestDevices('Pixle 9', catalog)[0]).toBe('Pixel 9');
    expect(suggestDevices('pixel9', catalog)[0]).toBe('Pixel 9');
    expect(suggestDevices('iphone16', catalog)[0]).toBe('iPhone 16');
    expect(suggestDevices('Galaxy S42', catalog)[0]).toBe('Galaxy S24');
  });

  it('suggests nothing for something unrelated', () => {
    expect(suggestDevices('Nokia 3310', catalog)).toEqual([]);
  });
});

describe('checkDevice', () => {
  it('accepts exact, differently cased and partial names', () => {
    expect(checkDevice({ device: 'Pixel 9' }, catalog)).toBeUndefined();
    expect(checkDevice({ device: 'pixel 9' }, catalog)).toBeUndefined();
    expect(checkDevice({ device: 'Galaxy' }, catalog)).toBeUndefined();
  });

  it('never checks wildcards or regexes', () => {
    expect(checkDevice({ device: 'Nokia.*' }, catalog)).toBeUndefined();
    expect(checkDevice({ device: '*' }, catalog)).toBeUndefined();
  });

  it('reports an unknown name with suggestions', () => {
    expect(checkDevice({ device: 'Pixle 9' }, catalog)).toBe(
      'No device named "Pixle 9". Did you mean "Pixel 9"?',
    );
    expect(checkDevice({ device: 'Nokia 3310', real: true }, catalog)).toBe(
      'No real device named "Nokia 3310".',
    );
  });

  it('checks the version of an exactly named device, allowing prefixes', () => {
    expect(checkDevice({ device: 'Pixel 9', version: '13' }, catalog)).toBe(
      '"Pixel 9" has no OS version 13. Available: 15, 14.',
    );
    expect(
      checkDevice({ device: 'Pixel 9', version: '15' }, catalog),
    ).toBeUndefined();
    expect(
      checkDevice({ device: 'iPhone 16', version: '18' }, catalog),
    ).toBeUndefined();
    expect(
      checkDevice({ device: 'Pixel 9', version: '1*' }, catalog),
    ).toBeUndefined();
    // Partial names may span devices: the version is not checked.
    expect(checkDevice({ device: 'Pixel', version: '99' }, catalog)).toBe(
      undefined,
    );
  });

  it('skips the check with an empty catalog', () => {
    expect(checkDevice({ device: 'Anything' }, [])).toBeUndefined();
  });
});

describe('verifyDevices', () => {
  it('fails with every problem and the way out', async () => {
    jest.spyOn(account, 'listDevices').mockResolvedValue(catalog);
    await expect(
      verifyDevices('maestro', [
        { device: 'Pixle 9' },
        { device: 'Galaxy S24', version: '9' },
        { device: 'iPhone 16' },
      ]),
    ).rejects.toThrow(
      /No device named "Pixle 9"\. Did you mean "Pixel 9"\?\n"Galaxy S24" has no OS version 9\. Available: 14\.\nSee every device with "testingbot devices --framework maestro"\.\nSet TESTINGBOT_SKIP_DEVICE_CHECK=1/,
    );
  });

  it('passes valid devices and caches the catalog for completion', async () => {
    const spy = jest.spyOn(account, 'listDevices').mockResolvedValue(catalog);
    await verifyDevices('maestro', [{ device: 'Pixel 9' }]);
    await verifyDevices('maestro', [{ device: 'Pixel 8' }]);
    expect(spy).toHaveBeenCalledTimes(1); // second call served from cache
    expect(cachedDevices('maestro')?.map((d) => d.name)).toContain('Pixel 9');
  });

  it('never blocks a run when the catalog is unreachable', async () => {
    jest.spyOn(account, 'listDevices').mockRejectedValue(new Error('offline'));
    await expect(
      verifyDevices('maestro', [{ device: 'Pixle 9' }]),
    ).resolves.toBeUndefined();
  });

  it('can be turned off and makes no request for wildcards', async () => {
    const spy = jest.spyOn(account, 'listDevices').mockResolvedValue(catalog);
    await verifyDevices('maestro', [{ device: 'Pixle 9' }], undefined, {
      TESTINGBOT_SKIP_DEVICE_CHECK: '1',
    });
    await verifyDevices('maestro', [{ device: 'Pixel.*' }, {}]);
    expect(spy).not.toHaveBeenCalled();
  });

  it('checks real devices against the real-device catalog', async () => {
    const spy = jest
      .spyOn(account, 'listDevices')
      .mockImplementation(async ({ real }) =>
        real
          ? [
              {
                name: 'Pixel 7',
                platform: 'Android',
                versions: ['13'],
                real: true,
              },
            ]
          : catalog,
      );
    await expect(
      verifyDevices('espresso', [{ device: 'Pixel 9', real: true }]),
    ).rejects.toThrow(/No real device named "Pixel 9"[\s\S]*--real/);
    expect(spy).toHaveBeenCalledWith(expect.objectContaining({ real: true }));
  });
});
