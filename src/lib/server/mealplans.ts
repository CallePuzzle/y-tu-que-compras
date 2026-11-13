import { Prisma, type MealType } from '#lib/generated/prisma/client.js';
import { normalizeItemName } from '#lib/normalize-name.js';
import type { Unit } from '#lib/schemas/item.js';
import prisma from '#lib/server/prisma.js';

// CRUD de menús planificados y sus ingredientes (épica #212, tarea #225). La
// familia viaja SIEMPRE en los argumentos — es la activa que
// `requireActiveFamily` dejó verificada en el load/acción — y entra en todos
// los `where` a través de `organizationId`: un menú de otra familia es como
// si no existiera, como en `items.ts` y `stores.ts`. Son escritura para
// cualquier miembro (issue #111): sin checks de rol.
//
// Guardar un menú también GARANTIZA su despensa: cada ingrediente lleva su
// producto al upsert de PantryItem — creado con cantidad 0 si no existía,
// sin tocar la cantidad del que ya estaba (un menú no es una compra) — y
// queda enlazado a él (`pantryItemId`) por el único (familia, nombre
// normalizado, unidad): mismo nombre con distinta unidad es producto
// distinto. Borrar después el producto de despensa solo le quita al
// ingrediente la referencia (SetNull): nombre, cantidad y unidad van
// snapshotados en el ingrediente, igual que en el historial de compras.

/** Un ingrediente del menú tal y como llega del formulario, ya validado por `mealPlanSchema` (#lib/schemas/mealplan.ts). */
export interface MealPlanIngredientData {
	name: string;
	/** `number` en el formulario; la base lo guarda con la precisión de `DECIMAL(10,3)`. */
	quantity: number;
	/** Valor del enum `Unit` (identificador inglés); la UI lo traduce con `unit_*`. */
	unit: Unit;
	/** Id de UNA categoría de la familia; un id ajeno o rancio se guarda como «sin categoría». */
	categoryId?: string;
}

/** Un menú tal y como llega del formulario, ya validado por `mealPlanSchema` (#lib/schemas/mealplan.ts): su día, su tipo y sus ingredientes. */
export interface MealPlanData {
	/** El día del menú como clave `YYYY-MM-DD` (fecha de calendario, sin hora). */
	date: string;
	mealType: MealType;
	title: string;
	ingredients: MealPlanIngredientData[];
}

/** Un ingrediente tal y como la vista del menú lo muestra. */
export interface MealPlanIngredientView {
	id: string;
	name: string;
	/** `Decimal(10,3)` en la base; la vista lo lee como `number`. */
	quantity: number;
	unit: Unit;
	/** Categoría del ingrediente; `null` si no lleva o su producto se la quiso quitar. */
	categoryId: string | null;
	/** Nombre visible de esa categoría, para pintar el chip sin otra consulta. */
	categoryName: string | null;
	/** El producto de despensa garantizado al guardar; `null` si se borró después (SetNull). */
	pantryItemId: string | null;
}

/** Un menú tal y como la vista del calendario lo muestra. */
export interface MealPlanView {
	id: string;
	/** El día del menú (`@db.Date` llega a medianoche UTC); el grupo del día lo etiqueta `listMealPlans`. */
	date: Date;
	mealType: MealType;
	title: string;
	/** Los ingredientes en su `position`, el orden en que el usuario los puso. */
	ingredients: MealPlanIngredientView[];
}

/** La familia ya tiene un menú de ese tipo ese día (único familia+fecha+tipo). */
export class MealPlanExistsError extends Error {
	constructor() {
		super('A meal of this type already exists on this date in this family');
		this.name = 'MealPlanExistsError';
	}
}

const MEAL_PLAN_SELECT = {
	id: true,
	date: true,
	mealType: true,
	title: true,
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
} satisfies Prisma.MealPlanSelect;

/**
 * ¿Es el P2002 de Postgres? En las transacciones de este módulo el único
 * índice único que puede saltar es el (familia, fecha, tipo) del menú — la
 * escritura de despensa va por su propio ON CONFLICT y los ingredientes no
 * llevan único —, así que el código basta para traducirlo al error de dominio
 * que la acción convertirá en el mensaje genérico de la UI, sin filtrar el
 * error crudo de Prisma.
 */
