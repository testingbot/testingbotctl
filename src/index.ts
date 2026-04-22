#!/usr/bin/env node
import program from './cli';
import { printBanner } from './ui/banner';

printBanner();
program.parse(process.argv);
