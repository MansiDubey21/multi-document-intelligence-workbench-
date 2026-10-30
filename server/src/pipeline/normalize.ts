import type { FactType } from '../types.js';

/* ------------------------------------------------------------------ */
/* Text clean-up                                                       */
/* ------------------------------------------------------------------ */

export function cleanText(raw: string): string {
  return raw
    .replace(/\r\n?/g, '\n')
    .replace(/[\u0000-\u0008\u000b\u000e-\u001f\u007f]/g, '')
    .replace(/ /g, ' ')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{4,}/g, '\n\n\n')
    .trim();
}

/** Lower-case, collapse whitespace, strip punctuation — used for fuzzy comparisons and excerpt verification. */
export function canonicalText(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

/* ------------------------------------------------------------------ */
/* Field dictionary: maps many real-world labels to one canonical key  */
/* ------------------------------------------------------------------ */

interface FieldDef {
  field: string;
  label: string;
  type: FactType;
  synonyms: string[];
  /** included in identity / financial / dates focus groups */
  group: 'identity' | 'financial' | 'dates' | 'licence' | 'contact' | 'other';
}

export const FIELD_DEFS: FieldDef[] = [
  { field: 'full_name', label: 'Full name', type: 'name', group: 'identity', synonyms: ['name', 'full name', 'applicant name', 'applicant', 'name of applicant', 'licence holder', 'holder name', 'holder', 'account holder', 'account holder name', 'customer name', 'borrower name', 'borrower'] },
  { field: 'company_name', label: 'Company name', type: 'name', group: 'identity', synonyms: ['company', 'company name', 'business name', 'legal name', 'entity name', 'registered name', 'entity', 'name of business', 'organisation', 'organization', 'firm name', 'employer'] },
  { field: 'address', label: 'Address', type: 'address', group: 'identity', synonyms: ['address', 'residential address', 'home address', 'current address', 'permanent address', 'correspondence address'] },
  { field: 'business_address', label: 'Business address', type: 'address', group: 'identity', synonyms: ['business address', 'registered address', 'registered office', 'office address', 'company address'] },
  { field: 'date_of_birth', label: 'Date of birth', type: 'date', group: 'identity', synonyms: ['date of birth', 'dob', 'birth date', 'born'] },
  { field: 'nationality', label: 'Nationality', type: 'text', group: 'identity', synonyms: ['nationality', 'citizenship'] },
  { field: 'id_number', label: 'ID / PAN number', type: 'id', group: 'identity', synonyms: ['pan', 'pan number', 'pan no', 'id number', 'national id', 'passport number', 'passport no', 'tax id'] },
  { field: 'licence_number', label: 'Licence number', type: 'id', group: 'licence', synonyms: ['licence number', 'licence no', 'licence id', 'dl number', 'dl no', 'driving licence number', 'trade licence number', 'licence'] },
  { field: 'licence_type', label: 'Licence type', type: 'text', group: 'licence', synonyms: ['licence type', 'licence class', 'class', 'category'] },
  { field: 'licence_issue_date', label: 'Licence issue date', type: 'date', group: 'dates', synonyms: ['issue date', 'date of issue', 'issued on', 'licence issue date', 'issued'] },
  { field: 'licence_expiry_date', label: 'Licence expiry date', type: 'date', group: 'dates', synonyms: ['expiry date', 'expiry', 'expires', 'expires on', 'valid until', 'valid till', 'valid upto', 'licence expiry', 'licence expiry date', 'expiration date', 'date of expiry'] },
  { field: 'registration_number', label: 'Company registration no.', type: 'id', group: 'licence', synonyms: ['registration number', 'registration no', 'company registration number', 'company registration no', 'cin', 'reg no', 'incorporation number', 'gstin', 'gst number'] },
  { field: 'email', label: 'Email', type: 'email', group: 'contact', synonyms: ['email', 'email address', 'e mail', 'contact email'] },
  { field: 'phone', label: 'Phone', type: 'phone', group: 'contact', synonyms: ['phone', 'phone number', 'mobile', 'mobile number', 'telephone', 'contact number', 'tel'] },
  { field: 'annual_revenue', label: 'Annual revenue', type: 'money', group: 'financial', synonyms: ['revenue', 'annual revenue', 'turnover', 'annual turnover', 'total revenue', 'gross revenue', 'revenue from operations', 'sales'] },
  { field: 'net_profit', label: 'Net profit', type: 'money', group: 'financial', synonyms: ['net profit', 'profit after tax', 'pat', 'net income', 'profit'] },
  { field: 'total_assets', label: 'Total assets', type: 'money', group: 'financial', synonyms: ['total assets', 'assets'] },
  { field: 'total_liabilities', label: 'Total liabilities', type: 'money', group: 'financial', synonyms: ['total liabilities', 'liabilities'] },
  { field: 'net_worth', label: 'Net worth / equity', type: 'money', group: 'financial', synonyms: ['net worth', 'shareholders equity', 'equity', 'total equity'] },
  { field: 'cash_balance', label: 'Cash balance', type: 'money', group: 'financial', synonyms: ['cash balance', 'cash and cash equivalents', 'cash', 'closing balance', 'average balance', 'average monthly balance'] },
  { field: 'loan_amount', label: 'Loan amount requested', type: 'money', group: 'financial', synonyms: ['loan amount', 'loan amount requested', 'amount requested', 'requested amount', 'facility amount'] },
  { field: 'employees', label: 'Employees', type: 'number', group: 'other', synonyms: ['employees', 'number of employees', 'headcount', 'staff'] },
  { field: 'financial_year', label: 'Financial year', type: 'text', group: 'dates', synonyms: ['financial year', 'fiscal year', 'fy', 'year', 'period'] },
  { field: 'application_date', label: 'Application date', type: 'date', group: 'dates', synonyms: ['application date', 'date of application', 'date submitted', 'submission date'] },
  { field: 'document_date', label: 'Document date', type: 'date', group: 'dates', synonyms: ['date', 'letter date', 'dated'] },
  { field: 'account_number', label: 'Account number', type: 'id', group: 'financial', synonyms: ['account number', 'account no', 'a c no', 'bank account number'] },
  { field: 'occupation', label: 'Occupation', type: 'text', group: 'identity', synonyms: ['occupation', 'designation', 'job title', 'role', 'position'] },
  { field: 'industry', label: 'Industry', type: 'text', group: 'other', synonyms: ['industry', 'sector', 'nature of business', 'business type'] },
];

const SYNONYM_INDEX = new Map<string, FieldDef>();
for (const def of FIELD_DEFS) for (const s of def.synonyms) SYNONYM_INDEX.set(s, def);
const MULTIWORD = [...SYNONYM_INDEX.keys()].filter((s) => s.includes(' ')).sort((a, b) => b.length - a.length);

export function normalizeLabel(label: string): string {
  return canonicalText(label.replace(/licen[cs]e/gi, 'licence'));
}

/** Map a free-form label to a canonical field definition (or null if unknown). */
export function resolveField(label: string): FieldDef | null {
  const norm = normalizeLabel(label);
  if (!norm) return null;
  const exact = SYNONYM_INDEX.get(norm);
  if (exact) return exact;
  for (const syn of MULTIWORD) if (new RegExp(`(^| )${syn}( |$)`).test(norm)) return SYNONYM_INDEX.get(syn)!;
  return null;
}

export const fieldDef = (field: string) => FIELD_DEFS.find((d) => d.field === field) ?? null;

export const slugField = (label: string) => normalizeLabel(label).replace(/ /g, '_').slice(0, 60) || 'field';

/* ------------------------------------------------------------------ */
/* Value normalisation                                                 */
/* ------------------------------------------------------------------ */

const MONTHS: Record<string, number> = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, sept: 9, oct: 10, nov: 11, dec: 12,
};

