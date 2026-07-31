// Reported 2026-07-31: a repeat request opened a new GPT tab even though the
// New pages checkbox was off, and the prompt was submitted only there. The
// telemetry for that run shows GPT alone with an empty dispatch baseline and
// anchorAnswerCount 1 — a fresh page — while every other provider carried a
// baseline from its reused page.
//
// The chain is self-reinforcing: probeReusableTabSurface rejects a tab whose
// composer holds any text, so a draft left behind by a failed insertion makes
// the tab "unsafe" on the next request, tryAttachExistingTab returns false, and
// runModelThroughTabs falls through to createNewLlmTab. One failed insertion
// therefore guarantees a duplicate tab next time.
//
// With New pages off, recoverable residue must never produce a duplicate tab.
const fs = require('fs');
const path = require('path');

const TAB_MANAGER_SRC = fs.readFileSync(
  path.join(__dirname, '..', 'background', 'tab-manager.js'),
  'utf8'
);
const ORCH_SRC = fs.readFileSync(
  path.join(__dirname, '..', 'background', 'job-orchestrator.js'),
  'utf8'
);
const ROUTER_SRC = fs.readFileSync(
  path.join(__dirname, '..', 'background', 'message-router.js'),
  'utf8'
);

describe('a repeat request never opens a duplicate tab', () => {
  test('reuse is mandatory when New pages is off', () => {
    const reuseBranch = ORCH_SRC.slice(
      ORCH_SRC.indexOf('async function runModelThroughTabs'),
      ORCH_SRC.indexOf('async function openTabsSequentially')
    );
    // The forceNewTabs branch returns before this point, so everything below is
    // the New-pages-off path.
    const forceBranchEnd = reuseBranch.indexOf('forceCreate: true');
    const attachAt = reuseBranch.indexOf('await tryAttachExistingTab(', forceBranchEnd);
    expect(attachAt).toBeGreaterThan(-1);
    const attachCall = reuseBranch.slice(attachAt, reuseBranch.indexOf('});', attachAt));
    expect(attachCall).toContain('allowGlobalReuse: true');
    expect(attachCall).toContain('mandatoryReuse: true');
  });

  test('a leftover draft is a soft blocker, an active generation is not', () => {
    const softSet = TAB_MANAGER_SRC.slice(
      TAB_MANAGER_SRC.indexOf('const SOFT_REUSE_BLOCKERS'),
      TAB_MANAGER_SRC.indexOf('async function probeReusableTabSurface')
    );
    expect(softSet).toContain('composer_has_draft');
    expect(softSet).toContain('modal_visible');
    // Taking over a tab mid-generation would destroy a running answer.
    expect(softSet).not.toContain('generation_active');
  });

  test('a soft blocker is overridden instead of rejected, and recorded', () => {
    const preflight = TAB_MANAGER_SRC.slice(
      TAB_MANAGER_SRC.indexOf('const mandatoryReuse = options.mandatoryReuse === true'),
      TAB_MANAGER_SRC.indexOf("details: 'unsafe_reuse_preflight'")
    );
    expect(preflight).toContain('SOFT_REUSE_BLOCKERS.has(surface.reason)');
    expect(preflight).toContain('if (!candidate && mandatoryReuse && firstSoftBlocked)');
    expect(preflight).toContain('SOFT_REUSE_BLOCKER_OVERRIDDEN');
  });

  test('an active generation still blocks, so a running answer is never hijacked', () => {
    const preflight = TAB_MANAGER_SRC.slice(
      TAB_MANAGER_SRC.indexOf('const mandatoryReuse = options.mandatoryReuse === true'),
      TAB_MANAGER_SRC.indexOf("details: 'unsafe_reuse_preflight'")
    );
    // generation_active is not in the soft set, so it can never become the
    // overridden candidate: the override only reads firstSoftBlocked.
    expect(preflight).toContain('firstSoftBlocked = { tab: tabOption, surface }');
    expect(preflight).toContain('candidate = firstSoftBlocked.tab');
  });

  test('both the override and the fallback-create are visible in telemetry', () => {
    const pinned = ROUTER_SRC.slice(
      ROUTER_SRC.indexOf('const DIAG_PINNED_LABELS'),
      ROUTER_SRC.indexOf(']);', ROUTER_SRC.indexOf('const DIAG_PINNED_LABELS'))
    );
    expect(pinned).toContain('SOFT_REUSE_BLOCKER_OVERRIDDEN');
    // Without this pinned, a duplicate tab is created with no retained trace.
    expect(pinned).toContain('TAB_ISOLATION_FALLBACK_CREATE');
  });
});
