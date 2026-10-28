import prisma from '$lib/server/prisma.js';
import { Prisma } from '$lib/generated/prisma/client';
import type { Unit } from '$lib/schemas/item.js';

// Finalizar compra (issues #43 y #70) e historial (#75, #76): cerrar una lista
// de la familia moviendo sus items comprados a la despensa, y consultar lo
// comprado. La familia viaja SIEMPRE en los argumentos — es la activa que
// `requireActiveFamily` dejó verificada — y una lista (o compra) de otra
// familia es como si no existiera, como en `lists.ts`/`items.ts`.

/**
 * El nombre canónico con el que la despensa identifica un producto (#70):
 * minúsculas, sin acentos y con los espacios colapsados a uno solo (issue
 * #107: el comentario prometía «sin espacios sobrantes» pero no colapsaba los
 * internos, y «Leche  entera» y «Leche entera» creaban dos filas de despensa
 * que no se sumaban al re-añadir). Es lo que se guarda en
 * `PantryItem.normalizedName` para que «Leche Entera», «leche entera» y
 * «LECHE  entera» sumen sobre el mismo item de la despensa. Mismo trato que el
 * `slugify` de las familias (NFD + quitar diacríticos), pero conservando los
 * espacios: es un nombre, no un slug.
 */
export function normalizeItemName(name: string): string {
	return name
		.trim()
		.normalize('NFD')
		.replace(/\p{Diacritic}/gu, '')
		.toLowerCase()
		.replace(/\s+/g, ' ');
}

/** Cómo acabó un intento de finalización. */
export type FinalizeOutcome =
	/** La compra se cerró: historial creado, despensa actualizada y comprados fuera. */
	| 'finalized'
	/** La lista no existe en esa familia (id ajeno o ya borrado). */
	| 'list-gone'
	/** Nada que finalizar: no había items comprados (o los llevó otro miembro). */
	| 'nothing-purchased';

/**
 * Error centinela para revolver el ROLLBACK de la transacción si el reclamo
 * de abajo borrara menos filas de las bloqueadas: solo vive dentro del try,
 * que lo traduce a `nothing-purchased`. Con los locks `FOR UPDATE` es un
 * invariante que nunca salta (nadie puede cambiar `purchased` de una fila
 * bloqueada); queda como guardia por si el orden de lectura se toca algún día.
 */
class ConcurrentFinalizeError extends Error {
	constructor() {
		super('La compra ya fue finalizada por otro miembro a la vez');
	}
}

/**
 * El orden canónico GLOBAL de los aterrizajes en despensa: comparación por
 * unidades de código UTF-16, idéntica en todo proceso y sin depender de la
 * locale (el `localeCompare` varía). Es la que ordena el bucle de upserts
 * para que ninguna pareja de transacciones bloquee las filas de despensa en
 * orden inverso.
 */
function ordenCanonico(a: string, b: string): number {
	return a < b ? -1 : a > b ? 1 : 0;
}

/**
 * Finaliza la compra de una lista DE LA FAMILIA: los items comprados pasan a
 * la despensa (sumando si el producto ya estaba, mismo nombre normalizado y
 * misma unidad), se registra el historial con el total escrito a mano y los
 * comprados desaparecen de la lista — que NO se borra y conserva intactos los
 * pendientes (criterio de aceptación de la #43).
 *
 * Todo en UNA transacción: o hay historial + despensa + lista depurada, o no
 * queda rastro de nada. El total ya llega validado por `purchaseSchema` (>= 0)
 * y el usuario es el que confirma, para el `PurchaseRecord.userId`.
 *
 * La protección contra la doble finalización es un RECLAMO POR BLOQUEO
 * (issue #108): los comprados se leen con `SELECT … FOR UPDATE` — en orden de
 * lista (`order`, luego antigüedad), que es también el orden del snapshot —
 * y después se borran con un `deleteMany` que, con las filas bloqueadas,
 * borra EXACTAMENTE lo leído. El lock congela el conjunto: un desmarcado
 * concurrente espera al COMMIT (y se queda sin fila que desmarcar), así que
 * ya no existe la ventana «leo comprados, otro desmarca, borro menos de lo
 * leído» que deshacía todo con un falso «nada comprado». Dos finalizaciones
 * de la MISMA lista serializan en los locks; la segunda no encuentra filas y
 * devolvemos `nothing-purchased` — exactamente lo que ve el segundo click de
 * un doble click.
 *
 * Los upserts de despensa tampoco pueden deadlockear: los comprados se
 * AGREGAN por (nombre canónico, unidad) — los duplicados de la misma lista
 * aterrizan juntos — y el bucle de upserts sigue el orden canónico GLOBAL del
 * par. Dos compras concurrentes de listas distintas ({leche, pan} y {pan,
 * leche}) tocan así las filas de despensa SIEMPRE en el mismo orden: sin
 * ciclos de locks, sin el 40P01 que antes abortaba a uno con
 * `purchases_error`.
 */
