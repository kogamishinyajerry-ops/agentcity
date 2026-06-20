// ============================================================================
// AgentCity ingester — REDACTION (DATA-CONTRACT §9)
// ----------------------------------------------------------------------------
// Defense-in-depth, runs on EVERY string that may reach the entity model / DOM.
//   §9.2 path tokenization  — /Users/<u> -> ~ ; project root -> <project>
//   §9.3 secret-shaped scrub — sk-* ghp_* AKIA* JWT Bearer key=… url-creds
//   §9.4 email local-part mask — a***@domain
// We report CATEGORY COUNTS only; we never claim a specific provider's key leaked
// (§9 posture: every corpus hit was a false positive).
// ============================================================================

export interface RedactionStats {
  paths: number; // /Users/<u> or <project> rewrites
  emails: number; // email local-parts masked
  secrets: number; // secret-shaped tokens scrubbed (category total)
  byCategory: Record<string, number>;
}

export function newRedactionStats(): RedactionStats {
  return { paths: 0, emails: 0, secrets: 0, byCategory: {} };
}

/**
 * A redactor closed over (optional) project-root strings so it can tokenize the
 * concrete project path the same way everywhere. Mutates `stats` in place.
 */
export class Redactor {
  // Concrete project roots to collapse to <project>, longest-first so a nested
  // root wins over its parent.
  private readonly projectRoots: string[];

  constructor(
    public stats: RedactionStats,
    projectRoots: string[] = []
  ) {
    this.projectRoots = [...new Set(projectRoots.filter(Boolean))].sort(
      (a, b) => b.length - a.length
    );
  }

  /** Redact a single string (all §9 passes). Returns a safe string. */
  text(input: string): string {
    if (typeof input !== 'string' || input.length === 0) return input;
    let s = input;
    s = this.tokenizePaths(s);
    s = this.maskEmails(s);
    s = this.scrubSecrets(s);
    return s;
  }

