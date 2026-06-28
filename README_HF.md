---
license: cc-by-4.0
task_categories:
  - text-classification
  - text-generation
language:
  - en
tags:
  - code
  - bug-detection
  - program-repair
  - sibling-bug
  - fix-propagation
  - software-engineering
pretty_name: Sibling-Leftover Bug Pairs
size_categories:
  - n<1K
configs:
  - config_name: leftover
    data_files:
      - split: train
        path: sibling_leftover_MERGED.jsonl
  - config_name: co_fixed
    data_files:
      - split: train
        path: co_fixed_pairs_supplementary.jsonl
---

# Sibling-Leftover Bug Pairs

A hand-verified corpus of **structural "sibling" bugs** mined from real merged
GitHub pull requests. Each record pairs a fixed bug with its *structural twin* —
a copy-pasted handler, a mirrored branch, or a parallel validation check that
carries the same class of defect.

The dataset frames a task that is complementary to issue→patch benchmarks
(SWE-bench, Defects4J, BugsInPy):

> **Given a merged fix, locate the structurally parallel sibling — and say
> whether that sibling was left unfixed.**

This tests whether a model can reason about **bug propagation and structural
symmetry**, the way a human reviewer asks "if this was wrong here, where else
is the same pattern wrong?"

## Configurations

This repository ships two related but distinct subsets:

| Config | File | Records | What it is |
|---|---|---|---|
| `leftover` (canonical) | `sibling_leftover_MERGED.jsonl` | 54 | **True sibling-leftovers** — the structural twin was *left unfixed* at the time the original was fixed (status `open` / fixed later with a measured gap / still unfixed at mining time). This is the propagation signal. |
| `co_fixed` (supplementary) | `co_fixed_pairs_supplementary.jsonl` | 25 | **Co-fixed pairs** — both siblings were fixed in the *same* PR. Kept separate because they are NOT leftovers; useful as "where bugs cluster" data but distinct from the propagation thesis. |

Total: **79 verified pairs across 12 languages** (Go, Java, Rust, TypeScript,
Python, JavaScript, PHP, C, Swift, Kotlin, C#, C++).

### Language distribution (leftover config)

Go 10 · Java 8 · Rust 7 · Python 6 · TypeScript 6 · JavaScript 5 · PHP 4 ·
C 3 · Swift 2 · Kotlin 1 · C# 1 · C++ 1

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
| `status` | string | Disposition of the sibling at mining time (see status vocabulary) |
| `repo_license` | string | SPDX identifier of the source repository's license |
| `gap_days` | int (optional) | Days between the original fix and the sibling fix, where the sibling was eventually fixed and the gap was measured. Present on only 3 records; absent otherwise. |

### `status` vocabulary

The `status` field records the disposition of the *sibling*, not the original
PR. It is descriptive rather than a strict enum. Values present in the leftover
config, with counts: `merged` (16), `sibling-unpatched` (15),
`sibling-unfixed-at-pr-time` (15), `open` (4), `fixed` (2), `closed` (1),
`sibling_also_fixed_later` (1). Consumers who need a binary should treat
`merged`/`fixed`/`sibling_also_fixed_later` as "eventually fixed" and
`open`/`sibling-unpatched`/`sibling-unfixed-at-pr-time` as "left unfixed at the
time the original was fixed".

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
  diffs. Every record carries its `pr_url`, so any pair can be re-checked against
  the upstream PR.
- For each pair, both the fixed hunk and the sibling location were read directly
  to confirm the sibling exists and carries the same defect class.
- Only key/symbol names and short code hunks are reproduced (fair-use scale).
  No proprietary text dumps; per-record `repo_license` is recorded.

### What the propagation signal actually is

The signal lives in the `status` field, not in a measured time-to-fix. Of the 54
leftover records, 34 carry a status showing the structural twin was still
unfixed at the moment the original was fixed (`sibling-unfixed-at-pr-time` 15,
`sibling-unpatched` 15, `open` 4) — for example cases in `eslint/eslint`,
`angular/angular`, `laravel/framework`, `dotnet/runtime`, and `JetBrains/Exposed`.
Only 3 records carry a measured `gap_days` for an eventually-fixed sibling
(`containerd/containerd` 4 days, `microsoft/onnxruntime` 1 day, `scipy/scipy`
2 days). The corpus does not systematically backfill eventual-fix dates, so the
propagation signal is the existence and disposition of the sibling, not a
measured time-to-fix.

## Intended use

- **LLM bug-finding evaluation** — given `buggy_pattern` plus file context, ask
  a model to name the `sibling_location`.
- **Propagation-aware APR research** — seed a pipeline that detects a fix
  pattern, embeds it, and retrieves structurally similar locations.
- **Static-analysis calibration** — each `bug_type` slug maps to a detectable
  syntactic/semantic pattern.

## Limitations

- **Small.** 79 pairs is a schema demonstration and seed, not a statistically
  powered benchmark. Treat results as directional.
- **No execution harness.** No test cases, reproduction scripts, or traces.
- **`status` vocabulary is descriptive, not a strict enum** (see above).
- **Sparse `gap_days`.** Only 3 records carry a measured gap.
- **Snapshot.** Sibling locations and line numbers reflect the repo state at
  mining time (June 2026) and drift as repos change.

## License

The dataset compilation, schema, and this card are released under
**CC-BY-4.0**. Each record's code snippets are reproduced from the upstream
repository under that repository's license (see the per-record `repo_license`
field). Reproducing short code snippets for research and benchmarking is
consistent with fair use / fair dealing in most jurisdictions; users should
verify compliance with their local law and the upstream license terms.
Upstream licenses observed in this corpus include MIT, Apache-2.0, BSD-2/3,
GPL-3.0, AGPL-3.0, LGPL-2.1, MPL-2.0, and Zlib.

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

## Dataset card author

[@greymoth-jp](https://github.com/greymoth-jp) — mined and verified from real
PRs, June 2026.
