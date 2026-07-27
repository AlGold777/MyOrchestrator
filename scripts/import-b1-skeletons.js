#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');
const SecretRedaction = require('../shared/secret-redaction');
const B1SkeletonCollector = require('../background/b1-skeleton-collector');

const inputPaths = process.argv.slice(2).map((value) => path.resolve(value));
if (!inputPaths.length || inputPaths.some((inputPath) => !fs.existsSync(inputPath))) {
  throw new Error('Usage: node scripts/import-b1-skeletons.js <sanitized-b1-export.json> [...]');
}

const payloads = inputPaths.map((inputPath) => JSON.parse(fs.readFileSync(inputPath, 'utf8')));
const expected = B1SkeletonCollector.TARGETS.map((target) => target.platform);
const selectorSource = fs.readFileSync(path.join(__dirname, '..', 'content-scripts', 'answer-pipeline-selectors.js'), 'utf8');
const resolverSource = fs.readFileSync(path.join(__dirname, '..', 'content-scripts', 'turn-resolver.js'), 'utf8');
const structureSource = fs.readFileSync(path.join(__dirname, '..', 'content-scripts', 'answer-structure.js'), 'utf8');
const byPlatform = new Map();
const failures = [];

function replayCapture(capture, platform) {
  const dom = new JSDOM(`<!doctype html><html><body>${capture.html}</body></html>`, {
    runScripts: 'outside-only',
    url: 'https://fixture.invalid/'
  });
  const { window } = dom;
  window.eval(selectorSource);
  window.eval(resolverSource);
  window.eval(structureSource);
  const selectors = window.AnswerPipelineSelectors.PLATFORM_SELECTORS[platform];
  const turn = window.TurnResolver.resolveTurn({ platform, selectors, document: window.document, minimumTextLength: 5 });
  const structure = window.AnswerStructure.inspect(turn.messageRoot, turn.answerNode);
  dom.window.close();
  return { exact: turn.resolution === 'exact', complete: structure.complete === true };
}

for (const payload of payloads) {
  for (const entry of payload.results || []) {
    if (!expected.includes(entry?.platform) || !entry?.capture) continue;
    const capture = entry.capture;
    const privacy = B1SkeletonCollector.validateCapture(capture, entry.platform, SecretRedaction);
    if (!privacy.ok
      || entry.status !== 'captured'
      || capture.resolution !== 'exact'
      || capture.diagnosticContext !== false
      || capture.structuralComplete !== true
      || Number(capture.selectedAnswerLength || 0) < 5) continue;
    const replay = replayCapture(capture, entry.platform);
    if (!replay.exact || !replay.complete) continue;
    const previous = byPlatform.get(entry.platform);
    if (!previous || B1SkeletonCollector.captureRank(capture) > B1SkeletonCollector.captureRank(previous.capture)) {
      byPlatform.set(entry.platform, { capture, sourceExtensionVersion: payload.extensionVersion || 'unknown' });
    }
  }
}

for (const platform of expected) {
  if (!byPlatform.has(platform)) failures.push(`${platform}:no_replayable_exact_fixture`);
}

if (failures.length) throw new Error(`B1 fixture gate failed: ${failures.join(', ')}`);

const outputDir = path.join(__dirname, '..', 'tests', 'fixtures', 'live-answer-skeletons');
fs.mkdirSync(outputDir, { recursive: true });
for (const platform of expected) {
  const selected = byPlatform.get(platform);
  const capture = selected.capture;
  const fixture = {
    schemaVersion: 1,
    platform,
    sourceExtensionVersion: selected.sourceExtensionVersion,
    privacyPolicy: 'sanitized_dom_skeletons_without_conversation_text_or_session_identifiers',
    capture
  };
  fs.writeFileSync(path.join(outputDir, `${platform}.json`), `${JSON.stringify(fixture, null, 2)}\n`, 'utf8');
}

const index = {
  schemaVersion: 1,
  sourceExtensionVersions: Array.from(new Set(Array.from(byPlatform.values()).map((entry) => entry.sourceExtensionVersion))).sort(),
  platformCount: expected.length,
  platforms: expected,
  exactCount: expected.length,
  structurallyCompleteCount: expected.length,
  ignoredRiskPlatforms: []
};
fs.writeFileSync(path.join(outputDir, 'index.json'), `${JSON.stringify(index, null, 2)}\n`, 'utf8');
process.stdout.write(`Imported ${expected.length} privacy-safe B1 fixtures into ${outputDir}\n`);
