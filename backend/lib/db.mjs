import postgres from 'postgres';

let sqlClient = null;

export function getSql() {
  if (sqlClient) return sqlClient;
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is not configured');
  sqlClient = postgres(process.env.DATABASE_URL, {
    max: Number(process.env.DB_POOL_SIZE || 10),
    idle_timeout: 20,
    connect_timeout: 10,
    prepare: false
  });
  return sqlClient;
}

export async function closeSql() {
  if (!sqlClient) return;
  await sqlClient.end({ timeout: 5 });
  sqlClient = null;
}