function isUniqueViolation(error: unknown): boolean {
	return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';
}

/** El patrón estricto de una clave de día (`YYYY-MM-DD`), la fecha que viaja del formulario. */
const DAY_KEY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

/** El patrón de una clave de mes (`YYYY-MM`): réplica del de `monthKeySchema` del calendario (la cota de años la aplica `monthRange`). */
const MONTH_KEY_PATTERN = /^(\d{4})-(0[1-9]|1[0-2])$/;

/**
 * La medianoche UTC del día de calendario dado. La columna `date` es
 * `@db.Date` — pura fecha, sin hora — y Prisma la sirve como `Date` a
 * medianoche UTC: «el día 10 de marzo» se escribe y se lee monolítico, sin
 * que la zona del servidor ni la del usuario lo desplacen. La clave debe
 * venir validada (el `dayKeySchema` del formulario la exige); aquí solo se
 * defiende el módulo de basura que no debe llegar a la base.
 *
 * El rechazo es por ROUND-TRIP, no por `NaN`: el parseo ISO de `Date` hace
 * rollover en vez de invalidar — `2026-02-31` es para JS el 1 de marzo y
 * `getTime()` no da NaN —, así que la fecha solo es real si el round-trip
 * devuelve la misma clave. Los años van acotados al calendario navegable
 * (1900–2099, la cota de `monthKeySchema` del grid: `Date.UTC` mapea 0–99 al
 * siglo XX). Es la misma defensa que `dayKeySchema`, sin zod: este módulo es
 * la última línea antes de la base.
 */
function dateOfDayKey(dateKey: string): Date {
	if (!DAY_KEY_PATTERN.test(dateKey)) {
		throw new RangeError(`Clave de día inválida: ${dateKey}`);
	}
	const year = Number(dateKey.slice(0, 4));
	if (year < 1900 || year > 2099) {
		throw new RangeError(`Clave de día fuera del calendario: ${dateKey}`);
	}
	const date = new Date(`${dateKey}T00:00:00Z`);
	if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== dateKey) {
		throw new RangeError(`Fecha inexistente: ${dateKey}`);
	}
	return date;
}

/** La clave de día (`YYYY-MM-DD`) de una fecha guardada en `@db.Date` (medianoche UTC). */
function dayKeyOf(date: Date): string {
	return date.toISOString().slice(0, 10);
}

/**
 * El rango de fechas de un mes, sobre la columna `date`: del día 1 (incluido)
 * al día 1 del mes siguiente (excluido). La clave `YYYY-MM` ya viene
 * resuelta en la zona de la app (Europe/Madrid, ver `monthKeyOf` del
 * calendario) y la columna no lleva hora, así que aquí no hay `Intl` ni
 * zonas: aritmética UTC sobre medianoches, la misma que el grid usa para sus
 * claves de celda. La cota de años replica a `monthKeySchema` del grid — el
 * patrón local no la lleva, y sin ella una clave tipo `0099-12` consultaría
 * el mes de 1999 (`Date.UTC` mapea 0–99) en vez de rechazarse como lo
 * rechaza el calendario.
 */
function monthRange(monthKey: string): { gte: Date; lt: Date } {
	const match = MONTH_KEY_PATTERN.exec(monthKey);
	const year = match ? Number(match[1]) : NaN;
	if (!match || year < 1900 || year > 2099) {
		throw new RangeError(`Clave de mes inválida: ${monthKey}`);
	}
	const month = Number(match[2]);
	return {
		gte: new Date(Date.UTC(year, month - 1, 1)),
		lt: new Date(Date.UTC(year, month, 1))
	};
}

/** El orden natural de los menús dentro de un día: desayuno, comida, cena y el resto al final. */
const MEAL_TYPE_ORDER: MealType[] = ['breakfast', 'lunch', 'dinner', 'other'];

