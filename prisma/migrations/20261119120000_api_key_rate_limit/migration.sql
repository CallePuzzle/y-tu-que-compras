-- Rate limit por clave de API (T5.1, issue #271): 60 peticiones por minuto en
-- vez del default del plugin apiKey (10 al día). Ver `src/lib/server/auth.ts`.

-- AlterTable
ALTER TABLE "apikey" ALTER COLUMN "rateLimitTimeWindow" SET DEFAULT 60000,
ALTER COLUMN "rateLimitMax" SET DEFAULT 60;

-- El plugin copia el límite a cada fila al crear la clave: las claves ya
-- creadas con el límite antiguo (10 al día) pasan al nuevo. Solo las que
-- conservan exactamente el antiguo; cualquier otro valor sería intencionado.
UPDATE "apikey"
SET "rateLimitTimeWindow" = 60000, "rateLimitMax" = 60, "requestCount" = 0
WHERE "rateLimitTimeWindow" = 86400000 AND "rateLimitMax" = 10;
