-- Remap de datos de la issue #147: la paleta semántica daisyUI de 8 colores
-- pasa a la dedicada de 12 y el catálogo de iconos se reduce de 39 a 20.
-- Sin cambio de esquema: `List.color` e `icon` siguen siendo String, solo
-- cambian los valores válidos (los enums los define `LIST_COLORS` y
-- `LIST_ICONS` en `src/lib/schemas/list.ts`). Los UPDATE van por el valor
-- viejo, así que no colisionan entre sí (los nuevos no son valores viejos).

-- Colores: primary/warning -> amarillo del pan, secondary -> teal de sombras,
-- accent -> naranja tomate, neutral -> gris azulado, info -> cian,
-- success -> verde pera, error -> manzana.
UPDATE "list" SET "color" = 'yellow' WHERE "color" = 'primary';
UPDATE "list" SET "color" = 'yellow' WHERE "color" = 'warning';
UPDATE "list" SET "color" = 'teal' WHERE "color" = 'secondary';
UPDATE "list" SET "color" = 'orange' WHERE "color" = 'accent';
UPDATE "list" SET "color" = 'gray' WHERE "color" = 'neutral';
UPDATE "list" SET "color" = 'cyan' WHERE "color" = 'info';
UPDATE "list" SET "color" = 'green' WHERE "color" = 'success';
UPDATE "list" SET "color" = 'red' WHERE "color" = 'error';

-- Iconos: un conservado por cada retirado, el más cercano en temática.
UPDATE "list" SET "icon" = 'list-checks' WHERE "icon" IN ('clipboard-list', 'star');
UPDATE "list" SET "icon" = 'shopping-basket' WHERE "icon" IN ('shopping-cart', 'shopping-bag');
UPDATE "list" SET "icon" = 'gift' WHERE "icon" IN ('heart', 'sparkles', 'ticket');
UPDATE "list" SET "icon" = 'apple' WHERE "icon" = 'carrot';
UPDATE "list" SET "icon" = 'croissant' WHERE "icon" IN ('egg', 'milk');
UPDATE "list" SET "icon" = 'wine' WHERE "icon" IN ('beer', 'cup-soda');
UPDATE "list" SET "icon" = 'dog' WHERE "icon" = 'cat';
UPDATE "list" SET "icon" = 'flower-2' WHERE "icon" = 'leaf';
UPDATE "list" SET "icon" = 'wrench' WHERE "icon" IN ('paintbrush', 'hammer');
UPDATE "list" SET "icon" = 'smartphone' WHERE "icon" IN ('laptop', 'gamepad-2', 'music');
