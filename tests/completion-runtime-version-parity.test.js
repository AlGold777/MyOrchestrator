/** @jest-environment node */
const fs = require('fs');
const vm = require('vm');
test('background accepts the shipped completion protocol and rejects stale versions', () => {
  const protocol = require('../shared/completion-protocol');
  const detector = fs.readFileSync(require.resolve('../content-utils/response-lifecycle-detector'), 'utf8');
  const detectorVersion = detector.match(/const VERSION = '([^']+)'/)[1];
  const router = fs.readFileSync(require.resolve('../background/message-router'), 'utf8');
  const a = router.indexOf('const EXPECTED_COMPLETION_DETECTOR_VERSION');
  const b = router.indexOf('// Readiness must not wait', a);
  if (a < 0 || b <= a) throw new Error('Runtime contract boundaries changed');
  const healthy = vm.runInNewContext(router.slice(a, b) + '\nisCompletionRuntimeHealthy;', {
    chrome: { runtime: { getManifest: () => ({ version: 'test-build' }) } }
  });
  const runtime = { completionSessionAvailable: true, buildVersion: 'test-build',
    detectorVersion, protocolVersion: protocol.version };
  expect(healthy(runtime)).toBe(true);
  expect(healthy({ ...runtime, protocolVersion: 'stale-protocol' })).toBe(false);
  expect(healthy({ ...runtime, buildVersion: 'old-build' })).toBe(false);
  expect(healthy({ ...runtime, completionSessionAvailable: false })).toBe(false);
});
