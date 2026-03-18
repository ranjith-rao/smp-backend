const { Client } = require('pg');
const bcrypt = require('bcrypt');
require('dotenv').config();

async function upsertUser(client, user) {
  const userQuery = `
    INSERT INTO "User" (
      "email", "firstName", "lastName", "phone", "password", "role",
      "isVerified", "isBlocked", "isDeleted", "username", "profileImageUrl", "bio", "createdAt"
    )
    VALUES ($1,$2,$3,$4,$5,'USER',true,false,false,$6,$7,$8,NOW())
    ON CONFLICT ("email") DO UPDATE SET
      "firstName" = EXCLUDED."firstName",
      "lastName" = EXCLUDED."lastName",
      "phone" = EXCLUDED."phone",
      "password" = EXCLUDED."password",
      "role" = 'USER',
      "isVerified" = true,
      "isBlocked" = false,
      "isDeleted" = false,
      "username" = EXCLUDED."username",
      "profileImageUrl" = EXCLUDED."profileImageUrl",
      "bio" = EXCLUDED."bio"
    RETURNING id, "email";
  `;

  const values = [
    user.email,
    user.firstName,
    user.lastName,
    user.phone,
    user.passwordHash,
    user.username,
    user.profileImageUrl,
    user.bio,
  ];

  const res = await client.query(userQuery, values);
  return res.rows[0];
}

async function upsertPage(client, page) {
  const pageQuery = `
    INSERT INTO "Page" (
      "name", "slug", "description", "category", "bannerImageUrl", "profileImageUrl", "ownerId", "createdAt", "updatedAt"
    )
    VALUES ($1,$2,$3,$4,$5,$6,$7,NOW(),NOW())
    ON CONFLICT ("slug") DO UPDATE SET
      "name" = EXCLUDED."name",
      "description" = EXCLUDED."description",
      "category" = EXCLUDED."category",
      "bannerImageUrl" = EXCLUDED."bannerImageUrl",
      "profileImageUrl" = EXCLUDED."profileImageUrl",
      "ownerId" = EXCLUDED."ownerId",
      "updatedAt" = NOW()
    RETURNING id, "slug";
  `;

  const values = [
    page.name,
    page.slug,
    page.description,
    page.category,
    page.bannerImageUrl,
    page.profileImageUrl,
    page.ownerId,
  ];

  const res = await client.query(pageQuery, values);
  return res.rows[0];
}

async function insertPostIfMissing(client, post) {
  const exists = await client.query(
    `SELECT id FROM "Post" WHERE "userId" = $1 AND COALESCE("content", '') = $2 LIMIT 1`,
    [post.userId, post.content]
  );

  if (exists.rows.length > 0) {
    return { inserted: false, id: exists.rows[0].id };
  }

  const insert = await client.query(
    `INSERT INTO "Post" (
      "userId", "pageId", "content", "feeling", "mediaType", "mediaUrl", "isHidden", "createdAt"
    )
    VALUES ($1,$2,$3,$4,$5,$6,false,NOW())
    RETURNING id`,
    [
      post.userId,
      post.pageId || null,
      post.content,
      post.feeling || null,
      post.mediaType || null,
      post.mediaUrl || null,
    ]
  );

  return { inserted: true, id: insert.rows[0].id };
}

async function followPage(client, pageId, userId) {
  await client.query(
    `INSERT INTO "PageFollower" ("pageId", "userId", "createdAt")
     VALUES ($1, $2, NOW())
     ON CONFLICT ("pageId", "userId") DO NOTHING`,
    [pageId, userId]
  );
}

