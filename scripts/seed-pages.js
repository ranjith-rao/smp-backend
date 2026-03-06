const { Client } = require('pg');
require('dotenv').config();

async function seedPages() {
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();

  try {
    // Get user IDs (excluding admin)
    const usersResult = await client.query(
      'SELECT id FROM "User" WHERE role = $1 ORDER BY id LIMIT 5',
      ['USER']
    );
    const userIds = usersResult.rows.map(row => row.id);

    if (userIds.length === 0) {
      console.log('❌ No users found. Please seed users first.');
      await client.end();
      return;
    }

    // Create pages
    const pages = [
      {
        name: 'Tech Innovations Daily',
        slug: 'tech-innovations',
        description: 'Stay updated with the latest technology trends, innovations, and breakthroughs. From AI to blockchain, we cover it all.',
        category: 'TECHNOLOGY',
        ownerId: userIds[0],
      },
      {
        name: 'Travel & Adventure',
        slug: 'travel-adventure',
        description: 'Explore the world with us! Share travel tips, destination guides, and adventure stories from every corner of the globe.',
        category: 'TRAVEL',
        ownerId: userIds[1],
      },
      {
        name: 'Fitness & Wellness',
        slug: 'fitness-wellness',
        description: 'Your journey to a healthier lifestyle starts here. Get workout tips, nutrition advice, and wellness inspiration.',
        category: 'HEALTH',
        ownerId: userIds[2],
      },
      {
        name: 'Creative Arts Hub',
        slug: 'creative-arts',
        description: 'Celebrating creativity in all forms. Digital art, painting, photography, sculpture, and more. Inspire and be inspired.',
        category: 'ARTS',
        ownerId: userIds[3],
      },
      {
        name: 'Food & Cooking',
        slug: 'food-cooking',
        description: 'Recipes, cooking tips, food reviews, and culinary adventures. From home cooking to restaurant recommendations.',
        category: 'FOOD',
        ownerId: userIds[4],
      },
    ];

    const pageInsertQuery = `
      INSERT INTO "Page" (name, slug, description, category, "ownerId", "createdAt", "updatedAt")
      VALUES ($1, $2, $3, $4, $5, NOW(), NOW())
      ON CONFLICT (name) DO NOTHING
      RETURNING id, name
    `;

    const createdPages = [];
    for (const page of pages) {
      const result = await client.query(pageInsertQuery, [
        page.name,
        page.slug,
        page.description,
        page.category,
        page.ownerId,
      ]);
      if (result.rows.length > 0) {
        createdPages.push(result.rows[0]);
        console.log(`✅ Created page: ${result.rows[0].name} (ID: ${result.rows[0].id})`);
      } else {
        // Page already exists, fetch it
        const existingPage = await client.query(
          'SELECT id, name FROM "Page" WHERE name = $1',
          [page.name]
        );
        if (existingPage.rows.length > 0) {
          createdPages.push(existingPage.rows[0]);
          console.log(`ℹ️ Page already exists: ${existingPage.rows[0].name} (ID: ${existingPage.rows[0].id})`);
        }
      }
    }

    // Create page posts
    const pagePosts = [
      {
        pageId: createdPages[0].id,
        userId: userIds[0],
        content: '🚀 Artificial Intelligence is reshaping industries at an unprecedented pace. From healthcare to finance, AI is the future.',
      },
      {
        pageId: createdPages[0].id,
        userId: userIds[0],
        content: '⚡ Quantum computing breakthrough: Scientists achieve quantum advantage in solving complex problems faster than ever before!',
      },
      {
        pageId: createdPages[0].id,
        userId: userIds[0],
        content: '🔐 Blockchain and Web3 are revolutionizing how we think about data ownership and digital privacy.',
      },
      {
        pageId: createdPages[1].id,
        userId: userIds[1],
        content: '🏔️ Just returned from hiking the most scenic mountain range! Nature at its finest. Who else loves mountain adventures?',
      },
      {
        pageId: createdPages[1].id,
        userId: userIds[1],
        content: '🌴 Tropical paradise awaits! Discover hidden beaches and crystal clear waters in Southeast Asia.',
      },
      {
        pageId: createdPages[1].id,
        userId: userIds[1],
        content: '✈️ Travel tip: Always book flights on Tuesday for the best deals. Share your travel hacks!',
      },
      {
        pageId: createdPages[2].id,
        userId: userIds[2],
        content: '💪 Morning workout complete! 30 minutes of cardio + strength training. Consistency is key to achieving fitness goals.',
      },
      {
        pageId: createdPages[2].id,
        userId: userIds[2],
        content: '🥗 Nutrition matters! Start your day with a protein-rich breakfast to fuel your body and mind.',
      },
      {
        pageId: createdPages[2].id,
        userId: userIds[2],
        content: '🧘 Mental wellness is just as important as physical fitness. Practice mindfulness and meditation daily.',
      },
      {
        pageId: createdPages[3].id,
        userId: userIds[3],
        content: '🎨 Digital art creation process: Started with a sketch, added colors, and brought imagination to life!',
      },
      {
        pageId: createdPages[3].id,
        userId: userIds[3],
        content: '📸 Photography is about capturing moments and telling stories through visual art. Share your best shots!',
      },
      {
        pageId: createdPages[3].id,
        userId: userIds[3],
        content: '🖼️ Art has the power to inspire, comfort, and transform. What\'s your favorite art form?',
      },
      {
        pageId: createdPages[4].id,
        userId: userIds[4],
        content: '🍝 Homemade pasta is so much better than store-bought! Recipe: fresh eggs, flour, and patience.',
      },
      {
        pageId: createdPages[4].id,
        userId: userIds[4],
        content: '☕ The perfect coffee ratio: 1 part coffee, 2 parts water, endless possibilities. Share your coffee recipe!',
      },
      {
        pageId: createdPages[4].id,
        userId: userIds[4],
        content: '🍰 Baking science: Understanding how ingredients interact is the secret to perfect desserts every time.',
      },
    ];

    const postInsertQuery = `
      INSERT INTO "Post" (content, "pageId", "userId", "createdAt")
      VALUES ($1, $2, $3, NOW())
      RETURNING id, content
    `;

    let postCount = 0;
    for (const post of pagePosts) {
      const result = await client.query(postInsertQuery, [post.content, post.pageId, post.userId]);
      postCount++;
    }

    console.log(`✅ Created ${postCount} page posts`);

    // Add some followers to pages
    const followersQuery = `
      INSERT INTO "PageFollower" ("pageId", "userId", "createdAt")
      VALUES ($1, $2, NOW())
      ON CONFLICT DO NOTHING
    `;

    let followerCount = 0;
    for (let i = 0; i < createdPages.length; i++) {
      const pageId = createdPages[i].id;
      // Add followers from other users
      for (let j = 0; j < userIds.length; j++) {
        if (userIds[j] !== userIds[i]) {
          await client.query(followersQuery, [pageId, userIds[j]]);
          followerCount++;
        }
      }
    }

    console.log(`✅ Added ${followerCount} page followers`);
    console.log('\n✨ Pages seeding completed successfully!');

  } catch (error) {
    console.error('❌ Error seeding pages:', error.message);
  } finally {
    await client.end();
  }
}

seedPages();
