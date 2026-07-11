#!/usr/bin/env node
// gh-sibling — rank recent merged PRs by how likely they left a "sibling" un-fixed.
// A sibling-leftover = a symmetric pair (foo.ts ↔ bar.ts, en.json ↔ ja.json) where a
// PR fixed one side and forgot the mirror. Today greymoth shipped 28 OSS PRs this way.
// Zero deps, zero network of its own — it shells out to the already-authed `gh` CLI.

import { execFile } from "node:child_process";
import { promisify } from "node:util";
const exec = promisify(execFile);

// ---------- scoring (pure, tested by --selftest) ----------

const SYMMETRY_WORDS = ["also", "same for", "mirror", "both", "sibling", "as well", "likewise", "ditto", "counterpart", "the other"];
const BUGFIX_WORDS = ["fix", "guard", "escape", "check", "validate", "sanitize", "handle", "prevent", "bug", "patch"];

// foo.ts ↔ bar.ts style sibling names: strip dir + ext, compare bare stems.
const stem = (p) => (p.split("/").pop() || "").replace(/\.[^.]+$/, "");
const isTestFile = (p) => /(\.|_|\/)(test|spec)s?(\.|$)/i.test(p) || /(^|\/)(tests?|specs?|__tests__)\//i.test(p);

// Known mirrored opposites — touching one stem but not its twin is the classic leftover.
// Opposite stem pairs. Kept deliberately to ones that read as mirrored *operations*;
// dropped noisy ones whose token also occurs as a plain noun (lock→lockfile, head→HTTP
// head, in/out→stdin/stdout, get/set→common words) to avoid false positives.
const OPPOSITES = [
  ["encode", "decode"], ["serialize", "deserialize"], ["enable", "disable"],
  ["compress", "decompress"], ["acquire", "release"], ["subscribe", "unsubscribe"],
  ["marshal", "unmarshal"], ["mount", "unmount"], ["import", "export"],
  ["increment", "decrement"], ["expand", "collapse"], ["show", "hide"],
];

function score(pr) {
  const reasons = [];
  let s = 0;

  const title = (pr.title || "").toLowerCase();
  const files = (pr.files || []).map((f) => f.path || f.filename || "");
  const codeFiles = files.filter((f) => !isTestFile(f));

  // 1. explicit symmetry language in the title => author was thinking "and also..."
  const hitWords = SYMMETRY_WORDS.filter((w) => title.includes(w));
  if (hitWords.length) { s += 3; reasons.push(`title hints symmetry: "${hitWords[0]}"`); }

  // 2. a bugfix (fix/guard/escape...) is the kind of change that needs mirroring
  const fixWords = BUGFIX_WORDS.filter((w) => title.includes(w));
  if (fixWords.length) { s += 1; reasons.push(`bugfix verb: "${fixWords[0]}"`); }

  // 3. touched exactly one side of a known opposite pair (e.g. encode.ts, no decode.ts).
  // Match opposites as word tokens (camelCase / snake / kebab boundaries), not loose
  // substrings — otherwise "lock.json" falsely reads as the "lock/unlock" pair.
  const tokens = new Set();
  for (const f of codeFiles) {
    for (const t of stem(f).split(/(?<=[a-z])(?=[A-Z])|[^a-zA-Z]+/)) {
      if (t) tokens.add(t.toLowerCase());
    }
  }
  for (const [a, b] of OPPOSITES) {
    const hasA = tokens.has(a), hasB = tokens.has(b);
    if (hasA !== hasB) { s += 2; reasons.push(`touched "${hasA ? a : b}" but not "${hasA ? b : a}"`); break; }
  }

  // 4. test changed but no test file touched, or vice-versa => mirror likely forgotten
  const hasCode = codeFiles.length > 0;
  const hasTest = files.some(isTestFile);
  if (hasCode && !hasTest && fixWords.length) { s += 1; reasons.push("bugfix with no test touched"); }

  // 5. small, focused PR (1-3 files) is where a forgotten sibling hides; huge PRs don't
  if (codeFiles.length >= 1 && codeFiles.length <= 3) { s += 1; reasons.push(`focused (${codeFiles.length} code file${codeFiles.length > 1 ? "s" : ""})`); }

  // 6. external author + web-flow merge committer = a verbatim-merger (merges as-is, high hit rate)
  const author = pr.author?.login || "";
  const committer = pr.mergeCommit?.committer?.name || pr.mergeCommit?.committedBy?.login || "";
  if (/web-flow|github/i.test(committer)) { s += 1; reasons.push("web-flow merge (verbatim merger)"); }

  return { score: s, reasons, files: codeFiles, author };
}

