import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';

// Test de INTEGRACIÓN (proyecto vitest `integration`): las funciones de
// `#lib/server/stores.ts` contra un Postgres real con las migraciones
// aplicadas. Como en `categories.int.spec.ts` no hacen falta sesiones: las
// familias de prueba se crean directamente con Prisma (el plugin de tenancy no
// entra en el camino) y lo que se ejercita es el CRUD con el filtro de familia
// activa — el criterio de la user story #181: cada familia gestiona solo lo
// suyo, los ids ajenos no se pueden tocar ni por error, y el duplicado se
// rechaza sobre el nombre NORMALIZADO con el P2002 traducido a
// `StoreExistsError`. El borrado también verifica el SetNull prometido por la
// épica #177 (tarea #179): las compras del historial sobreviven sin
// establecimiento y conservan su snapshot `storeName`.
import type { StoreData } from '#lib/schemas/store.js';
import prisma from './prisma.js';
import { StoreExistsError, createStore, deleteStore, listStores, updateStore } from './stores.js';

/** Crea una familia directamente en la base y devuelve su id. */
async function familyRow(prefix: string): Promise<string> {
	const id = randomUUID();
	await prisma.organization.create({
		data: {
			id,
			name: `${prefix} ${id.slice(0, 8)}`,
			// El formato de `slug` lo exige el plugin (^[a-z0-9-]+$, máx 50); aquí
			// solo hace falta cumplirlo para la FK.
			slug: `familia-${id.slice(0, 13).toLowerCase()}`
		}
	});
	return id;
}

/** Datos válidos según `storeSchema`, para mutar campo a campo en cada spec. */
const MERCADONA: StoreData = { name: 'Mercadona' };

