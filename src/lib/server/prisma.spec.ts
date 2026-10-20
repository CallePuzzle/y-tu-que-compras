import { beforeEach, describe, expect, it, vi } from 'vitest';

const env: Record<string, string | undefined> = {};
const appEnvironment = { dev: false, building: false };
const constructed = vi.fn();

vi.mock('$env/dynamic/private', () => ({ env }));
vi.mock('$app/environment', () => ({
	get dev() {
		return appEnvironment.dev;
	},
	get building() {
		return appEnvironment.building;
	}
}));
vi.mock('@prisma/adapter-pg', () => ({ PrismaPg: class {} }));
vi.mock('$lib/generated/prisma/client', () => ({
	PrismaClient: class {
		user = { findMany: () => 'findMany' };
		constructor() {
			constructed();
		}
		$disconnect() {
			return this;
		}
	}
}));

// El módulo guarda el cliente en una variable de módulo: cada test parte de uno nuevo.
// Se devuelve el módulo y no el proxy: resolver una promesa con el proxy lee `then`
// y lo instanciaría (justo la limitación que se documenta en prisma.ts).
async function importPrisma() {
	vi.resetModules();
	return import('./prisma');
}

describe('prisma (proxy perezoso)', () => {
	beforeEach(() => {
		constructed.mockClear();
		appEnvironment.dev = false;
		appEnvironment.building = false;
		delete env.DATABASE_URL;
	});

	it('no crea el cliente al importar el módulo', async () => {
		await importPrisma();
		expect(constructed).not.toHaveBeenCalled();
	});

	it('se instancia si se hace `await` del proxy', async () => {
		env.DATABASE_URL = 'postgresql://localhost/test';
		const { default: prisma } = await importPrisma();
		await prisma;
		expect(constructed).toHaveBeenCalledTimes(1);
	});

	it('falla en el primer acceso si falta DATABASE_URL', async () => {
		const { default: prisma } = await importPrisma();
		expect(() => prisma.user).toThrow('Falta DATABASE_URL');
	});

	it('en build sin DATABASE_URL devuelve un stub sin instanciar nada', async () => {
		// El `analyse` de SvelteKit evalúa los nodos de servidor en build y llega
		// hasta aquí vía auth (ver prisma.ts): no debe lanzar ni construir.
		// `_runtimeDataModel` es lo que lee el adapter de better-auth: si falta,
		// se salta su comprobación de schema.
		appEnvironment.building = true;
		const { default: prisma } = await importPrisma();
		const runtimeDataModel = (prisma as { _runtimeDataModel?: unknown })._runtimeDataModel;
		expect(runtimeDataModel).toBeUndefined();
		expect(constructed).not.toHaveBeenCalled();
	});

	it('crea un único cliente y enlaza sus métodos', async () => {
		env.DATABASE_URL = 'postgresql://localhost/test';
		const { default: prisma } = await importPrisma();

		expect(prisma.user.findMany()).toBe('findMany');
		const { $disconnect } = prisma;
		expect($disconnect()).toBeDefined();
		expect('user' in prisma).toBe(true);
		expect(constructed).toHaveBeenCalledTimes(1);
	});
});