export async function finalizePurchase(
	familyId: string,
	listId: string,
	total: number,
	userId: string
): Promise<FinalizeOutcome> {
	try {
		return await prisma.$transaction(async (tx) => {
			// Lista inexistente o ajena: id rancio o de otra familia — «no existe»
			// en ambos casos, sin revelar si vive en otra parte.
			const list = await tx.list.findFirst({
				where: { id: listId, organizationId: familyId },
				select: { id: true, name: true }
			});
			if (!list) {
				return 'list-gone';
			}

			// El reclamo (ver arriba): filas bloqueadas EN ORDEN DE LISTA — el
			// mismo que el alta rápida y el que mostrará el historial. `quantity`
			// vuelve como Decimal de la base y `unit` como el string del enum.
			const purchased = await tx.$queryRaw<
				Array<{ id: string; name: string; quantity: Prisma.Decimal; unit: Unit }>
			>`
				SELECT "id", "name", quantity, unit
				FROM "item"
				WHERE "listId" = ${list.id} AND purchased = true
				ORDER BY "order" ASC, "createdAt" ASC, "id" ASC
				FOR UPDATE
			`;
			// «No permitir finalizar sin items comprados»: sin comprados no hay
			// compra que cerrar (y tampoco historial sin items).
			if (purchased.length === 0) {
				return 'nothing-purchased';
			}

			// La confirmación del reclamo: invariante bajo lock, guardia por si
			// acaso. Ningún write posterior ocurre si saltara.
			const claim = await tx.item.deleteMany({
				where: { id: { in: purchased.map((item) => item.id) }, purchased: true }
			});
			if (claim.count !== purchased.length) {
				throw new ConcurrentFinalizeError();
			}

			// Historial (issue #75): snapshot inmutable de la lista y de cada
			// item comprado — en el ORDEN DE LA LISTA en que se compraron —,
			// con el total a mano y quién finalizó.
			await tx.purchaseRecord.create({
				data: {
					organizationId: familyId,
					listId: list.id,
					listName: list.name,
					total,
					userId,
					items: {
						create: purchased.map((item) => ({
							name: item.name,
							quantity: item.quantity,
							unit: item.unit
						}))
					}
				}
			});

			// Despensa: cada comprado aterriza en SU producto — el único
			// (familia, nombre normalizado, unidad) decide si es nuevo o se
			// suma. Los duplicados de la MISMA lista (mismo canónico y unidad)
			// se agregan en un solo aterrizaje, y el bucle va en orden
			// canónico global: es lo que hace imposible el deadlock entre
			// compras concurrentes (ver arriba).
			interface Aterrizaje {
				name: string;
				normalizedName: string;
				unit: Unit;
				quantity: number;
			}
			const aterrizajes = new Map<string, Aterrizaje>();
			for (const item of purchased) {
				const normalizedName = normalizeItemName(item.name);
				const clave = `${normalizedName}\n${item.unit}`;
				const previo = aterrizajes.get(clave);
				if (previo) {
					previo.quantity += Number(item.quantity);
					continue;
				}
				aterrizajes.set(clave, {
					name: item.name,
					normalizedName,
					unit: item.unit,
					quantity: Number(item.quantity)
				});
			}
			const enOrden = [...aterrizajes.values()].sort(
				(a, b) => ordenCanonico(a.normalizedName, b.normalizedName) || ordenCanonico(a.unit, b.unit)
			);

			// El upsert es el INSERT ON CONFLICT nativo de Postgres, así que dos
			// compras concurrentes que traen el mismo producto también suman
			// sin partirse.
			for (const aterrizaje of enOrden) {
				await tx.pantryItem.upsert({
					where: {
						organizationId_normalizedName_unit: {
							organizationId: familyId,
							normalizedName: aterrizaje.normalizedName,
							unit: aterrizaje.unit
						}
					},
					// La primera vez manda el nombre tal y como se escribió en la
					// lista: es el que la despensa mostrará de ahí en adelante.
					create: {
						organizationId: familyId,
						name: aterrizaje.name,
						normalizedName: aterrizaje.normalizedName,
						quantity: aterrizaje.quantity,
						unit: aterrizaje.unit
					},
					update: { quantity: { increment: aterrizaje.quantity } }
				});
			}

			return 'finalized';
		});
	} catch (error) {
		// Perder la carrera del reclamo NO es un error: es el segundo click de
		// un doble click. Todo lo demás (BD caída, total que desborda la
		// columna…) sube tal cual al action.
		if (error instanceof ConcurrentFinalizeError) {
			return 'nothing-purchased';
		}
		throw error;
	}
}

