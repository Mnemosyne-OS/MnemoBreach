/**
 * mask.ts — how an identifier looks on screen when nobody is holding it open.
 *
 * Masked is the default everywhere (doc 141 §8). The mask keeps just enough to
 * tell two entries apart: first letter and domain of an email, country code
 * and last two digits of a phone number.
 */

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function isEmail(v: string): boolean {
  return EMAIL.test(v.trim());
}

/** Keeps a leading `+` and digits; null when fewer than 6 digits remain. */
export function normalizePhone(v: string): string | null {
  const trimmed = v.trim();
  const digits = trimmed.replace(/\D/g, '');
  if (digits.length < 6 || digits.length > 15) return null;
  return (trimmed.startsWith('+') ? '+' : '') + digits;
}

/** `tony@gmail.com` → `t***@gmail.com`; a one-letter local part shows nothing. */
export function maskEmail(email: string): string {
  const at = email.lastIndexOf('@');
  if (at <= 0) return '***';
  const local = email.slice(0, at);
  const domain = email.slice(at + 1);
  const head = local.length > 1 ? local[0] : '';
  return `${head}***@${domain}`;
}

/**
 * `+33612345678` → `+33 ******* 78`. The country code is kept only when the
 * number starts with `+`; we do not guess its length, so it is the 2 digits
 * after the `+` (enough to tell a French from a US number apart, no more).
 */
export function maskPhone(phone: string): string {
  const plus = phone.startsWith('+');
  const digits = phone.replace(/\D/g, '');
  if (digits.length < 4) return '***';
  const cc = plus ? `+${digits.slice(0, 2)} ` : '';
  const rest = plus ? digits.slice(2) : digits;
  const tail = rest.slice(-2);
  return `${cc}${'*'.repeat(Math.max(rest.length - 2, 3))} ${tail}`;
}