/**
 * El orden canónico GLOBAL de los upserts de despensa: comparación por
 * unidades de código UTF-16, idéntica en todo proceso y sin depender de la
 * locale (el `localeCompare` varía). Es la de `purchases.ts`: los productos
 * se tocan SIEMPRE en el mismo orden para que dos guardados concurrentes con
 * productos comunes no bloqueen las filas de despensa en orden inverso (sin
 * ciclos de locks).
 */
function canonicalOrder(a: string, b: string): number {
	return a < b ? -1 : a > b ? 1 : 0;
}

/**
 * Resuelve la categoría del ingrediente: el id de UNA categoría de la
 * familia, o `null` si no viaja o ya no está en ella — un id ajeno o rancio
 * se guarda como «sin categoría» (el mismo efecto que el `SetNull` del
 * borrado) y sin 500 por violar la FK. Mismo trato que `resolveCategoryId`
 * de `items.ts`.
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
 * Garantiza la despensa del menú: cada ingrediente lleva su producto al
 * upsert de PantryItem y devuelve, alineado con el array de entrada, el id
 * del producto que cada ingrediente debe enlazar (`pantryItemId`).
 *
 * Los aterrizajes se AGREGAN por (nombre normalizado, unidad) — dos
 * ingredientes del mismo producto comparten el upsert y por tanto el enlace
 * — y el bucle sigue el orden canónico global (ver `canonicalOrder`), el
 * mismo blindaje anti-deadlock de `finalizePurchase`.
 *
 * La cantidad se toca solo al CREAR (arranca en 0: el menú garantiza el
 * producto, no lo compra) y la categoría hereda igual que al finalizar una
 * compra (épica #175): el producto solo toma la del ingrediente si NO tenía
 * ya una — la existente siempre gana —, con la misma UPDATE condicional
 * previa al upsert, sin leer-decidir-escribir. La rama update del upsert no
 * toca NADA: guardar dos veces el mismo menú no cambia la despensa.
 */
async function ensurePantryProducts(
	db: Prisma.TransactionClient,
	familyId: string,
	ingredients: ReadonlyArray<{ name: string; unit: Unit; categoryId: string | null }>
): Promise<string[]> {
	// Por pareja (nombre normalizado, unidad): su aterrizaje y los índices de
	// los ingredientes que caen en ella. El nombre visible del producto es el
	// del primer ingrediente del grupo y la categoría, la del primero que la
	// lleve (el orden del formulario manda).
	const landings = new Map<string, { landing: PantryLanding; indexes: number[] }>();
	ingredients.forEach((ingredient, index) => {
		const normalizedName = normalizeItemName(ingredient.name);
		const key = `${normalizedName}\n${ingredient.unit}`;
		const entry = landings.get(key);
		if (entry) {
			entry.indexes.push(index);
			if (entry.landing.categoryId === null && ingredient.categoryId !== null) {
				entry.landing.categoryId = ingredient.categoryId;
			}
			return;
		}
		landings.set(key, {
			landing: {
				name: ingredient.name,
				normalizedName,
				unit: ingredient.unit,
				categoryId: ingredient.categoryId
			},
			indexes: [index]
		});
	});

	/** Un aterrizaje en despensa: el producto de UN grupo de ingredientes equivalentes. */
	interface PantryLanding {
		name: string;
		normalizedName: string;
		unit: Unit;
		categoryId: string | null;
	}

	const pantryIds = new Array<string>(ingredients.length);
	const inOrder = [...landings.values()].sort(
		(a, b) =>
			canonicalOrder(a.landing.normalizedName, b.landing.normalizedName) ||
			canonicalOrder(a.landing.unit, b.landing.unit)
	);
	for (const { landing, indexes } of inOrder) {
		// La herencia de categoría va ANTES, como UPDATE condicional: el
		// `where` solo matchea el producto SIN categoría, así que la existente
		// del producto siempre gana — la guarda la aplica la base.
		if (landing.categoryId !== null) {
			await db.pantryItem.updateMany({
				where: {
					organizationId: familyId,
					normalizedName: landing.normalizedName,
					unit: landing.unit,
					categoryId: null
				},
				data: { categoryId: landing.categoryId }
			});
		}
		const product = await db.pantryItem.upsert({
			where: {
				organizationId_normalizedName_unit: {
					organizationId: familyId,
					normalizedName: landing.normalizedName,
					unit: landing.unit
				}
			},
			// La primera vez manda el nombre tal y como se escribió en el menú:
			// es el que la despensa mostrará de ahí en adelante.
			create: {
				organizationId: familyId,
				name: landing.name,
				normalizedName: landing.normalizedName,
				quantity: 0,
				unit: landing.unit,
				categoryId: landing.categoryId
			},
			update: {},
			select: { id: true }
		});
		for (const index of indexes) {
			pantryIds[index] = product.id;
		}
	}
	return pantryIds;
}

