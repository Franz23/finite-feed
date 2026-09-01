import { readdir, readFile } from "node:fs/promises";
import postgres from "postgres";

const databaseUrl = process.env.POSTGRES_URL_NON_POOLING;
if (!databaseUrl) throw new Error("POSTGRES_URL_NON_POOLING is not configured.");

const sql = postgres(databaseUrl, { max: 1, ssl: "require" });

try {
  await sql`create table if not exists public.finite_feed_migrations (
    name text primary key,
    applied_at timestamptz not null default now()
  )`;
  const [{ base_exists: baseExists }] = await sql`select to_regclass('public.profiles') is not null as base_exists`;
  if (baseExists) {
    await sql`insert into public.finite_feed_migrations (name) values ('0001_finite_feed.sql') on conflict do nothing`;
  }
  const migrationsUrl = new URL("../supabase/migrations/", import.meta.url);
  const migrationNames = (await readdir(migrationsUrl)).filter((name) => name.endsWith(".sql")).sort();
  for (const name of migrationNames) {
    const [applied] = await sql`select name from public.finite_feed_migrations where name = ${name}`;
    if (applied) continue;
    const migration = await readFile(new URL(name, migrationsUrl), "utf8");
    await sql.begin(async (transaction) => {
      await transaction.unsafe(migration);
      await transaction`insert into public.finite_feed_migrations (name) values (${name})`;
    });
    console.log(`Applied ${name}.`);
  }
  console.log("Finite Feed database schema is up to date.");
} finally {
  await sql.end();
}
