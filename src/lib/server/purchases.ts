import { APP_TIME_ZONE } from '#lib/format.js';
import prisma from '#lib/server/prisma.js';
import { Prisma } from '#lib/generated/prisma/client.js';
import { normalizeItemName } from '#lib/normalize-name.js';
import type { Unit } from '#lib/schemas/item.js';

// Finalizar compra (issues #43 y #70) e historial (#75, #76): cerrar una lista
// de la familia moviendo sus items comprados a la despensa, y consultar lo
// comprado. La familia viaja SIEMPRE en los argumentos — es la activa que
// `requireActiveFamily` dejó verificada — y una lista (o compra) de otra
// familia es como si no existiera, como en `lists.ts`/`items.ts`.
//
// El nombre canónico de los productos (`normalizeItemName`) vive ahora en
// `#lib/normalize-name`, fuera de `src/lib/server`: el cliente lo usa para
// buscar sugerencias de categoría por nombre (#173).

/** Cómo acabó un intento de finalización. */
export type FinalizeOutcome =
	/** La compra se cerró: historial creado, despensa actualizada y comprados fuera. */
	| 'finalized'
	/** La lista no existe en esa familia (id ajeno o ya borrado). */
	| 'list-gone'
	/** El establecimiento elegido (#185) no existe en esa familia (id ajeno o rancio). */
	| 'store-gone'
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
function canonicalOrder(a: string, b: string): number {
	return a < b ? -1 : a > b ? 1 : 0;
}

