const Schema = require('../disput/debate-case-schema');
global.DebateCaseSchema = Schema;
const Migrations = require('../disput/debate-storage-migrations');

const makeStorage = (seed = {}) => {
  const values = new Map(Object.entries(seed).map(([key, value]) => [key, JSON.stringify(value)]));
  return {
    values,
    getItem: (key) => values.get(key) || null,
    setItem: (key, value) => values.set(key, String(value)),
    removeItem: (key) => values.delete(key)
  };
};

describe('P0-R9 / P1-C1 persisted-data migration matrix', () => {
  test.each([
    ['run', { schemaVersion: 1, runId: 'r1', customRunField: { keep: true } }],
    ['revision', { schemaVersion: 0, revisionId: 'rev1', customRevisionField: 'keep' }],
    ['trace', { schemaVersion: 1, runs: [], customTraceField: 7 }],
    ['participant', { schemaVersion: 0, participantId: 'p1', availability: 'ready', customParticipantField: true }],
    ['custom_config', { schemaVersion: 0, configId: 'cfg1', models: ['a'], customConfigField: 'keep' }]
  ])('migrates %s records idempotently while preserving unknown fields', (kind, input) => {
    const first = Migrations.migrateRecord(kind, input);
    const second = Migrations.migrateRecord(kind, first.value);
    const customKey = Object.keys(input).find((key) => key.startsWith('custom'));
    expect(first.value.schemaVersion).toBe(Migrations.targetVersion(kind));
    expect(first.value.extensions.legacyUnknownFields[customKey]).toEqual(input[customKey]);
    expect(second.value).toEqual(first.value);
    expect(second.receipt.changed).toBe(false);
  });

  test('case migration preserves unknown fields, converts artifact arrays and is idempotent', () => {
    const legacy = {
      schemaVersion: 2, caseId: 'migration-case', createdAt: 1,
      customFutureCompatibleField: { value: 42 },
      artifacts: [{ id: 'c1', type: 'claim', status: 'asserted', provenance: { source: 'legacy' } }],
      changes: [], sourceEvents: []
    };
    const first = Migrations.migrateRecord('case', legacy);
    expect(Array.isArray(first.value.artifacts)).toBe(false);
    expect(first.value.extensions.legacyUnknownFields.customFutureCompatibleField).toEqual({ value: 42 });
    expect(Schema.validateCase(first.value)).toEqual({ ok: true, errors: [] });
    expect(Migrations.migrateRecord('case', first.value).value).toEqual(first.value);
  });

  test('transaction creates an exportable backup and supports explicit restore', async () => {
    const storage = makeStorage({ record: { schemaVersion: 0, configId: 'cfg', custom: 'before' } });
    const transaction = Migrations.createTransaction({ storage, key: 'record', kind: 'custom_config' });
    const migrated = await transaction.run();
    expect(migrated.ok).toBe(true);
    expect(JSON.parse(storage.getItem('record')).schemaVersion).toBe(1);
    expect(JSON.parse(await transaction.exportBackup()).value.custom).toBe('before');
    expect(await transaction.restore()).toMatchObject({ ok: true, value: { custom: 'before' } });
    expect(JSON.parse(storage.getItem('record')).custom).toBe('before');
  });

  test('failed verified write rolls the original record back without destructive downgrade', async () => {
    const values = new Map([['record', JSON.stringify({ schemaVersion: 0, configId: 'cfg', custom: 'safe' })]]);
    let corruptNextRead = false;
    const storage = {
      getItem(key) {
        if (key === 'record' && corruptNextRead) {
          corruptNextRead = false;
          return JSON.stringify({ corrupted: true });
        }
        return values.get(key) || null;
      },
      setItem(key, value) {
        values.set(key, String(value));
        if (key === 'record' && JSON.parse(String(value)).schemaVersion === 1) corruptNextRead = true;
      },
      removeItem: (key) => values.delete(key)
    };
    const transaction = Migrations.createTransaction({ storage, key: 'record', kind: 'custom_config' });
    const result = await transaction.run();
    expect(result).toMatchObject({ ok: false, code: 'MIGRATION_FAILED_ROLLED_BACK' });
    expect(JSON.parse(storage.getItem('record'))).toEqual({ schemaVersion: 0, configId: 'cfg', custom: 'safe' });
  });

  test('future schemas fail closed and leave persisted data untouched', async () => {
    const future = { schemaVersion: 999, runId: 'future' };
    const storage = makeStorage({ record: future });
    const transaction = Migrations.createTransaction({ storage, key: 'record', kind: 'run' });
    expect(await transaction.run()).toMatchObject({ ok: false, code: 'MIGRATION_FAILED_ROLLED_BACK' });
    expect(JSON.parse(storage.getItem('record'))).toEqual(future);
  });
});
