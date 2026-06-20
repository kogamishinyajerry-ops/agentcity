// Privacy is non-negotiable (DATA-CONTRACT §9). These tests pin the redaction
// contract: OS usernames (3 path forms), emails, and secret-shaped tokens are
// masked, while the documented FALSE POSITIVES (sk-<word> slugs) are NOT.
import { describe, it, expect } from 'vitest';
import { Redactor, newRedactionStats } from './redact.ts';

function red(input: string, roots: string[] = []) {
  const stats = newRedactionStats();
  const out = new Redactor(stats, roots).text(input);
  return { out, stats };
}

describe('redact — path tokenization (§9.2)', () => {
  it('collapses /Users/<user> to ~ and never leaks the username', () => {
    const { out, stats } = red('reading /Users/alice/proj/auth.ts now');
    expect(out).toBe('reading ~/proj/auth.ts now');
    expect(out).not.toContain('alice');
    expect(stats.paths).toBe(1);
  });

  it('collapses the dash-encoded project slug -Users-<user>-', () => {
    const { out } = red('/private/tmp/claude-9/-Users-alice-Desktop-foo/x');
    expect(out).not.toContain('alice');
    expect(out).toContain('-~-Desktop-foo');
  });

  it('collapses the Windows C:\\Users\\<user> form', () => {
    const { out } = red('C:\\Users\\alice\\project\\x.ts');
    expect(out).not.toContain('alice');
    expect(out).toContain('~');
  });

  it('collapses a known project root to <project> (longest-first)', () => {
    const { out, stats } = red('at /Users/alice/Desktop/Proj/src/x.ts', [
      '/Users/alice/Desktop/Proj',
    ]);
    expect(out).toContain('<project>/src/x.ts');
    expect(stats.paths).toBeGreaterThanOrEqual(1);
  });

  it('preserves spaces in the path tail after ~', () => {
    const { out } = red('/Users/bob/20260408 AI Analysis/notes.md');
    expect(out).toBe('~/20260408 AI Analysis/notes.md');
  });

  it('redacts EVERY occurrence in one string, not just the first (a missed one leaks)', () => {
    // real `cp`/diff/grep lines name the same home path twice — both must go.
    // If the global flag ever regressed, only the first would redact = a leak.
    const { out, stats } = red('cp /Users/alice/a.ts /Users/alice/b.ts');
    expect(out).toBe('cp ~/a.ts ~/b.ts');
    expect(out).not.toContain('alice');
    expect(stats.paths).toBe(2);
    // mixed forms in one string (slash path + dash slug) both collapse, zero leak
    const mixed = red('open /Users/alice/x and tmp/-Users-alice-Desktop-y').out;
    expect(mixed).not.toContain('alice');
    expect(mixed).toContain('~/x');
    expect(mixed).toContain('-~-Desktop-y');
  });
});

describe('redact — email mask (§9.4)', () => {
  it('masks the local part, keeps first char + domain', () => {
    const { out, stats } = red('ping alice@example.com please');
    expect(out).toBe('ping a***@example.com please');
    expect(stats.emails).toBe(1);
  });
});

describe('redact — secret-shaped scrub (§9.3)', () => {
  it('scrubs an Anthropic key', () => {
    const { out, stats } = red('key sk-ant-api03-ABCDEFGHIJKLMNOPqrstuvwx here');
    expect(out).toContain('<redacted:anthropic_key>');
    expect(out).not.toContain('ABCDEFGHIJKLMNOP');
    expect(stats.secrets).toBe(1);
  });

  it('scrubs a GitHub PAT, Google key, and key=value secrets', () => {
    expect(red('ghp_ABCDEFGHIJKLMNOPQRSTUV').out).toContain('<redacted:github_pat>');
    expect(red('AIza' + 'B'.repeat(35)).out).toContain('<redacted:google_key>');
    expect(red('password=hunter2hunter2').out).toBe('password=<redacted:kv_secret>');
  });

  it('does NOT scrub the documented false positives (sk-<word> slugs)', () => {
    // §9.3 posture: bare sk-<word> is an ordinary hyphenated identifier.
    expect(red('the sk-notification hook').out).toBe('the sk-notification hook');
    expect(red('a skill-firm slug').out).toBe('a skill-firm slug');
  });

  it('keeps the key name but masks the value', () => {
    const { out } = red('api_key: "abcdef1234567890"');
    expect(out).toContain('api_key');
    expect(out).toContain('<redacted:kv_secret>');
    expect(out).not.toContain('abcdef1234567890');
  });
});

