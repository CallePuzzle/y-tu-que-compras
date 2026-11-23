import { dayPantryStatus } from '#lib/pantry-status.js';
import { normalizeItemName } from '#lib/normalize-name.js';
import type { Unit } from '#lib/schemas/item.js';
import { Prisma } from '#lib/generated/prisma/client.js';
import prisma from '#lib/server/prisma.js';
import { dateOfDayKey } from '#lib/server/mealplans.js';

// Volcado a la lista de la compra desde el detalle del día (épica #236, tarea
// #245) y desde el detalle de receta (issue #290): lo que falta — para UN día,
// UN ingrediente o UNA receta — entra en la lista que elija el usuario. El
// patrón es el de `readdPantryItem` (issues #108 y #149): la lista se bloquea
// PRIMERO (`FOR UPDATE`) para serializar volcados concurrentes — dos miembros
// que pulsan a la vez acaban en UN item con la suma, nunca duplicados — y el
// equivalente pendiente se busca por nombre normalizado + unidad con
// `purchased: false` en el `where`.
//
// Lo que falta NO lo dice el cliente: se recalcula SIEMPRE aquí, dentro de la
// transacción, con `dayPantryStatus` (el cálculo puro de la #244) sobre los
// menús —o los ingredientes de la receta— reales y la despensa real de la
// familia. El item nuevo hereda nombre visible y categoría del producto de
// despensa (misma unidad por contrato); nace pendiente y al final de la lista.
//
// Día y receta comparten UN SOLO tronco de escritura (bloqueo, líneas,
// buscar-equivalente-o-crear): solo cambia de dónde salen los ingredientes —
// los menús de una fecha o la receta indicada —, y el déficit se agrega por
// producto igual en ambos (`dayPantryStatus` suma la necesidad por producto
// antes de compararla, venga de una comida o de otra o de dos filas de la
// misma receta).

/** Lo que la vista pide para un volcado del día (#245): nada de cantidades. */
export interface DumpData {
	/** El día del calendario como clave `YYYY-MM-DD`. */
	date: string;
	/** La lista de destino: una de las de la familia. */
	listId: string;
	/** Volcado individual: el ingrediente pulsado. Ausente = el día entero. */
	ingredientId?: string;
}

/** Lo que la vista pide para un volcado de receta (issue #290): nada de cantidades. */
export interface RecipeDumpData {
	/** La receta del listado cuyo detalle está abierto. */
	recipeId: string;
	/** La lista de destino: una de las de la familia. */
	listId: string;
	/** Volcado individual: el ingrediente pulsado. Ausente = la receta entera. */
	ingredientId?: string;
}

/** Lo que entró en la lista: la confirmación de la vista lo lista. */
export interface DumpedItem {
	name: string;
	/** `Decimal(10,3)` en la base, aplanado a `number` para el mensaje. */
	quantity: number;
	/** Valor del enum `Unit`; la UI lo traduce con `unit_*`. */
	unit: Unit;
}

/** Cómo acabó un volcado del día (#245). */
export type DumpResult =
	/** Entró (o sumó) todo lo que faltaba; `items` es exactamente eso. */
	| { outcome: 'added'; items: DumpedItem[] }
	/** Déficit 0 (o día sin menús): no falta nada y NO se ha escrito nada. */
	| { outcome: 'nothing' }
	/** La lista destino no existe en esa familia (id ajeno o ya borrada). */
	| { outcome: 'list-gone' }
	/** El ingrediente del volcado individual ya no está en el menú del día. */
	| { outcome: 'ingredient-gone' };

/**
 * Cómo acabó un volcado de receta (issue #290): los mismos finales que el
 * del día, más la receta rancia (borrada con el detalle abierto) — el día no
 * la tiene, y así cada action estrecha su unión sin casos fantasma.
 */
export type RecipeDumpResult = DumpResult | { outcome: 'recipe-gone' };

/** Lo que devuelve el tronco de escritura: o entró lo que faltaba o nada. */
type AddedOrNothing = { outcome: 'added'; items: DumpedItem[] } | { outcome: 'nothing' };

/**
 * Una línea del volcado: qué se añade y con qué identidad se busca el
 * equivalente pendiente. Con producto de despensa, nombre visible, canónico,
 * unidad y categoría salen de su fila (lo que la familia reconoce); sin
 * producto (`pantryItemId` null), del propio snapshot del ingrediente — no
 * hay producto de quien heredar.
 */