// ---- Historial de compras (issues #47 y #76): consulta del snapshot que
// deja `finalizePurchase`. Solo lectura: el registro es inmutable por diseño
// (los cambios posteriores en listas no alteran el historial, criterio de la
// #33), así que no hay acciones que lo editen. ----

/** El tamaño de página de la carga incremental del listado (#76). */
export const PURCHASES_PAGE_SIZE = 20;

/** Una compra del historial tal y como el listado la muestra. */
export interface PurchaseSummaryView {
	id: string;
	/** Nombre de la lista de origen guardado EN EL SNAPSHOT (#75): se muestra aunque la lista se haya borrado. */
	listName: string;
	/** `Decimal(10,2)` en la base; la vista lo lee como `number`. */
	total: number;
	createdAt: Date;
}

/** Un item del snapshot de una compra (nombre, cantidad y unidad del momento). */
export interface PurchaseItemView {
	id: string;
	name: string;
	/** `Decimal(10,3)` en la base; la vista lo lee como `number`. */
	quantity: number;
	/** Valor del enum `Unit` (identificador inglés); la UI lo traduce con `unit_*`. */
	unit: Unit;
}

/** El detalle completo de una compra: el resumen más su snapshot de items. */
export interface PurchaseDetailView extends PurchaseSummaryView {
	items: PurchaseItemView[];
}

/** De la fila de Prisma a la vista: el Decimal se aplana a `number`. */
function toSummary(row: {
	id: string;
	listName: string;
	total: unknown;
	createdAt: Date;
}): PurchaseSummaryView {
	return { id: row.id, listName: row.listName, total: Number(row.total), createdAt: row.createdAt };
}

/**
 * Las compras de la familia, de la más reciente a la más antigua (#76), con
 * carga incremental ACUMULATIVA: la página de `offset` trae TODO hasta ese
 * límite, no solo sus filas. Así el enlace «Cargar más» (`?offset=N+pageSize`)
 * añade al final de lo ya pintado con y sin JavaScript: en cliente la
 * navegación sustituye `data.purchases` por el array más largo y el `each`
 * reutiliza las filas existentes; sin JS, la página completa llega ya crecida.
 * El orden secundario por `id` desempata los `createdAt` iguales de forma
 * determinista (dos compras en el mismo instante no bailan entre páginas).
 */
export async function listPurchases(
	familyId: string,
	offset: number
): Promise<{ purchases: PurchaseSummaryView[]; hasMore: boolean }> {
	// El offset viaja en la URL: cualquier cosa que no sea un entero no
	// negativo es la primera página. Sin tope alto: un `take` desmedido solo
	// relee las compras de LA FAMILIA (el `where` manda), nunca las de nadie.
	const from = Number.isInteger(offset) && offset > 0 ? offset : 0;

	const rows = await prisma.purchaseRecord.findMany({
		where: { organizationId: familyId },
		orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
		select: { id: true, listName: true, total: true, createdAt: true },
		// Una compra de más para saber si queda historia detrás (#76).
		take: from + PURCHASES_PAGE_SIZE + 1
	});

	const hasMore = rows.length > from + PURCHASES_PAGE_SIZE;
	return { purchases: rows.slice(0, from + PURCHASES_PAGE_SIZE).map(toSummary), hasMore };
}

/**
 * El detalle de una compra de la familia con sus items snapshot (#76). `null`
 * si no existe ahí (id ajeno o rancio): sin revelar si vive en otra familia.
 * Los items vuelven en el orden en que se compraron, que es el orden de
 * inserción del snapshot.
 */
export async function getPurchase(
	familyId: string,
	purchaseId: string
): Promise<PurchaseDetailView | null> {
	const row = await prisma.purchaseRecord.findFirst({
		where: { id: purchaseId, organizationId: familyId },
		select: {
			id: true,
			listName: true,
			total: true,
			createdAt: true,
			items: { select: { id: true, name: true, quantity: true, unit: true } }
		}
	});
	if (!row) {
		return null;
	}
	return {
		...toSummary(row),
		items: row.items.map((item) => ({
			id: item.id,
			name: item.name,
			quantity: Number(item.quantity),
			unit: item.unit
		}))
	};
}
