import { loadEnv } from '../config/env';
import { createPool } from './postgres';

const names = ['Alice', 'Bob', 'Charlie', 'Diana'];

async function seed(): Promise<void> {
  const pool = createPool(loadEnv().DATABASE_URL);
  try {
    for (const name of names) {
      const { rows } = await pool.query<{ id: string }>('INSERT INTO users (name) VALUES ($1) RETURNING id', [name]);
      console.log(`${name.padEnd(8)} ${rows[0]?.id}`);
    }
  } finally {
    await pool.end();
  }
}

seed().catch((err: unknown) => {
  console.error('Seed failed:', err);
  process.exitCode = 1;
});
