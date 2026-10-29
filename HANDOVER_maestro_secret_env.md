# Handover: `--secret-env` for `testingbot maestro`

Written 2026-10-23. CLI slice of a cross-repo change; the full picture, API contract and the
web/node work are in `~/projects/web/MAESTRO_SECRET_ENV_HANDOVER.md`. Do the CLI part last or
behind the API (the API must accept `maestroOptions.secretEnv` first, otherwise the values would be
stored in plain text like `env` today).

## Why

A prospect found that values passed with `-e KEY=VALUE` are returned verbatim by
`GET /v1/app-automate/maestro/<projectId>` under `options.env` and embedded in the JUnit report.
VERIFIED on `main` (ee59411, 1.4.1):
- `src/cli.ts:658` declares `-e, --env <KEY=VALUE>`; `:878-884` parses into `args.env`.
- `src/models/maestro_options.ts:393-394` emits `opts.env`; `src/providers/maestro.ts:2304-2311`
  (sync) and `:435-480` (async) send it as `maestroOptions`.
- `--debug` prints the whole API response, including `options.env` (`src/providers/maestro.ts:2393`).
- `--json` output has no `options` (`src/utils/json_output.ts` `JsonRunResult`), so nothing to do there.
- README `:128` documents `-e`; `:206` shows `-e API_KEY=secret` as an example.

## What to build

1. `--secret-env <KEY=VALUE>` (repeatable), same parsing as `-e`, emitted as
   `maestroOptions.secretEnv` (object). Reject a key given to both `-e` and `--secret-env`.
2. Never print secret values: mask them in `--debug` output (replace values of `secretEnv`, and of
   `env` keys that also appear in `secretEnv`, with `***`), and make sure the request body is not
   logged elsewhere (grep `logger.debug` in `src/providers/maestro.ts`).
3. README: document `--secret-env`, change the `:206` example to use it for `API_KEY`, and say
   plainly that `-e` values are visible in the run options and reports.
4. CHANGELOG entry; bump minor.
5. Tests: wherever `getMaestroOptions` is covered (look for `maestro_options` tests), add cases for
   `secretEnv` emission and the duplicate-key rejection.

Guardrail: an existing untracked handover in this repo (`HANDOVER_maestro_tag_filter_bug.md`)
describes an unrelated uncommitted fix; do not mix the two.
