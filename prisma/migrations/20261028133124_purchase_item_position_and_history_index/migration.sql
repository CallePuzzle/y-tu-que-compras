-- Historial ordenado y con índice propio (issue #109).

-- `position` congela el orden de cada item del snapshot EN LA LISTA al
-- comprar: el detalle del historial lee por él y sale siempre igual, sin
-- depender del orden físico de inserción (que Postgres no promete). Los
-- snapshots previos al campo se rellenan por su orden de inserción (el `id`
-- es lo mejor que hay de aquella época) y se les asigna una vez por siempre:
-- el snapshot es inmutable.
ALTER TABLE "purchaseItem" ADD COLUMN "position" INTEGER NOT NULL DEFAULT 0;
WITH orden AS (
    SELECT "id", ROW_NUMBER() OVER (PARTITION BY "purchaseRecordId" ORDER BY "id") - 1 AS rn
    FROM "purchaseItem"
)
UPDATE "purchaseItem" SET "position" = orden.rn FROM orden WHERE "purchaseItem"."id" = orden."id";
ALTER TABLE "purchaseItem" ALTER COLUMN "position" DROP DEFAULT;

-- El listado del historial ordena por (createdAt DESC, id DESC) filtrando por
-- familia: el índice de solo `organizationId` no le servía de nada.
DROP INDEX "purchaseRecord_organizationId_idx";
CREATE INDEX "purchaseRecord_organizationId_createdAt_id_idx" ON "purchaseRecord"("organizationId", "createdAt" DESC, "id");
