import { dayPantryStatus } from '#lib/pantry-status.js';
import { normalizeItemName } from '#lib/normalize-name.js';
import type { Unit } from '#lib/schemas/item.js';
import prisma from '#lib/server/prisma.js';
import { dateOfDayKey } from '#lib/server/mealplans.js';

// Volcado a la lista de la compra desde el detalle del día (épica #236, tarea
// #245): lo que falta para UN día — o para UN ingrediente — entra en la lista
// que elija el usuario. El patrón es el de `readdPantryItem` (issues #108 y
// #149): la lista se bloquea PRIMERO (`FOR UPDATE`) para serializar volcados
// concurrentes — dos miembros que pulsan a la vez acaban en UN item con la
// suma, nunca duplicados — y el equivalente pendiente se busca por nombre
// normalizado + unidad con `purchased: false` en el `where`.
//
// Lo que falta NO lo dice el cliente: se recalcula SIEMPRE aquí, dentro de la
// transacción, con `dayPantryStatus` (el cálculo puro de la #244) sobre los
// menús reales del día y la despensa real de la familia. El item nuevo hereda
// nombre visible y categoría del producto de despensa (misma unidad por
// contrato); nace pendiente y al final de la lista.

/** Lo que la vista pide para un volcado (#245): nada de cantidades. */
export interface DumpData {
	/** El día del calendario como clave `YYYY-MM-DD`. */
	date: string;
	/** La lista de destino: una de las de la familia. */
	listId: string;
	/** Volcado individual: el ingrediente pulsado. Ausente = el día entero. */
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

/** Cómo acabó un volcado. */
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
 * El orden canónico GLOBAL de escritura (el mismo de `purchases.ts` y
 * `mealplans.ts`): comparación por unidades de código UTF-16, idéntica en
 * todo proceso y sin depender de la locale. Aquí deja las líneas del volcado
 * en orden determinista, para que los `order` de los items nuevos no dependan
 * del orden en que las comidas trajeron los ingredientes.
 */
function canonicalOrder(a: string, b: string): number {
	return a < b ? -1 : a > b ? 1 : 0;
}

/**
 * Vuelca lo que falta de UN día — o de UN ingrediente de ese día — en una
 * lista DE LA FAMILIA (#245). Todo en UNA transacción, con el mismo esqueleto
 * que `readdPantryItem`: lock de la lista, cálculo del déficit con los menús
 * y la despensa reales, y por producto buscar-equivalente-pendiente-o-crear
 * + increment. O entra lo que falta o no queda rastro de nada.
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
		// La lista PRIMERO y CON LOCK (issue #108, patrón `readdPantryItem`):
		// serializa todo volcado concurrente sobre la misma lista, así que el
		// «buscar pendiente equivalente o crear» de abajo ya no puede duplicar
		// items — el segundo ve lo que el primero acaba de crear y suma.
		// Lista inexistente o ajena: id rancio o de otra familia — «no existe»
		// en ambos casos, como en `finalizePurchase`.
		const list = await tx.$queryRaw<Array<{ id: string }>>`
			SELECT "id"
			FROM "list"
			WHERE "id" = ${data.listId} AND "organizationId" = ${familyId}
			FOR UPDATE
		`;
		if (list.length === 0) {
			return { outcome: 'list-gone' };
		}
		const listId = list[0].id;

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

		// Los productos de despensa del día, de UNA consulta: su fila da nombre
		// visible, canónico, unidad y categoría (lo que hereda el item nuevo) y
		// su cantidad alimenta el cálculo del déficit.
		const productIds = [
			...new Set(
				meals
					.flatMap((meal) => meal.ingredients.map((ingredient) => ingredient.pantryItemId))
					.filter((id): id is string => id !== null)
			)
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
		const productById = new Map(products.map((product) => [product.id, product]));
		const pantryQuantities = Object.fromEntries(
			products.map((product) => [product.id, Number(product.quantity)])
		);

		// El déficit lo recalcula el SERVIDOR (`dayPantryStatus`, #244): la
		// necesidad del día agregada por producto contra la despensa real.
		const statuses = dayPantryStatus(
			meals.map((meal) => ({
				ingredients: meal.ingredients.map((ingredient) => ({
					pantryItemId: ingredient.pantryItemId,
					quantity: Number(ingredient.quantity)
				}))
			})),
			pantryQuantities
		);

		// Las líneas del volcado, una por producto con déficit (el agregado del
		// día) o por ingrediente sin producto (su snapshot entero). En el
		// volcado individual solo entra el ingrediente pulsado.
		const entries: DumpEntry[] = [];
		const seenProducts = new Set<string>();
		for (const meal of meals) {
			for (const ingredient of meal.ingredients) {
				if (data.ingredientId && ingredient.id !== data.ingredientId) {
					continue;
				}

				if (ingredient.pantryItemId === null) {
					entries.push({
						name: ingredient.name,
						normalizedName: normalizeItemName(ingredient.name),
						unit: ingredient.unit,
						categoryId: ingredient.categoryId,
						quantity: Number(ingredient.quantity)
					});
					continue;
				}

				// Una sola línea por producto aunque dos comidas lo pidan: el
				// déficit ya viene agregado por `dayPantryStatus`.
				if (seenProducts.has(ingredient.pantryItemId)) {
					continue;
				}
				seenProducts.add(ingredient.pantryItemId);
				const status = statuses.get(ingredient.pantryItemId);
				const product = productById.get(ingredient.pantryItemId);
				// Sin producto que ya no está (despensa borrada con la FK aún
				// viva: imposible hoy, pero el cálculo es total) el déficit no
				// tiene de quién heredar y la línea no entra.
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
		}

		// Déficit 0 (o día sin menús): mensaje de «no falta nada» SIN
		// escritura — la transacción acaba sin tocar un solo item.
		if (entries.length === 0) {
			return { outcome: 'nothing' };
		}

		// Escritura en orden canónico (ver `canonicalOrder`): determinista
		// aunque el orden de las comidas no lo sea.
		entries.sort(
			(a, b) => canonicalOrder(a.normalizedName, b.normalizedName) || canonicalOrder(a.unit, b.unit)
		);

		// Por producto: buscar-equivalente-pendiente-o-crear + increment, el
		// patrón de `readdPantryItem`. La suma lleva `purchased: false` en el
		// `where`: si otro miembro marcó el equivalente como comprado mientras
		// tanto, no se toca y se crea un item nuevo (count 0).
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
	});
}
