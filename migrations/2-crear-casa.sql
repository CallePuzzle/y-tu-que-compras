-- CreateTable
CREATE TABLE "Home" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL
);

-- CreateTable
CREATE TABLE "_HomeToUser" (
    "A" INTEGER NOT NULL,
    "B" TEXT NOT NULL,
    CONSTRAINT "_HomeToUser_A_fkey" FOREIGN KEY ("A") REFERENCES "Home" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "_HomeToUser_B_fkey" FOREIGN KEY ("B") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "_HomeToUser_AB_unique" ON "_HomeToUser"("A", "B");

-- CreateIndex
CREATE INDEX "_HomeToUser_B_index" ON "_HomeToUser"("B");
