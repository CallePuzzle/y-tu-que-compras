-- AlterTable
ALTER TABLE "item" ADD COLUMN     "categoryId" TEXT;

-- AlterTable
ALTER TABLE "pantryItem" ADD COLUMN     "categoryId" TEXT;

-- AlterTable
ALTER TABLE "purchaseItem" ADD COLUMN     "categoryId" TEXT,
ADD COLUMN     "categoryName" TEXT;

-- CreateTable
CREATE TABLE "category" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "normalizedName" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "category_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "category_organizationId_normalizedName_key" ON "category"("organizationId", "normalizedName");

-- CreateIndex
CREATE INDEX "item_categoryId_idx" ON "item"("categoryId");

-- CreateIndex
CREATE INDEX "pantryItem_categoryId_idx" ON "pantryItem"("categoryId");

-- CreateIndex
CREATE INDEX "purchaseItem_categoryId_idx" ON "purchaseItem"("categoryId");

-- AddForeignKey
ALTER TABLE "category" ADD CONSTRAINT "category_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "item" ADD CONSTRAINT "item_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "category"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchaseItem" ADD CONSTRAINT "purchaseItem_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "category"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pantryItem" ADD CONSTRAINT "pantryItem_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "category"("id") ON DELETE SET NULL ON UPDATE CASCADE;
