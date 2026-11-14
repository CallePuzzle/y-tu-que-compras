import { Prisma } from '#lib/generated/prisma/client.js';
import { normalizeItemName } from '#lib/normalize-name.js';
import type { Unit } from '#lib/schemas/item.js';
import prisma from '#lib/server/prisma.js';

// CRUD de recetas de la familia (épica #232, tarea #238). La familia viaja
// SIEMPRE en los argumentos — es la activa que `requireActiveFamily` dejó
// verificada en el load/acción — y entra en todos los `where` a través de
// `organizationId`: una receta de otra familia es como si no existiera, como
// en `mealplans.ts` y `categories.ts`. Son escritura para cualquier miembro
// (issue #111): sin checks de rol.
//
// A diferencia del menú, guardar una receta NO toca la despensa: aquí no hay
// `ensurePantryProducts`. El ingrediente lleva su producto SNAPSHOTADO (nombre,
// cantidad y unidad, el mismo patrón del historial de compras) y `pantryItemId`
// es solo un ENLACE opcional a un producto que YA exista: se guarda el id tal
// cual si el producto es de la familia y queda en `null` si no (ajeno o rancio,
// el mismo trato que la categoría). Vincular productos NUEVOS a la despensa es
// cosa del alta de menús, nunca del CRUD de recetas: una receta es un libro de
// cocina, no una compra.

/** Un ingrediente de la receta tal y como llega del formulario, ya validado por `recipeSchema` (#lib/schemas/recipe.ts). */
export interface RecipeIngredientData {
	name: string;
	/** `number` en el formulario; la base lo guarda con la precisión de `DECIMAL(10,3)`. */
	quantity: number;
	/** Valor del enum `Unit` (identificador inglés); la UI lo traduce con `unit_*`. */
	unit: Unit;
	/** Id de UNA categoría de la familia; un id ajeno o rancio se guarda como «sin categoría». */
	categoryId?: string;
	/** Id de UN producto de despensa de la familia; un id ajeno o rancio se guarda como «sin enlace». */
	pantryItemId?: string;
}

/** Una receta tal y como llega del formulario, ya validada por `recipeSchema` (#lib/schemas/recipe.ts). */
export interface RecipeData {
	name: string;
	/** Raciones que rinde la receta; ausente significa que no lo declara (columna nullable). */
	servings?: number;
	ingredients: RecipeIngredientData[];
}

/** Un ingrediente tal y como la vista de receta lo muestra. */
export interface RecipeIngredientView {
	id: string;
	name: string;
	/** `Decimal(10,3)` en la base; la vista lo lee como `number`. */
	quantity: number;
	unit: Unit;
	/** Categoría del ingrediente; `null` si no lleva o su categoría se borró después (SetNull). */
	categoryId: string | null;
	/** Nombre visible de esa categoría, para pintar el chip sin otra consulta. */
	categoryName: string | null;
	/** El producto de despensa enlazado al guardar; `null` si no llevaba o se borró después (SetNull). */
	pantryItemId: string | null;
}

/** Una receta tal y como la vista la muestra. */
export interface RecipeView {
	id: string;
	name: string;
	/** Raciones que rinde; `null` si la receta no lo declara. */
	servings: number | null;
	/** Los ingredientes en su `position`, el orden en que el usuario los puso. */
	ingredients: RecipeIngredientView[];
}

/** Otra receta de la familia ya usa ese nombre (tras normalizar). */
export class RecipeExistsError extends Error {
	constructor() {
		super('Recipe name already exists in this family');
		this.name = 'RecipeExistsError';
	}
}

const RECIPE_SELECT = {
	id: true,
	name: true,
	servings: true,
	ingredients: {
		orderBy: { position: 'asc' },
		select: {
			id: true,
			name: true,
			quantity: true,
			unit: true,
			categoryId: true,
			category: { select: { name: true } },
			pantryItemId: true
		}
	}
} satisfies Prisma.RecipeSelect;

/**
 * ¿Es el P2002 de Postgres? En las transacciones de este módulo el único
 * índice único que puede saltar es el (familia, nombre normalizado) de la
 * receta — los ingredientes no llevan único —, así que el código basta para
 * traducirlo al error de dominio que la acción convertirá en el mensaje
 * genérico de la UI, sin filtrar el error crudo de Prisma.
 */
function isUniqueViolation(error: unknown): boolean {
	return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';
}

