const fs = require('fs');
const path = require('path');
const vm = require('vm');

const SELECTOR_METRICS_PATH = path.join(__dirname, '..', 'background', 'selector-metrics.js');
const SELECTOR_METRICS_SOURCE = fs.readFileSync(SELECTOR_METRICS_PATH, 'utf8');

function createSelectorMetricsSandbox() {
  const stored = {};
  const context = {
    console,
    Promise,
    Map,
    Set,
    Date,
    Math,
    Array,
    Object,
    Number,
    String,
    Boolean,
    JSON,
    setTimeout,
    clearTimeout,
    self: {},
    selectorResolutionMetrics: new Map(),
    selectorFailureMetrics: {},
    selectorHealthMeta: { updatedAt: null, perKey: {} },
    selectorHealthChecks: {},
    selectorMetricsDirty: false,
    selectorMetricsFlushTimer: null,
    selectorMetricsFlushInFlight: false,
    chrome: {
      runtime: {
        getManifest() {
          return { version: 'test' };
        }
      },
      storage: {
        local: {
          async get(key) {
            if (key === null) return { ...stored };
            if (typeof key === 'string') return { [key]: stored[key] };
            const result = {};
            Object.keys(key || {}).forEach((item) => {
              result[item] = stored[item] ?? key[item];
            });
            return result;
          },
          async set(obj) {
            Object.assign(stored, obj || {});
          },
          async remove(keys) {
            (Array.isArray(keys) ? keys : [keys]).forEach((key) => delete stored[key]);
          }
        }
      },
      scripting: {
        executeScript: jest.fn()
      },
      alarms: {
        create: jest.fn()
      }
    },
    appendLogEntry: jest.fn(),
    TabMapManager: {
      entries() {
        return [];
      }
    }
  };
  context.self = context;

  vm.createContext(context);
  vm.runInContext(SELECTOR_METRICS_SOURCE, context, { filename: 'background/selector-metrics.js' });
  return { context, stored };
}

describe('selector health profile', () => {
  test('classifies zero-hit repeated failures as broken and persists behavior profile', async () => {
    const { context, stored } = createSelectorMetricsSandbox();

    context.selectorFailureMetrics.GPT_composer_fail = 3;
    context.selectorHealthMeta.updatedAt = 1780912800000;
    context.selectorHealthMeta.perKey['GPT::composer'] = 1780912800000;

    const profile = context.buildSelectorHealthProfiles();

    expect(profile.profiles['GPT::composer']).toEqual(expect.objectContaining({
      profileStatus: 'broken',
      hits: 0,
      failures: 3,
      total: 3
    }));

    await context.persistResolutionMetrics();
    expect(stored.selector_health_profile_v1.profiles['GPT::composer']).toEqual(expect.objectContaining({
      profileStatus: 'broken'
    }));
  });
});
