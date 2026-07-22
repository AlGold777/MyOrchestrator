# LLM Codex-Codex

Chrome MV3 extension for dispatching prompts to multiple LLM web interfaces,
collecting answers, and running Debate pipelines.

## Start here

- Documentation map and writing rules: [docs/disput-docs/D0_documentation-map.md](docs/disput-docs/D0_documentation-map.md)
- Project setup and runtime overview: [docs/project-overview.md](docs/project-overview.md)
- Current Debate architecture: [docs/disput-docs/D2_disput-architecture.md](docs/disput-docs/D2_disput-architecture.md)
- Main-page model tabs and dispatch: [docs/model-tabs-architecture.md](docs/model-tabs-architecture.md)
- Timing values and wait budgets: [docs/timing-map.md](docs/timing-map.md)
- Current Debate round plans: [docs/disput-docs/D11_debate-round-plans.md](docs/disput-docs/D11_debate-round-plans.md)
- Deferred work only: [docs/disput-docs/reports/D19_disput-next-steps.md](docs/disput-docs/reports/D19_disput-next-steps.md)
- Append-only change history: [docs/CHANGELOG.md](docs/CHANGELOG.md)

## Development

```bash
npm install
npm test -- --runInBand
```

The extension is loaded unpacked from the project root through
`chrome://extensions`. Provider pages must already be authenticated for web UI
automation.
