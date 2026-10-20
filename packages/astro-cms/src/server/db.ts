import { database as connect } from "virtual:cms/storage";

export interface DocRow {
  type: string;
  id: string;
  draft: string | null;
  draft_updated_at: number | null;
  published: string | null;
  published_at: number | null;
}

let ready: Promise<unknown> | undefined;

function db() {
  const database = connect();
  ready ??= database.batch([
    database.prepare(
      `CREATE TABLE IF NOT EXISTS cms_documents (
        type TEXT NOT NULL,
        id TEXT NOT NULL,
        draft TEXT,
        draft_updated_at INTEGER,
        published TEXT,
        published_at INTEGER,
        PRIMARY KEY (type, id)
      )`,
    ),
    // Unpublished uploads. D1 caps a value at 2 MB, so files are stored in chunks.
    database.prepare(
      `CREATE TABLE IF NOT EXISTS cms_assets (
        key TEXT PRIMARY KEY,
        content_type TEXT NOT NULL,
        size INTEGER NOT NULL,
        chunks INTEGER NOT NULL,
        created_at INTEGER NOT NULL
      )`,
    ),
    database.prepare(
      `CREATE TABLE IF NOT EXISTS cms_asset_chunks (
        key TEXT NOT NULL,
        idx INTEGER NOT NULL,
        data BLOB NOT NULL,
        PRIMARY KEY (key, idx)
      )`,
    ),
    // An image's default alt text per locale, offered whenever the image is picked.
    database.prepare(
      `CREATE TABLE IF NOT EXISTS cms_asset_meta (
        value TEXT NOT NULL,
        locale TEXT NOT NULL,
        alt TEXT,
        PRIMARY KEY (value, locale)
      )`,
    ),
    // Dashboard preferences shared by all editors, such as the sidebar order.
    database.prepare(
      `CREATE TABLE IF NOT EXISTS cms_settings (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      )`,
    ),
  ]);
  return { database, ready };
}

async function q() {
  const { database, ready } = db();
  await ready;
  return database;
}

export async function allRows() {
  const database = await q();
  const { results } = await database.prepare("SELECT * FROM cms_documents").all<DocRow>();
  return results;
}

export async function getRow(type: string, id: string) {
  const database = await q();
  return database
    .prepare("SELECT * FROM cms_documents WHERE type = ? AND id = ?")
    .bind(type, id)
    .first<DocRow>();
}

export async function saveDraft(type: string, id: string, data: unknown) {
  const database = await q();
  await database
    .prepare(
      `INSERT INTO cms_documents (type, id, draft, draft_updated_at) VALUES (?, ?, ?, ?)
       ON CONFLICT (type, id) DO UPDATE SET draft = excluded.draft, draft_updated_at = excluded.draft_updated_at`,
    )
    .bind(type, id, JSON.stringify(data), Date.now())
    .run();
}

export async function clearDraft(type: string, id: string) {
  const database = await q();
  await database
    .prepare("UPDATE cms_documents SET draft = NULL, draft_updated_at = NULL WHERE type = ? AND id = ?")
    .bind(type, id)
    .run();
}

export async function markPublished(type: string, id: string, data: unknown) {
  const database = await q();
  await database
    .prepare(
      `INSERT INTO cms_documents (type, id, draft, draft_updated_at, published, published_at)
       VALUES (?, ?, NULL, NULL, ?, ?)
       ON CONFLICT (type, id) DO UPDATE SET draft = NULL, draft_updated_at = NULL,
         published = excluded.published, published_at = excluded.published_at`,
    )
    .bind(type, id, JSON.stringify(data), Date.now())
    .run();
}

/**
 * Takes a document off the site: no published version from now on, even while
 * the running build still has its file. With `draft`, it stays as a draft.
 */
export async function markUnpublished(type: string, id: string, draft: unknown = null) {
  const database = await q();
  const now = Date.now();
  await database
    .prepare(
      `INSERT INTO cms_documents (type, id, draft, draft_updated_at, published, published_at)
       VALUES (?, ?, ?, ?, NULL, ?)
       ON CONFLICT (type, id) DO UPDATE SET draft = excluded.draft, draft_updated_at = excluded.draft_updated_at,
         published = NULL, published_at = excluded.published_at`,
    )
    .bind(type, id, draft === null ? null : JSON.stringify(draft), draft === null ? null : now, now)
    .run();
}