/**
 * Finaliza la compra de una lista DE LA FAMILIA: los items comprados pasan a
 * la despensa (sumando si el producto ya estaba, mismo nombre normalizado y
 * misma unidad), se registra el historial con el total escrito a mano y los
 * comprados desaparecen de la lista — que NO se borra y conserva intactos los
 * pendientes (criterio de aceptación de la #43).
 *
 * La categoría hereda al aterrizar (#175): el producto de despensa solo toma
 * la del item si NO tenía ya una — la existente siempre gana —, y el snapshot
 * del historial congela la categoría del momento por id y por nombre.
 *
 * El establecimiento elegido (#185) viaja como id OPCIONAL y se resuelve
 * DENTRO de la transacción, igual que la lista: solo vale uno de la familia
 * activa y el snapshot congela su nombre visible (`storeName`, patrón
 * `listName`). A diferencia de la categoría del item — que un id rancio
 * degrada en silencio a «sin categoría» — aquí el fallo ES el resultado
 * (`store-gone`): quien finaliza eligió la tienda a propósito, y guardar la
 * compra sin ella sin avisar le mentiría en el historial.
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
	userId: string,
	storeId?: string
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

			// El establecimiento elegido (#185): ANTES de bloquear nada — si el id
			// es rancio (lo borraron mientras se rellenaba el modal) o ajeno a la
			// familia, la compra no se cierra y el action lo explica; sin locks ni
			// escrituras que revertir. El `''` del option vacío significa
			// «sin establecimiento», lo mismo que ausente.
			let store: { id: string; name: string } | null = null;
			if (storeId) {
				store = await tx.store.findFirst({
					where: { id: storeId, organizationId: familyId },
					select: { id: true, name: true }
				});
				if (!store) {
					return 'store-gone';
				}
			}

			// El reclamo (ver arriba): filas bloqueadas EN ORDEN DE LISTA — el
			// mismo que el alta rápida y el que mostrará el historial. `quantity`
			// vuelve como Decimal de la base y `unit` como el string del enum.
			// La categoría viaja por id y por nombre visible (#175): el id para
			// la FK del snapshot y el nombre para congelarlo (patrón `listName`).
			// El `FOR UPDATE OF i` es obligatorio con el JOIN: a secas intentaría
			// bloquear también las filas de `category` — lado nullable del LEFT
			// JOIN — y Postgres lo rechaza con error.
			const purchased = await tx.$queryRaw<
				Array<{
					id: string;
					name: string;
					quantity: Prisma.Decimal;
					unit: Unit;
					categoryId: string | null;
					categoryName: string | null;
				}>
			>`
				SELECT i."id", i."name", i.quantity, i.unit, i."categoryId", c.name AS "categoryName"
				FROM "item" i
				LEFT JOIN "category" c ON c."id" = i."categoryId"
				WHERE i."listId" = ${list.id} AND i.purchased = true
				ORDER BY i."order" ASC, i."createdAt" ASC, i."id" ASC
				FOR UPDATE OF i
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
			// item comprado — en el ORDEN DE LA LISTA en que se compraron, que
			// es la que acaban de traer los locks y la que congela `position`
			// (issue #109) —, con el total a mano y quién finalizó.
			await tx.purchaseRecord.create({
				data: {
					organizationId: familyId,
					listId: list.id,
					listName: list.name,
					// El establecimiento del momento (#185): por id para la FK y por
					// nombre visible congelado (patrón `listName`) — borrar o
					// renombrar la tienda después solo le quita el id (SetNull),
					// nunca el nombre que llevaba el ticket.
					storeId: store?.id,
					storeName: store?.name,
					total,
					userId,
					items: {
						create: purchased.map((item, position) => ({
							position,
							name: item.name,
							quantity: item.quantity,
							unit: item.unit,
							// El snapshot es fiel a lo comprado (#175): la categoría del
							// momento, por id Y por nombre. Borrar la categoría después
							// quita el id (SetNull) pero nunca el nombre congelado.
							categoryId: item.categoryId,
							categoryName: item.categoryName
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
			//
			// La categoría del aterrizaje la fija el PRIMER item del grupo
			// (#175): el recorrido sigue el orden de lista y los items del
			// mismo producto empatan en el orden canónico (mismo canónico y
			// unidad), así que «la primera del orden canónico» es este
			// primero de lista — determinista en compras y duplicados.
			interface PantryLanding {
				name: string;
				normalizedName: string;
				unit: Unit;
				quantity: number;
				categoryId: string | null;
			}
			const landings = new Map<string, PantryLanding>();
			for (const item of purchased) {
				const normalizedName = normalizeItemName(item.name);
				const key = `${normalizedName}\n${item.unit}`;
				const previous = landings.get(key);
				if (previous) {
					previous.quantity += Number(item.quantity);
					continue;
				}
				landings.set(key, {
					name: item.name,
					normalizedName,
					unit: item.unit,
					quantity: Number(item.quantity),
					categoryId: item.categoryId
				});
			}
			const inOrder = [...landings.values()].sort(
				(a, b) =>
					canonicalOrder(a.normalizedName, b.normalizedName) || canonicalOrder(a.unit, b.unit)
			);

			// El upsert es el INSERT ON CONFLICT nativo de Postgres, así que dos
			// compras concurrentes que traen el mismo producto también suman
			// sin partirse.
			//
			// La herencia de categoría (#175) va ANTES, como UPDATE condicional:
			// el `where` solo matchea el producto SIN categoría, así que la
			// existente del producto siempre gana — y no hay leer-decidir-
			// escribir, la guarda la aplica la base. El create del upsert estrena
			// la categoría del aterrizaje (un producto nuevo no tenía ninguna que
			// perder) y su rama update solo suma cantidad: nunca toca la
			// categoría ya fijada. Ambas escrituras siguen el mismo orden
			// canónico del bucle, así que no aparecen ciclos de locks nuevos.
			for (const landing of inOrder) {
				if (landing.categoryId) {
					await tx.pantryItem.updateMany({
						where: {
							organizationId: familyId,
							normalizedName: landing.normalizedName,
							unit: landing.unit,
							categoryId: null
						},
						data: { categoryId: landing.categoryId }
					});
				}
				await tx.pantryItem.upsert({
					where: {
						organizationId_normalizedName_unit: {
							organizationId: familyId,
							normalizedName: landing.normalizedName,
							unit: landing.unit
						}
					},
					// La primera vez manda el nombre tal y como se escribió en la
					// lista: es el que la despensa mostrará de ahí en adelante.
					create: {
						organizationId: familyId,
						name: landing.name,
						normalizedName: landing.normalizedName,
						quantity: landing.quantity,
						unit: landing.unit,
						categoryId: landing.categoryId
					},
					update: { quantity: { increment: landing.quantity } }
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

/**
 * La clave de sección de las compras SIN establecimiento (#187): las de antes
 * de la épica y las cerradas sin tienda. Es fija y sin colisiones posibles
 * (un id de tienda es un cuid y un snapshot va con prefijo), para que el
 * `?offset-<clave>` de su «Cargar más» no pise al de las demás.
 */
const NO_STORE_SECTION = 'none';

