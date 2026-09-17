/** @jest-environment node */
const fs = require('fs');
const vm = require('vm');

test.each([
  [false, 'get_it_completed'],
  [true, 'get_it_empty']
])('GET_IT_BATCH reaches the loaded orchestrator (failedOnly=%s)', async (failedOnly, status) => {
  const context = vm.createContext({
    AbortController,
    jobState: { llms: {}, session: { startTime: 123 } },
    isAppUiTab: () => true
  });
  context.self = context;
  // Load the complete module, including its real closure and public exports.
  vm.runInContext(fs.readFileSync(require.resolve('../background/job-orchestrator'), 'utf8'), context);
  const router = fs.readFileSync(require.resolve('../background/message-router'), 'utf8');
  const start = router.indexOf("case 'GET_IT_BATCH':");
  const end = router.indexOf("case 'MANUAL_RESPONSE_PING':", start);
  vm.runInContext(`function route(message, sender, sendResponse) {
    switch (message.type) { ${router.slice(start, end)} }
  }`, context);
  const response = await new Promise((resolve, reject) => {
    try {
      expect(context.route(
        { type: 'GET_IT_BATCH', llmNames: [], failedOnly },
        { tab: { id: 7 } }, resolve
      )).toBe(true);
    } catch (error) { reject(error); }
  });
  expect(response).toEqual({ status, results: [] });
});
