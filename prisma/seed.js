const { Client } = require('pg');
const bcrypt = require('bcrypt');
require('dotenv').config();

async function main() {
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();

  const hash = await bcrypt.hash('admin@nexus', 10);
  const email = 'admin@nexus.com';

  const query = `
    INSERT INTO "User" ("email","firstName","lastName","phone","password","role","isVerified","isBlocked","createdAt")
    VALUES($1,$2,$3,$4,$5,$6,true,false,now())
    ON CONFLICT (email) DO UPDATE SET
      "firstName" = EXCLUDED."firstName",
      "lastName" = EXCLUDED."lastName",
      "phone" = EXCLUDED."phone",
      "password" = EXCLUDED."password",
      "role" = EXCLUDED."role",
      "isVerified" = TRUE,
      "isBlocked" = FALSE;
  `;

  const values = [
    email,
    'System',
    'Admin',
    '0000000000',
    hash,
    'ADMIN',
  ];

  await client.query(query, values);
  console.log('✅ Admin seeded successfully');

  await client.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});