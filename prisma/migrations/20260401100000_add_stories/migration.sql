-- CreateEnum
CREATE TYPE "StoryMediaType" AS ENUM ('IMAGE', 'VIDEO', 'TEXT');

-- CreateTable
CREATE TABLE "Story" (
    "id" SERIAL NOT NULL,
    "userId" INTEGER NOT NULL,
    "mediaType" "StoryMediaType" NOT NULL DEFAULT 'TEXT',
    "mediaUrl" TEXT,
    "textContent" TEXT,
    "background" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Story_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StoryView" (
    "id" SERIAL NOT NULL,
    "storyId" INTEGER NOT NULL,
    "viewerId" INTEGER NOT NULL,
    "viewedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StoryView_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Story_expiresAt_idx" ON "Story"("expiresAt");

-- CreateIndex
CREATE INDEX "Story_userId_createdAt_idx" ON "Story"("userId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "StoryView_storyId_viewerId_key" ON "StoryView"("storyId", "viewerId");

-- CreateIndex
CREATE INDEX "StoryView_viewerId_viewedAt_idx" ON "StoryView"("viewerId", "viewedAt");

-- AddForeignKey
ALTER TABLE "Story" ADD CONSTRAINT "Story_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StoryView" ADD CONSTRAINT "StoryView_storyId_fkey" FOREIGN KEY ("storyId") REFERENCES "Story"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StoryView" ADD CONSTRAINT "StoryView_viewerId_fkey" FOREIGN KEY ("viewerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
