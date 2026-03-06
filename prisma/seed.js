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

  const userPasswordHash = await bcrypt.hash('User@1234', 10);
  const users = [
    ['aisha.khan@nexus.com', 'Aisha', 'Khan', '9000000001', userPasswordHash, 'USER'],
    ['arjun.patel@nexus.com', 'Arjun', 'Patel', '9000000002', userPasswordHash, 'USER'],
    ['meera.iyer@nexus.com', 'Meera', 'Iyer', '9000000003', userPasswordHash, 'USER'],
    ['rohan.sharma@nexus.com', 'Rohan', 'Sharma', '9000000004', userPasswordHash, 'USER'],
    ['sara.fernandez@nexus.com', 'Sara', 'Fernandez', '9000000005', userPasswordHash, 'USER'],
    ['vivaan.mehta@nexus.com', 'Vivaan', 'Mehta', '9000000006', userPasswordHash, 'USER'],
    ['nina.dsouza@nexus.com', 'Nina', 'DSouza', '9000000007', userPasswordHash, 'USER'],
    ['kabir.verma@nexus.com', 'Kabir', 'Verma', '9000000008', userPasswordHash, 'USER'],
    ['priya.singh@nexus.com', 'Priya', 'Singh', '9000000009', userPasswordHash, 'USER'],
    ['dev.kumar@nexus.com', 'Dev', 'Kumar', '9000000010', userPasswordHash, 'USER'],
  ];

  const userInsertQuery = `
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

  for (const user of users) {
    await client.query(userInsertQuery, user);
  }

  console.log('✅ Demo users seeded successfully');

  const settings = [
    ['homeTitle', 'Welcome to NEXUS'],
    ['homeSubtitle', 'The social platform where connections matter'],
    ['homeDescription', 'NEXUS is a modern social platform designed to bring people together. Share your thoughts, connect with friends, and build meaningful relationships in a safe and supportive community.'],
    ['contactEmail', 'support@nexus.com'],
    ['contactPhone', '+1 (555) 123-4567'],
  ];

  const settingsQuery = `
    INSERT INTO "Setting" ("key", "value")
    VALUES ($1, $2)
    ON CONFLICT ("key") DO UPDATE SET "value" = EXCLUDED."value";
  `;

  for (const [key, value] of settings) {
    await client.query(settingsQuery, [key, value]);
  }

  console.log('✅ Landing page settings seeded successfully');

  // Create posts for users
  const userResult = await client.query('SELECT id, "firstName", "lastName" FROM "User" WHERE role = $1 ORDER BY id', ['USER']);
  const userIds = userResult.rows;

  const posts = [
    { userId: 0, content: '🌅 Just watched the most beautiful sunrise! Starting my day with gratitude and positive vibes. #MorningMotivation', mediaUrl: null },
    { userId: 0, content: 'Had an amazing coffee at the new cafe downtown ☕ Highly recommend their caramel latte!', mediaUrl: null },
    { userId: 1, content: '💻 Finally finished my coding project! Feeling accomplished and ready for the next challenge. #DevLife', mediaUrl: null },
    { userId: 1, content: 'Weekend hiking trip was incredible! Nature really does heal the soul 🏔️', mediaUrl: null },
    { userId: 2, content: '📚 Just finished reading an amazing book on mindfulness. Life-changing perspectives! Anyone else into self-help books?', mediaUrl: null },
    { userId: 2, content: 'Cooked my first homemade pasta from scratch today 🍝 Turned out better than expected!', mediaUrl: null },
    { userId: 3, content: '🏋️ Completed my 30-day fitness challenge! Consistency is key, friends. Never give up on your goals!', mediaUrl: null },
    { userId: 3, content: 'Sunday vibes: Netflix, pizza, and no plans. Sometimes doing nothing is the best plan 🍕📺', mediaUrl: null },
    { userId: 4, content: '🎨 Working on a new art project. Creativity is flowing today! Stay tuned for the final piece.', mediaUrl: null },
    { userId: 4, content: 'Attended an inspiring tech conference today. So many brilliant minds in one room! #TechCommunity', mediaUrl: null },
    { userId: 5, content: '🎵 Concert last night was EPIC! My favorite band absolutely killed it. Best night ever!', mediaUrl: null },
    { userId: 5, content: 'Started learning Spanish today. ¡Hola amigos! Any tips for language learning?', mediaUrl: null },
    { userId: 6, content: '🌿 Planted a small herb garden on my balcony. Excited to grow my own basil and mint!', mediaUrl: null },
    { userId: 6, content: 'Just adopted the cutest kitten from the shelter 🐱 Name suggestions welcome!', mediaUrl: null },
    { userId: 7, content: '⚽ Game day! Supporting my team through thick and thin. Let\'s get that win!', mediaUrl: null },
    { userId: 7, content: 'Trying out a new recipe tonight: homemade sushi 🍣 Wish me luck!', mediaUrl: null },
    { userId: 8, content: '🎓 Just got my certification! Hard work pays off. Grateful for everyone who supported me.', mediaUrl: null },
    { userId: 8, content: 'Beach day with friends was exactly what I needed. Sun, sand, and good company ☀️🏖️', mediaUrl: null },
    { userId: 9, content: '💡 Had a eureka moment while working on my startup idea. The grind continues!', mediaUrl: null },
    { userId: 9, content: 'Movie marathon night! Rewatching all the classics. What\'s your comfort movie?', mediaUrl: null },
  ];

  const postInsertQuery = `
    INSERT INTO "Post" ("userId", "content", "mediaUrl", "isHidden", "createdAt")
    VALUES ($1, $2, $3, false, NOW())
  `;

  for (let i = 0; i < posts.length && i < userIds.length * 2; i++) {
    const post = posts[i];
    const userIndex = post.userId % userIds.length;
    const userId = userIds[userIndex].id;
    await client.query(postInsertQuery, [userId, post.content, post.mediaUrl]);
  }

  console.log('✅ Demo posts seeded successfully');

  await client.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});