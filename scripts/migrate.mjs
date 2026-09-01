import { readFile } from "node:fs/promises";
import postgres from "postgres";

const databaseUrl = process.env.POSTGRES_URL_NON_POOLING;
if (!databaseUrl) throw new Error("POSTGRES_URL_NON_POOLING is not configured.");

const migration = await readFile(new URL("../supabase/migrations/0001_focused_feed.sql", import.meta.url), "utf8");
const sql = postgres(databaseUrl, { max: 1, ssl: "require" });

try {
  await sql.unsafe(migration);
  console.log("Focused Feed database schema is up to date.");
} finally {
  await sql.end();
}
