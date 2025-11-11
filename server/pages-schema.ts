import { db } from "./db";
import { sql } from "drizzle-orm";
import { swallowPgError } from "./pg-utils";

let pagesColumnsEnsured = false;
let ensuringPagesColumns: Promise<void> | null = null;

function extractRegclassValue(row: Record<string, unknown>): string | null {
  const keys = ["tableName", "tablename", "to_regclass"];
  for (const key of keys) {
    const value = row[key];
    if (typeof value === "string" && value.trim().length > 0) {
      return value;
    }
  }
  return null;
}

async function checkPagesTableExists(): Promise<boolean> {
  try {
    const result = await db.execute(
      sql`SELECT to_regclass('public.pages') AS "tableName"`,
    );
    const row = result.rows?.[0];
    return typeof row === "object" && row !== null && extractRegclassValue(row) !== null;
  } catch (error) {
    console.warn(
      "[storage] Не удалось проверить наличие таблицы pages: ",
      error instanceof Error ? error.message : String(error),
    );
    return false;
  }
}

export async function ensurePagesContentColumns(): Promise<void> {
  if (pagesColumnsEnsured) {
    return;
  }

  if (ensuringPagesColumns) {
    await ensuringPagesColumns;
    return;
  }

  ensuringPagesColumns = (async () => {
    const tableExists = await checkPagesTableExists();

    if (!tableExists) {
      console.warn(
        "[storage] Таблица pages отсутствует. Пропускаем обновление колонок metadata/chunks",
      );
      return;
    }

    try {
      await db.execute(
        sql`
          ALTER TABLE "pages"
          ADD COLUMN IF NOT EXISTS "metadata" jsonb DEFAULT '{}'::jsonb NOT NULL
        `,
      );
    } catch (error) {
      swallowPgError(error, ["42701", "42P01"]);
    }

    try {
      await db.execute(
        sql`
          ALTER TABLE "pages"
          ADD COLUMN IF NOT EXISTS "chunks" jsonb DEFAULT '[]'::jsonb NOT NULL
        `,
      );
    } catch (error) {
      swallowPgError(error, ["42701", "42P01"]);
    }
  })();

  try {
    await ensuringPagesColumns;
    pagesColumnsEnsured = true;
  } finally {
    ensuringPagesColumns = null;
  }
}

export function __resetPagesSchemaForTests(): void {
  pagesColumnsEnsured = false;
  ensuringPagesColumns = null;
}
