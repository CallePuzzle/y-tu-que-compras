// Entorno para el proyecto vitest `integration` (ver `vite.config.ts`):
// tests que ejercitan better-auth y el adaptador Prisma real contra una base
// de datos. Esa base DEBE ser desechable: los tests crean usuarios, familias,
// roles y sesiones con datos aleatorios y no limpian detrás suyo.
//
// Guardia contra accidentes: la `DATABASE_URL` se valida de la MISMA fuente
// que leerá `prisma.ts` (`$env/dynamic/private`, que en vitest trae el `.env`
// de Vite), para que nadie corra estos tests contra un entorno compartido por
// descuido. Solo se permite localhost; en CI el service de postgres escucha
// ahí mismo.
//
// Nota: aquí NO se inventan `BETTER_AUTH_URL`/`BETTER_AUTH_SECRET`. El env
// dinámico se congela al arrancar vitest, así que un `process.env.X = ...` en
// este fichero jamás llegaría a `auth.ts`. Los tests firman cookies con el
// secret EFECTIVO de better-auth (ver `families.int.spec.ts`), y sin baseURL
// mejor-auth arranca con un warning inofensivo.
const { env } = await import('$env/dynamic/private');

const databaseUrl = env.DATABASE_URL;
if (!databaseUrl) {
	throw new Error(
		'test:integration necesita DATABASE_URL apuntando a una BD local con las migraciones aplicadas (postgres en :5432 + `bun run db:migrate`; en CI lo pone el workflow).'
	);
}

const host = new URL(databaseUrl).hostname;
if (!['localhost', '127.0.0.1', '::1', '[::1]'].includes(host)) {
	throw new Error(
		`test:integration solo corre contra una BD local desechable, pero DATABASE_URL apunta a "${host}". Si es compartida/remota, NO la uses para estos tests: crean y borran datos.`
	);
}

// Lo pide svelte-check: el `await` de arriba solo vale en un módulo, y este
// fichero de setup no exporta nada.
export {};
