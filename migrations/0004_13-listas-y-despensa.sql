-- CreateTable
CREATE TABLE "List" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "name" TEXT NOT NULL,
    "completed" BOOLEAN NOT NULL DEFAULT false
);

-- CreateTable
CREATE TABLE "GroceryList" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "quantity" INTEGER NOT NULL DEFAULT 1,
    "completed" BOOLEAN NOT NULL DEFAULT false,
    "groceryId" INTEGER NOT NULL,
    "listId" INTEGER NOT NULL,
    CONSTRAINT "GroceryList_groceryId_fkey" FOREIGN KEY ("groceryId") REFERENCES "Grocery" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "GroceryList_listId_fkey" FOREIGN KEY ("listId") REFERENCES "List" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
