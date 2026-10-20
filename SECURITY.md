# Security

## Reporting a vulnerability

Please don't open a public issue. Report it privately through GitHub:
**Security → Report a vulnerability** on this repository. Include what an
attacker can do, how to reproduce it, and the version.

You'll get an answer within a week. Fixes are released as a patch version and
noted in the changelog.

## Supported versions

Only the latest release gets security fixes.

## How the dashboard is protected

Every site that uses astro-cms has a dashboard at `/admin`, and anyone who
gets in can change and publish its content. What the package does:

- One shared password (`CMS_PASSWORD`), compared in constant time. After 10
  failed logins from an IP within 15 minutes, that IP is locked out for the
  rest of the window.
- Sessions are signed cookies (HMAC-SHA256, httpOnly, `SameSite=Strict`,
  `Secure` on HTTPS), valid for 7 days. Changing the password or
  `CMS_SESSION_SECRET` signs everyone out.
- The dashboard can't be framed by other sites; the canvas preview only by the
  dashboard itself.
- Rich text is sanitized against an allowlist, links are limited to web, mail
  and phone URLs, and SVG uploads with scripts or external content are refused.
- In `astro dev` only: the file-writing endpoint and the terminal need a random
  per-run token, and the terminal accepts local connections only.

What a site owner must do:

- Use a long random `CMS_PASSWORD` (20+ characters from a password manager).
  The lockout slows guessing from one IP; it can't stop guessing spread across
  many.
- Set `CMS_SESSION_SECRET` to a random value, so a stolen session cookie can't
  be used to guess the password offline.
- Give `CMS_GITHUB_TOKEN` access to the site's repository only (fine-grained,
  Contents read/write, Checks read).
- For more protection, put Cloudflare Access (or similar) in front of
  `/admin*` and `/api/cms/*`.
