-- CreateTable
CREATE TABLE "purchaseRecord" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "listId" TEXT,
    "listName" TEXT NOT NULL,
    "total" DECIMAL(10,2) NOT NULL,
    "userId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "purchaseRecord_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "purchaseItem" (
    "id" TEXT NOT NULL,
    "purchaseRecordId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "quantity" DECIMAL(10,3) NOT NULL,
    "unit" "unit" NOT NULL,

    CONSTRAINT "purchaseItem_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "purchaseRecord_organizationId_idx" ON "purchaseRecord"("organizationId");

-- CreateIndex
CREATE INDEX "purchaseItem_purchaseRecordId_idx" ON "purchaseItem"("purchaseRecordId");

-- AddForeignKey
ALTER TABLE "purchaseRecord" ADD CONSTRAINT "purchaseRecord_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchaseRecord" ADD CONSTRAINT "purchaseRecord_listId_fkey" FOREIGN KEY ("listId") REFERENCES "list"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchaseRecord" ADD CONSTRAINT "purchaseRecord_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchaseItem" ADD CONSTRAINT "purchaseItem_purchaseRecordId_fkey" FOREIGN KEY ("purchaseRecordId") REFERENCES "purchaseRecord"("id") ON DELETE CASCADE ON UPDATE CASCADE;