const pad = (n: number) => String(n).padStart(2, '0');

function validDate(y: number, m: number, d: number): string | null {
  if (y < 100) y += y > 50 ? 1900 : 2000;
  if (m < 1 || m > 12 || d < 1 || d > 31 || y < 1900 || y > 2200) return null;
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (dt.getUTCMonth() !== m - 1) return null;
  return `${y}-${pad(m)}-${pad(d)}`;
}

export const DATE_PATTERN =
  /\b(\d{4}-\d{1,2}-\d{1,2}|\d{1,2}[/.\-]\d{1,2}[/.\-]\d{2,4}|\d{1,2}(?:st|nd|rd|th)?\s+(?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\.?,?\s+\d{4}|(?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\.?\s+\d{1,2}(?:st|nd|rd|th)?,?\s+\d{4})\b/i;

/**
 * Parse a date into ISO yyyy-mm-dd. Numeric dates are read as DD/MM/YYYY
 * (documented assumption: the synthetic data set is Indian/UK-style).
 */
export function normalizeDate(input: string): string | null {
  const s = input.trim().toLowerCase();
  let m = s.match(/(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (m) return validDate(+m[1]!, +m[2]!, +m[3]!);
  m = s.match(/(\d{1,2})[/.\-](\d{1,2})[/.\-](\d{2,4})/);
  if (m) return validDate(+m[3]!, +m[2]!, +m[1]!);
  m = s.match(/(\d{1,2})(?:st|nd|rd|th)?\s+([a-z]{3,9})\.?,?\s+(\d{4})/);
  if (m && MONTHS[m[2]!.slice(0, 3)] !== undefined) return validDate(+m[3]!, MONTHS[m[2]!.slice(0, 3)]!, +m[1]!);
  m = s.match(/([a-z]{3,9})\.?\s+(\d{1,2})(?:st|nd|rd|th)?,?\s+(\d{4})/);
  if (m && MONTHS[m[1]!.slice(0, 3)] !== undefined) return validDate(+m[3]!, MONTHS[m[1]!.slice(0, 3)]!, +m[2]!);
  return null;
}

export const MONEY_PATTERN =
  /(?:₹|rs\.?|inr|usd|us\$|\$|£|gbp|€|eur)\s?\d[\d,]*(?:\.\d+)?(?:\s?(?:crore|cr|lakh|lakhs|lac|million|mn|m|billion|bn|k))?|\d[\d,]*(?:\.\d+)?\s?(?:crore|cr|lakh|lakhs|lac|million|mn|billion|bn)\b|\d[\d,]*(?:\.\d+)?\s?(?:inr|usd|gbp|eur)\b/i;

export interface Money {
  amount: number;
  currency: string | null;
}

export function parseMoney(input: string): Money | null {
  const s = input.toLowerCase().replace(/\s+/g, ' ');
  const num = s.match(/-?\d[\d,]*(?:\.\d+)?/);
  if (!num) return null;
  let amount = Number(num[0].replace(/,/g, ''));
  if (!Number.isFinite(amount)) return null;
  if (/\b(crore|cr)\b/.test(s)) amount *= 1e7;
  else if (/\b(lakh|lakhs|lac)\b/.test(s)) amount *= 1e5;
  else if (/\b(billion|bn)\b/.test(s)) amount *= 1e9;
  else if (/\b(million|mn)\b/.test(s) || /\d\s?m\b/.test(s)) amount *= 1e6;
  else if (/\d\s?k\b/.test(s)) amount *= 1e3;
  let currency: string | null = null;
  if (/₹|\brs\b|rs\.|\binr\b/.test(s)) currency = 'INR';
  else if (/us\$|\$|\busd\b/.test(s)) currency = 'USD';
  else if (/£|\bgbp\b/.test(s)) currency = 'GBP';
  else if (/€|\beur\b/.test(s)) currency = 'EUR';
  return { amount: Math.round(amount * 100) / 100, currency };
}

export function formatMoney(m: Money): string {
  return `${m.currency ?? ''} ${m.amount.toLocaleString('en-IN')}`.trim();
}

export const EMAIL_PATTERN = /[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/i;
export const PHONE_PATTERN = /(?:\+?\d{1,3}[\s-]?)?(?:\(?\d{2,5}\)?[\s-]?)?\d{3,5}[\s-]?\d{4,5}/;

export const BLANK_VALUE = /^(?:|-+|_+|n\/?a|na|none|nil|not provided|not available|tbd|tbc|pending|unknown|\?+)$/i;

/** Infer a type from the value itself when the label is unknown. */
export function inferType(value: string): FactType {
  if (EMAIL_PATTERN.test(value) && value.trim().split(/\s+/).length === 1) return 'email';
  if (/^\s*[\d\s/.\-a-z,]+$/i.test(value) && normalizeDate(value) && value.length <= 30) return 'date';
  if (MONEY_PATTERN.test(value) && value.length <= 40) return 'money';
  if (/^-?[\d,]+(\.\d+)?%?$/.test(value.trim())) return 'number';
  return 'text';
}

/** Produce the comparable form of a value for its type. */
export function normalizeValue(value: string, type: FactType): string | null {
  const v = value.trim();
  if (!v || BLANK_VALUE.test(v)) return null;
  switch (type) {
    case 'date':
      return normalizeDate(v);
    case 'money': {
      const m = parseMoney(v);
      return m ? `${m.currency ?? ''}:${m.amount}` : null;
    }
    case 'number': {
      const n = Number(v.replace(/[,%\s]/g, ''));
      return Number.isFinite(n) ? String(n) : canonicalText(v);
    }
    case 'email':
      return v.toLowerCase();
    case 'phone':
      return v.replace(/\D/g, '').slice(-10);
    case 'id':
      return v.toUpperCase().replace(/[^A-Z0-9]/g, '');
    default:
      return canonicalText(v);
  }
}
