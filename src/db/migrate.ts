import { readFile } from 'node:fs/promises';
import path from 'node:path';
import type { Pool } from 'pg';
import { loadEnv } from '../config/env';
import { createPool } from './postgres';

export async function migrate(pool: Pool): Promise<void> {
  const sql = await readFile(path.join(__dirname, '..', '..', 'db', 'schema.sql'), 'utf8');
  await pool.query(sql);
}

if (require.main === module) {
  const pool = createPool(loadEnv().DATABASE_URL);
  migrate(pool)
    .then(() => console.log('Database schema is up to date.'))
    .catch((err: unknown) => {
      console.error('Migration failed:', err);
      process.exitCode = 1;
    })
    .finally(() => void pool.end());
}
