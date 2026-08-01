#!/usr/bin/env node
/**
 * CLI wrapper over shared/telemetry-digest.js.
 *
 * The digest itself lives in shared/ because the results page generates it on
 * export too — one implementation, so a digest pasted from a file and one saved
 * by the Export button can never disagree.
 *
 * Usage:
 *   node scripts/telemetry-digest.js <export.json> [--json]
 */
'use strict';

const fs = require('fs');
const { buildDigest, render } = require('../shared/telemetry-digest.js');

const file = process.argv[2];
if (!file) {
  console.error('usage: node scripts/telemetry-digest.js <export.json> [--json]');
  process.exit(1);
}
const digest = buildDigest(JSON.parse(fs.readFileSync(file, 'utf8')));
console.log(process.argv.includes('--json') ? JSON.stringify(digest, null, 2) : render(digest));