// ---------- gh fetch ----------

async function fetchPRs(repo, limit) {
  const { stdout } = await exec("gh", [
    "pr", "list", "-R", repo, "--state", "merged", "--limit", String(limit),
    "--json", "number,title,author,mergeCommit,files",
  ], { maxBuffer: 1 << 24 });
  return JSON.parse(stdout);
}

// ---------- output ----------

const C = process.stdout.isTTY
  ? { dim: (s) => `\x1b[2m${s}\x1b[0m`, bold: (s) => `\x1b[1m${s}\x1b[0m`, cyan: (s) => `\x1b[36m${s}\x1b[0m` }
  : { dim: (s) => s, bold: (s) => s, cyan: (s) => s };

function render(ranked, repo) {
  console.log(C.bold(`\nsibling-leftover candidates — ${repo}`));
  console.log(C.dim("  recent merged PRs, ranked by how likely a mirror fix was forgotten\n"));
  if (!ranked.length) { console.log(C.dim("  (no candidates scored above zero)\n")); return; }
  for (const r of ranked) {
    console.log(`${C.cyan(`#${r.number}`)} ${C.bold(`[${r.score}]`)} ${r.title}`);
    console.log(C.dim(`  by ${r.author} · ${r.files.slice(0, 4).join(", ")}${r.files.length > 4 ? " …" : ""}`));
    for (const why of r.reasons) console.log(C.dim(`  · ${why}`));
    console.log();
  }
}

// ---------- selftest (no network) ----------

function selftest() {
  let failed = 0;
  const ok = (cond, msg) => { if (!cond) { failed++; console.error(`FAIL: ${msg}`); } };
  const hot = score({
    title: "fix: escape user input in encode.ts — same for the other path",
    author: { login: "outsider" },
    mergeCommit: { committer: { name: "GitHub web-flow" } },
    files: [{ path: "src/encode.ts" }],
  });
  const cold = score({
    title: "chore: bump deps",
    author: { login: "bot" },
    mergeCommit: { committer: { name: "alice" } },
    files: [{ path: "package.json" }, { path: "lock.json" }, { path: "a.ts" }, { path: "b.ts" }, { path: "c.ts" }],
  });
  ok(hot.score >= 5, `hot PR should score high, got ${hot.score}`);
  ok(cold.score <= 1, `cold PR should score low, got ${cold.score}`);
  ok(hot.score > cold.score, "hot must outrank cold");
  // symmetry word alone must register
  ok(score({ title: "also applies to X", files: [] }).score >= 3, "symmetry word missed");
  // opposite-pair detection: touched encode without decode
  ok(score({ title: "x", files: [{ path: "encode.ts" }] }).reasons.some((r) => r.includes("decode")), "opposite pair missed");
  if (failed) { console.error(`SELFTEST FAILED (${failed})`); process.exit(1); }
  console.log("selftest PASS");
}

// ---------- main ----------

async function main() {
  const args = process.argv.slice(2);
  if (args.includes("--selftest")) return selftest();

  const json = args.includes("--json");
  const repo = args.find((a) => !a.startsWith("--"));
  if (!repo || !repo.includes("/")) {
    console.error("usage: node gh-sibling.mjs <owner/repo> [--json] [--selftest]");
    process.exit(2);
  }

  let prs;
  try {
    prs = await fetchPRs(repo, 25);
  } catch (e) {
    console.error("gh failed — is `gh` installed and authed? (gh auth status)");
    console.error(String(e.stderr || e.message).trim());
    process.exit(1);
  }

  const ranked = prs
    .map((pr) => ({ number: pr.number, title: pr.title, ...score(pr) }))
    .filter((r) => r.score > 0)
    .sort((a, b) => b.score - a.score);

  if (json) console.log(JSON.stringify(ranked, null, 2));
  else render(ranked, repo);
}

main();
