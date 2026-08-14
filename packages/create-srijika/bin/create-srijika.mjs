#!/usr/bin/env node

import { runSrijikaCli } from '@srijika/cli';

const arguments_ = process.argv.slice(2);
const first = arguments_[0];
const forwarded =
  first === 'create' ||
  first === 'help' ||
  first === '--help' ||
  first === '-h' ||
  first === 'version' ||
  first === '--version' ||
  first === '-v'
    ? arguments_
    : ['create', ...arguments_];

runSrijikaCli(forwarded)
  .then((code) => {
    process.exitCode = code;
  })
  .catch((error) => {
    console.error(`create-srijika: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  });
