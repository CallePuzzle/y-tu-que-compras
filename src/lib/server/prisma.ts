import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '$lib/generated/prisma/client';
import { dev } from '$app/environment';
import { env } from '$env/dynamic/private';

function createPrismaClient(): PrismaClient {
	// `$env/dynamic/private` y no `process.env`: en desarrollo es SvelteKit/Vite
	// quien carga el `.env`, y en producción se lee el entorno real.
	const url = env.DATABASE_URL;
	if (!url) {
		throw new Error('Falta DATABASE_URL. Ver .env.example.');
	}
	return new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });
}

// Sin esto, cada recarga en caliente reevalúa este módulo y crea otro
// PrismaClient (y otro pool de conexiones) sobre el anterior.
const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

let client: PrismaClient | undefined;

function getPrismaClient(): PrismaClient {
	if (!client) {
		client = globalForPrisma.prisma ?? createPrismaClient();
		if (dev) {
			globalForPrisma.prisma = client;
		}
	}
	return client;
}

// El cliente se crea en el primer acceso, no al importar el módulo: `vite build`
// evalúa el código de servidor sin variables de entorno, así que instanciarlo
// aquí obligaría a tener DATABASE_URL definida para compilar.
//
// Limitaciones del proxy (cubierto en prisma.spec.ts):
// - cualquier acceso lo instancia, también los accidentales (`await prisma`
//   lee `then`);
// - `prisma instanceof PrismaClient` es `false` y el depurador muestra `{}`.
const prisma = new Proxy({} as PrismaClient, {
	get(_target, property) {
		const instance = getPrismaClient();
		const value = Reflect.get(instance, property);
		return typeof value === 'function' ? value.bind(instance) : value;
	},
	has(_target, property) {
		return Reflect.has(getPrismaClient(), property);
	}
});

export default prisma;
