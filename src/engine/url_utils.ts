/**
 * Strict URL and domain validation utilities for crawler security.
 * Prevents SSRF, open redirects, userinfo impersonation, and domain confusion attacks.
 */

/**
 * Detects sensitive URL paths and query patterns that must NEVER be crawled or indexed
 * for user privacy and security (auth, passwords, checkout, banking, admin).
 */
const SENSITIVE_PATH_PATTERNS = [
  // Auth & Account
  /\b(?:login|signin|sign-in|signup|sign-up|register|logout|auth|oauth|sso|saml)\b/i,
  /\b(?:password|passwd|reset-password|forgot-password|change-password)\b/i,
  /\b(?:account|my-account|profile|settings|security|user-profile)\b/i,
  // Banking & Financial & Payments
  /\b(?:checkout|cart|basket|billing|payment|pay|invoice|receipt)\b/i,
  /\b(?:bank|banking|wallet|fund|transfer|tax|salary|payroll)\b/i,
  // Administrative & Portals
  /\b(?:admin|administrator|moderator|dashboard|portal|cpanel|wp-admin)\b/i
];

const SENSITIVE_QUERY_PATTERNS = [
  /(?:token|auth_token|access_token|refresh_token|api_key|secret|password|passwd|session|session_id|jwt|cvv|ccv|credit_card)=/i
];

export function isSensitiveUrl(url: string): boolean {
  if (!url || typeof url !== 'string') return false;
  try {
    const parsed = new URL(url, 'http://localhost');
    const path = parsed.pathname.toLowerCase();
    const search = parsed.search.toLowerCase();

    // Check path patterns
    for (const pattern of SENSITIVE_PATH_PATTERNS) {
      if (pattern.test(path)) {
        return true;
      }
    }

    // Check query params for credentials/secrets
    for (const pattern of SENSITIVE_QUERY_PATTERNS) {
      if (pattern.test(search)) {
        return true;
      }
    }

    return false;
  } catch {
    return false;
  }
}

/**
 * Validates whether a given URL is a legitimate, crawlable internal link for the specified domain.
 *
 * Rules:
 * - Only 'http:' and 'https:' protocols are permitted (blocks javascript:, data:, file:, etc.).
 * - Userinfo (user:pass@) is strictly forbidden (neutralizes userinfo tricks like https://target.com@evil.com).
 * - Sensitive URLs (auth, checkout, passwords, banking, admin) are strictly blocked.
 * - Hostname comparison is case-insensitive.
 * - Subdomains:
 *   If allowSubdomains is true, candidate must match targetDomain exactly or end with `.${targetDomain}`.
 *   This explicitly blocks suffix injection attacks like `https://target.com.attacker.net`.
 * - Port numbers: allowed if valid, but checked against hostname.
 */
export function isValidCrawlUrl(
  candidateUrl: string,
  targetDomain: string,
  allowSubdomains: boolean = true
): boolean {
  if (!candidateUrl || typeof candidateUrl !== 'string') return false;
  if (!targetDomain || typeof targetDomain !== 'string') return false;

  // Enforce privacy: reject sensitive authentication, checkout, and admin URLs
  if (isSensitiveUrl(candidateUrl)) {
    return false;
  }

  try {
    const parsed = new URL(candidateUrl);

    // 1. Enforce strict HTTP/HTTPS scheme
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return false;
    }

    // 2. Reject userinfo tricks (e.g., https://trusted.com@evil.com)
    if (parsed.username || parsed.password) {
      return false;
    }

    const candidateHost = parsed.hostname.toLowerCase();
    const cleanTargetDomain = targetDomain.toLowerCase().replace(/:\d+$/, ''); // strip port if present in domain string

    // 3. Exact hostname match
    if (candidateHost === cleanTargetDomain) {
      return true;
    }

    // Handle www. variations
    if (cleanTargetDomain.startsWith('www.')) {
      const bareTarget = cleanTargetDomain.slice(4);
      if (candidateHost === bareTarget) return true;
      if (allowSubdomains && candidateHost.endsWith(`.${bareTarget}`)) return true;
    } else {
      if (candidateHost === `www.${cleanTargetDomain}`) return true;
      if (allowSubdomains && candidateHost.endsWith(`.${cleanTargetDomain}`)) return true;
    }

    return false;
  } catch {
    // Malformed URL
    return false;
  }
}

/**
 * Sanitizes URLs for safe browser navigation in content scripts.
 * Only permits 'http:' and 'https:' protocols.
 */
export function isSafeNavigationUrl(url: string, baseUrl?: string): boolean {
  if (!url || typeof url !== 'string') return false;
  try {
    const base = baseUrl || (typeof window !== 'undefined' && window.location?.href ? window.location.href : 'http://localhost');
    const parsed = new URL(url, base);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}