async function main() {
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();

  try {
    const passwordHash = await bcrypt.hash('User@1234', 10);

    const moreUsers = [
      {
        email: 'ananya.rao@nexus.com',
        firstName: 'Ananya',
        lastName: 'Rao',
        phone: '9000000011',
        username: 'ananya.rao',
        bio: 'Product designer, coffee lover, and travel storyteller.',
        profileImageUrl: 'https://picsum.photos/seed/user-ananya/400/400',
      },
      {
        email: 'rahul.nair@nexus.com',
        firstName: 'Rahul',
        lastName: 'Nair',
        phone: '9000000012',
        username: 'rahul.nair',
        bio: 'Full-stack dev sharing code, books, and side projects.',
        profileImageUrl: 'https://picsum.photos/seed/user-rahul/400/400',
      },
      {
        email: 'isha.malhotra@nexus.com',
        firstName: 'Isha',
        lastName: 'Malhotra',
        phone: '9000000013',
        username: 'isha.malhotra',
        bio: 'Fitness, nutrition, and mindful living every day.',
        profileImageUrl: 'https://picsum.photos/seed/user-isha/400/400',
      },
      {
        email: 'karthik.reddy@nexus.com',
        firstName: 'Karthik',
        lastName: 'Reddy',
        phone: '9000000014',
        username: 'karthik.reddy',
        bio: 'Tech entrepreneur documenting startup lessons.',
        profileImageUrl: 'https://picsum.photos/seed/user-karthik/400/400',
      },
      {
        email: 'zara.ali@nexus.com',
        firstName: 'Zara',
        lastName: 'Ali',
        phone: '9000000015',
        username: 'zara.ali',
        bio: 'Photographer capturing city and street moments.',
        profileImageUrl: 'https://picsum.photos/seed/user-zara/400/400',
      },
      {
        email: 'manav.joshi@nexus.com',
        firstName: 'Manav',
        lastName: 'Joshi',
        phone: '9000000016',
        username: 'manav.joshi',
        bio: 'Cyclist and weekend explorer.',
        profileImageUrl: 'https://picsum.photos/seed/user-manav/400/400',
      },
    ];

    const insertedUsers = [];
    for (const user of moreUsers) {
      const row = await upsertUser(client, { ...user, passwordHash });
      insertedUsers.push({ ...row, ...user });
    }

    const userByEmail = new Map(insertedUsers.map((u) => [u.email, u]));

    const pages = [
      {
        name: 'Nexus Travel Diaries',
        slug: 'nexus-travel-diaries',
        description: 'Beautiful places, hidden gems, and practical travel guides from around the world.',
        category: 'Travel',
        profileImageUrl: 'https://picsum.photos/seed/page-travel-profile/500/500',
        bannerImageUrl: 'https://picsum.photos/seed/page-travel-banner/1600/500',
        ownerEmail: 'ananya.rao@nexus.com',
      },
      {
        name: 'Fit Fuel Daily',
        slug: 'fit-fuel-daily',
        description: 'Daily fitness motivation, routines, and nutrition tips for sustainable health.',
        category: 'Health & Fitness',
        profileImageUrl: 'https://picsum.photos/seed/page-fit-profile/500/500',
        bannerImageUrl: 'https://picsum.photos/seed/page-fit-banner/1600/500',
        ownerEmail: 'isha.malhotra@nexus.com',
      },
      {
        name: 'Code & Build Lab',
        slug: 'code-build-lab',
        description: 'Coding tutorials, architecture notes, and developer productivity workflows.',
        category: 'Technology',
        profileImageUrl: 'https://picsum.photos/seed/page-code-profile/500/500',
        bannerImageUrl: 'https://picsum.photos/seed/page-code-banner/1600/500',
        ownerEmail: 'rahul.nair@nexus.com',
      },
      {
        name: 'Urban Lens Stories',
        slug: 'urban-lens-stories',
        description: 'Street photography stories, visual essays, and behind-the-shot notes.',
        category: 'Photography',
        profileImageUrl: 'https://picsum.photos/seed/page-lens-profile/500/500',
        bannerImageUrl: 'https://picsum.photos/seed/page-lens-banner/1600/500',
        ownerEmail: 'zara.ali@nexus.com',
      },
    ];

    const pageRows = [];
    for (const page of pages) {
      const owner = userByEmail.get(page.ownerEmail);
      if (!owner) continue;
      const row = await upsertPage(client, {
        ...page,
        ownerId: owner.id,
      });
      pageRows.push({ ...row, ...page, ownerId: owner.id });
    }

    // Follow each newly created page by all newly inserted users
    for (const page of pageRows) {
      for (const user of insertedUsers) {
        await followPage(client, page.id, user.id);
      }
    }

    const pageBySlug = new Map(pageRows.map((p) => [p.slug, p]));

    const posts = [
      {
        userEmail: 'ananya.rao@nexus.com',
        content: 'Sunrise over misty hills today. Nature always resets the mind. #travel #sunrise #nexus',
        mediaType: 'image',
        mediaUrl: 'https://picsum.photos/seed/post-ananya-1/1200/800',
        feeling: 'Grateful',
      },
      {
        userEmail: 'rahul.nair@nexus.com',
        content: 'Shipped a new feature after a long refactor sprint. Clean code feels so satisfying. #devlife #buildinpublic',
        mediaType: 'image',
        mediaUrl: 'https://picsum.photos/seed/post-rahul-1/1200/800',
        feeling: 'Motivated',
      },
      {
        userEmail: 'karthik.reddy@nexus.com',
        content: 'Startup note: solve one real pain deeply before expanding. Focus is your unfair advantage. #startup #founder',
        mediaType: 'image',
        mediaUrl: 'https://picsum.photos/seed/post-karthik-1/1200/800',
        feeling: 'Focused',
      },
      {
        userEmail: 'zara.ali@nexus.com',
        content: 'Golden hour in the old city lanes. The light was perfect for portraits. #photography #street',
        mediaType: 'image',
        mediaUrl: 'https://picsum.photos/seed/post-zara-1/1200/800',
        feeling: 'Inspired',
      },
      {
        userEmail: 'manav.joshi@nexus.com',
        content: '40km cycling route done before breakfast. Small habits compound. #cycling #fitness',
        mediaType: 'image',
        mediaUrl: 'https://picsum.photos/seed/post-manav-1/1200/800',
        feeling: 'Energized',
      },
      {
        userEmail: 'ananya.rao@nexus.com',
        pageSlug: 'nexus-travel-diaries',
        content: 'Top 5 weekend getaways under 4 hours from the city. Saving this for your next trip! #travelguide #weekend',
        mediaType: 'image',
        mediaUrl: 'https://picsum.photos/seed/pagepost-travel-1/1200/800',
      },
      {
        userEmail: 'isha.malhotra@nexus.com',
        pageSlug: 'fit-fuel-daily',
        content: '15-minute full body no-equipment routine. Perfect for busy weekdays. #fitness #homeworkout',
        mediaType: 'image',
        mediaUrl: 'https://picsum.photos/seed/pagepost-fit-1/1200/800',
      },
      {
        userEmail: 'rahul.nair@nexus.com',
        pageSlug: 'code-build-lab',
        content: 'API performance checklist before production launch. Keep this in your deploy notes. #backend #engineering',
        mediaType: 'image',
        mediaUrl: 'https://picsum.photos/seed/pagepost-code-1/1200/800',
      },
      {
        userEmail: 'zara.ali@nexus.com',
        pageSlug: 'urban-lens-stories',
        content: 'Street portrait mini-series: colors, emotions, and everyday stories. #streetphoto #urbanlens',
        mediaType: 'image',
        mediaUrl: 'https://picsum.photos/seed/pagepost-lens-1/1200/800',
      },
      {
        userEmail: 'isha.malhotra@nexus.com',
        pageSlug: 'fit-fuel-daily',
        content: 'High-protein breakfast ideas that take under 10 minutes. #nutrition #healthyfood',
        mediaType: 'image',
        mediaUrl: 'https://picsum.photos/seed/pagepost-fit-2/1200/800',
      },
    ];

    let insertedPostCount = 0;
    let existingPostCount = 0;

    for (const post of posts) {
      const user = userByEmail.get(post.userEmail);
      if (!user) continue;
      const page = post.pageSlug ? pageBySlug.get(post.pageSlug) : null;

      const result = await insertPostIfMissing(client, {
        userId: user.id,
        pageId: page?.id || null,
        content: post.content,
        feeling: post.feeling || null,
        mediaType: post.mediaType,
        mediaUrl: post.mediaUrl,
      });

      if (result.inserted) insertedPostCount += 1;
      else existingPostCount += 1;
    }

    console.log('✅ Extra users/pages/posts seed complete');
    console.log(`Users upserted: ${insertedUsers.length}`);
    console.log(`Pages upserted: ${pageRows.length}`);
    console.log(`Posts inserted: ${insertedPostCount}`);
    console.log(`Posts already existing (skipped): ${existingPostCount}`);
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
