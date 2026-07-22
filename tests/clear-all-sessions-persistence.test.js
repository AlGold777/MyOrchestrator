const fs = require('fs');
const path = require('path');

const ROUTER_SRC = fs.readFileSync(path.join(__dirname, '..', 'background', 'message-router.js'), 'utf8');

describe('CLEAR_ALL_SESSIONS persistence cleanup', () => {
  test('removes persisted jobState as well as clearing in-memory state', () => {
    const clearCase = ROUTER_SRC.slice(
      ROUTER_SRC.indexOf("case 'CLEAR_ALL_SESSIONS'"),
      ROUTER_SRC.indexOf("case 'MANUAL_RESPONSE_PING'")
    );
    expect(clearCase).toContain('jobState = {}');
    expect(clearCase).toMatch(/CompressedStorage\.remove\('jobState'\)|chrome\.storage\.local\.remove\(\['jobState'\]/);
  });
});
