/**
 * Turns the user's free-text instruction into analysis "focus" tags.
 * Used to filter/prioritise deterministic output and to brief the LLM.
 */
export type Focus = 'identity' | 'licence' | 'financial' | 'dates' | 'obligations' | 'missing' | 'discrepancies' | 'contact';

const RULES: [Focus, RegExp][] = [
  ['identity', /\b(names?|address(es)?|identity|kyc|applicant|person|personal|dob|birth)\b/i],
  ['licence', /\b(licen[cs]es?|permits?|registration|certificate)\b/i],
  ['financial', /\b(financ\w*|revenue|profit|turnover|assets?|liabilit\w*|balance|money|values?|amounts?|income|cash|worth|loan)\b/i],
  ['dates', /\b(dates?|deadlines?|expir\w*|timeline|when|validity|valid)\b/i],
  ['obligations', /\b(obligations?|covenants?|duties|duty|requirements?|must|shall|terms)\b/i],
  ['missing', /\b(missing|gaps?|incomplete|absent|blank|not provided)\b/i],
  ['discrepancies', /\b(inconsisten\w*|discrepan\w*|mismatch\w*|differ\w*|compar\w*|conflict\w*|verify|match)\b/i],
  ['contact', /\b(email|phone|contact)\b/i],
];

export function detectFocus(instruction: string): Focus[] {
  return RULES.filter(([, re]) => re.test(instruction)).map(([f]) => f);
}

/** Field groups (see FIELD_DEFS.group) relevant to the detected focus. null = everything. */
export function relevantGroups(focus: Focus[]): Set<string> | null {
  const groups = new Set<string>();
  if (focus.includes('identity')) ['identity', 'contact'].forEach((g) => groups.add(g));
  if (focus.includes('contact')) groups.add('contact');
  if (focus.includes('licence')) ['licence'].forEach((g) => groups.add(g));
  if (focus.includes('financial')) groups.add('financial');
  if (focus.includes('dates')) groups.add('dates');
  if (focus.includes('obligations')) groups.add('obligations');
  return groups.size === 0 ? null : groups;
}
