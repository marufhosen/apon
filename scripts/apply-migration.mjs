import { Pool } from 'pg';

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  console.error('DATABASE_URL is required (the script no longer contains a connection string).');
  process.exit(1);
}

const pool = new Pool({ connectionString });

async function main() {
  const client = await pool.connect();
  try {
    await client.query('ALTER TABLE rate_limits ADD COLUMN id text NOT NULL');
    console.log('Column added successfully');
  } catch (err) {
    // Column might already exist
    if (err.message.includes('already exists')) {
      console.log('Column already exists');
    } else {
      console.error('Error:', err);
    }
  } finally {
    await pool.end();
  }
}

main();