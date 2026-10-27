import prisma from '$lib/server/prisma.js';

// Finalizar compra (issues #43 y #70): cerrar una lista de la familia moviendo
// sus items comprados a la despensa. La familia viaja SIEMPRE en los
// argumentos — es la activa que `requireActiveFamily` dejó verificada — y una
// lista de otra familia es como si no existiera, como en `lists.ts`/`items.ts`.

/**
 * El nombre canónico con el que la despensa identifica un producto (#70):
 * minúsculas, sin acentos y sin espacios sobrantes. Es lo que se guarda en
 * `PantryItem.normalizedName` para que «Leche Entera», «leche entera» y
 * «LECHE entera» sumen sobre el mismo item de la despensa. Mismo trato que el
 * `slugify` de las familias (NFD + quitar diacríticos), pero conservando los
 * espacios: es un nombre, no un slug.
 */
export function normalizeItemName(name: string): string {
	return name
		.trim()
		.normalize('NFD')
		.replace(/\p{Diacritic}/gu, '')
		.toLowerCase();
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
 * Error centinela para revolver el ROLLBACK de la transacción cuando otro
 * miembro se llevó los items comprados mientras esta transacción los leía
 * (doble click, dos miembros a la vez): solo vive dentro del try de abajo,
 * que lo traduce a `nothing-purchased`.
 */
class ConcurrentFinalizeError extends Error {
	constructor() {
		super('La compra ya fue finalizada por otro miembro a la vez');
	}
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
 * La protección contra la doble finalización es un RECLAMO atómico: en vez de
 * «leo comprados, luego borro» (dos miembros podrían leer los mismos y acabar
 * con dos historiales), el `deleteMany` condicional borra solo los que SIGUEN
 * comprados y devuelve cuántos pudo borrarse. Si borra menos de los que había
 * leído, otro ganó la carrera: se lanza dentro y la transacción entera se
 * revierte (sin historial duplicado ni despensa inflada) para devolver
 * `nothing-purchased` — exactamente lo que ve el segundo click de un doble
 * click: ya no hay nada que finalizar. El que sí borra los suyos sigue con la
 * compra, y dos compras de listas distintas no se estorban: el reclamo es por
 * los items de ESTA lista.
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

			const purchased = await tx.item.findMany({
				where: { listId: list.id, purchased: true },
				select: { id: true, name: true, quantity: true, unit: true }
			});
			// «No permitir finalizar sin items comprados»: sin comprados no hay
			// compra que cerrar (y tampoco historial sin items).
			if (purchased.length === 0) {
				return 'nothing-purchased';
			}

			// El reclamo (ver arriba): gana quien se lleve los rows. Ningún
			// write posterior ocurre si la carrera se perdió.
			const claim = await tx.item.deleteMany({
				where: { id: { in: purchased.map((item) => item.id) }, purchased: true }
			});
			if (claim.count !== purchased.length) {
				throw new ConcurrentFinalizeError();
			}

			// Historial (issue #75): snapshot inmutable de la lista y de cada
			// item comprado, con el total a mano y quién finalizó.
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
			// (familia, nombre normalizado, unidad) decide si es nuevo o se suma.
			// El upsert es el INSERT ON CONFLICT nativo de Postgres, así que dos
			// compras concurrentes de listas distintas que traen el mismo
			// producto también suman sin partirse.
			for (const item of purchased) {
				const normalizedName = normalizeItemName(item.name);
				await tx.pantryItem.upsert({
					where: {
						organizationId_normalizedName_unit: {
							organizationId: familyId,
							normalizedName,
							unit: item.unit
						}
					},
					// La primera vez manda el nombre tal y como se escribió en la
					// lista: es el que la despensa mostrará de ahí en adelante.
					create: {
						organizationId: familyId,
						name: item.name,
						normalizedName,
						quantity: item.quantity,
						unit: item.unit
					},
					update: { quantity: { increment: item.quantity } }
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
