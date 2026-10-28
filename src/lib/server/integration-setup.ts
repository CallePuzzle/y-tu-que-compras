// Entorno para el proyecto vitest `integration` (ver `vite.config.ts`):
// tests que ejercitan better-auth y el adaptador Prisma real contra una base
// de datos. Esa base DEBE ser desechable: los tests crean usuarios, familias,
// roles y sesiones con datos aleatorios y no limpian detrás suyo.
//
// Guardia contra accidentes: la `DATABASE_URL` se valida de la MISMA fuente
// que leerá `prisma.ts` (`$env/dynamic/private`, que en vitest trae el `.env`
// de Vite), para que nadie corra estos tests contra un entorno compartido por
// descuido. Solo se permite localhost (en CI el service de postgres escucha
// ahí mismo) y una base cuyo nombre acabe en `_test` (issue #125): la de
// desarrollo de `.env.example` también es local, y estos tests la llenarían
// de datos que nadie limpia.
//
// En local no hace falta configurar nada: vitest corre en modo `test`, así que
// Vite carga `.env.test` por encima de `.env` y la `DATABASE_URL` es la del
// PostgreSQL de test de docker-compose.yml (`bun run db:test:up`), el mismo de
// los e2e (que truncan la BD antes de cada spec). Un `DATABASE_URL` en el
// entorno de la shell tiene prioridad sobre ambos ficheros.
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

const url = new URL(databaseUrl);
const host = url.hostname;
if (!['localhost', '127.0.0.1', '::1', '[::1]'].includes(host)) {
	throw new Error(
		`test:integration solo corre contra una BD local desechable, pero DATABASE_URL apunta a "${host}". Si es compartida/remota, NO la uses para estos tests: crean y borran datos.`
	);
}

const database = decodeURIComponent(url.pathname.slice(1));
if (!database.endsWith('_test')) {
	throw new Error(
		`test:integration solo corre contra una BD cuyo nombre acabe en "_test", pero DATABASE_URL apunta a "${database}". La de .env.test (bun run db:test:up) ya cumple; no uses la de desarrollo: estos tests crean datos y no los limpian.`
	);
}

// Lo pide svelte-check: el `await` de arriba solo vale en un módulo, y este
// fichero de setup no exporta nada.
export {};
