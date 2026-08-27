#!/usr/bin/env node
/**
 * ai-token-report.mjs - print what each AI feature costs, in tokens.
 *
 *   npm run ai:tokens
 *
 * Reads the real prompts and budgets out of api/_lib/features.js, so the table
 * is whatever the backend would actually send today. Nothing is called and no
 * key is needed: the counts are estimates (see api/_lib/tokenCost.js), and the
 * exact ones come back with every answer in `usage`.
 *
 * `--json` prints the same numbers as data, for anything that wants to chart
 * them or diff two branches.
 */

import {
  allFeatureTokenRanges,
  namedScenarios,
  formatTokenReport,
  formatScenarioReport,
  MIRRORED_FROM_RUN,
} from '../api/_lib/tokenCost.js';

const ranges = allFeatureTokenRanges();
const scenarios = namedScenarios();

if (process.argv.includes('--json')) {
  console.log(JSON.stringify({ ranges, scenarios }, null, 2));
} else {
  // The deadline run.js stops a call at, so a ceiling that cannot be written
  // inside it is called out rather than left to be worked out by eye.
  const { deadlineSeconds } = MIRRORED_FROM_RUN;
  console.log(formatTokenReport(ranges, deadlineSeconds));
  console.log('\n');
  console.log(formatScenarioReport(scenarios, deadlineSeconds));
}