/** El prefijo de la clave de sección de un establecimiento BORRADO (#187). */
const DELETED_STORE_PREFIX = 'name:';

/**
 * El tope del offset de «Cargar más» (issue #109): sin él, un `?offset=1e21`
 * pasaba `Number.isInteger` y el `take` desmedido revientaba Prisma (500), y
 * un `?offset=1000000` volcaba el historial entero. 1000 compras son 50
 * páginas: para el historial de una familia, de sobra. Cada sección del
 * listado agrupado (#187) acota SU offset por este tope, por su cuenta.
 */
export const MAX_PURCHASES_OFFSET = 1000;

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
	/** Establecimiento congelado al comprar (#187); `null` si no llevó. */
	storeName: string | null;
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
 * Una sección del listado agrupado (#187): las compras de UN establecimiento,
 * con el offset de SU carga incremental y el aviso de historia detrás.
 */
export interface PurchaseGroupView {
	/**
	 * La clave de la sección, estable para la URL del `?offset-<clave>`: el id
	 * del establecimiento vivo, el nombre congelado con prefijo si el
	 * establecimiento se borró (SetNull + snapshot) o la fija de «Sin
	 * establecimiento». El id y no el nombre, porque el nombre puede cambiar
	 * si renombran la tienda; la clave no.
	 */
	key: string;
	/**
	 * El nombre visible del establecimiento: el actual si la tienda vive, el
	 * del snapshot si se borró. `null` en «Sin establecimiento».
	 */
	storeName: string | null;
	purchases: PurchaseSummaryView[];
	/** El offset (acotado) que sirvió esta página de la sección. */
	offset: number;
	/** ¿Queda historia detrás en esta sección? Cada una pagina por su cuenta. */
	hasMore: boolean;
}

/**
 * El historial de la familia agrupado POR ESTABLECIMIENTO (#187): una sección
 * por tienda con compras, ordenadas por la compra más reciente de cada una
 * (la que compró más nuevo sube) y las compras por fecha dentro de la suya —
 * el índice `(organizationId, createdAt desc, id)` del esquema sirve a todas
 * las consultas. «Sin establecimiento» es un bloque propio SIEMPRE al final:
 * las compras de antes de la épica y las cerradas sin tienda van ahí aunque
 * sean las más nuevas de todas.
 *
 * El establecimiento borrado no rompe nada: su FK es `SetNull` (tarea #179)
 * y sus compras conservan el nombre congelado en `storeName`, así que siguen
 * juntas en una sección con ese nombre del snapshot — el historial sobrevive
 * al borrado como sobrevive al de la lista (`listName`).
 *
 * Cada sección pagina de forma ACUMULATIVA (mismo patrón del listado plano
 * #76): la página de su offset trae TODO lo suyo hasta ese límite, no solo
 * sus filas, para que «Cargar más» añada al final de lo ya pintado. El
 * offset viaja en la URL por sección (`?offset-<clave>=n`): cualquier cosa
 * que no sea un entero positivo es la primera página de ese bloque, y por
 * encima del tope se ACOTA (#109) — un offset desmedido no puede ni reventar
 * el `take` de Prisma ni volcar el historial entero. Un `take` grande solo
 * relee compras de LA FAMILIA (el `where` manda), nunca las de nadie.
 */
export async function listPurchasesByStore(
	familyId: string,
	offsets: Record<string, number> = {}
): Promise<{ groups: PurchaseGroupView[] }> {
	// Las secciones que existen: un grupo por (establecimiento, nombre del
	// snapshot) con la fecha de su compra más reciente. Agrupar por AMBOS
	// separa las compras de una tienda borrada (storeId null, storeName
	// congelado) de las que nunca llevaron tienda — y las de una tienda viva
	// renombrada a medio camino viajan con dos snapshots distintos pero caen
	// en la MISMA sección (ver abajo).
	const groupedRows = await prisma.purchaseRecord.groupBy({
		by: ['storeId', 'storeName'],
		where: { organizationId: familyId },
		_max: { createdAt: true }
	});

	// Los nombres ACTUALES de los establecimientos vivos con compras: la
	// sección de una tienda viva se titula como la tienda de hoy, no como el
	// snapshot de su compra más vieja.
	const liveStoreIds = [
		...new Set(groupedRows.map((group) => group.storeId).filter((id) => id !== null))
	];
	const liveStores = await prisma.store.findMany({
		where: { organizationId: familyId, id: { in: liveStoreIds } },
		select: { id: true, name: true }
	});
	const currentNameById = new Map(liveStores.map((store) => [store.id, store.name]));

	/** Un bloque: su clave, su título, el filtro de sus compras y su tope de orden. */
	interface HistorySection {
		key: string;
		storeName: string | null;
		where: Prisma.PurchaseRecordWhereInput;
		latest: Date;
	}
	const sections = new Map<string, HistorySection>();
	for (const group of groupedRows) {
		// Imposible que un grupo exista sin fecha (alguna fila lo creó):
		// guardia de tipos.
		if (group._max.createdAt === null) continue;

		let section: HistorySection;
		if (group.storeId !== null) {
			const name = currentNameById.get(group.storeId) ?? group.storeName;
			// Sin nombre no hay sección que titular: no ocurre en la práctica
			// (finalizar siempre congela uno), y una tienda que murió ENTRE la
			// agrupación y esta consulta es «sin título» y se salta — sus
			// compras reaparecen con el snapshot en la siguiente petición.
			if (name === null) continue;
			section = {
				key: group.storeId,
				storeName: name,
				where: { storeId: group.storeId },
				latest: group._max.createdAt
			};
		} else if (group.storeName !== null) {
			// Establecimiento borrado (SetNull): sus compras quedan juntas bajo
			// el nombre congelado, como lo dejó `finalizePurchase`.
			section = {
				key: `${DELETED_STORE_PREFIX}${group.storeName}`,
				storeName: group.storeName,
				where: { storeId: null, storeName: group.storeName },
				latest: group._max.createdAt
			};
		} else {
			// Sin establecimiento: el bloque final.
			section = {
				key: NO_STORE_SECTION,
				storeName: null,
				where: { storeId: null, storeName: null },
				latest: group._max.createdAt
			};
		}

		// Dos grupos con la misma clave (tienda viva renombrada a medio
		// camino): un solo bloque, ordenado por la más nueva de las dos.
		const previous = sections.get(section.key);
		if (previous && previous.latest >= section.latest) continue;
		sections.set(section.key, section);
	}

	// Secciones por su compra más reciente (el desempate por clave, canónico
	// como en todo el módulo: dos con el mismo instante no bailan), con «Sin
	// establecimiento» SIEMPRE al final.
	const ordered = [...sections.values()].sort((a, b) => {
		if (a.key === NO_STORE_SECTION) return 1;
		if (b.key === NO_STORE_SECTION) return -1;
		if (a.latest.getTime() !== b.latest.getTime()) {
			return b.latest.getTime() - a.latest.getTime();
		}
		return canonicalOrder(a.key, b.key);
	});

	// La página de CADA bloque, acumulativa y acotada por su cuenta (#109).
	const groups: PurchaseGroupView[] = [];
	for (const section of ordered) {
		const requestedOffset = offsets[section.key];
		const from =
			Number.isInteger(requestedOffset) && requestedOffset > 0
				? Math.min(requestedOffset, MAX_PURCHASES_OFFSET)
				: 0;

		const rows = await prisma.purchaseRecord.findMany({
			where: { organizationId: familyId, ...section.where },
			orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
			select: { id: true, listName: true, total: true, createdAt: true },
			// Una compra de más para saber si queda historia detrás (#76).
			take: from + PURCHASES_PAGE_SIZE + 1
		});
		// Raro (la tienda murió entre la agrupación y esta consulta): una
		// sección vacía solo sería ruido, mejor fuera.
		if (rows.length === 0) continue;

		const hasMore = rows.length > from + PURCHASES_PAGE_SIZE;
		groups.push({
			key: section.key,
			storeName: section.storeName,
			offset: from,
			hasMore,
			purchases: rows.slice(0, from + PURCHASES_PAGE_SIZE).map(toSummary)
		});
	}
	return { groups };
}

/**
 * El detalle de una compra de la familia con sus items snapshot (#76). `null`
 * si no existe ahí (id ajeno o rancio): sin revelar si vive en otra familia.
 * Los items vuelven en el orden en que se compraron: es la `position` que
 * `finalizePurchase` congeló (issue #109) — sin ella, el orden dependía del
 * orden físico de inserción, que Postgres no promete que se conserve.
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
			// El establecimiento del momento (#187): congelado al finalizar, el
			// ticket lo muestra aunque la tienda se renombre o se borre.
			storeName: true,
			items: {
				orderBy: { position: 'asc' },
				select: { id: true, name: true, quantity: true, unit: true }
			}
		}
	});
	if (!row) {
		return null;
	}
	return {
		...toSummary(row),
		storeName: row.storeName,
		items: row.items.map((item) => ({
			id: item.id,
			name: item.name,
			quantity: Number(item.quantity),
			unit: item.unit
		}))
	};
}

// ---- Gastos por día del calendario (épica #212, tarea #219): el total de
// cada día del mes y sus compras para el detalle. La clave de día es la MISMA
// `YYYY-MM-DD` que llevan las celdas del grid (`dateKeyOf`) y los grupos de
// menús (`listMealPlans`), para que la vista los cuelgue de cada celda sin
// buscar. ----

/** Una compra de UN día del calendario (#219), el detalle que pinta la celda. */
export interface PurchaseDayPurchaseView {
	id: string;
	/**
	 * El nombre visible del establecimiento: el ACTUAL si la tienda vive, el
	 * congelado del snapshot si se borró (SetNull, #187) y `null` si la compra
	 * no llevó — el mismo criterio del listado del historial.
	 */
	storeName: string | null;
	/** `Decimal(10,2)` en la base; la vista lo lee como `number`. */
	total: number;
}

/** Un día del mes con gastos (#219): su total y las compras que lo suman. */
export interface PurchaseDayView {
	/** La suma EXACTA del día en euros: se acumula en céntimos (ver `listPurchasesByDay`). */
	total: number;
	/** Las compras del día, de la más reciente a la más antigua (el orden del historial). */
	purchases: PurchaseDayPurchaseView[];
}

/**
 * El patrón de una clave de mes (`YYYY-MM`): réplica del de `monthKeySchema`
 * del calendario y del `monthRange` de los menús (la cota de años la aplica
 * `monthQueryRange`).
 */
const MONTH_KEY_PATTERN = /^(\d{4})-(0[1-9]|1[0-2])$/;

/** Una parte de `formatToParts`, garantizada por haberla pedido al formatear. */
function partOf(parts: Intl.DateTimeFormatPart[], type: Intl.DateTimeFormatPartTypes): string {
	const value = parts.find((part) => part.type === type)?.value;
	if (value === undefined) throw new RangeError(`Intl no devolvió la parte ${type}`);
	return value;
}

/**
 * El formateador de la clave de día, HOISTEADO a scope de módulo: construir
 * un `Intl.DateTimeFormat` es caro y la agregación lo invoca una vez por
 * compra del mes (cientos) — una construcción por proceso basta, como el
 * `weekdayLabels` del grid.
 */
const DAY_KEY_FORMATTER = new Intl.DateTimeFormat('en', {
	timeZone: APP_TIME_ZONE,
	year: 'numeric',
	month: '2-digit',
	day: '2-digit'
});

/**
 * La clave de día (`YYYY-MM-DD`) de una compra, resuelta EN LA ZONA DE LA
 * APP: réplica de `dateKeyOf` (`src/routes/calendar/grid.ts`) porque la UI
 * cuelga los gastos de las celdas por ESTA clave y tiene que coincidir letra
 * a letra — locale `en` por la misma razón que allí: es una clave interna,
 * no un texto para pintar.
 *
 * A diferencia del `dayKeyOf` de los menús — columna `@db.Date`, una fecha
 * pura que ya viene en día de calendario —, aquí `createdAt` es TIMESTAMPTZ
 * (UTC en la base) y el día de Madrid puede ser el SIGUIENTE al UTC: una
 * compra de las 00:30 españolas son las 22:30/23:30 UTC de la víspera según
 * el DST. `Intl` aplica la zona COMPLETA — CET/CEST según la fecha, sin
 * offset a mano — que es justo lo que el caso pide.
 */
function dayKeyOf(createdAt: Date): string {
	const parts = DAY_KEY_FORMATTER.formatToParts(createdAt);
	return `${partOf(parts, 'year')}-${partOf(parts, 'month')}-${partOf(parts, 'day')}`;
}

/**
 * El rango UTC que cubre toda compra cuyo día de Madrid caiga en el mes.
 * Madrid va al ESTE de UTC (CET = UTC+1, CEST = UTC+2), así que su medianoche
 * del día 1 es un instante UTC de la VÍSPERA: el mes calendario madrileño
 * empieza antes en UTC de lo que dice su clave, y el rango del mes UTC a
 * secas se la comería. Ampliarlo un día por lado cubre el arrastre de sobra
 * — el DST lo aplica `Intl` al agrupar, no hay offset que calcular — y el
 * sobrante (días contiguos que Madrid no pondría en el mes) lo descarta el
 * filtro por clave al agrupar. El índice `(organizationId, createdAt desc,
 * id)` sirve a este rango igual que al listado.
 */
function monthQueryRange(monthKey: string): { gte: Date; lt: Date } {
	const match = MONTH_KEY_PATTERN.exec(monthKey);
	const year = match ? Number(match[1]) : NaN;
	if (!match || year < 1900 || year > 2099) {
		throw new RangeError(`Clave de mes inválida: ${monthKey}`);
	}
	const month = Number(match[2]);
	const DAY_MS = 24 * 60 * 60 * 1000;
	return {
		gte: new Date(Date.UTC(year, month - 1, 1) - DAY_MS),
		lt: new Date(Date.UTC(year, month, 1) + DAY_MS)
	};
}

/**
 * Los gastos de la familia en un mes, agrupados POR DÍA (#219): un `Record`
 * indexado por la clave `YYYY-MM-DD` de cada día — la misma que llevan las
 * celdas del grid (`buildMonthGrid`) y los grupos de menús
 * (`listMealPlans`) — con el total del día y sus compras para el detalle.
 * Los días sin compras no aparecen: la celda no tiene nada que colgar, y el
 * total del mes sale de sumar los totales de los días que sí.
 *
 * DECISIÓN DE DISEÑO (#219): traer las filas del mes y agrupar EN JS, no
 * `date_trunc` en `queryRaw`. Un mes son cientos de filas — de sobra — y así
 * el desplazamiento a Europe/Madrid lo aplica `Intl` con la zona completa
 * (CET/CEST según fecha, nada hardcodeado), la clave de día sale de la MISMA
 * función que usa el grid y el `where` lleva la familia SIEMPRE, como en el
 * resto de vistas del módulo.
 *
 * La suma de cada día va en CÉNTIMOS: el Decimal se aplana a `number` como
 * en toda vista, pero el total ha de ser EXACTO (#219) y la suma de floats
 * arrastra ruido (0.1 + 0.2 ≠ 0.3). Redondear cada compra a su céntimo lo
 * elimina; el día vuelve a euros UNA vez, ya sumado entero.
 */
export async function listPurchasesByDay(
	familyId: string,
	monthKey: string
): Promise<Record<string, PurchaseDayView>> {
	const range = monthQueryRange(monthKey);
	const rows = await prisma.purchaseRecord.findMany({
		where: { organizationId: familyId, createdAt: { gte: range.gte, lt: range.lt } },
		orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
		select: { id: true, total: true, createdAt: true, storeId: true, storeName: true }
	});

	// Los nombres ACTUALES de los establecimientos vivos con compras del mes:
	// UNA consulta más, como en `listPurchasesByStore`. Una tienda borrada
	// (SetNull) no está aquí y su compra conserva el nombre del snapshot.
	const liveStoreIds = [...new Set(rows.map((row) => row.storeId).filter((id) => id !== null))];
	const liveStores = await prisma.store.findMany({
		where: { organizationId: familyId, id: { in: liveStoreIds } },
		select: { id: true, name: true }
	});
	const currentNameById = new Map(liveStores.map((store) => [store.id, store.name]));

	const byDay: Record<string, PurchaseDayView> = {};
	for (const row of rows) {
		const dayKey = dayKeyOf(row.createdAt);
		// El rango UTC ampliado arrastra días contiguos ajenos al mes: solo
		// cuentan los que Madrid pone dentro.
		if (!dayKey.startsWith(`${monthKey}-`)) continue;

		const day = (byDay[dayKey] ??= { total: 0, purchases: [] });
		day.total += Math.round(Number(row.total) * 100);
		day.purchases.push({
			id: row.id,
			storeName:
				row.storeId === null ? row.storeName : (currentNameById.get(row.storeId) ?? row.storeName),
			total: Number(row.total)
		});
	}
	// De céntimos a euros, un solo reparto por día y ya con el día completo.
	for (const day of Object.values(byDay)) {
		day.total /= 100;
	}
	return byDay;
}
