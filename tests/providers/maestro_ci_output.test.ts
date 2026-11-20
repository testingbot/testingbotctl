import Maestro from '../../src/providers/maestro';
import MaestroOptions from '../../src/models/maestro_options';
import Credentials from '../../src/models/credentials';
import type { MaestroFlowInfo } from '../../src/providers/maestro';

/** Non-interactive (CI) output of the live flow table. */
describe('Maestro append-only flow output', () => {
  const strip = (s: string) => s.replace(/\x1b\[[0-9;]*m/g, '');
  let lines: string[];
  let writes: string[];

  beforeEach(() => {
    lines = [];
    writes = [];
    jest.spyOn(console, 'log').mockImplementation((s = '') => {
      lines.push(strip(String(s)));
    });
    jest.spyOn(process.stdout, 'write').mockImplementation((s) => {
      writes.push(String(s));
      return true;
    });
  });
  afterEach(() => jest.restoreAllMocks());

  it('prints each finished flow once, with its fail reason, and never moves the cursor', () => {
    const maestro = new Maestro(
      new Credentials('k', 's'),
      MaestroOptions.forExistingProject({}),
    );
    const previous = new Map();
    const flow = (
      id: number,
      name: string,
      status: MaestroFlowInfo['status'],
      extra: Partial<MaestroFlowInfo> = {},
    ): MaestroFlowInfo => ({ id, name, status, ...extra });

    maestro['appendFinishedFlows'](
      [flow(1, 'login.yaml', 'READY'), flow(2, 'search.yaml', 'WAITING')],
      previous,
    );
    expect(lines).toEqual([]);

    maestro['appendFinishedFlows'](
      [
        flow(1, 'login.yaml', 'DONE', { success: 1 }),
        flow(2, 'search.yaml', 'READY'),
      ],
      previous,
    );
    maestro['appendFinishedFlows'](
      [
        flow(1, 'login.yaml', 'DONE', { success: 1 }),
        flow(2, 'search.yaml', 'FAILED', {
          error_messages: ['Element "Search" not found'],
        }),
      ],
      previous,
    );

    expect(lines).toHaveLength(4); // header, separator, two rows
    expect(lines[0]).toContain('Fail reason');
    expect(lines[2]).toMatch(/✔ PASSED\s+login\.yaml/);
    expect(lines[3]).toMatch(
      /✘ FAILED\s+search\.yaml\s+Element "Search" not found/,
    );
    expect(writes.join('')).not.toMatch(/\x1b\[\d*[AK]/);
  });
});
