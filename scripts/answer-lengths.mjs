#!/usr/bin/env node
/**
 * Turn AI_USAGE log lines into the numbers the pricing model assumes.
 *
 * The model in rhizomiumaitokencosts.xlsx prices every call on an assumption:
 * that a typical answer runs at some fraction of the budget the call was
 * allowed. That fraction moves the bill more than anything else in the
 * workbook — output is six times the input rate on Terra, and reasoning is
 * billed as output — and until this script is run against real logs it is a
 * guess someone typed.
 *
 *   vercel logs <deployment-url> | node scripts/answer-lengths.mjs
 *   cat saved-logs.txt | node scripts/answer-lengths.mjs
 *   node scripts/answer-lengths.mjs saved-logs.txt
 *
 * Anything that is not an AI_USAGE line is ignored, so piping a whole log
 * dump in is fine.
 *
 * Output is per feature, because one global number is the wrong shape: a
 * canvas assist returns a sentence and a patch generator writes a whole
 * document, and they cannot share a fraction.
 *
 * ---------------------------------------------------------------------------
 * A warning about what this can and cannot tell you.
 *
 * These lines live as long as the platform keeps function logs. Nothing
 * aggregates them, so this is a SAMPLE of whatever window you happened to
 * fetch, not a measurement of the population. Two consequences worth holding
 * on to before pasting a number into a spreadsheet:
 *
 *   - Only completed calls log. A call that timed out or was refused produced
 *     tokens and was billed for them, and it is not in here. The share below
 *     is therefore a floor, not an average.
 *   - A handful of calls from one afternoon is one artist's habits, not the
 *     product's. The `n` column is there to be looked at; the script says so
 *     out loud when a feature is too thin to trust.
 */

import { createInterface } from 'node:readline';
import { createReadStream } from 'node:fs';

const MARKER = 'AI_USAGE';

/** Below this many calls, a mean is an anecdote. */
const THIN_SAMPLE = 20;

function quantile(sorted, q) {
  if (sorted.length === 0) return null;
  const pos = (sorted.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  if (lo === hi) return sorted[lo];
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
}

function parse(line) {
  const at = line.indexOf(MARKER);
  if (at === -1) return null;
  // Everything after the marker is the JSON object; anything the platform
  // prefixed (timestamps, request ids, colour codes) stays on the left.
  const json = line.slice(at + MARKER.length).trim();
  try {
    const row = JSON.parse(json);
    return typeof row === 'object' && row !== null ? row : null;
  } catch {
    return null;
  }
}

async function main() {
  const file = process.argv[2];
  const input = file ? createReadStream(file) : process.stdin;

  if (!file && process.stdin.isTTY) {
    console.error('Reading from stdin. Pipe logs in, or pass a file. -h for help.');
    process.exit(2);
  }

  const byFeature = new Map();
  let seen = 0;
  let unparsed = 0;

  for await (const line of createInterface({ input, crlfDelay: Infinity })) {
    if (!line.includes(MARKER)) continue;
    seen += 1;
    const row = parse(line);
    if (!row) {
      unparsed += 1;
      continue;
    }
    const key = row.feature || row.label || 'unknown';
    const bucket = byFeature.get(key) ?? { shares: [], answers: [], seconds: [], budget: null };
    // A null share is a call whose budget we could not read — counted as seen,
    // excluded from the statistics rather than folded in as a zero.
    if (typeof row.answerShare === 'number') bucket.shares.push(row.answerShare);
    if (typeof row.answerTokens === 'number') bucket.answers.push(row.answerTokens);
    if (typeof row.seconds === 'number') bucket.seconds.push(row.seconds);
    if (typeof row.outputBudget === 'number') bucket.budget = row.outputBudget;
    byFeature.set(key, bucket);
  }

  if (seen === 0) {
    console.error(`No ${MARKER} lines found. Is this the right log stream, and is the`);
    console.error('deployment running a build that includes the structured log line?');
    process.exit(1);
  }

  const rows = [];
  for (const [feature, b] of byFeature) {
    const shares = [...b.shares].sort((x, y) => x - y);
    const mean = shares.length ? shares.reduce((a, c) => a + c, 0) / shares.length : null;
    rows.push({
      feature,
      n: b.shares.length,
      mean,
      p50: quantile(shares, 0.5),
      p90: quantile(shares, 0.9),
      max: shares.length ? shares[shares.length - 1] : null,
      budget: b.budget,
    });
  }
  rows.sort((a, c) => c.n - a.n);

  const pct = (v) => (v === null ? '—' : `${(v * 100).toFixed(1)}%`);
  const pad = (v, w) => String(v).padEnd(w);
  const padL = (v, w) => String(v).padStart(w);

  console.log('');
  console.log('Answer length as a share of the output budget, per feature');
  console.log('');
  console.log(
    `  ${pad('feature', 24)}${padL('n', 6)}${padL('mean', 9)}${padL('median', 9)}` +
      `${padL('p90', 9)}${padL('max', 9)}${padL('budget', 9)}`
  );
  console.log(`  ${'-'.repeat(75)}`);
  for (const r of rows) {
    console.log(
      `  ${pad(r.feature, 24)}${padL(r.n, 6)}${padL(pct(r.mean), 9)}${padL(pct(r.p50), 9)}` +
        `${padL(pct(r.p90), 9)}${padL(pct(r.max), 9)}${padL(r.budget ?? '—', 9)}`
    );
  }
  console.log('');

  const thin = rows.filter((r) => r.n < THIN_SAMPLE);
  if (thin.length) {
    console.log(
      `  Thin sample (under ${THIN_SAMPLE} calls): ${thin.map((r) => r.feature).join(', ')}.`
    );
    console.log('  Treat those rows as anecdotes. Collect more before repricing on them.');
    console.log('');
  }
  if (unparsed) {
    console.log(`  ${unparsed} marked line(s) could not be parsed and were skipped.`);
    console.log('');
  }

  console.log('  Paste the MEDIAN column into "Cost per call", one row per feature.');
  console.log('  The mean is dragged by the occasional call that runs to its ceiling;');
  console.log('  the median is what a typical answer actually does, which is what the');
  console.log('  workbook means by typical. Keep p90 in view — it is the tail the');
  console.log('  quotas underwrite.');
  console.log('');
  console.log('  Remember: only completed calls appear here. Timeouts generated tokens,');
  console.log('  were billed, and are absent — so these shares are a floor.');
  console.log('');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
