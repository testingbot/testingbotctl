# Handover: Maestro CLI uploads a bundle with no runnable flow

Written 2026-09-01. The fix is **implemented and tested but not committed**. What is left is
review, the commit, and the release call.

## Symptom the customer hit

A customer's CI ran two Maestro jobs (TestingBot projects 90878 and 90881, user 450050). Both
uploaded a 3,540-byte zip containing exactly:

```
config.yaml
flows/shared/login.yaml
flows/shared/logout.yaml
```

The two archives are byte-identical (`sha1 7d0d00ae`). Their `config.yaml` globs 14 suite
directories (`flows/smoke/*.yaml`, `flows/claims/*.yaml`, ...) and none of them are in the zip,
so the server extracted 0 flows, fell back to the legacy single-session run path, and burned a
real Android device session per job on a run that executed nothing and failed with no
explanation. The requested flow was `flows/claims/cc-import-to-new-claim.yaml` (visible in the
run capabilities as `wbx flow/cc-import-to-new-claim <run id>`).

Their earlier uploads the same morning (projects 90806, 90752, 90710) were fine and contained
`flows/smoke/*.yaml`, so this is not a config change on their side.

## Root cause

`Maestro#collectFlows` in `src/providers/maestro.ts` applies tag filtering **after** runFlow
dependency discovery, and `filterFlowsByTags` treats the discovered dependencies as flows.

Walk the customer's case:

1. One flow is passed: `flows/claims/cc-import-to-new-claim.yaml`.
2. `findMaestroProjectRoot` locates `config.yaml` and adds it, `baseDir` becomes the project root.
3. Dependency discovery adds the flow's runFlow targets, `flows/shared/login.yaml` and
   `flows/shared/logout.yaml`, to `allFlowFiles`.
4. `loadConfigTags` reads `excludeTags` from `config.yaml` (`pairing-ux`, `unverified`,
   `data-blocked`, `app-bug-blocked`, `bug-repro`). The requested flow carries one of those tags
   and is dropped.
5. **The guard does not fire.** `filterFlowsByTags` only throws when `keptYamlFlows` is empty, and
   the two shared helpers are still in it: a subflow carries no tags, so it always survives an
   `excludeTags` filter.
6. `survivingTopLevel` is computed, is empty, and nothing checks it. The zip is built from
   `allFlowFiles` and uploaded, and a run is started.

So the bad archive is built by us, not by their packaging step.

## The fix (uncommitted, in the working tree)

`src/providers/maestro.ts`, end of `collectFlows` (~line 849): throw when `survivingTopLevel` is
empty, naming the flows the tag filters excluded.

```ts
if (survivingTopLevel.length === 0) {
  const dropped = topLevelFlowFiles
    .map((f) => path.relative(baseDir ?? process.cwd(), f))
    .join(', ');
  throw new TestingBotError(
    `No flows left to run: every flow you passed was excluded by the tag filters ...`,
  );
}
```

`tests/providers/maestro.test.ts` (~line 4023): `collectFlows when tag filters drop every
requested flow` reproduces the customer's shape — one flow tagged `data-blocked`, a `config.yaml`
that excludes that tag, an untagged `runFlow` helper — and asserts `collectFlows()` rejects.

### Verified

```bash
npx jest tests/providers/maestro.test.ts   # 262 passed
npx tsc --noEmit                           # clean
npx eslint src/providers/maestro.ts tests/providers/maestro.test.ts
```

The 6 eslint errors that lint reports (lines 50, 1456, 2017, 3424, 4638, 5942 of the test file)
are all pre-existing and none are in the added code. The new test was confirmed to **fail** with
the guard deleted, so it pins the behaviour rather than passing by accident.

## Careful: unrelated local changes

The working tree already had uncommitted work before this fix, and `git diff` mixes them together.
Only these two hunks belong to this bug:

- `src/providers/maestro.ts` — the `survivingTopLevel.length === 0` block
- `tests/providers/maestro.test.ts` — the new `describe` block

The other hunks (the `test?: { sessionId, environment }` field on `MaestroRunInfo`, the
`assertSessionsStarted` call in the polling loop, and the edits to `base_provider.ts`,
`espresso.ts`, `xcuitest.ts`, `tests/providers/base_provider.test.ts`) are somebody else's
in-progress work. **Stage by hunk**, do not `git add -A`.

## What is left

1. Review and commit the two hunks on a branch (repo default is `main`).
2. Decide on a release. This is a data-loss-shaped bug for anyone using `excludeTags` with
   subflows, so it likely justifies a patch release of `testingbot` (currently `1.1.1`) rather
   than waiting. Publish flow is the `publish` GitHub workflow (Node 22).
3. Consider a second, deeper fix that was **not** made here: `filterFlowsByTags` should filter
   only the top-level flows and never judge a dependency by its tags. The guard added now catches
   the resulting empty bundle, but a flow whose *helper* happens to carry an excluded tag can
   still lose that helper from the zip. Worth a look, with its own test.

## Related work already shipped

The server side was hardened in the `web` repo, commit `300a9ccc2`, pushed to `origin/develop`
(not yet deployed): `UploadMaestroJob` now marks a project `FAILED` when the config patterns match
nothing, records which patterns missed and what the archive really contains, `POST /:id/tests`
returns that reason, and `POST /:id/run` plus the members retry refuse a failed project so the
legacy path can no longer spend a device session. That makes the failure loud; this CLI fix is
what stops it happening.

Projects 90878 and 90881 cannot be repaired by `script/reextract_maestro_flows.rb` in the web
repo — their zips genuinely lack the flows. The customer has to re-upload once this ships, and is
owed an explanation for the two burned sessions.