interface DumpEntry {
	name: string;
	/** El canónico: la búsqueda de equivalente compara canónico a canónico. */
	normalizedName: string;
	unit: Unit;
	categoryId: string | null;
	/** Lo que falta, ya agregado (el déficit del día o el ingrediente entero). */
	quantity: number;
}

/**
 * Un ingrediente ya normalizado para el cálculo: la única adaptación es la
 * cantidad, que las dos fuentes traen como `Decimal` de Prisma y aquí viaja
 * aplanada a `number` — el mismo aplanado que hace la vista al pintar.
 */
interface SourceIngredient {
	id: string;
	name: string;
	quantity: number;
	unit: Unit;
	categoryId: string | null;
	/** Su producto de despensa; `null` si no lleva o se borró después (SetNull). */
	pantryItemId: string | null;
}

/** El orden canónico GLOBAL de escritura (el mismo de `purchases.ts` y
 * `mealplans.ts`): comparación por unidades de código UTF-16, idéntica en
 * todo proceso y sin depender de la locale. Aquí deja las líneas del volcado
 * en orden determinista, para que los `order` de los items nuevos no dependan
 * del orden en que las comidas trajeron los ingredientes.
 */
function canonicalOrder(a: string, b: string): number {
	return a < b ? -1 : a > b ? 1 : 0;
}

/**
 * La lista PRIMERO y CON LOCK (issue #108, patrón `readdPantryItem`):
 * serializa todo volcado concurrente sobre la misma lista, así que el
 * «buscar pendiente equivalente o crear» de `writeEntries` ya no puede
 * duplicar items — el segundo ve lo que el primero acaba de crear y suma.
 * Lista inexistente o ajena: id rancio o de otra familia — «no existe» en
 * ambos casos, como en `finalizePurchase`. Devuelve su id, o `null` si no
 * está (el `null` de Prisma degradaría el select).
 */
async function lockList(
	tx: Prisma.TransactionClient,
	familyId: string,
	listId: string
): Promise<string | null> {
	const locked = await tx.$queryRaw<Array<{ id: string }>>`
		SELECT "id"
		FROM "list"
		WHERE "id" = ${listId} AND "organizationId" = ${familyId}
		FOR UPDATE
	`;
	return locked.length === 0 ? null : locked[0].id;
}

/**
 * Los productos de despensa de los ingredientes, de UNA consulta: su fila da
 * nombre visible, canónico, unidad y categoría (lo que hereda el item nuevo)
 * y su cantidad alimenta el cálculo del déficit. El mapa id → cantidad es el
 * payload mínimo que `dayPantryStatus` necesita.
 */
async function productsOfIngredients(
	tx: Prisma.TransactionClient,
	familyId: string,
	ingredients: ReadonlyArray<SourceIngredient>
): Promise<{
	productById: Map<
		string,
		{ name: string; normalizedName: string; unit: Unit; categoryId: string | null }
	>;
	pantryQuantities: Record<string, number>;
}> {
	const productIds = [
		...new Set(ingredients.map((ingredient) => ingredient.pantryItemId).filter((id) => id !== null))
	];
	const products = await tx.pantryItem.findMany({
		where: { organizationId: familyId, id: { in: productIds } },
		select: {
			id: true,
			name: true,
			normalizedName: true,
			unit: true,
			categoryId: true,
			quantity: true
		}
	});
	return {
		productById: new Map(
			products.map(({ id, name, normalizedName, unit, categoryId }) => [
				id,
				{ name, normalizedName, unit, categoryId }
			])
		),
		pantryQuantities: Object.fromEntries(
			products.map((product) => [product.id, Number(product.quantity)])
		)
	};
}

/**
 * Las líneas del volcado, una por producto con déficit (el agregado) o por
 * ingrediente sin producto (su snapshot entero). En el volcado individual
 * solo entra el ingrediente pulsado (`onlyIngredientId`).
 */
