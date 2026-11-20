#!/usr/bin/env node
import program from './cli';
import { printBanner } from './ui/banner';
import { complete } from './commands/completion';

// The shell completion callback: answer and exit before Commander parses
// (the words being completed are not valid arguments yet).
if (process.argv[2] === '__complete') {
  try {
    const candidates = complete(program, process.argv.slice(3));
    if (candidates.length > 0)
      process.stdout.write(`${candidates.join('\n')}\n`);
  } catch {
    // A broken completion must never print an error into the prompt.
  }
} else {
  printBanner();
  program.parse(process.argv);
}
