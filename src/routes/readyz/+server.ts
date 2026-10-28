import type { RequestHandler } from '@sveltejs/kit';

import prisma from '$lib/server/prisma';

/**
 * Readiness del clúster (issue #124): 200 solo si la base de datos responde
 * (`SELECT 1` por el adaptador pg real). Un 503 saca el pod del Service sin
 * reiniciarlo (eso lo decide `/healthz`), de modo que un apagón de Postgres
 * o un pool agotado se ven en las probes y no en las peticiones de los
 * usuarios.
 *
 * Ruta pública (exenta en `isPublicPathname`) y sin log de request (ver
 * `handleLogging`).
 */
export const prerender = false;

export const GET: RequestHandler = async () => {
	try {
		await prisma.$queryRaw`SELECT 1`;
		return new Response('ready');
	} catch {
		return new Response('database unavailable', { status: 503 });
	}
};
