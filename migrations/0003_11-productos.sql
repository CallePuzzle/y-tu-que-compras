-- CreateTable
CREATE TABLE "Grocery" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "homeId" INTEGER NOT NULL,
    CONSTRAINT "Grocery_homeId_fkey" FOREIGN KEY ("homeId") REFERENCES "Home" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Store" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "name" TEXT NOT NULL,
    "description" TEXT
);

-- CreateTable
CREATE TABLE "Price" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "price" REAL NOT NULL,
    "date" DATETIME NOT NULL,
    "grocery_id" INTEGER NOT NULL,
    "store_id" INTEGER NOT NULL,
    CONSTRAINT "Price_grocery_id_fkey" FOREIGN KEY ("grocery_id") REFERENCES "Grocery" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Price_store_id_fkey" FOREIGN KEY ("store_id") REFERENCES "Store" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
