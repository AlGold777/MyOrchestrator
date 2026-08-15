require('../shared/proof-telemetry-policy.js');
const fs = require('fs');
const os = require('os');
const path = require('path');
const ProofTelemetry = require('../shared/proof-oriented-telemetry.js');
const { validateContainer, validateStandaloneReport } = require('../scripts/validate-proof-telemetry.js');
const Cli = require('../scripts/build-proof-telemetry-report.js');
const { SCENARIOS, sourceRows } = require('./fixtures/proof-telemetry-scenario-matrix.js');

describe('offline proof telemetry report CLI', () => {
  async function fixture() {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'proof-cli-'));
    const scenario = SCENARIOS.find((item) => item.id === 'multiple-incidents');
    const ledger = ProofTelemetry.buildLedger(sourceRows(scenario), { runSessionId: 'fixture-run', exportedAt: 20000 });
    const canonical = await ProofTelemetry.buildCanonicalEvidence(ledger, {
      canonicalLedger: true, exportedAt: 20000, extensionVersion: 'test', snapshotConsistency: 'queue_drained'
    });
    const filename = path.join(directory, 'source.json');
    fs.writeFileSync(filename, JSON.stringify(canonical));
    return { directory, filename, sourceBytes: fs.readFileSync(filename), canonical };
  }

  test('lists incidents and refuses an ambiguous selection', async () => {
    const { filename } = await fixture();
    const listed = await Cli.run([filename, '--list-incidents']);
    expect(listed.reproductionMode).toBe('exact-reproduction');
    expect(listed.incidentCount).toBeGreaterThan(1);
    await expect(Cli.run([filename, '--task=cutted', '--model=GPT']))
      .rejects.toThrow(/AMBIGUOUS_INCIDENT/);
  });

  test('builds and validates one report with complete source/cache provenance without changing the source', async () => {
    const { filename, sourceBytes, canonical } = await fixture();
    const incidentId = Object.keys(canonical.incidentIndex.incidents)[0];
    const report = await Cli.run([filename, '--task=cutted', `--incident=${incidentId}`, '--exported-at=21000']);
    expect((await validateStandaloneReport(report)).errors.map((error) => error.code))
      .toEqual(expect.arrayContaining(['S15']));
    expect(report.crossReportCompatibility.sourceArtifact).toEqual(expect.objectContaining({
      sourceContainerType: 'canonical-evidence',
      sourceArtifactHash: canonical.integrity.hashes.artifact,
      reproductionMode: 'exact-reproduction',
      cacheKey: expect.objectContaining({
        sourceLedgerHash: canonical.ledger.ledgerHash,
        registryHash: canonical.integrity.hashes.registry,
        generatorVersion: ProofTelemetry.GENERATOR_VERSION,
        reportVersion: ProofTelemetry.REPORT_VERSION,
        reportType: 'cutted',
        incidentId,
        modelId: 'GPT',
        reproductionMode: 'exact-reproduction'
      })
    }));
    expect(report.crossReportCompatibility.sourceArtifact.diagnosticLimitations)
      .toEqual([expect.objectContaining({ code: 'S15' })]);
    const stderr = { write: jest.fn() };
    Cli.writeDiagnosticLimitations(report, stderr);
    expect(stderr.write).toHaveBeenCalledWith(expect.stringContaining('[telemetry limitation] S15:'));
    expect(fs.readFileSync(filename)).toEqual(sourceBytes);
  });

  test('rebuilds and validates full forensic output without modifying canonical input', async () => {
    const { filename, sourceBytes } = await fixture();
    const output = await Cli.run([filename, '--all', '--exported-at=21000']);
    expect(output.containerType).toBe('all-presets');
    expect(output.manifest.sourceArtifact).toEqual(expect.objectContaining({ reproductionMode: 'exact-reproduction' }));
    expect(output.manifest.sourceArtifact.diagnosticLimitations.map((item) => item.code).sort())
      .toEqual(['S06', 'S06', 'S15']);
    expect((await validateContainer(output)).errors.map((error) => error.code).sort())
      .toEqual(['S06', 'S06', 'S15']);
    expect(fs.readFileSync(filename)).toEqual(sourceBytes);
  });

  test('never overwrites the source path', async () => {
    const { filename, sourceBytes } = await fixture();
    expect(() => Cli.writeOutput(filename, { changed: true }, filename)).toThrow(/OUTPUT_OVERWRITES_SOURCE/);
    expect(fs.readFileSync(filename)).toEqual(sourceBytes);
  });

  test('requires an explicit reinterpretation mode for an unknown generator', async () => {
    const { filename, canonical } = await fixture();
    const changed = JSON.parse(JSON.stringify(canonical));
    changed.sharedConfig.generatorVersion = 'proof-export@future';
    for (let pass = 0; pass < 3; pass += 1) {
      changed.integrity.size.measuredBytes = Buffer.byteLength(JSON.stringify(changed));
    }
    const hashInput = JSON.parse(JSON.stringify(changed));
    delete hashInput.integrity.hashes.artifact;
    changed.integrity.hashes.artifact = await ProofTelemetry.sha256(hashInput);
    fs.writeFileSync(filename, JSON.stringify(changed));
    const incidentId = Object.keys(changed.incidentIndex.incidents)[0];
    await expect(Cli.run([filename, '--task=cutted', `--incident=${incidentId}`]))
      .rejects.toThrow(/REPRODUCTION_UNSUPPORTED/);
    const report = await Cli.run([
      filename,
      '--task=cutted',
      `--incident=${incidentId}`,
      '--reproduction=reinterpretation',
      '--exported-at=21000'
    ]);
    expect(report.crossReportCompatibility.sourceArtifact.reproductionMode).toBe('reinterpretation');
  });

  test('never labels a historical all-presets generator as exact reproduction', async () => {
    const { directory } = await fixture();
    const source = JSON.parse(fs.readFileSync(path.join(
      __dirname,
      '..',
      'docs',
      'proof_oriented_telemetry_spec_v1',
      'all-presets.example.json'
    ), 'utf8'));
    source.sharedConfig.generatorVersion = 'proof-export@2.6.0';
    source.exportAudit.hashes.sharedConfig = await ProofTelemetry.sha256(source.sharedConfig);
    source.exportAudit.hashes.container = `sha256:${'0'.repeat(64)}`;
    for (let pass = 0; pass < 3; pass += 1) {
      source.exportAudit.budget.measuredBytes = Buffer.byteLength(JSON.stringify(source));
    }
    delete source.exportAudit.hashes.container;
    source.exportAudit.hashes.container = await ProofTelemetry.sha256(source);
    const filename = path.join(directory, 'historical-all-presets.json');
    fs.writeFileSync(filename, JSON.stringify(source));

    await expect(Cli.run([filename, '--list-incidents']))
      .rejects.toThrow(/REPRODUCTION_UNSUPPORTED.*generator/);
    const listed = await Cli.run([filename, '--list-incidents', '--reproduction=reinterpretation']);
    expect(listed.reproductionMode).toBe('reinterpretation');
  });

  test('represents unavailable legacy reproduction as an explicit unsupported outcome', async () => {
    const { filename } = await fixture();
    expect(Cli.REQUESTABLE_REPRODUCTION_MODES).toEqual([
      'exact-reproduction',
      'legacy-reproduction',
      'reinterpretation'
    ]);
    expect(Cli.LEGACY_REPRODUCTION_ADAPTERS).toHaveLength(0);
    await expect(Cli.run([filename, '--list-incidents', '--reproduction=legacy-reproduction']))
      .rejects.toEqual(expect.objectContaining({
        code: 'REPRODUCTION_UNSUPPORTED',
        reproductionMode: 'unsupported',
        message: expect.stringContaining('no registered legacy adapter')
      }));
  });

  test('rejects unknown reproduction labels as unsupported instead of silently reinterpreting', async () => {
    const { filename } = await fixture();
    await expect(Cli.run([filename, '--list-incidents', '--reproduction=unsupported']))
      .rejects.toEqual(expect.objectContaining({
        code: 'REPRODUCTION_UNSUPPORTED',
        reproductionMode: 'unsupported'
      }));
  });
});
