# 0013: Records: one rewritten run record, latest-state provenance, measurements as release assets

- Status: accepted
- Date: 2026-11-25
- Tracker: T-0028, Q-0012

## Context and problem statement

The brief says every run writes a JSON record (iterations, check results, judge findings, models, tokens, cost and duration) and that the report and every metric are built from these records. The records stay out of git, and a small provenance file per component is committed. [ADR 0003](0003-bootstrap-answers.md) put run records under `.fazon/` and left the layout inside to this document. The measurement protocol adds calibration records, and the requirement that published numbers keep their records. The [records](../spec/records.md) document settles the formats.

## Considered options

1. **Writing the run record:** one JSON document rewritten atomically after every step; an append-only event log plus a summary written at the end.
2. **Provenance:** the latest accepted state, overwritten on regeneration; an append-only history.
3. **Where measurement records are kept:** GitHub release assets of the example repository; committed in the repository; a separate data repository.
4. **Agent transcripts:** kept locally with the run; only a summary kept.

## Decision outcome

The maintainer chose:

1. **One JSON document, rewritten atomically:** `.fazon/runs/<run-id>/run.json`. One format to specify and read; a crash leaves the last completed step.
2. **The latest accepted state.** Git keeps the history. The file names no person.
3. **GitHub release assets.** Each measurement round is a release with an archive of its records, linked from the published tables.
4. **Kept locally:** `calls/<n>.jsonl` in the run's directory. CI never uploads them, and published records leave them out.

The document also fixes:

- the layout of a run's directory;
- run IDs that sort by start time;
- SHA-256 hashes: of a file's bytes with LF line endings, and of the approved API's canonical JSON (RFC 8785);
- the location of calibration records in the framework repository.

### Consequences

- The run record, provenance and calibration record have JSON Schemas with examples, checked by `just lint`.
- The CLI reference (T-0030) covers reading and pruning `.fazon/`.
- The reusable workflow (T-0032) uploads the report, but no transcript.
- The provenance file lives in the component's `generated/` directory, so the agent can't write it ([ADR 0009](0009-agent-permissions.md)).

## More information

- Run records and provenance: [docs/spec/records.md](../spec/records.md)
- Brief: [Run record](../design/brief.md#run-record), [Report](../design/brief.md#report)
