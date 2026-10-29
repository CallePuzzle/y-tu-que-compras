-- Orden manual de la despensa (issue #134, drag-to-swap con Swapy).
--
-- La despensa se listaba alfabética (`orderBy name` en `listPantryItems`);
-- para poder reordenarla necesita su propia columna de orden, como
-- `Item.order` en las listas. El backfill numera alfabéticamente por familia
-- con `ROW_NUMBER` — la misma ordenación que aplicaba la consulta hasta
-- ahora, así que el orden INICIAL de la vista no cambia — y la columna
-- queda NOT NULL sin default: los nuevos productos entran por el final
-- (max + 1 en el upsert de `purchases.ts`), nunca «sin decir dónde».
ALTER TABLE "pantryItem" ADD COLUMN "order" INTEGER NOT NULL DEFAULT 0;
WITH orden AS (
    SELECT "id", ROW_NUMBER() OVER (PARTITION BY "organizationId" ORDER BY name) AS rn
    FROM "pantryItem"
)
UPDATE "pantryItem" SET "order" = orden.rn FROM orden WHERE "pantryItem"."id" = orden."id";
ALTER TABLE "pantryItem" ALTER COLUMN "order" DROP DEFAULT;
