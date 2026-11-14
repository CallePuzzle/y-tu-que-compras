-- AlterTable
ALTER TABLE "mealPlan" ADD COLUMN     "recipeId" TEXT;

-- CreateTable
CREATE TABLE "recipe" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "normalizedName" TEXT NOT NULL,
    "servings" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "recipe_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "recipeIngredient" (
    "id" TEXT NOT NULL,
    "recipeId" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "quantity" DECIMAL(10,3) NOT NULL,
    "unit" "unit" NOT NULL,
    "pantryItemId" TEXT,
    "categoryId" TEXT,

    CONSTRAINT "recipeIngredient_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "recipe_organizationId_normalizedName_key" ON "recipe"("organizationId", "normalizedName");

-- CreateIndex
CREATE INDEX "recipeIngredient_recipeId_idx" ON "recipeIngredient"("recipeId");

-- CreateIndex
CREATE INDEX "recipeIngredient_pantryItemId_idx" ON "recipeIngredient"("pantryItemId");

-- CreateIndex
CREATE INDEX "recipeIngredient_categoryId_idx" ON "recipeIngredient"("categoryId");

-- AddForeignKey
ALTER TABLE "mealPlan" ADD CONSTRAINT "mealPlan_recipeId_fkey" FOREIGN KEY ("recipeId") REFERENCES "recipe"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recipe" ADD CONSTRAINT "recipe_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recipeIngredient" ADD CONSTRAINT "recipeIngredient_recipeId_fkey" FOREIGN KEY ("recipeId") REFERENCES "recipe"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recipeIngredient" ADD CONSTRAINT "recipeIngredient_pantryItemId_fkey" FOREIGN KEY ("pantryItemId") REFERENCES "pantryItem"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recipeIngredient" ADD CONSTRAINT "recipeIngredient_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "category"("id") ON DELETE SET NULL ON UPDATE CASCADE;