/**
 * Resuelve la categoría del ingrediente: el id de UNA categoría de la
 * familia, o `null` si no viaja o ya no está en ella — un id ajeno o rancio
 * se guarda como «sin categoría» (el mismo efecto que el `SetNull` del
 * borrado) y sin 500 por violar la FK. Mismo trato que `resolveCategoryId`
 * de `items.ts` y `mealplans.ts`.
 */
async function resolveCategoryId(
	db: Prisma.TransactionClient,
	familyId: string,
	categoryId: string | undefined
): Promise<string | null> {
	if (!categoryId) {
		return null;
	}
	const category = await db.category.findFirst({
		where: { id: categoryId, organizationId: familyId },
		select: { id: true }
	});
	return category?.id ?? null;
}

/**
 * Resuelve el enlace al producto de despensa: el id de UN producto de la
 * familia, o `null` si no viaja o no es de ella — un id ajeno o rancio se
 * guarda «sin enlace» (el mismo efecto que el `SetNull` del borrado) y sin
 * 500 por violar la FK. AQUÍ no se crea nada: garantizar el producto es cosa
 * del alta de menús (`ensurePantryProducts`), nunca de las recetas.
 */
async function resolvePantryItemId(
	db: Prisma.TransactionClient,
	familyId: string,
	pantryItemId: string | undefined
): Promise<string | null> {
	if (!pantryItemId) {
		return null;
	}
	const product = await db.pantryItem.findFirst({
		where: { id: pantryItemId, organizationId: familyId },
		select: { id: true }
	});
	return product?.id ?? null;
}

/**
 * Prepara los ingredientes del formulario para la escritura, DENTRO de la
 * transacción que autoriza la receta: la categoría y el producto de despensa
 * de cada uno contra la familia (ver `resolveCategoryId` y
 * `resolvePantryItemId`), con la `position` del servidor — el orden del
 * formulario, desde 0, sin default en el schema: «nadie inserta sin decir
 * dónde», como el `order` de Item y el `position` de PurchaseItem.
 */
async function prepareIngredients(
	db: Prisma.TransactionClient,
	familyId: string,
	ingredients: RecipeIngredientData[]
): Promise<
	Array<{
		position: number;
		name: string;
		quantity: number;
		unit: Unit;
		categoryId: string | null;
		pantryItemId: string | null;
	}>
> {
	const resolved = [];
	for (const ingredient of ingredients) {
		resolved.push({
			name: ingredient.name,
			quantity: ingredient.quantity,
			unit: ingredient.unit,
			categoryId: await resolveCategoryId(db, familyId, ingredient.categoryId),
			pantryItemId: await resolvePantryItemId(db, familyId, ingredient.pantryItemId)
		});
	}
	return resolved.map((ingredient, position) => ({ position, ...ingredient }));
}

/** De la fila de Prisma a la vista: los Decimals se aplanan a `number`. */
function toRecipeView(row: {
	id: string;
	name: string;
	servings: number | null;
	ingredients: Array<{
		id: string;
		name: string;
		quantity: unknown;
		unit: Unit;
		categoryId: string | null;
		category: { name: string } | null;
		pantryItemId: string | null;
	}>;
}): RecipeView {
	return {
		id: row.id,
		name: row.name,
		servings: row.servings,
		ingredients: row.ingredients.map((ingredient) => ({
			id: ingredient.id,
			name: ingredient.name,
			quantity: Number(ingredient.quantity),
			unit: ingredient.unit,
			categoryId: ingredient.categoryId,
			categoryName: ingredient.category?.name ?? null,
			pantryItemId: ingredient.pantryItemId
		}))
	};
}

/**
 * Crea una receta de la familia con sus ingredientes. El único (familia,
 * nombre normalizado) se aplica en la base: si otra receta de la familia ya
 * usa el nombre — «Tortilla de patatas», «tortilla de patatas» o cualquier
 * variante que `normalizeItemName` haga canónicamente igual — el INSERT muere
 * en P2002 y sale como `RecipeExistsError` — a prueba de carrera, sin ventana
 * entre un check previo y el write, como en categorías y establecimientos —,
 * para que la acción lo traduzca al mensaje genérico de la UI.
 */
