const { Pool } = require('pg');
const fs = require('fs');

const pool = new Pool({
  host: '127.0.0.1',
  port: process.env.DB_PORT || 5432,
  database: 'africastn_os',
  user: 'africastn_app',
  password: process.env.DB_PASSWORD,
});

const sql = fs.readFileSync(
  '../src/modules/finance/db/migrations/010-stza-client.sql',
  'utf8'
);

pool
  .query(sql)
  .then(() => {
    console.log('Migration 010 applied successfully.');
    pool.end();
  })
  .catch((e) => {
    console.error('Migration failed:', e.message);
    pool.end();
    process.exit(1);
  });
