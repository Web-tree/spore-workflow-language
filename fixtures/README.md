# Conformance fixtures

The format is defined in [spec/fixtures.md](../spec/fixtures.md). One JSON file per fixture, in a folder per kind:

```text
fixtures/
├── definition/   # a definition and whether a validator accepts it, or which codes it reports
├── dot/          # SWL-DOT source and the definition it normalizes to, or that it is rejected
└── trace/        # a definition, a sequence of events, and what each transition must produce
```

File names start with the profile the fixture needs, then say what it checks: `core-loop-exhausted.json`. An implementation runs every fixture whose profiles it claims and reports the ones it skips. The TypeScript draft runs them from `implementations/typescript/test/fixtures.test.ts`.

Check a fixture file's structure with `bunx ajv-cli@5 validate --spec=draft2020 -s schemas/fixture.schema.json -d "fixtures/*/*.json"` from the repository root.

A fixture that an implementation fails is either a non-conformance or a spec issue. Open an issue; don't edit the fixture to match the implementation.