function entriesOfIngredients(
	ingredients: ReadonlyArray<SourceIngredient>,
	{
		onlyIngredientId,
		statuses,
		productById
	}: {
		onlyIngredientId?: string;
		statuses: ReturnType<typeof dayPantryStatus>;
		productById: Map<
			string,
			{ name: string; normalizedName: string; unit: Unit; categoryId: string | null }
		>;
	}
): DumpEntry[] {
	const entries: DumpEntry[] = [];
	const seenProducts = new Set<string>();
	for (const ingredient of ingredients) {
		if (onlyIngredientId && ingredient.id !== onlyIngredientId) {
			continue;
		}

		if (ingredient.pantryItemId === null) {
			entries.push({
				name: ingredient.name,
				normalizedName: normalizeItemName(ingredient.name),
				unit: ingredient.unit,
				categoryId: ingredient.categoryId,
				quantity: ingredient.quantity
			});
			continue;
		}

		// Una sola línea por producto aunque dos comidas —o dos filas de la
		// misma receta— lo pidan: el déficit ya viene agregado por
		// `dayPantryStatus`.
		if (seenProducts.has(ingredient.pantryItemId)) {
			continue;
		}
		seenProducts.add(ingredient.pantryItemId);
		const status = statuses.get(ingredient.pantryItemId);
		const product = productById.get(ingredient.pantryItemId);
		// Sin producto que ya no está (despensa borrada con la FK aún viva:
		// imposible hoy, pero el cálculo es total) el déficit no tiene de quién
		// heredar y la línea no entra.
		if (!status || status.deficit <= 0 || !product) {
			continue;
		}
		entries.push({
			name: product.name,
			normalizedName: product.normalizedName,
			unit: product.unit,
			categoryId: product.categoryId,
			quantity: status.deficit
		});
	}
	return entries;
}

/**
 * La escritura de las líneas ya calculadas: sin líneas no falta nada y no se
 * toca un solo item; con ellas, orden canónico (ver `canonicalOrder`) y por
 * producto buscar-equivalente-pendiente-o-crear + increment, el patrón de
 * `readdPantryItem`. La suma lleva `purchased: false` en el `where`: si otro
 * miembro marcó el equivalente como comprado mientras tanto, no se toca y se
 * crea un item nuevo (count 0).
 */
async function writeEntries(
	tx: Prisma.TransactionClient,
	listId: string,
	entries: DumpEntry[]
): Promise<AddedOrNothing> {
	// Déficit 0 (o día sin menús / receta sin ingredientes): mensaje de «no
	// falta nada» SIN escritura.
	if (entries.length === 0) {
		return { outcome: 'nothing' };
	}

	entries.sort(
		(a, b) => canonicalOrder(a.normalizedName, b.normalizedName) || canonicalOrder(a.unit, b.unit)
	);

	const added: DumpedItem[] = [];
	for (const entry of entries) {
		const pending = await tx.item.findMany({
			where: { listId: listId, purchased: false, unit: entry.unit },
			select: { id: true, name: true }
		});
		const equivalentItem = pending.find(
			(row) => normalizeItemName(row.name) === entry.normalizedName
		);

		const total = equivalentItem
			? await tx.item.updateMany({
					where: { id: equivalentItem.id, purchased: false },
					data: { quantity: { increment: entry.quantity } }
				})
			: { count: 0 };

		if (total.count === 0) {
			// El item nuevo hereda nombre visible y categoría del producto de
			// despensa (o del snapshot del ingrediente) y nace al final de la
			// lista: el `order` lo calcula el SERVIDOR, como en `createItem`,
			// y con la lista bloqueada nunca se repite entre líneas ni entre
			// volcados concurrentes.
			const { _max } = await tx.item.aggregate({
				where: { listId: listId },
				_max: { order: true }
			});
			await tx.item.create({
				data: {
					listId: listId,
					name: entry.name,
					quantity: entry.quantity,
					unit: entry.unit,
					categoryId: entry.categoryId,
					order: (_max.order ?? -1) + 1
				}
			});
		}
		added.push({ name: entry.name, quantity: entry.quantity, unit: entry.unit });
	}

	return { outcome: 'added', items: added };
}

/**
 * Vuelca lo que falta de UN día — o de UN ingrediente de ese día — en una
 * lista DE LA FAMILIA (#245). Todo en UNA transacción: lock de la lista,
 * déficit recalculado con los menús y la despensa reales y escritura única.
 *
 * El déficit es el AGREGADO del día por producto (dos comidas que piden
 * huevos son una sola necesidad): el volcado individual de un ingrediente
 * añade el déficit de SU PRODUCTO para todo el día, no solo su comida — es
 * la cifra exacta que el badge de la #244 enseña. Los ingredientes sin
 * producto de despensa (FK anulada, ver `dayPantryStatus`) se vuelcan por su
 * propio snapshot: falta todo lo que piden y no hay producto de quien
 * heredar nombre ni categoría.
 */
