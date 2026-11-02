import { defineEnvVars } from '@sveltejs/kit/env';

// Variables de entorno explícitas (kit 3): sustituyen al dinámico
// `$env/dynamic/private`. Todas son OPCIONALES en el esquema (`(input) =>
// input` devuelve `string | undefined`), igual que era `env.X`: cada
// consumidor decide su obligatoriedad (p. ej. `prisma.ts` exige
// `DATABASE_URL`, y `sender.ts` cae a «sin SMTP» si faltan las suyas). Al no
// ser `static`, se leen del entorno al ARRANCAR (en dev/vitest, del snapshot
// de arranque de Vite; en producción, del entorno real que inyecta el
// orquestador), nunca se inlinean en el bundle — requisito para que
// `vite build` no exija secreto alguno, como documentan `prisma.ts` y
// `sender.ts`.
export const variables = defineEnvVars({
	// better-auth (auth.ts): URL pública y secret de firma de cookies.
	BETTER_AUTH_URL: {
		schema: (input) => input,
		description: 'Origen público de la app, baseURL de better-auth.'
	},
	BETTER_AUTH_SECRET: {
		schema: (input) => input,
		description: 'Secret con el que better-auth firma las cookies de sesión.'
	},
	// Origen público para enlaces de invitación (invitations.ts): cae a
	// `BETTER_AUTH_URL` y, en último lugar, al localhost de desarrollo. En el
	// clúster lo fija deploy/lib/app.libsonnet.
	ORIGIN: {
		schema: (input) => input,
		description: 'Origen público alterno para construir URLs absolutas.'
	},
	// Observabilidad (hooks.server.ts, logger.ts): la salt etiqueta la traza
	// raíz con un hash del usuario; el nivel y el entorno etiquetan los logs.
	OBSERVABILITY_SALT: {
		schema: (input) => input,
		description: 'Salt para hashear el id de usuario en la traza raíz.'
	},
	LOG_LEVEL: {
		schema: (input) => input,
		description: 'Nivel de pino (info por defecto en logger.ts).'
	},
	// Detección de Vercel (hooks.server.ts, logger.ts): las fija la plataforma.
	VERCEL: {
		schema: (input) => input,
		description: '«1» cuando la app corre en Vercel.'
	},
	VERCEL_ENV: {
		schema: (input) => input,
		description: 'Entorno de Vercel: development | preview | production.'
	},
	// Prisma (prisma.ts): cadena de conexión; obligatoria salvo durante el
	// build (el cliente se instancia perezoso vía Proxy).
	DATABASE_URL: {
		schema: (input) => input,
		description: 'Cadena de conexión PostgreSQL del cliente Prisma.'
	},
	// SMTP (sender.ts): si faltan, no hay transporte y los emails se capturan
	// para los tests (dev/test no mandan nada real). El typo `SMPT_` es
	// intencionado: así están nombradas en producción.
	SMTP_HOST: {
		schema: (input) => input,
		description: 'Host SMTP para el envío de correos.'
	},
	SMPT_AUTH_USER: {
		schema: (input) => input,
		description: 'Usuario SMTP (el typo SMPT_ es intencionado).'
	},
	SMPT_AUTH_PASS: {
		schema: (input) => input,
		description: 'Password SMTP (el typo SMPT_ es intencionado).'
	},
	SMPT_SENDER: {
		schema: (input) => input,
		description: 'Remitente de los correos (el typo SMPT_ es intencionado).'
	}
});
