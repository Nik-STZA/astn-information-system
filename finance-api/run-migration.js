const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');

const pool = new Pool({
  host: '127.0.0.1',
  port: process.env.DB_PORT || 5432,
  database: 'africastn_os',
  user: 'africastn_app',
  password: process.env.DB_PASSWORD,
});

// Usage, through the Cloud SQL Auth Proxy:
//   DB_PORT=5433 DB_PASSWORD=... node run-migration.js 019-supplier-master.sql
// The file is named on the command line so that applying a migration never
// means editing this script (it used to name 010 here).
const name = process.argv[2];
if (!name || !/^\d{3}-[a-z0-9-]+\.sql$/.test(name)) {
  console.error('usage: node run-migration.js <NNN-name.sql>');
  process.exit(2);
}
const sql = fs.readFileSync(
  path.join(__dirname, '../src/modules/finance/db/migrations', name),
  'utf8'
);

pool
  .query(sql)
  .then(() => {
    console.log(`Migration ${name} applied successfully.`);
    pool.end();
  })
  .catch((e) => {
    console.error('Migration failed:', e.message);
    pool.end();
    process.exit(1);
  });
