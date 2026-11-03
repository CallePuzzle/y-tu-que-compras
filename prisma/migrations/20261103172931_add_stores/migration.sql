-- AlterTable
ALTER TABLE "purchaseRecord" ADD COLUMN     "storeId" TEXT,
ADD COLUMN     "storeName" TEXT;

-- CreateTable
CREATE TABLE "store" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "normalizedName" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "store_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "store_organizationId_normalizedName_key" ON "store"("organizationId", "normalizedName");

-- AddForeignKey
ALTER TABLE "store" ADD CONSTRAINT "store_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchaseRecord" ADD CONSTRAINT "purchaseRecord_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "store"("id") ON DELETE SET NULL ON UPDATE CASCADE;