describe('redact — extended secret formats (defense-in-depth)', () => {
  it('scrubs GitHub non-PAT tokens (oauth/user/server/refresh)', () => {
    for (const prefix of ['gho_', 'ghu_', 'ghs_', 'ghr_']) {
      const { out } = red(`token ${prefix}${'A'.repeat(36)} end`);
      expect(out).toContain('<redacted:github_token>');
      expect(out).not.toContain('AAAAAAAA');
    }
  });

  it('scrubs Stripe underscore-form secret/restricted keys', () => {
    expect(red('sk_live_' + 'a'.repeat(24)).out).toContain('<redacted:stripe_key>');
    expect(red('rk_test_' + 'b'.repeat(24)).out).toContain('<redacted:stripe_key>');
  });

  it('does NOT scrub Stripe lookalikes (risk_test_, mask_live_ are ordinary words)', () => {
    expect(red('the risk_test_results were fine').out).toBe('the risk_test_results were fine');
    expect(red('a mask_live_preview flag').out).toBe('a mask_live_preview flag');
  });

  it('scrubs a Google OAuth (ya29.) access token', () => {
    const { out } = red('Authorization ya29.' + 'c'.repeat(40));
    expect(out).toContain('<redacted:google_oauth>');
    expect(out).not.toContain('cccccccc');
  });

  it('scrubs an npm automation token but leaves short npm_ words', () => {
    expect(red('npm_' + 'd'.repeat(36)).out).toContain('<redacted:npm_token>');
    expect(red('run npm_config_cache here').out).toBe('run npm_config_cache here');
  });

  it('scrubs a Slack app-level token', () => {
    expect(red('xapp-1-' + 'E'.repeat(20)).out).toContain('<redacted:slack_token>');
  });

  it('scrubs a full PEM private-key block', () => {
    const pem =
      '-----BEGIN OPENSSH PRIVATE KEY-----\n' +
      'b3BlbnNzaC1rZXktdjEAAAAABG5vbmU' + 'F'.repeat(40) + '\n' +
      '-----END OPENSSH PRIVATE KEY-----';
    const { out, stats } = red(`here is the key:\n${pem}\nthanks`);
    expect(out).toContain('<redacted:private_key>');
    expect(out).not.toContain('b3BlbnNzaC1rZXk');
    expect(out).toContain('here is the key:');
    expect(out).toContain('thanks');
    expect(stats.byCategory['private_key']).toBe(1);
  });

  it('scrubs a TRUNCATED PEM block (BEGIN with no END) to end-of-string', () => {
    const { out } = red('-----BEGIN RSA PRIVATE KEY-----\nMIIEpAIBAAKCAQEA' + 'G'.repeat(40));
    expect(out).toContain('<redacted:private_key>');
    expect(out).not.toContain('MIIEpAIBAAKCAQEA');
  });

  it('does NOT scrub a PUBLIC key block (public keys are not secret)', () => {
    const pub = '-----BEGIN PUBLIC KEY-----\nMFkwEwYHKoZI' + 'H'.repeat(20) + '\n-----END PUBLIC KEY-----';
    const { out } = red(pub);
    expect(out).toContain('PUBLIC KEY');
    expect(out).not.toContain('<redacted:private_key>');
  });
});

describe('redact — deep() walks nested structures', () => {
  it('redacts strings inside arrays and objects, leaves non-strings', () => {
    const stats = newRedactionStats();
    const r = new Redactor(stats);
    const out = r.deep({ path: '/Users/alice/x', n: 42, nested: ['/Users/bob/y'] });
    expect(JSON.stringify(out)).not.toContain('alice');
    expect(JSON.stringify(out)).not.toContain('bob');
    expect(out.n).toBe(42);
  });
});
