import { DatabaseSync } from "node:sqlite";
import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import path from "node:path";
import fs from "node:fs";
import type { Project, Asset, Notification, BrandVoice } from "@/lib/data";
import {
  defaultProjects,
  defaultAssets,
  defaultNotifications,
  DEFAULT_VOICE,
} from "@/lib/data";
import { DEFAULT_PRICING, PRICING_VERSION, type PricingConfig } from "./pricing";

/**
 * Durable backend store, backed by SQLite via Node's built-in `node:sqlite`
 * module (zero external dependencies). The database file lives in `./data`.
 *
 * A single process-wide connection is reused across requests. This works for a
 * self-hosted / long-lived Node server (`next start`). On ephemeral serverless
 * platforms the file is per-instance; swap the connection for a hosted Postgres
 * without changing any of the query helpers below.
 */

let db: DatabaseSync | null = null;

export function getDb(): DatabaseSync {
  if (db) return db;

  const dataDir = path.join(process.cwd(), "data");
  fs.mkdirSync(dataDir, { recursive: true });
  const conn = new DatabaseSync(path.join(dataDir, "echoforge.db"));

  conn.exec("PRAGMA journal_mode = WAL");
  conn.exec("PRAGMA foreign_keys = ON");
  conn.exec(`
    CREATE TABLE IF NOT EXISTS users (
      email         TEXT PRIMARY KEY,
      name          TEXT NOT NULL,
      password_hash TEXT NOT NULL,
      plan          TEXT NOT NULL,
      created_at    TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS projects (
      id           TEXT PRIMARY KEY,
      user_email   TEXT NOT NULL REFERENCES users(email) ON DELETE CASCADE,
      title        TEXT NOT NULL,
      status       TEXT NOT NULL,
      progress     INTEGER NOT NULL,
      assets_ready INTEGER NOT NULL,
      assets_total INTEGER NOT NULL,
      eta          TEXT NOT NULL,
      created_at   TEXT NOT NULL,
      file_name    TEXT,
      file_size    TEXT,
      transcript   TEXT,
      storage_path TEXT,
      sort         INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS assets (
      id         TEXT PRIMARY KEY,
      user_email TEXT NOT NULL REFERENCES users(email) ON DELETE CASCADE,
      project_id TEXT NOT NULL,
      name       TEXT NOT NULL,
      type       TEXT NOT NULL,
      views      TEXT NOT NULL,
      status     TEXT NOT NULL,
      liked      INTEGER NOT NULL,
      content    TEXT,
      sort       INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS notifications (
      id         TEXT PRIMARY KEY,
      user_email TEXT NOT NULL REFERENCES users(email) ON DELETE CASCADE,
      title      TEXT NOT NULL,
      message    TEXT NOT NULL,
      time       TEXT NOT NULL,
      read       INTEGER NOT NULL,
      type       TEXT NOT NULL,
      sort       INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS pricing_config (
      key   TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS integrations (
      name   TEXT PRIMARY KEY,
      config TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS reset_tokens (
      token      TEXT PRIMARY KEY,
      user_email TEXT NOT NULL,
      expires_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS analytics_events (
      id    INTEGER PRIMARY KEY AUTOINCREMENT,
      event TEXT NOT NULL,
      path  TEXT,
      ts    INTEGER NOT NULL,
      meta  TEXT
    );
    CREATE TABLE IF NOT EXISTS brand_voice (
      user_email TEXT PRIMARY KEY REFERENCES users(email) ON DELETE CASCADE,
      config     TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS ideas (
      id         TEXT PRIMARY KEY,
      user_email TEXT NOT NULL REFERENCES users(email) ON DELETE CASCADE,
      title      TEXT NOT NULL,
      notes      TEXT,
      script     TEXT,
      score      INTEGER NOT NULL,
      status     TEXT NOT NULL,
      created_at TEXT NOT NULL,
      sort       INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS subscribers (
      id          TEXT PRIMARY KEY,
      owner_email TEXT NOT NULL REFERENCES users(email) ON DELETE CASCADE,
      email       TEXT NOT NULL,
      source      TEXT,
      created_at  TEXT NOT NULL,
      UNIQUE(owner_email, email)
    );
    CREATE TABLE IF NOT EXISTS creator_pages (
      user_email   TEXT PRIMARY KEY REFERENCES users(email) ON DELETE CASCADE,
      slug         TEXT NOT NULL UNIQUE,
      display_name TEXT NOT NULL,
      bio          TEXT,
      links        TEXT,
      rates        TEXT,
      enabled      INTEGER NOT NULL DEFAULT 1
    );
    CREATE TABLE IF NOT EXISTS public_audits (
      id         TEXT PRIMARY KEY,
      label      TEXT NOT NULL,
      grade      INTEGER NOT NULL,
      report     TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS audits (
      id         TEXT PRIMARY KEY,
      user_email TEXT NOT NULL REFERENCES users(email) ON DELETE CASCADE,
      source     TEXT NOT NULL,
      label      TEXT,
      grade      INTEGER NOT NULL,
      report     TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS platform_accounts (
      user_email    TEXT NOT NULL REFERENCES users(email) ON DELETE CASCADE,
      platform      TEXT NOT NULL,
      access_token  TEXT NOT NULL,
      refresh_token TEXT,
      expires_at    INTEGER,
      external_id   TEXT,
      handle        TEXT,
      created_at    TEXT NOT NULL,
      PRIMARY KEY (user_email, platform)
    );
    CREATE TABLE IF NOT EXISTS post_metrics (
      post_id    TEXT PRIMARY KEY,
      user_email TEXT NOT NULL REFERENCES users(email) ON DELETE CASCADE,
      views      INTEGER NOT NULL DEFAULT 0,
      likes      INTEGER NOT NULL DEFAULT 0,
      comments   INTEGER NOT NULL DEFAULT 0,
      source     TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS revenue_entries (
      id         TEXT PRIMARY KEY,
      user_email TEXT NOT NULL REFERENCES users(email) ON DELETE CASCADE,
      month      TEXT NOT NULL,
      stream     TEXT NOT NULL,
      amount     REAL NOT NULL,
      note       TEXT,
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS deals (
      id         TEXT PRIMARY KEY,
      user_email TEXT NOT NULL REFERENCES users(email) ON DELETE CASCADE,
      brand      TEXT NOT NULL,
      contact    TEXT,
      value      REAL NOT NULL DEFAULT 0,
      stage      TEXT NOT NULL,
      platform   TEXT,
      notes      TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS pending_plans (
      email      TEXT PRIMARY KEY,
      plan       TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS provenance (
      asset_id  TEXT PRIMARY KEY,
      manifest  TEXT NOT NULL,
      signature TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS app_flags (
      key   TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS audit_log (
      id     INTEGER PRIMARY KEY AUTOINCREMENT,
      actor  TEXT NOT NULL,
      action TEXT NOT NULL,
      detail TEXT,
      ts     INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS scheduled_posts (
      id           TEXT PRIMARY KEY,
      user_email   TEXT NOT NULL REFERENCES users(email) ON DELETE CASCADE,
      asset_id     TEXT NOT NULL,
      asset_name   TEXT NOT NULL,
      platform     TEXT NOT NULL,
      scheduled_at TEXT NOT NULL,
      status       TEXT NOT NULL,
      created_at   TEXT NOT NULL,
      sort         INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS clips (
      id          TEXT PRIMARY KEY,
      user_email  TEXT NOT NULL REFERENCES users(email) ON DELETE CASCADE,
      project_id  TEXT NOT NULL,
      title       TEXT NOT NULL,
      start_sec   REAL NOT NULL,
      end_sec     REAL NOT NULL,
      score       INTEGER NOT NULL,
      reason      TEXT NOT NULL,
      matched     TEXT,
      status      TEXT NOT NULL,
      style       TEXT NOT NULL DEFAULT 'bold',
      output_path TEXT,
      error       TEXT,
      created_at  TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_clips_user ON clips(user_email);
    CREATE TABLE IF NOT EXISTS watchlist (
      id              TEXT PRIMARY KEY,
      user_email      TEXT NOT NULL REFERENCES users(email) ON DELETE CASCADE,
      handle          TEXT NOT NULL,
      label           TEXT,
      last_grade      INTEGER,
      last_top        TEXT,
      last_checked_at TEXT,
      created_at      TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS managed_accounts (
      manager_email TEXT NOT NULL REFERENCES users(email) ON DELETE CASCADE,
      client_email  TEXT NOT NULL REFERENCES users(email) ON DELETE CASCADE,
      status        TEXT NOT NULL,
      created_at    TEXT NOT NULL,
      PRIMARY KEY (manager_email, client_email)
    );
    CREATE TABLE IF NOT EXISTS error_log (
      id      INTEGER PRIMARY KEY AUTOINCREMENT,
      context TEXT NOT NULL,
      message TEXT NOT NULL,
      stack   TEXT,
      ts      TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS gen_images (
      id         TEXT PRIMARY KEY,
      user_email TEXT NOT NULL REFERENCES users(email) ON DELETE CASCADE,
      prompt     TEXT NOT NULL,
      path       TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS site_audits (
      id           TEXT PRIMARY KEY,
      user_email   TEXT NOT NULL,
      url          TEXT NOT NULL,
      status       TEXT NOT NULL DEFAULT 'pending_payment',
      paid         INTEGER NOT NULL DEFAULT 0,
      score        INTEGER,
      report       TEXT,
      error        TEXT,
      created_at   TEXT NOT NULL,
      completed_at TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_projects_user ON projects(user_email);
    CREATE INDEX IF NOT EXISTS idx_assets_user ON assets(user_email);
    CREATE INDEX IF NOT EXISTS idx_notifications_user ON notifications(user_email);
  `);

  // Additive migrations for databases created before these columns existed.
  for (const stmt of [
    "ALTER TABLE projects ADD COLUMN transcript TEXT",
    "ALTER TABLE projects ADD COLUMN storage_path TEXT",
    "ALTER TABLE projects ADD COLUMN transcript_words TEXT",
    "ALTER TABLE projects ADD COLUMN duration_sec REAL",
    "ALTER TABLE assets ADD COLUMN content TEXT",
    "ALTER TABLE assets ADD COLUMN evergreen INTEGER NOT NULL DEFAULT 0",
    "ALTER TABLE assets ADD COLUMN ab_group TEXT",
    "ALTER TABLE users ADD COLUMN referral_code TEXT",
    "ALTER TABLE users ADD COLUMN referred_by TEXT",
    "ALTER TABLE users ADD COLUMN last_brief_at TEXT",
    "ALTER TABLE scheduled_posts ADD COLUMN clip_id TEXT",
    "ALTER TABLE scheduled_posts ADD COLUMN external_id TEXT",
    "ALTER TABLE clips ADD COLUMN position TEXT NOT NULL DEFAULT 'bottom'",
    "ALTER TABLE clips ADD COLUMN focus TEXT NOT NULL DEFAULT 'center'",
    "ALTER TABLE users ADD COLUMN trial_ends_at TEXT",
    "ALTER TABLE users ADD COLUMN trial_prev_plan TEXT",
    "ALTER TABLE users ADD COLUMN custom_voice_id TEXT",
    "ALTER TABLE users ADD COLUMN email_verified INTEGER NOT NULL DEFAULT 1",
    "ALTER TABLE users ADD COLUMN verify_token TEXT",
    "ALTER TABLE clips ADD COLUMN kind TEXT NOT NULL DEFAULT 'clip'",
    "ALTER TABLE clips ADD COLUMN script TEXT",
    "ALTER TABLE projects ADD COLUMN approve_token TEXT",
  ]) {
    try {
      conn.exec(stmt);
    } catch {
      /* column already exists */
    }
  }

  db = conn;
  return conn;
}

