#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const Verification = require('../shared/answer-verification');

const fixturePath = path.join(__dirname, '..', 'tests', 'fixtures', 'answer-structure-cases.json');
const cases = JSON.parse(fs.readFileSync(fixturePath, 'utf8'));
let failed = 0;
for (const item of cases) {
  const result = Verification.verifySnapshotPair(item.first, item.second);
  const pass = result.verified === item.verified;
  if (!pass) failed += 1;
  process.stdout.write(`${pass ? 'PASS' : 'FAIL'} | ${item.name} | expected=${item.verified} actual=${result.verified} | ${result.reasons.join(',') || 'verified'}\n`);
}
process.stdout.write(`\n${cases.length - failed}/${cases.length} structural cases passed\n`);
process.exitCode = failed ? 1 : 0;
