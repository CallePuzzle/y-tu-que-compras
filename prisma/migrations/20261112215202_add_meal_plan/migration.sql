-- CreateEnum
CREATE TYPE "mealType" AS ENUM ('breakfast', 'lunch', 'dinner', 'other');

-- CreateTable
CREATE TABLE "mealPlan" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "mealType" "mealType" NOT NULL,
    "title" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "mealPlan_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "mealPlanIngredient" (
    "id" TEXT NOT NULL,
    "mealPlanId" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "quantity" DECIMAL(10,3) NOT NULL,
    "unit" "unit" NOT NULL,
    "pantryItemId" TEXT,
    "categoryId" TEXT,

    CONSTRAINT "mealPlanIngredient_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "mealPlan_organizationId_date_idx" ON "mealPlan"("organizationId", "date");

-- CreateIndex
CREATE UNIQUE INDEX "mealPlan_organizationId_date_mealType_key" ON "mealPlan"("organizationId", "date", "mealType");

-- CreateIndex
CREATE INDEX "mealPlanIngredient_mealPlanId_idx" ON "mealPlanIngredient"("mealPlanId");

-- CreateIndex
CREATE INDEX "mealPlanIngredient_pantryItemId_idx" ON "mealPlanIngredient"("pantryItemId");

-- CreateIndex
CREATE INDEX "mealPlanIngredient_categoryId_idx" ON "mealPlanIngredient"("categoryId");

-- AddForeignKey
ALTER TABLE "mealPlan" ADD CONSTRAINT "mealPlan_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "mealPlanIngredient" ADD CONSTRAINT "mealPlanIngredient_mealPlanId_fkey" FOREIGN KEY ("mealPlanId") REFERENCES "mealPlan"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "mealPlanIngredient" ADD CONSTRAINT "mealPlanIngredient_pantryItemId_fkey" FOREIGN KEY ("pantryItemId") REFERENCES "pantryItem"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "mealPlanIngredient" ADD CONSTRAINT "mealPlanIngredient_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "category"("id") ON DELETE SET NULL ON UPDATE CASCADE;
