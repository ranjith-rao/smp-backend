/*
  Warnings:

  - You are about to drop the `PageAdmin` table. If the table is not empty, all the data it contains will be lost.

*/
-- DropForeignKey
ALTER TABLE "PageAdmin" DROP CONSTRAINT "PageAdmin_pageId_fkey";

-- DropForeignKey
ALTER TABLE "PageAdmin" DROP CONSTRAINT "PageAdmin_userId_fkey";

-- AlterTable
ALTER TABLE "Conversation" ADD COLUMN     "groupName" TEXT,
ADD COLUMN     "profileImageUrl" TEXT;

-- DropTable
DROP TABLE "PageAdmin";
