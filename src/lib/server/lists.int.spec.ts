import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';

// Test de INTEGRACIÓN (proyecto vitest `integration`): las funciones de
// `$lib/server/lists.ts` contra un Postgres real con las migraciones
// aplicadas. A diferencia de `families.int.spec.ts` no hacen falta sesiones ni
// el router de better-auth: las listas solo cuelgan de la organización por FK,
// así que las familias de prueba se crean directamente con Prisma (el plugin
// de tenancy no entra en el camino) y lo que se ejercita es el CRUD con el
// filtro de familia activa — el criterio de la issue #66: cada familia ve solo
// lo suyo, y los ids ajenos no se pueden tocar ni por error.
import type { ListData } from '$lib/schemas/list.js';
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
const LISTA: ListData = { name: 'Frutería del barrio', color: 'primary', icon: 'shopping-basket' };

describe('CRUD de listas por familia (#66)', () => {
	it('createList guarda nombre, color e icono en la familia dada', async () => {
		const familyId = await familyRow('Familia Creadora');

		const created = await createList(familyId, LISTA);
		expect(created).toMatchObject({ name: LISTA.name, color: LISTA.color, icon: LISTA.icon });

		const row = await prisma.list.findUniqueOrThrow({ where: { id: created.id } });
		expect(row.organizationId).toBe(familyId);
	});

	it('listLists devuelve las listas de la familia y no las de otras', async () => {
		const mia = await familyRow('Familia Propia');
		const ajena = await familyRow('Familia Ajena');

		const propia = await createList(mia, { ...LISTA, name: 'Compra semanal' });
		await createList(ajena, { ...LISTA, name: 'Lista secreta' });

		const lists = await listLists(mia);
		expect(lists.map((list) => list.id)).toEqual([propia.id]);
		expect(lists[0]).toMatchObject({ name: 'Compra semanal' });
	});

	it('updateList cambia una lista propia; con una ajena devuelve false y no la toca', async () => {
		const mia = await familyRow('Familia Editora');
		const ajena = await familyRow('Familia Intacta');
		const propia = await createList(mia, LISTA);
		const externa = await createList(ajena, LISTA);

		const changed = await updateList(mia, propia.id, {
			name: 'Lidl',
			color: 'success',
			icon: 'shopping-cart'
		});
		expect(changed).toBe(true);
		expect(await prisma.list.findUniqueOrThrow({ where: { id: propia.id } })).toMatchObject({
			name: 'Lidl',
			color: 'success',
			icon: 'shopping-cart'
		});

		// El id de una lista de OTRA familia no se puede actualizar aunque se
		// conozca: el filtro de familia activa lo hace inalcanzable.
		const foreign = await updateList(mia, externa.id, { ...LISTA, name: 'Vándalo' });
		expect(foreign).toBe(false);
		expect((await prisma.list.findUniqueOrThrow({ where: { id: externa.id } })).name).toBe(
			LISTA.name
		);
	});

	it('updateList devuelve false para un id inexistente', async () => {
		const familyId = await familyRow('Familia Fantasma');
		expect(await updateList(familyId, randomUUID(), LISTA)).toBe(false);
	});

	it('deleteList borra solo de su familia; una ajena devuelve false y queda', async () => {
		const mia = await familyRow('Familia Borradora');
		const ajena = await familyRow('Familia Superviviente');
		const propia = await createList(mia, LISTA);
		const externa = await createList(ajena, LISTA);

		expect(await deleteList(mia, externa.id)).toBe(false);
		expect(await prisma.list.findUnique({ where: { id: externa.id } })).not.toBeNull();

		expect(await deleteList(mia, propia.id)).toBe(true);
		expect(await prisma.list.findUnique({ where: { id: propia.id } })).toBeNull();
	});

	it('borrar la familia se lleva sus listas (FK en cascada)', async () => {
		const familyId = await familyRow('Familia Evanescente');
		const a = await createList(familyId, LISTA);
		const b = await createList(familyId, { ...LISTA, name: 'Parafarmacia' });

		await prisma.organization.delete({ where: { id: familyId } });

		expect(await prisma.list.findMany({ where: { id: { in: [a.id, b.id] } } })).toHaveLength(0);
	});
});