export async function dumpDayToList(familyId: string, data: DumpData): Promise<DumpResult> {
	return prisma.$transaction(async (tx) => {
		const listId = await lockList(tx, familyId, data.listId);
		if (listId === null) {
			return { outcome: 'list-gone' };
		}

		// Los ingredientes del día: TODOS los menús de esa fecha de la familia,
		// cada ingrediente con su snapshot (nombre, cantidad, unidad, categoría)
		// y su producto de despensa. Un día sin menús no tiene nada que volcar.
		const meals = await tx.mealPlan.findMany({
			where: { organizationId: familyId, date: dateOfDayKey(data.date) },
			select: {
				ingredients: {
					orderBy: { position: 'asc' },
					select: {
						id: true,
						name: true,
						quantity: true,
						unit: true,
						categoryId: true,
						pantryItemId: true
					}
				}
			}
		});

		// En el volcado individual, el ingrediente pulsado ha de ser uno de los
		// del día (la familia y la fecha ya van en la consulta de arriba): un
		// id rancio — el ingrediente borrado con el detalle abierto — o ajeno
		// es «ya no está», sin revelar si vive en otra familia.
		if (
			data.ingredientId &&
			!meals.some((meal) =>
				meal.ingredients.some((ingredient) => ingredient.id === data.ingredientId)
			)
		) {
			return { outcome: 'ingredient-gone' };
		}

		// La normalización no cambia nada del snapshot: solo aplana las
		// cantidades `Decimal` (ver `SourceIngredient`). El agregado por
		// producto de `dayPantryStatus` es igual agrupando por comidas que
		// plano: la necesidad se suma sobre la MISMA clave.
		const ingredients: SourceIngredient[] = meals.flatMap((meal) =>
			meal.ingredients.map((ingredient) => ({
				...ingredient,
				quantity: Number(ingredient.quantity)
			}))
		);
		const { productById, pantryQuantities } = await productsOfIngredients(
			tx,
			familyId,
			ingredients
		);
		const statuses = dayPantryStatus([{ ingredients }], pantryQuantities);

		return writeEntries(
			tx,
			listId,
			entriesOfIngredients(ingredients, {
				onlyIngredientId: data.ingredientId,
				statuses,
				productById
			})
		);
	});
}

/**
 * Vuelca lo que falta de UNA receta — o de UN ingrediente de ella — en una
 * lista DE LA FAMILIA (issue #290): el mismo tronco que el volcado del día
 * (lock, déficit recalculado en servidor, buscar-equivalente-o-crear) con los
 * ingredientes de la receta como fuente — no hay fecha: lo que pide la
 * receta se compara con la despensa tal cual. El déficit es también el
 * AGREGADO por producto: una receta que pide el mismo producto dos veces es
 * una sola necesidad. Los ingredientes sin producto (FK anulada) salen por
 * su snapshot: falta todo lo que piden.
 */
export async function dumpRecipeToList(
	familyId: string,
	data: RecipeDumpData
): Promise<RecipeDumpResult> {
	return prisma.$transaction(async (tx) => {
		const listId = await lockList(tx, familyId, data.listId);
		if (listId === null) {
			return { outcome: 'list-gone' };
		}

		// Los ingredientes de la receta DE LA FAMILIA, con su snapshot (nombre,
		// cantidad, unidad, categoría) y su producto de despensa: un id ajeno o
		// rancio — la receta borrada con el detalle abierto — es «no existe»,
		// como la lista de arriba.
		const recipe = await tx.recipe.findFirst({
			where: { id: data.recipeId, organizationId: familyId },
			select: {
				ingredients: {
					orderBy: { position: 'asc' },
					select: {
						id: true,
						name: true,
						quantity: true,
						unit: true,
						categoryId: true,
						pantryItemId: true
					}
				}
			}
		});
		if (!recipe) {
			return { outcome: 'recipe-gone' };
		}

		// En el volcado individual, el ingrediente pulsado ha de ser uno de los
		// de la receta: un id rancio — el ingrediente que una edición paralela
		// quitó con el detalle abierto — o ajeno es «ya no está».
		if (
			data.ingredientId &&
			!recipe.ingredients.some((ingredient) => ingredient.id === data.ingredientId)
		) {
			return { outcome: 'ingredient-gone' };
		}

		const ingredients: SourceIngredient[] = recipe.ingredients.map((ingredient) => ({
			...ingredient,
			quantity: Number(ingredient.quantity)
		}));
		const { productById, pantryQuantities } = await productsOfIngredients(
			tx,
			familyId,
			ingredients
		);
		const statuses = dayPantryStatus([{ ingredients }], pantryQuantities);

		return writeEntries(
			tx,
			listId,
			entriesOfIngredients(ingredients, {
				onlyIngredientId: data.ingredientId,
				statuses,
				productById
			})
		);
	});
}
