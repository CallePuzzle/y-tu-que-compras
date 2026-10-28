-- Última defensa de la regla «una cantidad es mayor que cero» (issue #107):
-- el schema zod ya no deja pasar nada por debajo de 0.001 ni nada que la
-- columna DECIMAL(10,3) vaya a redondear o desbordar, pero el CHECK lo
-- garantiza para TODO escritor (seed, scripts, un fallo futuro de validación).
-- En `purchaseItem` el snapshot copia la cantidad del item de origen: misma
-- regla. Los constraints son personalizados (Prisma no modela CHECKs) y viven
-- SOLO aquí: `prisma db push` no los respeta, el desarrollo con migraciones sí.
ALTER TABLE "item" ADD CONSTRAINT "item_quantity_positive" CHECK (quantity > 0);
ALTER TABLE "purchaseItem" ADD CONSTRAINT "purchase_item_quantity_positive" CHECK (quantity > 0);
