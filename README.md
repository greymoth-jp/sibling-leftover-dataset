# Sibling-Leftover Bug Pairs

A hand-verified corpus of structural "sibling" bugs mined from real merged
GitHub pull requests. Each record pairs a fixed bug with its structural twin: a
copy-pasted handler, a mirrored branch, or a parallel validation check that
carries the same class of defect.

The dataset frames a task that is complementary to issue→patch benchmarks like
SWE-bench, Defects4J, and BugsInPy:

> Given a merged fix, locate the structurally parallel sibling, and say whether
> that sibling was left unfixed.

This tests whether a model can reason about bug propagation and structural
symmetry, the way a human reviewer asks "if this was wrong here, where else is
the same pattern wrong?"

A companion CLI, [`cli/`](cli/), runs the same detection heuristic live against
a repo's recent merged PRs; this dataset is the hand-verified record of what
that kind of search finds. See [§CLI](#cli) below.

## Files

This repository ships two related but distinct subsets:

| File | Records | What it is |
|---|---|---|
| `sibling_leftover_MERGED.jsonl` | 54 | **True sibling-leftovers** — the structural twin was left unfixed at the time the original was fixed (the sibling is `open`, was fixed later with a measurable gap, or is still unfixed at mining time). This is the propagation signal. |
| `co_fixed_pairs_supplementary.jsonl` | 25 | **Co-fixed pairs** — both siblings were fixed in the *same* PR. Kept separate because they are not leftovers; useful as "where bugs cluster" data but distinct from the propagation thesis. |

Total: **79 verified pairs across 12 languages** (Go, Java, Rust, TypeScript,
Python, JavaScript, PHP, C, Swift, Kotlin, C#, C++).

Language distribution of the leftover set: Go 10, Java 8, Rust 7, Python 6,
TypeScript 6, JavaScript 5, PHP 4, C 3, Swift 2, Kotlin 1, C# 1, C++ 1.

## Schema

Each line is a JSON object:

| Field | Type | Description |
|---|---|---|
| `repo` | string | `owner/repo` on GitHub |
| `pr_url` | string | Canonical PR URL the fix came from |
| `lang` | string | Primary language of the changed file |
| `file` | string | Repo-relative path of the fixed file |
| `bug_type` | string | Short slug describing the bug class |
| `buggy_pattern` | string | Before-code snippet (verbatim from the diff) |
| `fixed_pattern` | string | After-code snippet (verbatim from the diff) |
| `sibling_location` | string | Natural-language description of where the parallel twin is, including file path and function name where known |
| `status` | string | Disposition of the *sibling* at mining time (see below) |
| `repo_license` | string | SPDX identifier of the source repository's license |
| `gap_days` | int (optional) | Days between the original fix and the sibling fix, where the sibling was eventually fixed and the gap was measured. Present on only 3 records; absent otherwise. |

### `status` vocabulary

The `status` field records the disposition of the *sibling*, not the original
PR. It is descriptive rather than a clean enum. Values actually present in the
leftover set, with counts:

| status | count | reading |
|---|---|---|
| `merged` | 16 | sibling's fix was merged |
| `sibling-unpatched` | 15 | sibling still carried the bug at the time the original was fixed |
| `sibling-unfixed-at-pr-time` | 15 | same, recorded against the originating PR |
| `open` | 4 | sibling fix was still an open PR / unresolved |
| `fixed` | 2 | sibling was fixed (gap measured) |
| `closed` | 1 | sibling's PR closed |
| `sibling_also_fixed_later` | 1 | sibling fixed in a follow-up (gap measured) |

Consumers who need a binary can treat `merged`/`fixed`/`sibling_also_fixed_later`
as "eventually fixed" and `open`/`sibling-unpatched`/`sibling-unfixed-at-pr-time`
as "left unfixed at the time the original was fixed".

## Example record

```json
{
  "repo": "langchain-ai/langchain",
  "pr_url": "https://github.com/langchain-ai/langchain/pull/38488",
  "lang": "Python",
  "file": "libs/partners/anthropic/langchain_anthropic/middleware/anthropic_tools.py",
  "bug_type": "keyerror-unset-arg",
  "buggy_pattern": "old_path = args[\"old_path\"]",
  "fixed_pattern": "old_path = args[\"path\"]",
  "sibling_location": "FilesystemClaudeTextEditorMiddleware._handle_rename (~line 1054, same file) — identical KeyError on the same wrong key; the structural twin of StateClaudeTextEditorMiddleware._handle_rename (~line 555).",
  "status": "closed",
  "repo_license": "MIT"
}
```

## How it was built

- Every pair was found by reading real `gh pr view` / `gh pr diff` / `gh api`
  output. No code was fabricated or inferred beyond what appears in the actual
  diffs. Every record carries its `pr_url`, so any pair can be re-checked
  against the upstream PR.
- For each pair, both the fixed hunk and the sibling location were read directly
  to confirm the sibling exists and carries the same defect class.
- Only key/symbol names and short code hunks are reproduced (fair-use scale).
  No proprietary text dumps; the per-record `repo_license` is recorded.

### What the propagation signal actually is

The signal lives in the `status` field, not in a measured time-to-fix. Of the 54
leftover records, 34 carry a status showing the structural twin was still
unfixed at the moment the original was fixed (`sibling-unfixed-at-pr-time` 15,
`sibling-unpatched` 15, `open` 4) — for example cases in `eslint/eslint`,
`angular/angular`, `laravel/framework`, `dotnet/runtime`, and
`JetBrains/Exposed`.

Only 3 records carry a measured `gap_days` for an eventually-fixed sibling
(`containerd/containerd` 4 days, `microsoft/onnxruntime` 1 day, `scipy/scipy`
2 days). The corpus does **not** systematically backfill eventual-fix dates, so
treat the propagation signal as the existence and disposition of the sibling,
not as a measured time-to-fix.

## Intended use

- **LLM bug-finding evaluation** — given `buggy_pattern` plus file context, ask
  a model to name the `sibling_location`.
- **Propagation-aware APR research** — seed a pipeline that detects a fix
  pattern, embeds it, and retrieves structurally similar locations.
- **Static-analysis calibration** — each `bug_type` slug maps to a detectable
  syntactic/semantic pattern.

## Limitations

- **Small.** 79 pairs is a schema demonstration and seed, not a statistically
  powered benchmark. Treat any result as directional.
- **No execution harness.** No test cases, reproduction scripts, or traces.
- **`status` vocabulary is descriptive, not a strict enum** (see above).
- **Sparse `gap_days`.** Only 3 records carry a measured gap.
- **Snapshot.** Sibling locations and line numbers reflect repo state at mining
  time (June 2026) and drift as repos change.

## CLI

`cli/gh-sibling.mjs` is a small tool that runs the same detection heuristic
this dataset was hand-mined with, live against a repo's recent merged PRs. It
reads the last 25 merged PRs (via your already-authed `gh` CLI), scores each
for how likely it left a mirror unfixed, and prints them highest-first with
the reason.

```sh
node cli/gh-sibling.mjs <owner/repo>
```

```
sibling-leftover candidates — nocodb/nocodb

#14140 [3] fix(nc-gui): show date examples in date format dropdown
  by rameshmane7218 · DateOptions.vue, DateTimeOptions.vue, lang/en.json
  · bugfix verb: "fix"
  · focused (3 code files)
```

That `en.json` with no other locale touched is the tell. Open the PR, find the
side they missed, send the mirror.

```sh
node cli/gh-sibling.mjs <owner/repo> --json   # machine-readable, for scripting a queue
node cli/gh-sibling.mjs --selftest            # offline check of the scoring, no gh needed
```

It scores on: symmetry language in the title (`also`, `same for`, `mirror`,
`both`, `as well`), a bugfix verb (`fix`, `guard`, `escape`, `check`,
`validate`), touching one side of a known opposite pair (`encode`/`decode`,
`enable`/`disable`, `subscribe`/`unsubscribe`, `show`/`hide`, and more) but not
the other, a bugfix that touched no test, a small focused PR (1 to 3 files),
and being merged by `web-flow` (the maintainer took it verbatim, so the gap
shipped as-is). None of it is proof — it's a ranked list of where to look
first, so you read 5 PRs instead of 250.

Requires Node (built-in modules only, zero dependencies) and
[`gh`](https://cli.github.com/) installed and authed. Sends nothing anywhere
beyond the `gh pr list` requests `gh` itself makes to GitHub.

The CLI's code is MIT-licensed ([`cli/LICENSE`](cli/LICENSE)), separate from
the CC-BY-4.0 dataset license below. This code previously lived in its own
repo, `gh-sibling-cli`, now archived and folded in here.

## License

The dataset compilation, schema, and this README are released under
**CC-BY-4.0** (see [`LICENSE`](LICENSE)). Each record's code snippets are
reproduced from the upstream repository under that repository's license (see the
per-record `repo_license` field). Reproducing short code snippets for research
and benchmarking is consistent with fair use / fair dealing in most
jurisdictions; users should verify compliance with their local law and the
upstream license terms. Upstream licenses observed in this corpus include MIT,
Apache-2.0, BSD-2/3, GPL-3.0, AGPL-3.0, LGPL-2.1, MPL-2.0, and Zlib.

`README_HF.md` is the same card with the metadata header used by the Hugging Face
Hub.

## Citation

```bibtex
@misc{greymoth2026siblingleftover,
  author = {greymoth},
  title  = {Sibling-Leftover Bug Pairs},
  year   = {2026},
  note   = {Hand-verified corpus of structural sibling bugs mined from merged GitHub PRs.}
}
```

Please also cite the upstream PRs listed in each record's `pr_url`.

## Author

[@greymoth-jp](https://github.com/greymoth-jp) — mined and verified from real
PRs, June 2026.
