import { z } from 'zod/v4';

import { normalizeItemName } from '#lib/normalize-name.js';
import { itemSchema } from '#lib/schemas/item.js';
import prisma from '#lib/server/prisma.js';

// Bodies de los endpoints de items de la API pública /api/v1 (épica #260,
// tarea #268) y la resolución de su categoría.
//
// Los campos de un item son los MISMOS que valida el formulario web
// (`itemSchema`: nombre 1–100, cantidad > 0 con el contrato de la columna,
// unidad del enum `UNITS`), instanciados sin textos i18n: los mensajes son los
// de zod por defecto, en inglés como el resto de la API.
//
// La categoría es opcional (checklist #172) y se puede indicar de dos formas:
//
// - `categoryId`: el id, como hace el select de la UI (lo que devuelve el GET).
// - `category`: el NOMBRE, resuelto contra las categorías de la familia por
//   nombre canónico (`normalizeItemName`, el mismo del índice único de
//   categorías): «lácteos» o « LÁCTEOS » encuentran «Lácteos». La API no expone
//   las categorías (fuera de alcance de la épica), así que el nombre es lo que
//   una integración conoce.
//
// Mismo trato que la UI con un id rancio: una categoría que no es de la
// familia (id ajeno, nombre desconocido) se guarda como «sin categoría», sin
// error. `null` o `''` en cualquiera de las dos quita la categoría.

const ONE_CATEGORY_MESSAGE = 'Use either categoryId or category, not both';

/** `categoryId` y `category` del body: opcionales y anulables (`null` = sin categoría). */
const categoryFields = {
	categoryId: z.string().nullish(),
	category: z.string().trim().max(100).nullish()
};

/** ¿Trae el body un valor «con contenido» en este campo de categoría? */
function hasValue(value: string | null | undefined): boolean {
	return typeof value === 'string' && value !== '';
}

/** Rechaza que viajen a la vez `categoryId` y `category` con valor (ambiguo). */
function oneCategory(data: { categoryId?: string | null; category?: string | null }): boolean {
	return !(hasValue(data.categoryId) && hasValue(data.category));
}

/** Body del POST de items: los campos del formulario web + la categoría por id o nombre. */
export function apiItemCreateSchema() {
	return itemSchema()
		.omit({ categoryId: true })
		.extend(categoryFields)
		.refine(oneCategory, { message: ONE_CATEGORY_MESSAGE });
}

/**
 * Body del PATCH de items: todos los campos opcionales (actualización
 * parcial), más el booleano `purchased` (el toggle de comprado de la UI) y el
 * `order` (posición en la lista, entero ≥ 0). Al menos un campo: un PATCH
 * vacío es casi seguro un error del cliente.
 */
export function apiItemPatchSchema() {
	return itemSchema()
		.omit({ categoryId: true })
		.partial()
		.extend({
			...categoryFields,
			purchased: z.boolean().optional(),
			order: z.number().int().min(0).max(2_147_483_647).optional()
		})
		.refine(oneCategory, { message: ONE_CATEGORY_MESSAGE })
		.refine((data) => Object.values(data).some((value) => value !== undefined), {
			message: 'At least one field is required'
		});
}

export type ApiItemCreate = z.infer<ReturnType<typeof apiItemCreateSchema>>;
export type ApiItemPatch = z.infer<ReturnType<typeof apiItemPatchSchema>>;

/**
 * ¿Trae el body alguna indicación de categoría (aunque sea para quitarla)?
 * En el PATCH, su ausencia conserva la categoría actual.
 */
export function mentionsCategory(data: {
	categoryId?: string | null;
	category?: string | null;
}): boolean {
	return data.categoryId !== undefined || data.category !== undefined;
}

/**
 * El id de categoría a pasar a `createItem`/`updateItem` (`undefined` = sin
 * categoría). Un `categoryId` se pasa tal cual: `items.ts` ya lo valida
 * contra la familia (`resolveCategoryId`). Un nombre se busca por canónico en
 * las categorías de la familia; si no hay ninguna, sin categoría.
 */
export async function resolveApiCategoryId(
	familyId: string,
	data: { categoryId?: string | null; category?: string | null }
): Promise<string | undefined> {
	if (hasValue(data.categoryId)) {
		return data.categoryId ?? undefined;
	}
	if (!hasValue(data.category)) {
		return undefined;
	}
	const normalizedName = normalizeItemName(data.category ?? '');
	if (!normalizedName) {
		return undefined;
	}
	const category = await prisma.category.findUnique({
		where: { organizationId_normalizedName: { organizationId: familyId, normalizedName } },
		select: { id: true }
	});
	return category?.id;
}