// --- Users ---

export interface DbUser {
  email: string;
  name: string;
  passwordHash: string;
  plan: string;
  createdAt: string;
}

export function findUser(email: string): DbUser | null {
  const row = getDb()
    .prepare("SELECT * FROM users WHERE email = ?")
    .get(email.toLowerCase()) as Record<string, string> | undefined;
  if (!row) return null;
  return {
    email: row.email,
    name: row.name,
    passwordHash: row.password_hash,
    plan: row.plan,
    createdAt: row.created_at,
  };
}

export function createUser(user: DbUser): void {
  getDb()
    .prepare(
      "INSERT INTO users (email, name, password_hash, plan, created_at) VALUES (?, ?, ?, ?, ?)"
    )
    .run(
      user.email.toLowerCase(),
      user.name,
      user.passwordHash,
      user.plan,
      user.createdAt
    );
}

// --- Ideas (content backlog: idea → script → generated assets) ---

export interface Idea {
  id: string;
  title: string;
  notes: string;
  script: string;
  score: number;
  status: "idea" | "scripted" | "generated";
  createdAt: string;
}

function mapIdea(row: Record<string, unknown>): Idea {
  return {
    id: row.id as string,
    title: row.title as string,
    notes: (row.notes as string) ?? "",
    script: (row.script as string) ?? "",
    score: row.score as number,
    status: row.status as Idea["status"],
    createdAt: row.created_at as string,
  };
}

export function listIdeas(email: string): Idea[] {
  return (
    getDb()
      .prepare("SELECT * FROM ideas WHERE user_email = ? ORDER BY sort DESC")
      .all(email.toLowerCase()) as Record<string, unknown>[]
  ).map(mapIdea);
}

export function getIdea(email: string, id: string): Idea | null {
  const row = getDb()
    .prepare("SELECT * FROM ideas WHERE id = ? AND user_email = ?")
    .get(id, email.toLowerCase()) as Record<string, unknown> | undefined;
  return row ? mapIdea(row) : null;
}

export function insertIdea(
  email: string,
  idea: Omit<Idea, "createdAt">
): Idea {
  const now = new Date().toISOString();
  getDb()
    .prepare(
      `INSERT INTO ideas (id, user_email, title, notes, script, score, status, created_at, sort)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      idea.id,
      email.toLowerCase(),
      idea.title,
      idea.notes || null,
      idea.script || null,
      idea.score,
      idea.status,
      now,
      Date.now()
    );
  return { ...idea, createdAt: now };
}

export function updateIdea(
  email: string,
  id: string,
  updates: Partial<Pick<Idea, "title" | "notes" | "script" | "status" | "score">>
): Idea | null {
  const cols: Record<string, string> = {
    title: "title",
    notes: "notes",
    script: "script",
    status: "status",
    score: "score",
  };
  const sets: string[] = [];
  const values: (string | number)[] = [];
  for (const [key, col] of Object.entries(cols)) {
    const v = updates[key as keyof typeof updates];
    if (v !== undefined) {
      sets.push(`${col} = ?`);
      values.push(v as string | number);
    }
  }
  if (sets.length > 0) {
    values.push(id, email.toLowerCase());
    getDb()
      .prepare(`UPDATE ideas SET ${sets.join(", ")} WHERE id = ? AND user_email = ?`)
      .run(...values);
  }
  return getIdea(email, id);
}

export function deleteIdea(email: string, id: string): void {
  getDb()
    .prepare("DELETE FROM ideas WHERE id = ? AND user_email = ?")
    .run(id, email.toLowerCase());
}

// --- Subscribers + creator pages (owned audience) ---

export interface Subscriber {
  id: string;
  email: string;
  source: string;
  createdAt: string;
}

export function listSubscribers(email: string): Subscriber[] {
  return getDb()
    .prepare(
      `SELECT id, email, source, created_at AS createdAt
       FROM subscribers WHERE owner_email = ? ORDER BY created_at DESC`
    )
    .all(email.toLowerCase()) as unknown as Subscriber[];
}

/** Returns true when the subscriber is new (INSERT OR IGNORE dedupes). */
export function addSubscriber(
  ownerEmail: string,
  subscriberEmail: string,
  source: string
): boolean {
  const res = getDb()
    .prepare(
      `INSERT OR IGNORE INTO subscribers (id, owner_email, email, source, created_at)
       VALUES (?, ?, ?, ?, ?)`
    )
    .run(
      `sub-${crypto.randomUUID()}`,
      ownerEmail.toLowerCase(),
      subscriberEmail.toLowerCase(),
      source,
      new Date().toISOString()
    );
  return Number(res.changes) > 0;
}

export interface CreatorPage {
  slug: string;
  displayName: string;
  bio: string;
  links: { label: string; url: string }[];
  rates: { platform: string; price: number }[];
  enabled: boolean;
}

function mapCreatorPage(row: Record<string, unknown>): CreatorPage {
  const parse = <T,>(v: unknown, fallback: T): T => {
    try {
      return v ? (JSON.parse(v as string) as T) : fallback;
    } catch {
      return fallback;
    }
  };
  return {
    slug: row.slug as string,
    displayName: row.display_name as string,
    bio: (row.bio as string) ?? "",
    links: parse(row.links, []),
    rates: parse(row.rates, []),
    enabled: Boolean(row.enabled),
  };
}

export function getCreatorPageByEmail(email: string): CreatorPage | null {
  const row = getDb()
    .prepare("SELECT * FROM creator_pages WHERE user_email = ?")
    .get(email.toLowerCase()) as Record<string, unknown> | undefined;
  return row ? mapCreatorPage(row) : null;
}

export function getCreatorPageOwner(slug: string): { email: string; page: CreatorPage } | null {
  const row = getDb()
    .prepare("SELECT * FROM creator_pages WHERE slug = ? AND enabled = 1")
    .get(slug.toLowerCase()) as Record<string, unknown> | undefined;
  return row ? { email: row.user_email as string, page: mapCreatorPage(row) } : null;
}

/** Returns false when the slug is already taken by another user. */
export function upsertCreatorPage(email: string, page: CreatorPage): boolean {
  const conn = getDb();
  const taken = conn
    .prepare("SELECT user_email FROM creator_pages WHERE slug = ?")
    .get(page.slug) as { user_email: string } | undefined;
  if (taken && taken.user_email !== email.toLowerCase()) return false;
  conn
    .prepare(
      `INSERT OR REPLACE INTO creator_pages (user_email, slug, display_name, bio, links, rates, enabled)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      email.toLowerCase(),
      page.slug,
      page.displayName,
      page.bio || null,
      JSON.stringify(page.links),
      JSON.stringify(page.rates),
      page.enabled ? 1 : 0
    );
  return true;
}

// --- Public shareable audits (the viral score cards) ---

export function insertPublicAudit(
  id: string,
  label: string,
  grade: number,
  reportJson: string
): void {
  getDb()
    .prepare(
      "INSERT INTO public_audits (id, label, grade, report, created_at) VALUES (?, ?, ?, ?, ?)"
    )
    .run(id, label, grade, reportJson, new Date().toISOString());
}

export function getPublicAudit(
  id: string
): { label: string; grade: number; report: string; createdAt: string } | null {
  const row = getDb()
    .prepare(
      "SELECT label, grade, report, created_at AS createdAt FROM public_audits WHERE id = ?"
    )
    .get(id) as
    | { label: string; grade: number; report: string; createdAt: string }
    | undefined;
  return row ?? null;
}

// --- Social audits ---