  /** Redact any value recursively (strings inside arrays/objects). */
  deep<T>(value: T): T {
    if (typeof value === 'string') return this.text(value) as unknown as T;
    if (Array.isArray(value)) return value.map((v) => this.deep(v)) as unknown as T;
    if (value && typeof value === 'object') {
      const out: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
        out[k] = this.deep(v);
      }
      return out as unknown as T;
    }
    return value;
  }

  // ---- §9.2 path tokenization ------------------------------------------------
  private tokenizePaths(s: string): string {
    let out = s;
    // Collapse concrete project roots first (more specific than /Users/<u>).
    for (const root of this.projectRoots) {
      if (out.includes(root)) {
        const before = out;
        out = out.split(root).join('<project>');
        if (out !== before) this.stats.paths += countOccurrences(before, root);
      }
    }
    // /Users/<user>  ->  ~   (also /home/<user> for linux corpora).
    // The username segment can itself contain almost anything except a slash;
    // we deliberately stop at the FIRST slash/quote so the rest of the path
    // (which may legitimately contain spaces, e.g. "20260408 AI Analysis") is
    // preserved AND still relative-to-~. The OS username is the only secret here.
    out = out.replace(/\/(?:Users|home)\/[^/\s"'\\]+/g, () => {
      this.stats.paths += 1;
      return '~';
    });
    // Claude Code flattens a project path into a dash-encoded SLUG used as the
    // on-disk projects/<projDir> name and inside /tmp/claude-*/ task paths:
    //   -Users-<user>-Desktop-foo   (slashes -> dashes).  The slash-based rule
    //   above never sees these, so the OS username leaks via the slug. Collapse
    //   the leading "-Users-<user>" / "-home-<user>" segment to a marker.
    out = out.replace(/-(?:Users|home)-[^-\s/"'\\]+/g, () => {
      this.stats.paths += 1;
      return '-~';
    });
    // Windows: C:\Users\<user>\...  (backslash form) leaks the username too.
    out = out.replace(/[A-Za-z]:\\Users\\[^\\/\s"']+/gi, () => {
      this.stats.paths += 1;
      return '~';
    });
    // /private/tmp/claude-<n>/... and /tmp/... keep their structure but the
    // username inside (claude-<uid>) is harmless; leave as-is.
    return out;
  }

  // ---- §9.4 email local-part mask -------------------------------------------
  private maskEmails(s: string): string {
    return s.replace(
      /([A-Za-z0-9])[A-Za-z0-9._%+-]*(@[A-Za-z0-9.-]+\.[A-Za-z]{2,})/g,
      (_full, first: string, domain: string) => {
        this.stats.emails += 1;
        return `${first}***${domain}`;
      }
    );
  }

  // ---- §9.3 secret-shaped scrub ---------------------------------------------
  private scrubSecrets(s: string): string {
    let out = s;
    // Anthropic keys are `sk-ant-...`. The bare `sk-<word>` pattern fires on
    // ordinary hyphenated identifiers (sk-notification, skill slugs) — exactly
    // the scary FALSE POSITIVE §9 forbids. Require the real provider prefix.
    out = this.scrub(out, /sk-ant-[A-Za-z0-9_-]{16,}/g, 'anthropic_key');
    out = this.scrub(out, /\bsk-(?:proj|live|test)-[A-Za-z0-9]{16,}/g, 'sk_key');
    out = this.scrub(out, /ghp_[A-Za-z0-9]{20,}/g, 'github_pat');
    out = this.scrub(out, /\bAKIA[0-9A-Z]{16}\b/g, 'aws_akid');
    // JWT: three base64url segments dot-separated.
    out = this.scrub(
      out,
      /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g,
      'jwt'
    );
    out = this.scrub(out, /\bBearer\s+[A-Za-z0-9._-]{12,}/g, 'bearer');
    // url-with-credentials  scheme://user:pass@host
    out = this.scrub(out, /\b[a-z][a-z0-9+.-]*:\/\/[^/\s:@]+:[^/\s@]+@/gi, 'url_creds');
    // more bare high-value formats (defense-in-depth; category only, no provider claim)
    out = this.scrub(out, /\bAIza[0-9A-Za-z_-]{35}\b/g, 'google_key');
    out = this.scrub(out, /\bxox[baprs]-[0-9A-Za-z-]{10,}/g, 'slack_token');
    out = this.scrub(out, /\bxapp-[0-9A-Za-z-]{10,}/g, 'slack_token');
    out = this.scrub(out, /\bgithub_pat_[0-9A-Za-z_]{22,}/g, 'github_pat');
    // GitHub non-PAT tokens (oauth/user/server/refresh). ghp_ is handled above;
    // these other prefixes leak via the SAME git flows but were uncovered.
    out = this.scrub(out, /gh[osru]_[A-Za-z0-9]{20,}/g, 'github_token');
    // Stripe live/test secret + restricted keys use an UNDERSCORE form the sk-
    // rules never see (sk_live_…, rk_test_…). Require the live|test infix so a
    // variable like `risk_test_value` can't trip it.
    out = this.scrub(out, /\b[sr]k_(?:live|test)_[A-Za-z0-9]{16,}/g, 'stripe_key');
    // Google OAuth access tokens (gcloud). The ya29. prefix is highly distinctive.
    out = this.scrub(out, /\bya29\.[A-Za-z0-9._-]{20,}/g, 'google_oauth');
    // npm automation tokens — npm_ + 36 base62.
    out = this.scrub(out, /\bnpm_[A-Za-z0-9]{36}\b/g, 'npm_token');
    // PEM private-key blocks (SSH / TLS / OPENSSH / EC / ENCRYPTED). Redact the
    // WHOLE block; a truncated block (BEGIN with no END) scrubs to end-of-string
    // since the base64 body IS the secret. "PUBLIC KEY" is intentionally excluded.
    out = this.scrub(
      out,
      /-----BEGIN (?:[A-Z0-9 ]+ )?PRIVATE KEY-----[\s\S]*?(?:-----END (?:[A-Z0-9 ]+ )?PRIVATE KEY-----|$)/g,
      'private_key'
    );
    // key=value / password: … assignments (§9.3) — mask the VALUE, keep the key name.
    out = out.replace(
      /\b(api[_-]?key|access[_-]?key|secret[_-]?key|secret|password|passwd|authorization|auth|token)(\s*[=:]\s*)["']?([A-Za-z0-9/_+.\-]{12,})["']?/gi,
      (_m: string, key: string, sep: string) => {
        this.stats.secrets += 1;
        this.stats.byCategory['kv_secret'] = (this.stats.byCategory['kv_secret'] ?? 0) + 1;
        return `${key}${sep}<redacted:kv_secret>`;
      }
    );
    return out;
  }

  private scrub(s: string, re: RegExp, category: string): string {
    return s.replace(re, () => {
      this.stats.secrets += 1;
      this.stats.byCategory[category] = (this.stats.byCategory[category] ?? 0) + 1;
      return `<redacted:${category}>`;
    });
  }
}

function countOccurrences(haystack: string, needle: string): number {
  if (!needle) return 0;
  let n = 0;
  let i = haystack.indexOf(needle);
  while (i !== -1) {
    n += 1;
    i = haystack.indexOf(needle, i + needle.length);
  }
  return n;
}
