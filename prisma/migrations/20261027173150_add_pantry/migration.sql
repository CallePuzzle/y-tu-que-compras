-- CreateTable
CREATE TABLE "pantryItem" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "normalizedName" TEXT NOT NULL,
    "quantity" DECIMAL(10,3) NOT NULL,
    "unit" "unit" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "pantryItem_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "pantryItem_organizationId_normalizedName_unit_key" ON "pantryItem"("organizationId", "normalizedName", "unit");

-- AddForeignKey
ALTER TABLE "pantryItem" ADD CONSTRAINT "pantryItem_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
