-- AlterTable
ALTER TABLE "Comment" ADD COLUMN     "isHidden" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "Post" ADD COLUMN     "isHidden" BOOLEAN NOT NULL DEFAULT false;