/**
 * Prepara los ingredientes del formulario para la escritura, DENTRO de la
 * transacción que autoriza el menú: la categoría de cada uno contra la
 * familia (ver `resolveCategoryId`) y el producto de despensa garantizado
 * (ver `ensurePantryProducts`), con la `position` del servidor — el orden del
 * formulario, desde 0, sin default en el schema: «nadie inserta sin decir
 * dónde», como el `order` de Item.
 */
async function prepareIngredients(
	db: Prisma.TransactionClient,
	familyId: string,
	ingredients: MealPlanIngredientData[]
): Promise<
	Array<{
		position: number;
		name: string;
		quantity: number;
		unit: Unit;
		categoryId: string | null;
		pantryItemId: string;
	}>
> {
	const resolved = [];
	for (const ingredient of ingredients) {
		resolved.push({
			name: ingredient.name,
			quantity: ingredient.quantity,
			unit: ingredient.unit,
			categoryId: await resolveCategoryId(db, familyId, ingredient.categoryId)
		});
	}
	const pantryItemIds = await ensurePantryProducts(db, familyId, resolved);
	return resolved.map((ingredient, position) => ({
		position,
		...ingredient,
		pantryItemId: pantryItemIds[position]
	}));
}

/** De la fila de Prisma a la vista: los Decimals se aplanan a `number`. */
function toMealPlanView(row: {
	id: string;
	date: Date;
	mealType: MealType;
	title: string;
	ingredients: Array<{
		id: string;
		name: string;
		quantity: unknown;
		unit: Unit;
		categoryId: string | null;
		category: { name: string } | null;
		pantryItemId: string | null;
	}>;
}): MealPlanView {
	return {
		id: row.id,
		date: row.date,
		mealType: row.mealType,
		title: row.title,
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
 * Crea un menú de la familia con sus ingredientes. El único (familia, fecha,
 * tipo) se aplica en la base: si otra comida del mismo día ya ocupa el tipo,
 * el INSERT muere en P2002 y sale como `MealPlanExistsError` — a prueba de
 * carrera, sin ventana entre un check previo y el write, para que la acción
 * lo traduzca al mensaje genérico de la UI.
 */
export async function createMealPlan(familyId: string, data: MealPlanData): Promise<MealPlanView> {
	try {
		return await prisma.$transaction(async (tx) => {
			const ingredients = await prepareIngredients(tx, familyId, data.ingredients);
			const row = await tx.mealPlan.create({
				data: {
					organizationId: familyId,
					date: dateOfDayKey(data.date),
					mealType: data.mealType,
					title: data.title,
					ingredients: { create: ingredients }
				},
				select: MEAL_PLAN_SELECT
			});
			return toMealPlanView(row);
		});
	} catch (error) {
		if (isUniqueViolation(error)) {
			throw new MealPlanExistsError();
		}
		throw error;
	}
}

/**
 * Edita un menú de la familia: su día, su tipo, su título y SUS INGREDIENTES
 * ENTERA — fuera los que había, dentro los que llegan con su `position`
 * recalculada desde 0, como `updateItem` sustituye los campos. `false` si no
 * hay menú con ese id EN ESA FAMILIA (id rancio o ajeno): la pertenencia se
 * verifica dentro de la transacción, sin posibilidad de tocar un menú ajeno
 * por un id rancio.
 *
 * El menú va PRIMERO y CON LOCK (issue #108, patrón `createItem`): la
 * edición reemplaza los ingredientes con un borra-y-crea, y dos ediciones
 * concurrentes del mismo menú sin serializar se pisarían — la que llega
 * segunda no vería las filas SIN COMMIT de la primera, su borrado no
 * encontraría nada… y sus ingredientes nuevos convivirían con los de la
 * otra. Con el lock, la segunda espera al COMMIT y sustituye EXACTAMENTE lo
 * que hay.
 *
 * Mover el menú a un día+tipo ya ocupado por OTRO menú de la familia muere
 * en el único (familia, fecha, tipo) y sale como `MealPlanExistsError`, como
 * el alta; editar sin mover no choca consigo mismo (Postgres ignora el
 * update que no cambia los valores de la fila). El rechazo no deja nada a
 * medias: la transacción revierte despensa, borrado y reemplazo.
 */
export async function updateMealPlan(
	familyId: string,
	id: string,
	data: MealPlanData
): Promise<boolean> {
	try {
		return await prisma.$transaction(async (tx) => {
			const locked = await tx.$queryRaw<Array<{ id: string }>>`
				SELECT "id"
				FROM "mealPlan"
				WHERE "id" = ${id} AND "organizationId" = ${familyId}
				FOR UPDATE
			`;
			if (locked.length === 0) {
				return false;
			}

			const ingredients = await prepareIngredients(tx, familyId, data.ingredients);
			await tx.mealPlanIngredient.deleteMany({ where: { mealPlanId: id } });
			await tx.mealPlan.update({
				where: { id },
				data: {
					date: dateOfDayKey(data.date),
					mealType: data.mealType,
					title: data.title,
					ingredients: { create: ingredients }
				},
				select: { id: true }
			});
			return true;
		});
	} catch (error) {
		if (isUniqueViolation(error)) {
			throw new MealPlanExistsError();
		}
		throw error;
	}
}

/**
 * Borra un menú de la familia con sus ingredientes (FK en cascada); `false`
 * si ya no estaba (doble envío) o era de otra familia. La despensa NO se
 * toca: los productos con cantidad 0 que el menú garantizó siguen siendo
 * despensa de la familia, y quitarlos es decisión aparte.
 */
export async function deleteMealPlan(familyId: string, id: string): Promise<boolean> {
	const result = await prisma.mealPlan.deleteMany({
		where: { id, organizationId: familyId }
	});
	return result.count > 0;
}

/**
 * Los menús del mes agrupados POR DÍA para pintar el grid del calendario: la
 * clave de cada grupo es la misma `YYYY-MM-DD` que llevan las celdas (ver
 * `buildMonthGrid`), así que la vista cuelga de cada celda sus menús sin
 * buscar. Solo existen grupos de días CON menús y llegan en orden de fecha;
 * dentro de un día, los menús en su orden natural (desayuno, comida, cena,
 * otro; desempata la antigüedad, conservada por el sort estable) y los
 * ingredientes de cada menú por su `position`.
 *
 * El mes viaja como clave `YYYY-MM` — la que el load del calendario valida
 * con `monthKeySchema` y resuelve en la zona de la app (Europe/Madrid) — y
 * la consulta la acota por FECHAS puras: la columna `date` no lleva hora
 * (`@db.Date`), así que el rango va del día 1 al día 1 del mes siguiente.
 */
export async function listMealPlans(
	familyId: string,
	monthKey: string
): Promise<Record<string, MealPlanView[]>> {
	const range = monthRange(monthKey);
	const rows = await prisma.mealPlan.findMany({
		where: { organizationId: familyId, date: { gte: range.gte, lt: range.lt } },
		orderBy: [{ date: 'asc' }, { createdAt: 'asc' }, { id: 'asc' }],
		select: MEAL_PLAN_SELECT
	});

	const byDay: Record<string, MealPlanView[]> = {};
	for (const row of rows) {
		const day = (byDay[dayKeyOf(row.date)] ??= []);
		day.push(toMealPlanView(row));
	}
	// El tipo manda dentro del día; el `orderBy` de la consulta (antigüedad)
	// queda como desempate porque `sort` es estable.
	for (const day of Object.values(byDay)) {
		day.sort((a, b) => MEAL_TYPE_ORDER.indexOf(a.mealType) - MEAL_TYPE_ORDER.indexOf(b.mealType));
	}
	return byDay;
}