export async function createRecipe(familyId: string, data: RecipeData): Promise<RecipeView> {
	try {
		return await prisma.$transaction(async (tx) => {
			const ingredients = await prepareIngredients(tx, familyId, data.ingredients);
			const row = await tx.recipe.create({
				data: {
					organizationId: familyId,
					name: data.name,
					// El canónico del duplicado: el mismo `normalizeItemName` de la
					// despensa, para que «Tortilla» y «TORTILLA» choquen igual que
					// dos productos de despensa.
					normalizedName: normalizeItemName(data.name),
					servings: data.servings ?? null,
					ingredients: { create: ingredients }
				},
				select: RECIPE_SELECT
			});
			return toRecipeView(row);
		});
	} catch (error) {
		if (isUniqueViolation(error)) {
			throw new RecipeExistsError();
		}
		throw error;
	}
}

/**
 * Edita una receta de la familia: su nombre, sus raciones y SUS INGREDIENTES
 * ENTERA — fuera los que había, dentro los que llegan con su `position`
 * recalculada desde 0, como `updateMealPlan` sustituye los del menú. `false`
 * si no hay receta con ese id EN ESA FAMILIA (id rancio o ajeno): la
 * pertenencia se verifica dentro de la transacción, sin posibilidad de tocar
 * una receta ajena por un id rancio.
 *
 * La receta va PRIMERO y CON LOCK (patrón `updateMealPlan`): la edición
 * reemplaza los ingredientes con un borra-y-crea, y dos ediciones concurrentes
 * de la misma receta sin serializar se pisarían — la que llega segunda no
 * vería las filas SIN COMMIT de la primera y sus ingredientes nuevos
 * convivirían con los de la otra. Con el lock, la segunda espera al COMMIT y
 * sustituye EXACTAMENTE lo que hay.
 *
 * Renombrar a un nombre que ya ocupa OTRA receta de la familia muere en el
 * único (familia, nombre normalizado) y sale como `RecipeExistsError`, como
 * el alta; editar sin cambiar el nombre no choca consigo mismo (Postgres
 * ignora el update que no cambia los valores de la fila). El rechazo no deja
 * nada a medias: la transacción revierte nombre e ingredientes.
 */
export async function updateRecipe(
	familyId: string,
	id: string,
	data: RecipeData
): Promise<boolean> {
	try {
		return await prisma.$transaction(async (tx) => {
			const locked = await tx.$queryRaw<Array<{ id: string }>>`
				SELECT "id"
				FROM "recipe"
				WHERE "id" = ${id} AND "organizationId" = ${familyId}
				FOR UPDATE
			`;
			if (locked.length === 0) {
				return false;
			}

			const ingredients = await prepareIngredients(tx, familyId, data.ingredients);
			await tx.recipeIngredient.deleteMany({ where: { recipeId: id } });
			await tx.recipe.update({
				where: { id },
				data: {
					name: data.name,
					normalizedName: normalizeItemName(data.name),
					servings: data.servings ?? null,
					ingredients: { create: ingredients }
				},
				select: { id: true }
			});
			return true;
		});
	} catch (error) {
		if (isUniqueViolation(error)) {
			throw new RecipeExistsError();
		}
		throw error;
	}
}

/**
 * Borra una receta de la familia con sus ingredientes (FK en cascada);
 * `false` si ya no estaba (doble envío) o era de otra familia. La despensa NO
 * se toca y los menús que nacieron de ella tampoco: su FK es `SetNull` — el
 * menú vive solo de su snapshot (título e ingredientes) y se queda con
 * `recipeId` en null, sin propagación.
 */
export async function deleteRecipe(familyId: string, id: string): Promise<boolean> {
	const result = await prisma.recipe.deleteMany({
		where: { id, organizationId: familyId }
	});
	return result.count > 0;
}

/**
 * Las recetas de la familia, en orden alfabético por su nombre VISIBLE — el
 * que escribió el usuario, no el canónico de búsqueda — para el listado de la
 * vista. Postgres decide el alfabeto con su collation y el orden de filas no
 * es estable, así que la antigüedad (y el id) desempatan, como en el
 * calendario. Los ingredientes llegan en su `position`.
 */
export async function listRecipes(familyId: string): Promise<RecipeView[]> {
	const rows = await prisma.recipe.findMany({
		where: { organizationId: familyId },
		orderBy: [{ name: 'asc' }, { createdAt: 'asc' }, { id: 'asc' }],
		select: RECIPE_SELECT
	});
	return rows.map(toRecipeView);
}