export async function deleteRow(type: string, id: string) {
  const database = await q();
  await database.prepare("DELETE FROM cms_documents WHERE type = ? AND id = ?").bind(type, id).run();
}

const CHUNK = 1024 * 1024;

export async function putAsset(key: string, contentType: string, bytes: Uint8Array) {
  const database = await q();
  const chunks = Math.max(1, Math.ceil(bytes.length / CHUNK));
  const statements = [
    database
      .prepare("INSERT INTO cms_assets (key, content_type, size, chunks, created_at) VALUES (?, ?, ?, ?, ?)")
      .bind(key, contentType, bytes.length, chunks, Date.now()),
  ];
  for (let i = 0; i < chunks; i++) {
    statements.push(
      database
        .prepare("INSERT INTO cms_asset_chunks (key, idx, data) VALUES (?, ?, ?)")
        .bind(key, i, bytes.subarray(i * CHUNK, (i + 1) * CHUNK)),
    );
  }
  await database.batch(statements);
}

export async function getAsset(key: string) {
  const database = await q();
  const meta = await database
    .prepare("SELECT content_type, size FROM cms_assets WHERE key = ?")
    .bind(key)
    .first<{ content_type: string; size: number }>();
  if (!meta) return undefined;
  const { results } = await database
    .prepare("SELECT data FROM cms_asset_chunks WHERE key = ? ORDER BY idx")
    .bind(key)
    .all<{ data: ArrayBuffer | number[] }>();
  const bytes = new Uint8Array(meta.size);
  let offset = 0;
  for (const { data } of results) {
    const part = new Uint8Array(data as ArrayBuffer);
    bytes.set(part, offset);
    offset += part.length;
  }
  return { contentType: meta.content_type, bytes };
}

export async function listAssets() {
  const database = await q();
  const { results } = await database
    .prepare("SELECT key, content_type, size, created_at FROM cms_assets ORDER BY created_at DESC")
    .all<{ key: string; content_type: string; size: number; created_at: number }>();
  return results;
}

export async function assetAlts(locale: string) {
  const database = await q();
  const { results } = await database
    .prepare("SELECT value, alt FROM cms_asset_meta WHERE locale = ?")
    .bind(locale)
    .all<{ value: string; alt: string | null }>();
  return new Map(results.map((r) => [r.value, r.alt ?? ""]));
}

export async function setAssetAlt(value: string, locale: string, alt: string) {
  const database = await q();
  await database
    .prepare(
      `INSERT INTO cms_asset_meta (value, locale, alt) VALUES (?, ?, ?)
       ON CONFLICT (value, locale) DO UPDATE SET alt = excluded.alt`,
    )
    .bind(value, locale, alt)
    .run();
}

/** Carries an image's alt texts over to the file that replaces it. */
export async function moveAssetMeta(from: string, to: string) {
  const database = await q();
  await database.batch([
    database.prepare("INSERT OR REPLACE INTO cms_asset_meta (value, locale, alt) SELECT ?, locale, alt FROM cms_asset_meta WHERE value = ?").bind(to, from),
    database.prepare("DELETE FROM cms_asset_meta WHERE value = ?").bind(from),
  ]);
}

export async function deleteAssetMeta(value: string) {
  const database = await q();
  await database.prepare("DELETE FROM cms_asset_meta WHERE value = ?").bind(value).run();
}

export async function deleteAsset(key: string) {
  const database = await q();
  await database.batch([
    database.prepare("DELETE FROM cms_asset_chunks WHERE key = ?").bind(key),
    database.prepare("DELETE FROM cms_assets WHERE key = ?").bind(key),
  ]);
}

export async function getSetting<T>(key: string): Promise<T | undefined> {
  const database = await q();
  const row = await database.prepare("SELECT value FROM cms_settings WHERE key = ?").bind(key).first<{ value: string }>();
  return row ? (JSON.parse(row.value) as T) : undefined;
}

export async function setSetting(key: string, value: unknown) {
  const database = await q();
  await database
    .prepare("INSERT INTO cms_settings (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value")
    .bind(key, JSON.stringify(value))
    .run();
}
