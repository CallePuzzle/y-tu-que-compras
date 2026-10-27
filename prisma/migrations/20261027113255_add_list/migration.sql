-- CreateTable
CREATE TABLE "list" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "color" TEXT NOT NULL,
    "icon" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "list_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "list_organizationId_idx" ON "list"("organizationId");

-- AddForeignKey
ALTER TABLE "list" ADD CONSTRAINT "list_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
