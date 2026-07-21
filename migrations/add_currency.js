const { neon } = require('@neondatabase/serverless');

// Load env from .env.local manually
const fs = require('fs');
const path = require('path');
const envPath = path.resolve(__dirname, '..', '.env.local');
const envContent = fs.readFileSync(envPath, 'utf8');
envContent.split('\n').forEach(line => {
  const [key, ...val] = line.split('=');
  if (key && val.length) process.env[key.trim()] = val.join('=').trim();
});

const sql = neon(process.env.DATABASE_URL);

async function runMigration() {
  try {
    console.log('Adding currency column to expenses...');
    await sql`ALTER TABLE expenses ADD COLUMN IF NOT EXISTS currency VARCHAR(10) NOT NULL DEFAULT 'BRL'`;
    console.log('Adding currency column to recurring_expenses...');
    await sql`ALTER TABLE recurring_expenses ADD COLUMN IF NOT EXISTS currency VARCHAR(10) NOT NULL DEFAULT 'BRL'`;
    console.log('Migration completed successfully.');
  } catch (error) {
    console.error('Migration failed:', error);
  }
}

runMigration();
