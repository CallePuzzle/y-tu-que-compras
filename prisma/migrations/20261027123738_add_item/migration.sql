-- CreateEnum
CREATE TYPE "unit" AS ENUM ('unit', 'kilogram', 'gram', 'liter', 'milliliter', 'package', 'can', 'dozen');

-- CreateTable
CREATE TABLE "item" (
    "id" TEXT NOT NULL,
    "listId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "quantity" DECIMAL(10,3) NOT NULL,
    "unit" "unit" NOT NULL,
    "purchased" BOOLEAN NOT NULL DEFAULT false,
    "order" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "item_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "item_listId_idx" ON "item"("listId");

-- AddForeignKey
ALTER TABLE "item" ADD CONSTRAINT "item_listId_fkey" FOREIGN KEY ("listId") REFERENCES "list"("id") ON DELETE CASCADE ON UPDATE CASCADE;
