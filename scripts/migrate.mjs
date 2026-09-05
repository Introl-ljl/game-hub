import fs from 'node:fs/promises';
import path from 'node:path';
import { getSql } from '../backend/lib/db.mjs';

export async function migrate() {
  const dbDir = new URL('../db', import.meta.url);
  const files = (await fs.readdir(dbDir))
    .filter((file) => file.endsWith('.sql'))
    .sort();
  const sql = getSql();
  for (const file of files) {
    const migration = await fs.readFile(path.join(dbDir.pathname, file), 'utf8');
    for (const statement of migration.split(/;\s*(?:\r?\n|$)/).map((item) => item.trim()).filter(Boolean)) {
      await sql.unsafe(statement);
    }
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  await migrate();
  console.log('Database schema is up to date.');
  process.exit(0);
}
