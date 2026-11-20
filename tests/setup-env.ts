import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// Keep the CLI's remembered state (update checks, device caches, first-run
// flags) out of the developer's real ~/.config while tests run.
process.env.XDG_CONFIG_HOME = fs.mkdtempSync(
  path.join(os.tmpdir(), 'testingbot-cli-test-'),
);
delete process.env.TESTINGBOT_NOTIFY;
// A .testingbot.yml above the checkout must not leak into CLI tests.
process.env.TESTINGBOT_CONFIG = 'none';
