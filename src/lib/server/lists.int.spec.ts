import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';

// Test de INTEGRACIÓN (proyecto vitest `integration`): las funciones de
// `#lib/server/lists.ts` contra un Postgres real con las migraciones
// aplicadas. A diferencia de `families.int.spec.ts` no hacen falta sesiones ni
// el router de better-auth: las listas solo cuelgan de la organización por FK,
// así que las familias de prueba se crean directamente con Prisma (el plugin
// de tenancy no entra en el camino) y lo que se ejercita es el CRUD con el
// filtro de familia activa — el criterio de la issue #66: cada familia ve solo
// lo suyo, y los ids ajenos no se pueden tocar ni por error.
import type { ListData } from '#lib/schemas/list.js';
import prisma from './prisma.js';
import { createList, deleteList, listLists, updateList } from './lists.js';

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

/** Datos válidos según `listSchema`, para mutar campo a campo en cada spec. */
const LIST: ListData = { name: 'Frutería del barrio', color: 'yellow', icon: 'shopping-basket' };

describe('CRUD de listas por familia (#66)', () => {
	it('createList guarda nombre, color e icono en la familia dada', async () => {
		const familyId = await familyRow('Familia Creadora');

		const created = await createList(familyId, LIST);
		expect(created).toMatchObject({ name: LIST.name, color: LIST.color, icon: LIST.icon });

		const row = await prisma.list.findUniqueOrThrow({ where: { id: created.id } });
		expect(row.organizationId).toBe(familyId);
	});

	it('listLists devuelve las listas de la familia y no las de otras', async () => {
		const ownFamily = await familyRow('Familia Propia');
		const otherFamily = await familyRow('Familia Ajena');

		const ownList = await createList(ownFamily, { ...LIST, name: 'Compra semanal' });
		await createList(otherFamily, { ...LIST, name: 'Lista secreta' });

		const lists = await listLists(ownFamily);
		expect(lists.map((list) => list.id)).toEqual([ownList.id]);
		expect(lists[0]).toMatchObject({ name: 'Compra semanal' });
	});

	it('listLists cuenta los items pendientes de comprar (#69)', async () => {
		const ownFamily = await familyRow('Familia Contadora');
		const emptyList = await createList(ownFamily, { ...LIST, name: 'Vacía' });
		const fullList = await createList(ownFamily, { ...LIST, name: 'Llena' });

		// Items directamente en la base: el spec de listas no depende del CRUD
		// de items (eso lo ejercita `items.int.spec.ts`).
		await prisma.item.createMany({
			data: [
				{ listId: fullList.id, name: 'Leche', quantity: 2, unit: 'liter', order: 0 },
				{ listId: fullList.id, name: 'Pan', quantity: 1, unit: 'unit', order: 1, purchased: true }
			]
		});

		const lists = await listLists(ownFamily);
		expect(lists.find((list) => list.id === emptyList.id)).toMatchObject({
			itemCount: 0,
			pendingCount: 0
		});
		expect(lists.find((list) => list.id === fullList.id)).toMatchObject({
			itemCount: 2,
			pendingCount: 1
		});
	});

	it('updateList cambia una lista propia; con una ajena devuelve false y no la toca', async () => {
		const ownFamily = await familyRow('Familia Editora');
		const otherFamily = await familyRow('Familia Intacta');
		const ownList = await createList(ownFamily, LIST);
		const externalFamily = await createList(otherFamily, LIST);

		const changed = await updateList(ownFamily, ownList.id, {
			name: 'Lidl',
			color: 'green',
			icon: 'croissant'
		});
		expect(changed).toBe(true);
		expect(await prisma.list.findUniqueOrThrow({ where: { id: ownList.id } })).toMatchObject({
			name: 'Lidl',
			color: 'green',
			icon: 'croissant'
		});

		// El id de una lista de OTRA familia no se puede actualizar aunque se
		// conozca: el filtro de familia activa lo hace inalcanzable.
		const foreign = await updateList(ownFamily, externalFamily.id, { ...LIST, name: 'Vándalo' });
		expect(foreign).toBe(false);
		expect((await prisma.list.findUniqueOrThrow({ where: { id: externalFamily.id } })).name).toBe(
			LIST.name
		);
	});

	it('updateList devuelve false para un id inexistente', async () => {
		const familyId = await familyRow('Familia Fantasma');
		expect(await updateList(familyId, randomUUID(), LIST)).toBe(false);
	});

	it('deleteList borra solo de su familia; una ajena devuelve false y queda', async () => {
		const ownFamily = await familyRow('Familia Borradora');
		const otherFamily = await familyRow('Familia Superviviente');
		const ownList = await createList(ownFamily, LIST);
		const externalFamily = await createList(otherFamily, LIST);

		expect(await deleteList(ownFamily, externalFamily.id)).toBe(false);
		expect(await prisma.list.findUnique({ where: { id: externalFamily.id } })).not.toBeNull();

		expect(await deleteList(ownFamily, ownList.id)).toBe(true);
		expect(await prisma.list.findUnique({ where: { id: ownList.id } })).toBeNull();
	});

	it('borrar la familia se lleva sus listas (FK en cascada)', async () => {
		const familyId = await familyRow('Familia Evanescente');
		const a = await createList(familyId, LIST);
		const b = await createList(familyId, { ...LIST, name: 'Parafarmacia' });

		await prisma.organization.delete({ where: { id: familyId } });

		expect(await prisma.list.findMany({ where: { id: { in: [a.id, b.id] } } })).toHaveLength(0);
	});
});
