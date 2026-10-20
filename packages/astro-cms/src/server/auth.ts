import { getSecret } from "astro:env/server";
import { database as connect } from "virtual:cms/storage";

export const SESSION_COOKIE = "cms_session";
const SESSION_DAYS = 7;
const MAX_FAILURES = 10;
const WINDOW_MS = 15 * 60 * 1000;

export const cmsPassword = () => getSecret("CMS_PASSWORD") || undefined;

/** Logins are required on a deployed site, and locally once a password is set in .dev.vars. */
export const authRequired = () => !__CMS_DEV__ || !!cmsPassword();

const encoder = new TextEncoder();

const b64url = (bytes: ArrayBuffer) =>
  btoa(String.fromCharCode(...new Uint8Array(bytes))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

/**
 * The signing key derives from the password, so changing it ends every session.
 * With CMS_SESSION_SECRET set, the key also needs that random secret, so a
 * stolen session cookie can't be used to guess the password offline. Without
 * it, a fixed salt is used (the package's old name, so renaming it didn't sign
 * anyone out).
 */
async function key(password: string) {
  const secret = getSecret("CMS_SESSION_SECRET");
  const material = secret ? `astro-cms-session:${secret}:${password}` : `lumos-cms-session:${password}`;
  const raw = await crypto.subtle.digest("SHA-256", encoder.encode(material));
  return crypto.subtle.importKey("raw", raw, { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"]);
}

export function timingSafeEqual(a: string, b: string) {
  const x = encoder.encode(a);
  const y = encoder.encode(b);
  let diff = x.length ^ y.length;
  for (let i = 0; i < Math.max(x.length, y.length); i++) diff |= (x[i] ?? 0) ^ (y[i] ?? 0);
  return diff === 0;
}

export async function createSession(password: string) {
  const expires = Date.now() + SESSION_DAYS * 86400_000;
  const sig = await crypto.subtle.sign("HMAC", await key(password), encoder.encode(`v1.${expires}`));
  return { value: `v1.${expires}.${b64url(sig)}`, maxAge: SESSION_DAYS * 86400 };
}

export async function verifySession(token: string | undefined) {
  const password = cmsPassword();
  if (!password || !token) return false;
  const [version, expires, sig] = token.split(".");
  if (version !== "v1" || !sig || !(Number(expires) > Date.now())) return false;
  const expected = await crypto.subtle.sign("HMAC", await key(password), encoder.encode(`v1.${expires}`));
  return timingSafeEqual(sig, b64url(expected));
}

/* ---------------------------- Brute-force limit ---------------------------- */

async function attemptsDb() {
  const database = connect();
  await database
    .prepare(
      "CREATE TABLE IF NOT EXISTS cms_login_attempts (ip TEXT PRIMARY KEY, failures INTEGER NOT NULL, window_start INTEGER NOT NULL)",
    )
    .run();
  return database;
}

export async function isLockedOut(ip: string) {
  const database = await attemptsDb();
  const row = await database
    .prepare("SELECT failures, window_start FROM cms_login_attempts WHERE ip = ?")
    .bind(ip)
    .first<{ failures: number; window_start: number }>();
  return !!row && row.failures >= MAX_FAILURES && Date.now() - row.window_start < WINDOW_MS;
}

export async function recordFailure(ip: string) {
  const database = await attemptsDb();
  const now = Date.now();
  await database
    .prepare(
      `INSERT INTO cms_login_attempts (ip, failures, window_start) VALUES (?, 1, ?)
       ON CONFLICT (ip) DO UPDATE SET
         failures = CASE WHEN ? - window_start > ? THEN 1 ELSE failures + 1 END,
         window_start = CASE WHEN ? - window_start > ? THEN ? ELSE window_start END`,
    )
    .bind(ip, now, now, WINDOW_MS, now, WINDOW_MS, now)
    .run();
}

export async function clearFailures(ip: string) {
  const database = await attemptsDb();
  await database.prepare("DELETE FROM cms_login_attempts WHERE ip = ?").bind(ip).run();
}

/** Only dashboard paths are valid places to return to after signing in. */
export const safeNext = (next: string | null) =>
  next && /^\/admin(\/|$|\?)/.test(next) && !next.startsWith("/admin/login") ? next : "/admin";