export function insertAuditReport(
  email: string,
  source: string,
  label: string,
  grade: number,
  reportJson: string
): string {
  const id = `aud-${crypto.randomUUID()}`;
  getDb()
    .prepare(
      `INSERT INTO audits (id, user_email, source, label, grade, report, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    )
    .run(id, email.toLowerCase(), source, label, grade, reportJson, new Date().toISOString());
  return id;
}

export function latestAuditReport(
  email: string
): { id: string; report: string } | null {
  const row = getDb()
    .prepare(
      "SELECT id, report FROM audits WHERE user_email = ? ORDER BY created_at DESC LIMIT 1"
    )
    .get(email.toLowerCase()) as { id: string; report: string } | undefined;
  return row ?? null;
}

// --- Connected platform accounts (creator OAuth tokens) ---

export interface PlatformAccount {
  platform: string;
  accessToken: string;
  refreshToken: string | null;
  expiresAt: number | null;
  externalId: string | null;
  handle: string | null;
  createdAt: string;
}

export function getPlatformAccount(
  email: string,
  platform: string
): PlatformAccount | null {
  const row = getDb()
    .prepare(
      "SELECT * FROM platform_accounts WHERE user_email = ? AND platform = ?"
    )
    .get(email.toLowerCase(), platform) as Record<string, unknown> | undefined;
  if (!row) return null;
  return {
    platform: row.platform as string,
    accessToken: row.access_token as string,
    refreshToken: (row.refresh_token as string) ?? null,
    expiresAt: (row.expires_at as number) ?? null,
    externalId: (row.external_id as string) ?? null,
    handle: (row.handle as string) ?? null,
    createdAt: row.created_at as string,
  };
}

export function listPlatformAccounts(
  email: string
): { platform: string; handle: string | null; createdAt: string }[] {
  return getDb()
    .prepare(
      `SELECT platform, handle, created_at AS createdAt
       FROM platform_accounts WHERE user_email = ? ORDER BY platform`
    )
    .all(email.toLowerCase()) as unknown as {
    platform: string;
    handle: string | null;
    createdAt: string;
  }[];
}

export function upsertPlatformAccount(
  email: string,
  acct: Omit<PlatformAccount, "createdAt">
): void {
  getDb()
    .prepare(
      `INSERT OR REPLACE INTO platform_accounts
       (user_email, platform, access_token, refresh_token, expires_at, external_id, handle, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      email.toLowerCase(),
      acct.platform,
      acct.accessToken,
      acct.refreshToken,
      acct.expiresAt,
      acct.externalId,
      acct.handle,
      new Date().toISOString()
    );
}

export function deletePlatformAccount(email: string, platform: string): void {
  getDb()
    .prepare(
      "DELETE FROM platform_accounts WHERE user_email = ? AND platform = ?"
    )
    .run(email.toLowerCase(), platform);
}

// --- Post metrics (the performance flywheel's raw material) ---
// Written by manual results entry today and by platform-API ingestion later —
// both land in the same table, so everything downstream is source-agnostic.

export interface PostMetrics {
  postId: string;
  views: number;
  likes: number;
  comments: number;
  source: string;
  updatedAt: string;
}

export function upsertPostMetrics(
  email: string,
  postId: string,
  m: { views: number; likes: number; comments: number; source: string }
): void {
  getDb()
    .prepare(
      `INSERT OR REPLACE INTO post_metrics (post_id, user_email, views, likes, comments, source, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      postId,
      email.toLowerCase(),
      m.views,
      m.likes,
      m.comments,
      m.source,
      new Date().toISOString()
    );
}

export function listPostMetrics(email: string): PostMetrics[] {
  return getDb()
    .prepare(
      `SELECT post_id AS postId, views, likes, comments, source, updated_at AS updatedAt
       FROM post_metrics WHERE user_email = ?`
    )
    .all(email.toLowerCase()) as unknown as PostMetrics[];
}

export interface TopPerformer {
  assetId: string;
  assetName: string;
  platform: string;
  views: number;
  likes: number;
  comments: number;
}

/** Measured published posts ranked by views — the creator's proven winners. */
export function topPerformers(email: string, limit = 5): TopPerformer[] {
  return getDb()
    .prepare(
      `SELECT sp.asset_id AS assetId, sp.asset_name AS assetName, sp.platform,
              pm.views, pm.likes, pm.comments
       FROM post_metrics pm
       JOIN scheduled_posts sp ON sp.id = pm.post_id AND sp.user_email = pm.user_email
       WHERE pm.user_email = ? AND sp.status = 'published'
       ORDER BY pm.views DESC, pm.likes DESC
       LIMIT ?`
    )
    .all(email.toLowerCase(), limit) as unknown as TopPerformer[];
}

export function getScheduledPost(email: string, id: string): ScheduledPost | null {
  const row = getDb()
    .prepare("SELECT * FROM scheduled_posts WHERE id = ? AND user_email = ?")
    .get(id, email.toLowerCase()) as Record<string, unknown> | undefined;
  return row ? mapScheduled(row) : null;
}

// --- Referrals (viral loop) ---

export function getReferralInfo(email: string): { code: string; count: number } {
  const conn = getDb();
  const lower = email.toLowerCase();
  const row = conn
    .prepare("SELECT referral_code FROM users WHERE email = ?")
    .get(lower) as { referral_code: string | null } | undefined;
  let code = row?.referral_code ?? null;
  if (!code) {
    // Lazily mint codes for accounts created before referrals existed.
    code = `ef-${crypto.randomUUID().slice(0, 8)}`;
    conn.prepare("UPDATE users SET referral_code = ? WHERE email = ?").run(code, lower);
  }
  const count = (
    conn
      .prepare("SELECT COUNT(*) AS c FROM users WHERE referred_by = ?")
      .get(code) as { c: number }
  ).c;
  return { code, count };
}

export function setReferredBy(email: string, refCode: string): void {
  getDb()
    .prepare(
      "UPDATE users SET referred_by = ? WHERE email = ? AND referred_by IS NULL"
    )
    .run(refCode.slice(0, 40), email.toLowerCase());
}

// --- Revenue ledger (the creator's income, not the platform's) ---

export interface RevenueEntry {
  id: string;
  month: string; // "2026-08"
  stream: string;
  amount: number;
  note: string;
  createdAt: string;
}

export function listRevenue(email: string): RevenueEntry[] {
  return getDb()
    .prepare(
      `SELECT id, month, stream, amount, COALESCE(note, '') AS note, created_at AS createdAt
       FROM revenue_entries WHERE user_email = ? ORDER BY month DESC, created_at DESC`
    )
    .all(email.toLowerCase()) as unknown as RevenueEntry[];
}

export function insertRevenue(
  email: string,
  entry: Omit<RevenueEntry, "createdAt">
): RevenueEntry {
  const now = new Date().toISOString();
  getDb()
    .prepare(
      `INSERT INTO revenue_entries (id, user_email, month, stream, amount, note, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      entry.id,
      email.toLowerCase(),
      entry.month,
      entry.stream,
      entry.amount,
      entry.note || null,
      now
    );
  return { ...entry, createdAt: now };
}

export function deleteRevenue(email: string, id: string): void {
  getDb()
    .prepare("DELETE FROM revenue_entries WHERE id = ? AND user_email = ?")
    .run(id, email.toLowerCase());
}

// --- Brand deals (sponsorship pipeline) ---

export interface Deal {
  id: string;
  brand: string;
  contact: string;
  value: number;
  stage: "lead" | "negotiating" | "booked" | "delivered" | "paid";
  platform: string;
  notes: string;
  createdAt: string;
  updatedAt: string;
}

function mapDeal(row: Record<string, unknown>): Deal {
  return {
    id: row.id as string,
    brand: row.brand as string,
    contact: (row.contact as string) ?? "",
    value: row.value as number,
    stage: row.stage as Deal["stage"],
    platform: (row.platform as string) ?? "",
    notes: (row.notes as string) ?? "",
    createdAt: row.created_at as string,
    updatedAt: row.updated_at as string,
  };
}

export function listDeals(email: string): Deal[] {
  return (
    getDb()
      .prepare("SELECT * FROM deals WHERE user_email = ? ORDER BY updated_at DESC")
      .all(email.toLowerCase()) as Record<string, unknown>[]
  ).map(mapDeal);
}

export function getDeal(email: string, id: string): Deal | null {
  const row = getDb()
    .prepare("SELECT * FROM deals WHERE id = ? AND user_email = ?")
    .get(id, email.toLowerCase()) as Record<string, unknown> | undefined;
  return row ? mapDeal(row) : null;
}

export function insertDeal(
  email: string,
  deal: Omit<Deal, "createdAt" | "updatedAt">
): Deal {
  const now = new Date().toISOString();
  getDb()
    .prepare(
      `INSERT INTO deals (id, user_email, brand, contact, value, stage, platform, notes, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      deal.id,
      email.toLowerCase(),
      deal.brand,
      deal.contact || null,
      deal.value,
      deal.stage,
      deal.platform || null,
      deal.notes || null,
      now,
      now
    );
  return { ...deal, createdAt: now, updatedAt: now };
}

export function updateDeal(
  email: string,
  id: string,
  updates: Partial<Pick<Deal, "brand" | "contact" | "value" | "stage" | "platform" | "notes">>
): Deal | null {
  const cols: Record<string, string> = {
    brand: "brand",
    contact: "contact",
    value: "value",
    stage: "stage",
    platform: "platform",
    notes: "notes",
  };
  const sets: string[] = [];
  const values: (string | number)[] = [];
  for (const [key, col] of Object.entries(cols)) {
    const v = updates[key as keyof typeof updates];
    if (v !== undefined) {
      sets.push(`${col} = ?`);
      values.push(v as string | number);
    }
  }
  if (sets.length > 0) {
    sets.push("updated_at = ?");
    values.push(new Date().toISOString());
    values.push(id, email.toLowerCase());
    getDb()
      .prepare(`UPDATE deals SET ${sets.join(", ")} WHERE id = ? AND user_email = ?`)
      .run(...values);
  }
  return getDeal(email, id);
}

export function deleteDeal(email: string, id: string): void {
  getDb()
    .prepare("DELETE FROM deals WHERE id = ? AND user_email = ?")
    .run(id, email.toLowerCase());
}

// --- Pending plans (paid via Stripe before an account existed) ---

export function setPendingPlan(email: string, plan: string): void {
  getDb()
    .prepare(
      "INSERT OR REPLACE INTO pending_plans (email, plan, created_at) VALUES (?, ?, ?)"
    )
    .run(email.toLowerCase(), plan, new Date().toISOString());
}

/** Returns and clears the plan a checkout reserved for this email, if any. */
export function consumePendingPlan(email: string): string | null {
  const conn = getDb();
  const row = conn
    .prepare("SELECT plan FROM pending_plans WHERE email = ?")
    .get(email.toLowerCase()) as { plan: string } | undefined;
  if (!row) return null;
  conn.prepare("DELETE FROM pending_plans WHERE email = ?").run(email.toLowerCase());
  return row.plan;
}

// --- Projects ---

function mapProject(row: Record<string, unknown>): Project {
  return {
    id: row.id as string,
    title: row.title as string,
    status: row.status as Project["status"],
    progress: row.progress as number,
    assetsReady: row.assets_ready as number,
    assetsTotal: row.assets_total as number,
    eta: row.eta as string,
    createdAt: row.created_at as string,
    fileName: (row.file_name as string) ?? undefined,
    fileSize: (row.file_size as string) ?? undefined,
  };
}

export function listProjects(email: string): Project[] {
  return (
    getDb()
      .prepare("SELECT * FROM projects WHERE user_email = ? ORDER BY sort DESC")
      .all(email.toLowerCase()) as Record<string, unknown>[]
  ).map(mapProject);
}

/** Projects created since an ISO timestamp — used for monthly plan quotas. */
export function countProjectsSince(email: string, sinceIso: string): number {
  return (
    getDb()
      .prepare(
        "SELECT COUNT(*) AS c FROM projects WHERE user_email = ? AND created_at >= ?"
      )
      .get(email.toLowerCase(), sinceIso) as { c: number }
  ).c;
}

export function insertProject(email: string, p: Project): void {
  const sort = Date.now();
  getDb()
    .prepare(
      `INSERT INTO projects
       (id, user_email, title, status, progress, assets_ready, assets_total, eta, created_at, file_name, file_size, sort)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      p.id,
      email.toLowerCase(),
      p.title,
      p.status,
      p.progress,
      p.assetsReady,
      p.assetsTotal,
      p.eta,
      p.createdAt,
      p.fileName ?? null,
      p.fileSize ?? null,
      sort
    );
}

/**
 * Creates a project already populated with its generated assets, landing
 * directly in "review". Generation is synchronous, so there is no fake
 * processing phase — the assets are real and ready to inspect immediately.
 */
export function createProjectWithAssets(
  email: string,
  meta: {
    id: string;
    title: string;
    fileName?: string;
    fileSize?: string;
    transcript?: string;
    storagePath?: string;
  },
  generated: { name: string; type: string; content: string }[]
): { project: Project; assets: Asset[] } {
  const lower = email.toLowerCase();
  const now = new Date().toISOString();
  const conn = getDb();
  const total = generated.length;

  conn
    .prepare(
      `INSERT INTO projects
       (id, user_email, title, status, progress, assets_ready, assets_total, eta, created_at, file_name, file_size, transcript, storage_path, sort)
       VALUES (?, ?, ?, 'review', 100, ?, ?, 'Awaiting approval', ?, ?, ?, ?, ?, ?)`
    )
    .run(
      meta.id,
      lower,
      meta.title,
      total,
      total,
      now,
      meta.fileName ?? null,
      meta.fileSize ?? null,
      meta.transcript ?? null,
      meta.storagePath ?? null,
      Date.now()
    );

  const assets: Asset[] = generated.map((a, i) => {
    const id = `a-${crypto.randomUUID()}`;
    conn
      .prepare(
        `INSERT INTO assets (id, user_email, project_id, name, type, views, status, liked, content, sort)
         VALUES (?, ?, ?, ?, ?, '—', 'draft', 0, ?, ?)`
      )
      .run(id, lower, meta.id, a.name, a.type, a.content, i);
    return {
      id,
      projectId: meta.id,
      name: a.name,
      type: a.type,
      views: "—",
      status: "draft",
      liked: false,
      content: a.content,
    };
  });

  const project: Project = {
    id: meta.id,
    title: meta.title,
    status: "review",
    progress: 100,
    assetsReady: total,
    assetsTotal: total,
    eta: "Awaiting approval",
    createdAt: now,
    fileName: meta.fileName,
    fileSize: meta.fileSize,
  };
  return { project, assets };
}

const PROJECT_COLUMNS: Record<string, string> = {
  title: "title",
  status: "status",
  progress: "progress",
  assetsReady: "assets_ready",
  assetsTotal: "assets_total",
  eta: "eta",
};

export function updateProject(
  email: string,
  id: string,
  updates: Partial<Project>
): Project | null {
  const sets: string[] = [];
  const values: unknown[] = [];
  for (const [key, col] of Object.entries(PROJECT_COLUMNS)) {
    if (key in updates && updates[key as keyof Project] !== undefined) {
      sets.push(`${col} = ?`);
      values.push(updates[key as keyof Project]);
    }
  }
  if (sets.length > 0) {
    values.push(id, email.toLowerCase());
    getDb()
      .prepare(
        `UPDATE projects SET ${sets.join(", ")} WHERE id = ? AND user_email = ?`
      )
      .run(...(values as (string | number)[]));
  }
  const row = getDb()
    .prepare("SELECT * FROM projects WHERE id = ? AND user_email = ?")
    .get(id, email.toLowerCase()) as Record<string, unknown> | undefined;
  return row ? mapProject(row) : null;
}

export function deleteProject(email: string, id: string): void {
  const conn = getDb();
  conn
    .prepare("DELETE FROM assets WHERE project_id = ? AND user_email = ?")
    .run(id, email.toLowerCase());
  conn
    .prepare("DELETE FROM clips WHERE project_id = ? AND user_email = ?")
    .run(id, email.toLowerCase());
  conn
    .prepare("DELETE FROM projects WHERE id = ? AND user_email = ?")
    .run(id, email.toLowerCase());
}

// --- Assets ---

function mapAsset(row: Record<string, unknown>): Asset {
  return {
    id: row.id as string,
    projectId: row.project_id as string,
    name: row.name as string,
    type: row.type as string,
    views: row.views as string,
    status: row.status as Asset["status"],
    liked: Boolean(row.liked),
    content: (row.content as string) ?? undefined,
    evergreen: Boolean(row.evergreen),
    abGroup: (row.ab_group as string | null) ?? undefined,
  };
}

export function setAssetEvergreen(
  email: string,
  id: string,
  evergreen: boolean
): Asset | null {
  getDb()
    .prepare("UPDATE assets SET evergreen = ? WHERE id = ? AND user_email = ?")
    .run(evergreen ? 1 : 0, id, email.toLowerCase());
  return getAsset(email, id);
}

export function listAssets(email: string): Asset[] {
  return (
    getDb()
      .prepare("SELECT * FROM assets WHERE user_email = ? ORDER BY sort ASC")
      .all(email.toLowerCase()) as Record<string, unknown>[]
  ).map(mapAsset);
}

export function setProjectAssetsStatus(
  email: string,
  projectId: string,
  status: Asset["status"]
): void {
  getDb()
    .prepare(
      "UPDATE assets SET status = ? WHERE project_id = ? AND user_email = ?"
    )
    .run(status, projectId, email.toLowerCase());
}

export function getAsset(email: string, id: string): Asset | null {
  const row = getDb()
    .prepare("SELECT * FROM assets WHERE id = ? AND user_email = ?")
    .get(id, email.toLowerCase()) as Record<string, unknown> | undefined;
  return row ? mapAsset(row) : null;
}

export function updateAsset(
  email: string,
  id: string,
  updates: { name?: string; content?: string }
): Asset | null {
  const conn = getDb();
  const sets: string[] = [];
  const values: string[] = [];
  if (updates.name !== undefined) {
    sets.push("name = ?");
    values.push(updates.name);
  }
  if (updates.content !== undefined) {
    sets.push("content = ?");
    values.push(updates.content);
  }
  if (sets.length > 0) {
    values.push(id, email.toLowerCase());
    conn
      .prepare(`UPDATE assets SET ${sets.join(", ")} WHERE id = ? AND user_email = ?`)
      .run(...values);
  }
  return getAsset(email, id);
}

/** Title + stored transcript of the project an asset belongs to. */
export function getProjectSource(
  email: string,
  projectId: string
): { title: string; transcript: string } | null {
  const row = getDb()
    .prepare("SELECT title, transcript FROM projects WHERE id = ? AND user_email = ?")
    .get(projectId, email.toLowerCase()) as
    | { title: string; transcript: string | null }
    | undefined;
  if (!row) return null;
  return { title: row.title, transcript: row.transcript ?? "" };
}

export function toggleAssetLike(email: string, id: string): Asset | null {
  const conn = getDb();
  conn
    .prepare(
      "UPDATE assets SET liked = 1 - liked WHERE id = ? AND user_email = ?"
    )
    .run(id, email.toLowerCase());
  const row = conn
    .prepare("SELECT * FROM assets WHERE id = ? AND user_email = ?")
    .get(id, email.toLowerCase()) as Record<string, unknown> | undefined;
  return row ? mapAsset(row) : null;
}

// --- Notifications ---

function mapNotification(row: Record<string, unknown>): Notification {
  return {
    id: row.id as string,
    title: row.title as string,
    message: row.message as string,
    time: row.time as string,
    read: Boolean(row.read),
    type: row.type as Notification["type"],
  };
}

export function listNotifications(email: string): Notification[] {
  return (
    getDb()
      .prepare(
        "SELECT * FROM notifications WHERE user_email = ? ORDER BY sort DESC"
      )
      .all(email.toLowerCase()) as Record<string, unknown>[]
  ).map(mapNotification);
}

export function insertNotification(
  email: string,
  n: Notification
): void {
  getDb()
    .prepare(
      `INSERT INTO notifications (id, user_email, title, message, time, read, type, sort)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      n.id,
      email.toLowerCase(),
      n.title,
      n.message,
      n.time,
      n.read ? 1 : 0,
      n.type,
      Date.now()
    );
}

export function markNotificationRead(email: string, id: string): void {
  getDb()
    .prepare(
      "UPDATE notifications SET read = 1 WHERE id = ? AND user_email = ?"
    )
    .run(id, email.toLowerCase());
}

export function markAllNotificationsRead(email: string): void {
  getDb()
    .prepare("UPDATE notifications SET read = 1 WHERE user_email = ?")
    .run(email.toLowerCase());
}

// --- Pricing ---

/**
 * Returns the pricing config from the DB, seeding it from DEFAULT_PRICING on
 * first access. Prices/allotments can then be edited in the DB (or via
 * setPricingConfig) and take effect without a redeploy.
 */
export function getPricingConfig(): PricingConfig {
  const conn = getDb();
  const ver = conn
    .prepare("SELECT value FROM pricing_config WHERE key = 'version'")
    .get() as { value: string } | undefined;
  const row = conn
    .prepare("SELECT value FROM pricing_config WHERE key = 'config'")
    .get() as { value: string } | undefined;
  if (row && ver?.value === String(PRICING_VERSION)) {
    try {
      return JSON.parse(row.value) as PricingConfig;
    } catch {
      /* fall through to reseed on corrupt JSON */
    }
  }
  // First access, or DEFAULT_PRICING moved on since this DB was seeded — the
  // shipped config wins over the stale stored copy.
  conn
    .prepare(
      "INSERT OR REPLACE INTO pricing_config (key, value) VALUES ('config', ?)"
    )
    .run(JSON.stringify(DEFAULT_PRICING));
  conn
    .prepare(
      "INSERT OR REPLACE INTO pricing_config (key, value) VALUES ('version', ?)"
    )
    .run(String(PRICING_VERSION));
  return DEFAULT_PRICING;
}

export function setPricingConfig(config: PricingConfig): void {
  getDb()
    .prepare(
      "INSERT OR REPLACE INTO pricing_config (key, value) VALUES ('config', ?)"
    )
    .run(JSON.stringify(config));
}

// --- Integrations (API keys / connections stored server-side) ---

export function getIntegrationRaw(name: string): Record<string, string> {
  const row = getDb()
    .prepare("SELECT config FROM integrations WHERE name = ?")
    .get(name) as { config: string } | undefined;
  if (!row) return {};
  try {
    return JSON.parse(decryptConfig(row.config)) as Record<string, string>;
  } catch {
    return {};
  }
}

// Integration configs hold API keys — encrypted at rest with a key derived
// from SESSION_SECRET. Legacy plaintext rows still read fine and upgrade to
// ciphertext on their next save.
const ENC_PREFIX = "enc1:";

function integrationsKey(): Buffer | null {
  const secret = process.env.SESSION_SECRET;
  if (!secret || secret.length < 16) return null;
  return createHash("sha256").update(`${secret}:integrations:v1`).digest();
}

function encryptConfig(json: string): string {
  const key = integrationsKey();
  if (!key) return json;
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ct = Buffer.concat([cipher.update(json, "utf8"), cipher.final()]);
  return `${ENC_PREFIX}${iv.toString("base64")}:${cipher.getAuthTag().toString("base64")}:${ct.toString("base64")}`;
}

function decryptConfig(stored: string): string {
  if (!stored.startsWith(ENC_PREFIX)) return stored;
  const key = integrationsKey();
  if (!key) return "{}";
  try {
    const [ivB, tagB, ctB] = stored.slice(ENC_PREFIX.length).split(":");
    const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(ivB, "base64"));
    decipher.setAuthTag(Buffer.from(tagB, "base64"));
    return Buffer.concat([
      decipher.update(Buffer.from(ctB, "base64")),
      decipher.final(),
    ]).toString("utf8");
  } catch {
    return "{}";
  }
}

export function setIntegrationRaw(
  name: string,
  config: Record<string, string>
): void {
  getDb()
    .prepare(
      "INSERT OR REPLACE INTO integrations (name, config) VALUES (?, ?)"
    )
    .run(name, encryptConfig(JSON.stringify(config)));
}

// --- Provenance (signed per-asset manifests) ---

export function setProvenance(
  assetId: string,
  manifest: string,
  signature: string
): void {
  getDb()
    .prepare(
      "INSERT OR REPLACE INTO provenance (asset_id, manifest, signature) VALUES (?, ?, ?)"
    )
    .run(assetId, manifest, signature);
}

export function getProvenanceRaw(
  assetId: string
): { manifest: string; signature: string } | null {
  const row = getDb()
    .prepare("SELECT manifest, signature FROM provenance WHERE asset_id = ?")
    .get(assetId) as { manifest: string; signature: string } | undefined;
  return row ?? null;
}

// --- App flags (operator kill switches / toggles) ---

export interface AppFlags {
  generationEnabled: boolean;
}

const DEFAULT_FLAGS: AppFlags = { generationEnabled: true };

export function getFlags(): AppFlags {
  const row = getDb()
    .prepare("SELECT value FROM app_flags WHERE key = 'config'")
    .get() as { value: string } | undefined;
  if (!row) return { ...DEFAULT_FLAGS };
  try {
    return { ...DEFAULT_FLAGS, ...(JSON.parse(row.value) as Partial<AppFlags>) };
  } catch {
    return { ...DEFAULT_FLAGS };
  }
}

export function setFlags(flags: AppFlags): void {
  getDb()
    .prepare("INSERT OR REPLACE INTO app_flags (key, value) VALUES ('config', ?)")
    .run(JSON.stringify(flags));
}

// --- Audit log (admin actions) ---

export interface AuditEntry {
  id: number;
  actor: string;
  action: string;
  detail: string;
  ts: number;
}

export function insertAudit(actor: string, action: string, detail: string): void {
  getDb()
    .prepare("INSERT INTO audit_log (actor, action, detail, ts) VALUES (?, ?, ?, ?)")
    .run(actor.slice(0, 128), action.slice(0, 64), detail.slice(0, 512), Date.now());
}

export function listAudit(limit = 100): AuditEntry[] {
  return getDb()
    .prepare("SELECT * FROM audit_log ORDER BY id DESC LIMIT ?")
    .all(limit) as unknown as AuditEntry[];
}

// --- Admin: user management + platform totals ---

export interface AdminUserRow {
  email: string;
  name: string;
  plan: string;
  createdAt: string;
  projects: number;
  assets: number;
  trialEndsAt: string | null;
  trialPrevPlan: string | null;
}

export function listUsers(): AdminUserRow[] {
  return (
    getDb()
      .prepare(
        `SELECT u.email, u.name, u.plan, u.created_at AS createdAt,
           u.trial_ends_at AS trialEndsAt, u.trial_prev_plan AS trialPrevPlan,
           (SELECT COUNT(*) FROM projects p WHERE p.user_email = u.email) AS projects,
           (SELECT COUNT(*) FROM assets a WHERE a.user_email = u.email) AS assets
         FROM users u ORDER BY u.created_at DESC`
      )
      .all() as unknown as AdminUserRow[]
  );
}

export function setUserPlan(email: string, plan: string): boolean {
  const res = getDb()
    .prepare("UPDATE users SET plan = ? WHERE email = ?")
    .run(plan, email.toLowerCase());
  return Number(res.changes) > 0;
}

// --- Error log (observability) ---

export function insertErrorLog(context: string, message: string, stack?: string): void {
  try {
    const conn = getDb();
    conn
      .prepare("INSERT INTO error_log (context, message, stack, ts) VALUES (?, ?, ?, ?)")
      .run(context.slice(0, 300), message.slice(0, 1000), (stack ?? "").slice(0, 4000), new Date().toISOString());
    // Ring buffer: keep the newest 500 rows.
    conn.prepare(
      "DELETE FROM error_log WHERE id NOT IN (SELECT id FROM error_log ORDER BY id DESC LIMIT 500)"
    ).run();
  } catch {
    /* the error logger must never throw */
  }
}

export function listErrorLogs(limit = 50): {
  id: number;
  context: string;
  message: string;
  ts: string;
}[] {
  return getDb()
    .prepare("SELECT id, context, message, ts FROM error_log ORDER BY id DESC LIMIT ?")
    .all(limit) as unknown as { id: number; context: string; message: string; ts: string }[];
}

// --- Email verification ---

export function isEmailVerified(email: string): boolean {
  const row = getDb()
    .prepare("SELECT email_verified FROM users WHERE email = ?")
    .get(email.toLowerCase()) as { email_verified: number } | undefined;
  return row ? Boolean(row.email_verified) : true;
}

export function setVerifyToken(email: string, token: string): void {
  getDb()
    .prepare("UPDATE users SET email_verified = 0, verify_token = ? WHERE email = ?")
    .run(token, email.toLowerCase());
}

export function consumeVerifyToken(token: string): string | null {
  if (!token || token.length < 16) return null;
  const row = getDb()
    .prepare("SELECT email FROM users WHERE verify_token = ?")
    .get(token) as { email: string } | undefined;
  if (!row) return null;
  getDb()
    .prepare("UPDATE users SET email_verified = 1, verify_token = NULL WHERE email = ?")
    .run(row.email);
  return row.email;
}

// --- Account deletion (the user's right to leave completely) ---

/** Removes every row and returns every stored file path for this account.
 *  Explicit per-table deletes — never trusting cascade pragmas with a
 *  person's right to be forgotten. */
export function deleteAccount(email: string): { files: string[] } {
  const conn = getDb();
  const e = email.toLowerCase();
  const files: string[] = [];
  for (const row of conn
    .prepare("SELECT storage_path AS p FROM projects WHERE user_email = ? AND storage_path IS NOT NULL")
    .all(e) as { p: string }[]) {
    files.push(row.p);
  }
  for (const row of conn
    .prepare("SELECT output_path AS p FROM clips WHERE user_email = ? AND output_path IS NOT NULL")
    .all(e) as { p: string }[]) {
    files.push(row.p);
  }
  for (const row of conn
    .prepare("SELECT path AS p FROM gen_images WHERE user_email = ?")
    .all(e) as { p: string }[]) {
    files.push(row.p);
  }

  for (const table of [
    "projects",
    "assets",
    "notifications",
    "ideas",
    "subscribers",
    "creator_pages",
    "audits",
    "platform_accounts",
    "post_metrics",
    "revenue_entries",
    "deals",
    "scheduled_posts",
    "clips",
    "watchlist",
    "gen_images",
    "brand_voice",
  ]) {
    conn.prepare(`DELETE FROM ${table} WHERE user_email = ?`).run(e);
  }
  conn.prepare("DELETE FROM managed_accounts WHERE manager_email = ? OR client_email = ?").run(e, e);
  conn.prepare("DELETE FROM reset_tokens WHERE user_email = ?").run(e);
  conn.prepare("DELETE FROM site_audits WHERE user_email = ?").run(e);
  conn.prepare("DELETE FROM users WHERE email = ?").run(e);
  return { files };
}

// --- Custom narration voice (xAI voice clone) ---

export function setCustomVoiceId(email: string, voiceId: string | null): void {
  getDb()
    .prepare("UPDATE users SET custom_voice_id = ? WHERE email = ?")
    .run(voiceId, email.toLowerCase());
}

export function getCustomVoiceId(email: string): string | null {
  const row = getDb()
    .prepare("SELECT custom_voice_id FROM users WHERE email = ?")
    .get(email.toLowerCase()) as { custom_voice_id: string | null } | undefined;
  return row?.custom_voice_id ?? null;
}

// --- Timed free trials (operator-granted) ---

/** Puts the user on `plan` until now+days. The pre-trial plan is remembered
 *  once — re-granting during an active trial extends it without losing the
 *  original plan to revert to. */
export function grantTrial(email: string, plan: string, days: number): boolean {
  const row = getDb()
    .prepare("SELECT plan, trial_prev_plan FROM users WHERE email = ?")
    .get(email.toLowerCase()) as { plan: string; trial_prev_plan: string | null } | undefined;
  if (!row) return false;
  const prev = row.trial_prev_plan ?? row.plan;
  const ends = new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString();
  getDb()
    .prepare(
      "UPDATE users SET plan = ?, trial_prev_plan = ?, trial_ends_at = ? WHERE email = ?"
    )
    .run(plan, prev, ends, email.toLowerCase());
  return true;
}

/** Ends an active trial immediately, reverting to the pre-trial plan. */
export function cancelTrial(email: string): { reverted: string } | null {
  const row = getDb()
    .prepare("SELECT trial_prev_plan FROM users WHERE email = ?")
    .get(email.toLowerCase()) as { trial_prev_plan: string | null } | undefined;
  if (!row?.trial_prev_plan) return null;
  getDb()
    .prepare(
      "UPDATE users SET plan = trial_prev_plan, trial_prev_plan = NULL, trial_ends_at = NULL WHERE email = ?"
    )
    .run(email.toLowerCase());
  return { reverted: row.trial_prev_plan };
}

/** Reverts every expired trial; returns what changed for notifications. */
export function expireTrials(): { email: string; plan: string; trialPlan: string }[] {
  const now = new Date().toISOString();
  const rows = getDb()
    .prepare(
      "SELECT email, plan, trial_prev_plan FROM users WHERE trial_ends_at IS NOT NULL AND trial_ends_at < ?"
    )
    .all(now) as { email: string; plan: string; trial_prev_plan: string | null }[];
  for (const r of rows) {
    getDb()
      .prepare(
        "UPDATE users SET plan = COALESCE(trial_prev_plan, plan), trial_prev_plan = NULL, trial_ends_at = NULL WHERE email = ?"
      )
      .run(r.email);
  }
  return rows.map((r) => ({
    email: r.email,
    plan: r.trial_prev_plan ?? r.plan,
    trialPlan: r.plan,
  }));
}

export function adminTotals(): {
  users: number;
  projects: number;
  assets: number;
  scheduled: number;
  published: number;
} {
  const conn = getDb();
  const count = (sql: string) => (conn.prepare(sql).get() as { c: number }).c;
  return {
    users: count("SELECT COUNT(*) AS c FROM users"),
    projects: count("SELECT COUNT(*) AS c FROM projects"),
    assets: count("SELECT COUNT(*) AS c FROM assets"),
    scheduled: count("SELECT COUNT(*) AS c FROM scheduled_posts WHERE status = 'scheduled'"),
    published: count("SELECT COUNT(*) AS c FROM scheduled_posts WHERE status = 'published'"),
  };
}

// --- Per-user analytics (real workspace aggregates, no vanity metrics) ---

export interface UserAnalytics {
  totals: {
    assets: number;
    liveAssets: number;
    projects: number;
    publishedProjects: number;
    scheduled: number;
    published: number;
    likes: number;
  };
  platforms: { platform: string; scheduled: number; published: number }[];
  types: { type: string; count: number }[];
  recentPublished: { assetName: string; platform: string; scheduledAt: string }[];
  measured: { posts: number; views: number; likes: number; comments: number };
  topPerformers: TopPerformer[];
}

export function userAnalytics(email: string): UserAnalytics {
  const conn = getDb();
  const lower = email.toLowerCase();
  const one = (sql: string, ...args: string[]) =>
    (conn.prepare(sql).get(...args) as { c: number }).c;

  return {
    totals: {
      assets: one("SELECT COUNT(*) AS c FROM assets WHERE user_email = ?", lower),
      liveAssets: one(
        "SELECT COUNT(*) AS c FROM assets WHERE user_email = ? AND status IN ('live','sent')",
        lower
      ),
      projects: one("SELECT COUNT(*) AS c FROM projects WHERE user_email = ?", lower),
      publishedProjects: one(
        "SELECT COUNT(*) AS c FROM projects WHERE user_email = ? AND status = 'published'",
        lower
      ),
      scheduled: one(
        "SELECT COUNT(*) AS c FROM scheduled_posts WHERE user_email = ? AND status = 'scheduled'",
        lower
      ),
      published: one(
        "SELECT COUNT(*) AS c FROM scheduled_posts WHERE user_email = ? AND status = 'published'",
        lower
      ),
      likes: one(
        "SELECT COUNT(*) AS c FROM assets WHERE user_email = ? AND liked = 1",
        lower
      ),
    },
    platforms: conn
      .prepare(
        `SELECT platform,
           SUM(CASE WHEN status = 'scheduled' THEN 1 ELSE 0 END) AS scheduled,
           SUM(CASE WHEN status = 'published' THEN 1 ELSE 0 END) AS published
         FROM scheduled_posts WHERE user_email = ?
         GROUP BY platform ORDER BY published DESC, scheduled DESC`
      )
      .all(lower) as unknown as UserAnalytics["platforms"],
    types: conn
      .prepare(
        `SELECT type, COUNT(*) AS count FROM assets WHERE user_email = ?
         GROUP BY type ORDER BY count DESC`
      )
      .all(lower) as unknown as UserAnalytics["types"],
    recentPublished: conn
      .prepare(
        `SELECT asset_name AS assetName, platform, scheduled_at AS scheduledAt
         FROM scheduled_posts WHERE user_email = ? AND status = 'published'
         ORDER BY sort DESC LIMIT 8`
      )
      .all(lower) as unknown as UserAnalytics["recentPublished"],
    measured: conn
      .prepare(
        `SELECT COUNT(*) AS posts,
                COALESCE(SUM(views), 0) AS views,
                COALESCE(SUM(likes), 0) AS likes,
                COALESCE(SUM(comments), 0) AS comments
         FROM post_metrics WHERE user_email = ?`
      )
      .get(lower) as UserAnalytics["measured"],
    topPerformers: topPerformers(lower, 5),
  };
}

// --- Brand voice ---

export function getBrandVoice(email: string): BrandVoice {
  const row = getDb()
    .prepare("SELECT config FROM brand_voice WHERE user_email = ?")
    .get(email.toLowerCase()) as { config: string } | undefined;
  if (!row) return { ...DEFAULT_VOICE };
  try {
    return { ...DEFAULT_VOICE, ...(JSON.parse(row.config) as Partial<BrandVoice>) };
  } catch {
    return { ...DEFAULT_VOICE };
  }
}

export function setBrandVoice(email: string, voice: BrandVoice): void {
  getDb()
    .prepare(
      "INSERT OR REPLACE INTO brand_voice (user_email, config) VALUES (?, ?)"
    )
    .run(email.toLowerCase(), JSON.stringify(voice));
}

// --- Password reset tokens ---

export function createResetToken(
  token: string,
  email: string,
  expiresAt: number
): void {
  getDb()
    .prepare(
      "INSERT OR REPLACE INTO reset_tokens (token, user_email, expires_at) VALUES (?, ?, ?)"
    )
    .run(token, email.toLowerCase(), expiresAt);
}

export function consumeResetToken(token: string): string | null {
  const conn = getDb();
  const row = conn
    .prepare("SELECT user_email, expires_at FROM reset_tokens WHERE token = ?")
    .get(token) as { user_email: string; expires_at: number } | undefined;
  if (!row) return null;
  conn.prepare("DELETE FROM reset_tokens WHERE token = ?").run(token);
  if (row.expires_at < Date.now()) return null;
  return row.user_email;
}

export function updateUserPassword(email: string, passwordHash: string): void {
  getDb()
    .prepare("UPDATE users SET password_hash = ? WHERE email = ?")
    .run(passwordHash, email.toLowerCase());
}

// --- Analytics (self-hosted funnel events) ---

export function insertEvent(event: string, path: string, meta: string | null): void {
  getDb()
    .prepare("INSERT INTO analytics_events (event, path, ts, meta) VALUES (?, ?, ?, ?)")
    .run(event.slice(0, 64), path.slice(0, 256), Date.now(), meta ? meta.slice(0, 512) : null);
}

/** Token telemetry by tier, aggregated from llm_* analytics events. */
export function llmUsage(): {
  tier: string;
  calls: number;
  inTok: number;
  outTok: number;
}[] {
  const rows = getDb()
    .prepare("SELECT event, meta FROM analytics_events WHERE event LIKE 'llm_%'")
    .all() as { event: string; meta: string | null }[];
  const agg = new Map<string, { calls: number; inTok: number; outTok: number }>();
  for (const r of rows) {
    const tier = r.event.slice(4);
    const cur = agg.get(tier) ?? { calls: 0, inTok: 0, outTok: 0 };
    cur.calls++;
    try {
      const m = r.meta ? (JSON.parse(r.meta) as { i?: number; o?: number }) : null;
      cur.inTok += m?.i ?? 0;
      cur.outTok += m?.o ?? 0;
    } catch {
      /* count the call even when meta is unparseable */
    }
    agg.set(tier, cur);
  }
  return [...agg.entries()].map(([tier, v]) => ({ tier, ...v }));
}

export function eventCounts(): { event: string; count: number }[] {
  return getDb()
    .prepare("SELECT event, COUNT(*) as count FROM analytics_events GROUP BY event ORDER BY count DESC")
    .all() as { event: string; count: number }[];
}

// --- Scheduled posts (publish / schedule) ---

export interface ScheduledPost {
  id: string;
  assetId: string;
  assetName: string;
  platform: string;
  scheduledAt: string;
  status: "scheduled" | "published" | "canceled";
  createdAt: string;
  clipId?: string | null;
  externalId?: string | null;
}

function mapScheduled(row: Record<string, unknown>): ScheduledPost {
  return {
    id: row.id as string,
    assetId: row.asset_id as string,
    assetName: row.asset_name as string,
    platform: row.platform as string,
    scheduledAt: row.scheduled_at as string,
    status: row.status as ScheduledPost["status"],
    createdAt: row.created_at as string,
    clipId: (row.clip_id as string | null) ?? null,
    externalId: (row.external_id as string | null) ?? null,
  };
}

export function listScheduledPosts(email: string): ScheduledPost[] {
  return (
    getDb()
      .prepare("SELECT * FROM scheduled_posts WHERE user_email = ? ORDER BY sort DESC")
      .all(email.toLowerCase()) as Record<string, unknown>[]
  ).map(mapScheduled);
}

export function createScheduledPost(
  email: string,
  post: Omit<ScheduledPost, "createdAt">
): ScheduledPost {
  const now = new Date().toISOString();
  getDb()
    .prepare(
      `INSERT INTO scheduled_posts (id, user_email, asset_id, asset_name, platform, scheduled_at, status, created_at, sort, clip_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      post.id,
      email.toLowerCase(),
      post.assetId,
      post.assetName,
      post.platform,
      post.scheduledAt,
      post.status,
      now,
      Date.now(),
      post.clipId ?? null
    );
  return { ...post, createdAt: now };
}

/** Records the platform-side id (tweet id, YouTube video id) after delivery,
 *  which is what the metrics poller keys on. */
export function setScheduledExternalId(
  email: string,
  id: string,
  externalId: string
): void {
  getDb()
    .prepare("UPDATE scheduled_posts SET external_id = ? WHERE id = ? AND user_email = ?")
    .run(externalId, id, email.toLowerCase());
}

/** Published posts that have a platform-side id — the metrics poller's worklist. */
export function listPublishedWithExternalId(): (ScheduledPost & { userEmail: string })[] {
  return (
    getDb()
      .prepare(
        "SELECT * FROM scheduled_posts WHERE status = 'published' AND external_id IS NOT NULL"
      )
      .all() as Record<string, unknown>[]
  ).map((row) => ({ ...mapScheduled(row), userEmail: row.user_email as string }));
}

/** Every still-scheduled post across all users — the scheduler tick's worklist. */
export function listAllScheduledPending(): (ScheduledPost & { userEmail: string })[] {
  return (
    getDb()
      .prepare("SELECT * FROM scheduled_posts WHERE status = 'scheduled'")
      .all() as Record<string, unknown>[]
  ).map((row) => ({ ...mapScheduled(row), userEmail: row.user_email as string }));
}

/** Reschedule a still-pending post (time and/or platform). Published and
 *  canceled posts are immutable history — the WHERE clause enforces it. */
export function updateScheduledPost(
  email: string,
  id: string,
  updates: { platform?: string; scheduledAt?: string }
): ScheduledPost | null {
  const conn = getDb();
  const sets: string[] = [];
  const values: string[] = [];
  if (updates.platform !== undefined) {
    sets.push("platform = ?");
    values.push(updates.platform);
  }
  if (updates.scheduledAt !== undefined) {
    sets.push("scheduled_at = ?");
    values.push(updates.scheduledAt);
  }
  if (sets.length > 0) {
    values.push(id, email.toLowerCase());
    conn
      .prepare(
        `UPDATE scheduled_posts SET ${sets.join(", ")}
         WHERE id = ? AND user_email = ? AND status = 'scheduled'`
      )
      .run(...values);
  }
  const row = conn
    .prepare("SELECT * FROM scheduled_posts WHERE id = ? AND user_email = ?")
    .get(id, email.toLowerCase()) as Record<string, unknown> | undefined;
  return row ? mapScheduled(row) : null;
}

export function setScheduledStatus(
  email: string,
  id: string,
  status: ScheduledPost["status"]
): ScheduledPost | null {
  const conn = getDb();
  conn
    .prepare("UPDATE scheduled_posts SET status = ? WHERE id = ? AND user_email = ?")
    .run(status, id, email.toLowerCase());
  const row = conn
    .prepare("SELECT * FROM scheduled_posts WHERE id = ? AND user_email = ?")
    .get(id, email.toLowerCase()) as Record<string, unknown> | undefined;
  return row ? mapScheduled(row) : null;
}

// --- Seeding ---

/**
 * Populates a brand-new account with the sample projects/assets/notifications
 * so the dashboard is not empty on first login. IDs are regenerated per user so
 * accounts never collide, and asset→project links are preserved.
 */
// --- Clip Studio ---

/** One transcribed word with start/end seconds — the caption-burn unit.
 *  `sp` is the diarized speaker index when the provider supplies one. */
export interface TranscriptWord {
  w: string;
  s: number;
  e: number;
  sp?: number;
}

export interface Clip {
  id: string;
  projectId: string;
  title: string;
  startSec: number;
  endSec: number;
  score: number;
  reason: string;
  matched: string | null;
  status: "suggested" | "queued" | "rendering" | "ready" | "failed";
  style: string;
  /** Caption placement: top | middle | bottom. */
  position: string;
  /** Horizontal crop focus for the 9:16 cut: left | center | right. */
  focus: string;
  /** 'clip' = cut from a source video; 'script' = TTS-narrated script video. */
  kind: string;
  script: string | null;
  outputPath: string | null;
  error: string | null;
  createdAt: string;
}

function mapClip(row: Record<string, unknown>): Clip {
  return {
    id: row.id as string,
    projectId: row.project_id as string,
    title: row.title as string,
    startSec: row.start_sec as number,
    endSec: row.end_sec as number,
    score: row.score as number,
    reason: row.reason as string,
    matched: (row.matched as string | null) ?? null,
    status: row.status as Clip["status"],
    style: row.style as string,
    position: (row.position as string) ?? "bottom",
    focus: (row.focus as string) ?? "center",
    kind: (row.kind as string) ?? "clip",
    script: (row.script as string | null) ?? null,
    outputPath: (row.output_path as string | null) ?? null,
    error: (row.error as string | null) ?? null,
    createdAt: row.created_at as string,
  };
}

/** Caption-only job: the whole source video re-rendered with captions. */
export function insertCaptionJob(
  email: string,
  v: { id: string; title: string; projectId: string; style: string; position: string }
): Clip {
  const now = new Date().toISOString();
  getDb()
    .prepare(
      `INSERT INTO clips (id, user_email, project_id, title, start_sec, end_sec, score, reason, matched, status, style, position, created_at, kind)
       VALUES (?, ?, ?, ?, 0, 0, 0, '', NULL, 'queued', ?, ?, ?, 'caption')`
    )
    .run(v.id, email.toLowerCase(), v.projectId, v.title, v.style, v.position, now);
  return {
    id: v.id,
    projectId: v.projectId,
    title: v.title,
    startSec: 0,
    endSec: 0,
    score: 0,
    reason: "",
    matched: null,
    status: "queued",
    style: v.style,
    position: v.position,
    focus: "center",
    kind: "caption",
    script: null,
    outputPath: null,
    error: null,
    createdAt: now,
  };
}

/** A TTS-narrated script video: enters the same render queue as clips. */
export function insertScriptVideo(
  email: string,
  v: { id: string; title: string; script: string; style: string; position: string }
): Clip {
  const now = new Date().toISOString();
  getDb()
    .prepare(
      `INSERT INTO clips (id, user_email, project_id, title, start_sec, end_sec, score, reason, matched, status, style, position, created_at, kind, script)
       VALUES (?, ?, '', ?, 0, 0, 0, '', NULL, 'queued', ?, ?, ?, 'script', ?)`
    )
    .run(v.id, email.toLowerCase(), v.title, v.style, v.position, now, v.script);
  return {
    id: v.id,
    projectId: "",
    title: v.title,
    startSec: 0,
    endSec: 0,
    score: 0,
    reason: "",
    matched: null,
    status: "queued",
    style: v.style,
    position: v.position,
    focus: "center",
    kind: "script",
    script: v.script,
    outputPath: null,
    error: null,
    createdAt: now,
  };
}

export function insertClip(
  email: string,
  c: Omit<Clip, "createdAt" | "outputPath" | "error" | "position" | "focus" | "kind" | "script">
): Clip {
  const now = new Date().toISOString();
  getDb()
    .prepare(
      `INSERT INTO clips (id, user_email, project_id, title, start_sec, end_sec, score, reason, matched, status, style, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      c.id,
      email.toLowerCase(),
      c.projectId,
      c.title,
      c.startSec,
      c.endSec,
      c.score,
      c.reason,
      c.matched,
      c.status,
      c.style,
      now
    );
  return {
    ...c,
    position: "bottom",
    focus: "center",
    kind: "clip",
    script: null,
    outputPath: null,
    error: null,
    createdAt: now,
  };
}

export function listClips(email: string, projectId: string): Clip[] {
  return (
    getDb()
      .prepare(
        "SELECT * FROM clips WHERE user_email = ? AND project_id = ? ORDER BY score DESC, start_sec ASC"
      )
      .all(email.toLowerCase(), projectId) as Record<string, unknown>[]
  ).map(mapClip);
}

export function getClip(email: string, id: string): Clip | null {
  const row = getDb()
    .prepare("SELECT * FROM clips WHERE id = ? AND user_email = ?")
    .get(id, email.toLowerCase()) as Record<string, unknown> | undefined;
  return row ? mapClip(row) : null;
}

/** Re-detecting highlights replaces prior *suggestions* only — rendered or
 *  in-flight clips are user work and survive. */
export function clearSuggestedClips(email: string, projectId: string): void {
  getDb()
    .prepare(
      "DELETE FROM clips WHERE user_email = ? AND project_id = ? AND status = 'suggested'"
    )
    .run(email.toLowerCase(), projectId);
}

export function updateClip(
  email: string,
  id: string,
  patch: {
    status?: Clip["status"];
    style?: string;
    position?: string;
    focus?: string;
    outputPath?: string | null;
    error?: string | null;
  }
): void {
  const cur = getClip(email, id);
  if (!cur) return;
  getDb()
    .prepare(
      "UPDATE clips SET status = ?, style = ?, position = ?, focus = ?, output_path = ?, error = ? WHERE id = ? AND user_email = ?"
    )
    .run(
      patch.status ?? cur.status,
      patch.style ?? cur.style,
      patch.position ?? cur.position,
      patch.focus ?? cur.focus,
      patch.outputPath !== undefined ? patch.outputPath : cur.outputPath,
      patch.error !== undefined ? patch.error : cur.error,
      id,
      email.toLowerCase()
    );
}

export function deleteClip(email: string, id: string): void {
  getDb()
    .prepare("DELETE FROM clips WHERE id = ? AND user_email = ?")
    .run(id, email.toLowerCase());
}

/** The render worker's cross-user worklist, oldest first. */
export function listQueuedClips(): (Clip & { userEmail: string })[] {
  return (
    getDb()
      .prepare("SELECT * FROM clips WHERE status = 'queued' ORDER BY created_at ASC")
      .all() as Record<string, unknown>[]
  ).map((row) => ({ ...mapClip(row), userEmail: row.user_email as string }));
}

/** Recover clips stuck in 'rendering' after a server restart mid-render. */
export function requeueStuckRenders(): void {
  getDb().prepare("UPDATE clips SET status = 'queued' WHERE status = 'rendering'").run();
}

/** Projects that still have a stored source video — Clip Studio's pick list. */
export function listProjectsWithMedia(email: string): { id: string; title: string }[] {
  return getDb()
    .prepare(
      "SELECT id, title FROM projects WHERE user_email = ? AND storage_path IS NOT NULL ORDER BY sort DESC"
    )
    .all(email.toLowerCase()) as unknown as { id: string; title: string }[];
}

export function listAllClips(email: string): Clip[] {
  return (
    getDb()
      .prepare("SELECT * FROM clips WHERE user_email = ? ORDER BY created_at DESC")
      .all(email.toLowerCase()) as Record<string, unknown>[]
  ).map(mapClip);
}

export interface ProjectMedia {
  title: string;
  transcript: string;
  storagePath: string | null;
  words: TranscriptWord[] | null;
  durationSec: number | null;
}

export function getProjectMedia(email: string, projectId: string): ProjectMedia | null {
  const row = getDb()
    .prepare(
      "SELECT title, transcript, storage_path, transcript_words, duration_sec FROM projects WHERE id = ? AND user_email = ?"
    )
    .get(projectId, email.toLowerCase()) as
    | {
        title: string;
        transcript: string | null;
        storage_path: string | null;
        transcript_words: string | null;
        duration_sec: number | null;
      }
    | undefined;
  if (!row) return null;
  let words: TranscriptWord[] | null = null;
  if (row.transcript_words) {
    try {
      const parsed = JSON.parse(row.transcript_words);
      if (Array.isArray(parsed)) words = parsed as TranscriptWord[];
    } catch {
      /* treat unparseable words as absent */
    }
  }
  return {
    title: row.title,
    transcript: row.transcript ?? "",
    storagePath: row.storage_path,
    words,
    durationSec: row.duration_sec,
  };
}

export function setProjectMedia(
  email: string,
  projectId: string,
  media: { words?: TranscriptWord[] | null; durationSec?: number | null }
): void {
  const conn = getDb();
  if (media.words !== undefined) {
    conn
      .prepare("UPDATE projects SET transcript_words = ? WHERE id = ? AND user_email = ?")
      .run(media.words ? JSON.stringify(media.words) : null, projectId, email.toLowerCase());
  }
  if (media.durationSec !== undefined) {
    conn
      .prepare("UPDATE projects SET duration_sec = ? WHERE id = ? AND user_email = ?")
      .run(media.durationSec, projectId, email.toLowerCase());
  }
}

// --- A/B hook variants ---

export function insertAssetRow(
  email: string,
  a: {
    id: string;
    projectId: string;
    name: string;
    type: string;
    content: string;
    abGroup?: string | null;
  }
): void {
  getDb()
    .prepare(
      `INSERT INTO assets (id, user_email, project_id, name, type, views, status, liked, content, sort, ab_group)
       VALUES (?, ?, ?, ?, ?, '0', 'ready', 0, ?, ?, ?)`
    )
    .run(a.id, email.toLowerCase(), a.projectId, a.name, a.type, a.content, Date.now(), a.abGroup ?? null);
}

export function setAssetAbGroup(email: string, id: string, abGroup: string | null): void {
  getDb()
    .prepare("UPDATE assets SET ab_group = ? WHERE id = ? AND user_email = ?")
    .run(abGroup, id, email.toLowerCase());
}

/** Measured views per variant for every undecided A/B group, across users. */
export function abGroupStats(): {
  userEmail: string;
  abGroup: string;
  assetId: string;
  assetName: string;
  views: number;
  measuredPosts: number;
}[] {
  return getDb()
    .prepare(
      `SELECT a.user_email AS userEmail, a.ab_group AS abGroup, a.id AS assetId, a.name AS assetName,
              COALESCE(SUM(pm.views), 0) AS views, COUNT(pm.post_id) AS measuredPosts
       FROM assets a
       LEFT JOIN scheduled_posts sp ON sp.asset_id = a.id AND sp.user_email = a.user_email AND sp.status = 'published'
       LEFT JOIN post_metrics pm ON pm.post_id = sp.id AND pm.user_email = a.user_email
       WHERE a.ab_group IS NOT NULL AND a.ab_group NOT LIKE '%:decided'
       GROUP BY a.user_email, a.ab_group, a.id, a.name`
    )
    .all() as unknown as {
    userEmail: string;
    abGroup: string;
    assetId: string;
    assetName: string;
    views: number;
    measuredPosts: number;
  }[];
}

export function markAbGroupDecided(userEmail: string, abGroup: string): void {
  getDb()
    .prepare("UPDATE assets SET ab_group = ? WHERE user_email = ? AND ab_group = ?")
    .run(`${abGroup}:decided`, userEmail.toLowerCase(), abGroup);
}

// --- Competitor watchlist ---

export interface WatchEntry {
  id: string;
  handle: string;
  label: string | null;
  lastGrade: number | null;
  lastTop: string | null;
  lastCheckedAt: string | null;
  createdAt: string;
}

function mapWatch(row: Record<string, unknown>): WatchEntry {
  return {
    id: row.id as string,
    handle: row.handle as string,
    label: (row.label as string | null) ?? null,
    lastGrade: (row.last_grade as number | null) ?? null,
    lastTop: (row.last_top as string | null) ?? null,
    lastCheckedAt: (row.last_checked_at as string | null) ?? null,
    createdAt: row.created_at as string,
  };
}

export function listWatchlist(email: string): WatchEntry[] {
  return (
    getDb()
      .prepare("SELECT * FROM watchlist WHERE user_email = ? ORDER BY created_at ASC")
      .all(email.toLowerCase()) as Record<string, unknown>[]
  ).map(mapWatch);
}

export function insertWatch(email: string, id: string, handle: string): void {
  getDb()
    .prepare(
      "INSERT INTO watchlist (id, user_email, handle, created_at) VALUES (?, ?, ?, ?)"
    )
    .run(id, email.toLowerCase(), handle, new Date().toISOString());
}

export function deleteWatch(email: string, id: string): void {
  getDb()
    .prepare("DELETE FROM watchlist WHERE id = ? AND user_email = ?")
    .run(id, email.toLowerCase());
}

export function updateWatchResult(
  email: string,
  id: string,
  r: { label: string; grade: number; top: string[] }
): void {
  getDb()
    .prepare(
      "UPDATE watchlist SET label = ?, last_grade = ?, last_top = ?, last_checked_at = ? WHERE id = ? AND user_email = ?"
    )
    .run(r.label, r.grade, JSON.stringify(r.top), new Date().toISOString(), id, email.toLowerCase());
}

/** Watchlist entries due a weekly re-check, oldest first — the scheduler's
 *  cross-user worklist (bounded per tick to respect YouTube quota). */
export function listWatchDue(limit = 3): (WatchEntry & { userEmail: string })[] {
  const cutoff = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
  return (
    getDb()
      .prepare(
        `SELECT * FROM watchlist WHERE last_checked_at IS NULL OR last_checked_at < ?
         ORDER BY last_checked_at ASC LIMIT ?`
      )
      .all(cutoff, limit) as Record<string, unknown>[]
  ).map((row) => ({ ...mapWatch(row), userEmail: row.user_email as string }));
}

// --- Generated images (thumbnails / cover art) ---

export function insertGenImage(email: string, id: string, prompt: string, path: string): void {
  getDb()
    .prepare(
      "INSERT INTO gen_images (id, user_email, prompt, path, created_at) VALUES (?, ?, ?, ?, ?)"
    )
    .run(id, email.toLowerCase(), prompt, path, new Date().toISOString());
}

export function getGenImage(email: string, id: string): { path: string } | null {
  const row = getDb()
    .prepare("SELECT path FROM gen_images WHERE id = ? AND user_email = ?")
    .get(id, email.toLowerCase()) as { path: string } | undefined;
  return row ?? null;
}

// --- Storage retention (maintenance sweeps) ---

/** Every clip that still points at a rendered file, across users. */
export function listRenderedClips(): {
  id: string;
  userEmail: string;
  outputPath: string;
  kind: string;
}[] {
  return getDb()
    .prepare(
      "SELECT id, user_email AS userEmail, output_path AS outputPath, kind FROM clips WHERE output_path IS NOT NULL"
    )
    .all() as unknown as { id: string; userEmail: string; outputPath: string; kind: string }[];
}

/** Clears an expired render: metadata survives, re-render is one click. */
export function clearClipOutput(email: string, id: string, status: Clip["status"]): void {
  getDb()
    .prepare(
      "UPDATE clips SET output_path = NULL, status = ?, error = ? WHERE id = ? AND user_email = ?"
    )
    .run(status, "expired after 30 days — render again anytime", id, email.toLowerCase());
}

/** All stored source-video paths — the uploads the sweeper must not touch. */
export function listAllStoragePaths(): { email: string; id: string; storagePath: string }[] {
  return getDb()
    .prepare(
      "SELECT user_email AS email, id, storage_path AS storagePath FROM projects WHERE storage_path IS NOT NULL"
    )
    .all() as unknown as { email: string; id: string; storagePath: string }[];
}

export function clearProjectStorage(email: string, id: string): void {
  getDb()
    .prepare("UPDATE projects SET storage_path = NULL WHERE id = ? AND user_email = ?")
    .run(id, email.toLowerCase());
}

/** Generated images older than the cutoff; rows are deleted, paths returned. */
export function purgeOldGenImages(cutoffIso: string): string[] {
  const conn = getDb();
  const rows = conn
    .prepare("SELECT path FROM gen_images WHERE created_at < ?")
    .all(cutoffIso) as { path: string }[];
  conn.prepare("DELETE FROM gen_images WHERE created_at < ?").run(cutoffIso);
  return rows.map((r) => r.path);
}

// --- Client approval links (agency workflow) ---

export function getOrCreateApproveToken(email: string, projectId: string): string | null {
  const row = getDb()
    .prepare("SELECT approve_token FROM projects WHERE id = ? AND user_email = ?")
    .get(projectId, email.toLowerCase()) as { approve_token: string | null } | undefined;
  if (!row) return null;
  if (row.approve_token) return row.approve_token;
  const token = crypto.randomUUID().replace(/-/g, "");
  getDb()
    .prepare("UPDATE projects SET approve_token = ? WHERE id = ? AND user_email = ?")
    .run(token, projectId, email.toLowerCase());
  return token;
}

export function getProjectByApproveToken(
  token: string
): { email: string; projectId: string; title: string } | null {
  if (!token || token.length < 16) return null;
  const row = getDb()
    .prepare("SELECT user_email, id, title FROM projects WHERE approve_token = ?")
    .get(token) as { user_email: string; id: string; title: string } | undefined;
  return row ? { email: row.user_email, projectId: row.id, title: row.title } : null;
}

// --- Smart scheduling ---

/** Measured performance by platform × local posting hour, for best-time hints. */
export function bestHoursByPlatform(
  email: string
): { platform: string; hour: number; avgViews: number; samples: number }[] {
  return getDb()
    .prepare(
      `SELECT sp.platform, CAST(substr(sp.scheduled_at, 12, 2) AS INTEGER) AS hour,
              AVG(pm.views) AS avgViews, COUNT(*) AS samples
       FROM post_metrics pm
       JOIN scheduled_posts sp ON sp.id = pm.post_id AND sp.user_email = pm.user_email
       WHERE pm.user_email = ? AND length(sp.scheduled_at) >= 13
       GROUP BY sp.platform, hour`
    )
    .all(email.toLowerCase()) as unknown as {
    platform: string;
    hour: number;
    avgViews: number;
    samples: number;
  }[];
}

/** Ready assets with no pending scheduled post — "Fill my week" candidates. */
export function listUnscheduledAssets(email: string, limit = 7): Asset[] {
  return (
    getDb()
      .prepare(
        `SELECT a.* FROM assets a
         WHERE a.user_email = ?
           AND a.content IS NOT NULL
           AND NOT EXISTS (
             SELECT 1 FROM scheduled_posts sp
             WHERE sp.asset_id = a.id AND sp.user_email = a.user_email AND sp.status = 'scheduled'
           )
         ORDER BY a.sort DESC LIMIT ?`
      )
      .all(email.toLowerCase(), limit) as Record<string, unknown>[]
  ).map(mapAsset);
}

// --- Managed client accounts (agency delegated access) ---

export interface ManagedLink {
  managerEmail: string;
  clientEmail: string;
  status: "invited" | "active";
  createdAt: string;
  name: string;
  plan: string;
}

/** Clients this manager can (or is waiting to) act as, with user info. */
export function listClientsOf(manager: string): ManagedLink[] {
  return getDb()
    .prepare(
      `SELECT m.manager_email AS managerEmail, m.client_email AS clientEmail,
              m.status, m.created_at AS createdAt, u.name, u.plan
       FROM managed_accounts m JOIN users u ON u.email = m.client_email
       WHERE m.manager_email = ? ORDER BY m.created_at ASC`
    )
    .all(manager.toLowerCase()) as unknown as ManagedLink[];
}

/** Managers who have (or requested) access to this client's account. */
export function listManagersOf(client: string): ManagedLink[] {
  return getDb()
    .prepare(
      `SELECT m.manager_email AS managerEmail, m.client_email AS clientEmail,
              m.status, m.created_at AS createdAt, u.name, u.plan
       FROM managed_accounts m JOIN users u ON u.email = m.manager_email
       WHERE m.client_email = ? ORDER BY m.created_at ASC`
    )
    .all(client.toLowerCase()) as unknown as ManagedLink[];
}

export function insertManagedLink(
  manager: string,
  client: string,
  status: "invited" | "active"
): void {
  getDb()
    .prepare(
      `INSERT OR REPLACE INTO managed_accounts (manager_email, client_email, status, created_at)
       VALUES (?, ?, ?, ?)`
    )
    .run(manager.toLowerCase(), client.toLowerCase(), status, new Date().toISOString());
}

/** Client-side approval of a pending management request. */
export function activateManagedLink(manager: string, client: string): boolean {
  const res = getDb()
    .prepare(
      "UPDATE managed_accounts SET status = 'active' WHERE manager_email = ? AND client_email = ? AND status = 'invited'"
    )
    .run(manager.toLowerCase(), client.toLowerCase());
  return Number(res.changes) > 0;
}

/** Removes the link in whichever direction it exists (manager or client view). */
export function deleteManagedLink(a: string, b: string): void {
  const conn = getDb();
  conn
    .prepare("DELETE FROM managed_accounts WHERE manager_email = ? AND client_email = ?")
    .run(a.toLowerCase(), b.toLowerCase());
  conn
    .prepare("DELETE FROM managed_accounts WHERE manager_email = ? AND client_email = ?")
    .run(b.toLowerCase(), a.toLowerCase());
}

/** The auth-layer check: may `manager` currently act as `client`? */
export function isActiveManager(manager: string, client: string): boolean {
  const row = getDb()
    .prepare(
      "SELECT 1 FROM managed_accounts WHERE manager_email = ? AND client_email = ? AND status = 'active'"
    )
    .get(manager.toLowerCase(), client.toLowerCase());
  return Boolean(row);
}

const PLAN_RANK: Record<string, number> = {
  Free: 0,
  Lite: 1,
  Starter: 2,
  "Creator Pro": 3,
  Agency: 4,
};

/** Quota inheritance: a managed client rides the best plan among their own
 *  and every active manager's — the agency's plan covers its clients. */
export function bestPlanFor(email: string): string {
  const own = findUser(email)?.plan ?? "Starter";
  let best = own;
  const managers = getDb()
    .prepare(
      `SELECT u.plan FROM managed_accounts m JOIN users u ON u.email = m.manager_email
       WHERE m.client_email = ? AND m.status = 'active'`
    )
    .all(email.toLowerCase()) as { plan: string }[];
  for (const m of managers) {
    if ((PLAN_RANK[m.plan] ?? 0) > (PLAN_RANK[best] ?? 0)) best = m.plan;
  }
  return best;
}

// --- Weekly operator brief ---

/** Users due a weekly brief: active accounts not briefed in the last 6.5 days. */
export function listUsersDueBrief(): { email: string; name: string }[] {
  const cutoff = new Date(Date.now() - 6.5 * 24 * 60 * 60 * 1000).toISOString();
  return getDb()
    .prepare(
      `SELECT email, name FROM users
       WHERE (last_brief_at IS NULL OR last_brief_at < ?)
         AND EXISTS (SELECT 1 FROM projects p WHERE p.user_email = users.email)`
    )
    .all(cutoff) as unknown as { email: string; name: string }[];
}

export function setLastBriefAt(email: string): void {
  getDb()
    .prepare("UPDATE users SET last_brief_at = ? WHERE email = ?")
    .run(new Date().toISOString(), email.toLowerCase());
}

export function seedUser(email: string): void {
  const lower = email.toLowerCase();
  const idMap = new Map<string, string>();

  defaultProjects.forEach((p) => {
    const newId = `proj-${crypto.randomUUID()}`;
    idMap.set(p.id, newId);
    insertProject(lower, { ...p, id: newId });
  });

  const conn = getDb();
  defaultAssets.forEach((a, i) => {
    const projectId = idMap.get(a.projectId) ?? a.projectId;
    conn
      .prepare(
        `INSERT INTO assets (id, user_email, project_id, name, type, views, status, liked, sort)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        `a-${crypto.randomUUID()}`,
        lower,
        projectId,
        a.name,
        a.type,
        a.views,
        a.status,
        a.liked ? 1 : 0,
        i
      );
  });

  defaultNotifications.forEach((n, i) => {
    conn
      .prepare(
        `INSERT INTO notifications (id, user_email, title, message, time, read, type, sort)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        `n-${crypto.randomUUID()}`,
        lower,
        n.title,
        n.message,
        n.time,
        n.read ? 1 : 0,
        n.type,
        defaultNotifications.length - i
      );
  });
}

// --- Paid site audits (the Complete Content Audit product) ---

export interface SiteAuditRow {
  id: string;
  userEmail: string;
  url: string;
  status: string; // pending_payment | queued | running | ready | failed
  paid: boolean;
  score: number | null;
  report: string | null; // JSON blob
  error: string | null;
  createdAt: string;
  completedAt: string | null;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function rowToSiteAudit(r: any): SiteAuditRow {
  return {
    id: r.id,
    userEmail: r.user_email,
    url: r.url,
    status: r.status,
    paid: Boolean(r.paid),
    score: r.score ?? null,
    report: r.report ?? null,
    error: r.error ?? null,
    createdAt: r.created_at,
    completedAt: r.completed_at ?? null,
  };
}

export function insertSiteAudit(
  email: string,
  id: string,
  url: string,
  opts: { paid?: boolean } = {}
): void {
  const paid = opts.paid ? 1 : 0;
  getDb()
    .prepare(
      `INSERT INTO site_audits (id, user_email, url, status, paid, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`
    )
    .run(
      id,
      email.toLowerCase(),
      url,
      paid ? "queued" : "pending_payment",
      paid,
      new Date().toISOString()
    );
}

export function getSiteAudit(email: string, id: string): SiteAuditRow | null {
  const r = getDb()
    .prepare("SELECT * FROM site_audits WHERE id = ? AND user_email = ?")
    .get(id, email.toLowerCase());
  return r ? rowToSiteAudit(r) : null;
}

export function getSiteAuditById(id: string): SiteAuditRow | null {
  const r = getDb().prepare("SELECT * FROM site_audits WHERE id = ?").get(id);
  return r ? rowToSiteAudit(r) : null;
}

export function listQueuedSiteAudits(): SiteAuditRow[] {
  return (
    getDb()
      .prepare("SELECT * FROM site_audits WHERE status = 'queued' ORDER BY created_at")
      .all() as unknown[]
  ).map(rowToSiteAudit);
}

export function listSiteAudits(email: string): SiteAuditRow[] {
  return (
    getDb()
      .prepare(
        "SELECT * FROM site_audits WHERE user_email = ? ORDER BY created_at DESC LIMIT 20"
      )
      .all(email.toLowerCase()) as unknown[]
  ).map(rowToSiteAudit);
}

export function updateSiteAudit(
  id: string,
  fields: { status?: string; score?: number; report?: string; error?: string | null; completedAt?: string }
): void {
  const sets: string[] = [];
  const vals: unknown[] = [];
  if (fields.status !== undefined) { sets.push("status = ?"); vals.push(fields.status); }
  if (fields.score !== undefined) { sets.push("score = ?"); vals.push(fields.score); }
  if (fields.report !== undefined) { sets.push("report = ?"); vals.push(fields.report); }
  if (fields.error !== undefined) { sets.push("error = ?"); vals.push(fields.error); }
  if (fields.completedAt !== undefined) { sets.push("completed_at = ?"); vals.push(fields.completedAt); }
  if (!sets.length) return;
  vals.push(id);
  getDb().prepare(`UPDATE site_audits SET ${sets.join(", ")} WHERE id = ?`).run(...(vals as never[]));
}

/** Payment confirmed (Stripe webhook): unlock and queue the crawl. */
export function markSiteAuditPaid(id: string): SiteAuditRow | null {
  getDb()
    .prepare(
      "UPDATE site_audits SET paid = 1, status = 'queued' WHERE id = ? AND status = 'pending_payment'"
    )
    .run(id);
  return getSiteAuditById(id);
}