describe('CRUD de establecimientos por familia (#181)', () => {
	it('createStore guarda el nombre y su canónico normalizado', async () => {
		const familyId = await familyRow('Familia Compradora');

		const store = await createStore(familyId, { name: 'Mercadona  Centro' });
		expect(store).toMatchObject({ name: 'Mercadona  Centro' });
		expect(await prisma.store.findUniqueOrThrow({ where: { id: store.id } })).toMatchObject({
			// El canónico del duplicado lo calcula el SERVIDOR con el mismo
			// `normalizeItemName` de la despensa y las categorías: minúsculas,
			// sin acentos y espacios colapsados.
			normalizedName: 'mercadona centro',
			organizationId: familyId
		});
	});

	it('createStore rechaza el duplicado normalizado; otra familia sí puede tenerlo', async () => {
		const mia = await familyRow('Familia Primera');
		const ajena = await familyRow('Familia Segunda');
		await createStore(mia, MERCADONA);

		// «mercadona» es el mismo canónico que «Mercadona»: el único
		// (familia, normalizedName) lo rechaza y sale como el error de dominio
		// que la acción traducirá al mensaje de la UI (checklist #181).
		await expect(createStore(mia, { name: 'mercadona' })).rejects.toBeInstanceOf(StoreExistsError);
		await expect(createStore(mia, { name: ' MERCADONA ' })).rejects.toBeInstanceOf(
			StoreExistsError
		);

		// Sin fugas entre familias: el mismo nombre en OTRA familia es válido.
		const ajenaStore = await createStore(ajena, { name: 'MERCADONA' });
		expect(ajenaStore.name).toBe('MERCADONA');
	});

	it('listStores devuelve solo los de la familia, por orden de creación', async () => {
		const mia = await familyRow('Familia Listadora');
		const ajena = await familyRow('Familia Ajena');

		const primero = await createStore(mia, MERCADONA);
		const segundo = await createStore(mia, { name: 'Lidl' });
		await createStore(ajena, { name: 'Establecimiento secreto' });

		const stores = await listStores(mia);
		expect(stores.map((store) => store.id)).toEqual([primero.id, segundo.id]);
		expect(stores).toEqual([
			{ id: primero.id, name: 'Mercadona' },
			{ id: segundo.id, name: 'Lidl' }
		]);
	});

	it('updateStore renombra el propio; uno ajeno o inexistente devuelve false', async () => {
		const mia = await familyRow('Familia Editora');
		const ajena = await familyRow('Familia Intacta');
		const propio = await createStore(mia, MERCADONA);
		const externo = await createStore(ajena, MERCADONA);

		expect(await updateStore(mia, propio.id, { name: 'Mercadona del barrio' })).toBe(true);
		expect(await prisma.store.findUniqueOrThrow({ where: { id: propio.id } })).toMatchObject({
			name: 'Mercadona del barrio',
			normalizedName: 'mercadona del barrio'
		});

		// El id de un establecimiento de OTRA familia no se puede actualizar
		// aunque se conozca: el filtro de familia activa lo hace inalcanzable.
		expect(await updateStore(mia, externo.id, { name: 'Vándalo' })).toBe(false);
		expect((await prisma.store.findUniqueOrThrow({ where: { id: externo.id } })).name).toBe(
			'Mercadona'
		);
		expect(await updateStore(mia, randomUUID(), MERCADONA)).toBe(false);
	});

	it('updateStore rechaza el renombrado a un duplicado; renombrar al mismo nombre no choca', async () => {
		const familyId = await familyRow('Familia Renombradora');
		const mercadona = await createStore(familyId, MERCADONA);
		const lidl = await createStore(familyId, { name: 'Lidl' });

		await expect(updateStore(familyId, lidl.id, { name: 'mercadona' })).rejects.toBeInstanceOf(
			StoreExistsError
		);
		// El rechazo no dejó un establecimiento a medias: lidl sigue intacto.
		expect(await prisma.store.findUniqueOrThrow({ where: { id: lidl.id } })).toMatchObject({
			name: 'Lidl'
		});

		// Renombrar al MISMO nombre (con espacios que el trim quita) pasa por el
		// único sin chocar consigo mismo: Postgres ignora el update sin cambios.
		expect(await updateStore(familyId, mercadona.id, { name: ' Mercadona ' })).toBe(true);
	});

	it('deleteStore borra solo el propio; las compras quedan sin store pero conservan storeName (SetNull)', async () => {
		const mia = await familyRow('Familia Destructora');
		const ajena = await familyRow('Familia Superviviente');
		const propio = await createStore(mia, MERCADONA);
		const externo = await createStore(ajena, MERCADONA);

		// Compra del historial apuntando al establecimiento: el snapshot
		// `storeName` congela el nombre visible del momento de comprar (#179).
		const compra = await prisma.purchaseRecord.create({
			data: {
				organizationId: mia,
				listName: 'Compra semanal',
				storeId: propio.id,
				storeName: 'Mercadona',
				total: 10.5
			}
		});

		// El ajeno no se puede borrar aunque se conozca su id…
		expect(await deleteStore(mia, externo.id)).toBe(false);
		expect(await prisma.store.findUnique({ where: { id: externo.id } })).not.toBeNull();
		expect(await deleteStore(mia, randomUUID())).toBe(false);

		// …y el propio sí: la compra sobrevive SIN establecimiento (FK SetNull)
		// y el historial conserva el nombre snapshot (el detalle nunca muestra
		// un hueco).
		expect(await deleteStore(mia, propio.id)).toBe(true);
		expect(await prisma.store.findUnique({ where: { id: propio.id } })).toBeNull();
		const historial = await prisma.purchaseRecord.findUniqueOrThrow({
			where: { id: compra.id }
		});
		expect(historial.storeId).toBeNull();
		expect(historial.storeName).toBe('Mercadona');
	});

	it('una compra sin establecimiento sigue siendo válida (storeId nullable)', async () => {
		const familyId = await familyRow('Familia Anónima');
		await createStore(familyId, MERCADONA);

		const compra = await prisma.purchaseRecord.create({
			data: { organizationId: familyId, listName: 'Compra rápida', total: 3.2 }
		});
		expect(compra.storeId).toBeNull();
		expect(compra.storeName).toBeNull();
	});

	it('borrar la familia se lleva sus establecimientos (FK en cascada)', async () => {
		const familyId = await familyRow('Familia Evanescente');
		await createStore(familyId, MERCADONA);
		await createStore(familyId, { name: 'Lidl' });

		await prisma.organization.delete({ where: { id: familyId } });

		expect(await prisma.store.findMany({ where: { organizationId: familyId } })).toHaveLength(0);
	});
});
