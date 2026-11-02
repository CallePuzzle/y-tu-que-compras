import adapterNode from '@sveltejs/adapter-node';
import adapterVercel from '@sveltejs/adapter-vercel';
import { vitePreprocess } from '@sveltejs/vite-plugin-svelte';
import { paraglideVitePlugin } from '@inlang/paraglide-js';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'vitest/config';
import { playwright } from '@vitest/browser-playwright';
import { sveltekit } from '@sveltejs/kit/vite';

export default defineConfig({
	plugins: [
		paraglideVitePlugin({
			project: './project.inlang',
			// Estrategia y cookie: en `project.inlang/paraglide.config.js`, la misma
			// configuración que lee el CLI del postinstall.
			outdir: './src/lib/paraglide'
		}),
		tailwindcss(),
		sveltekit({
			preprocess: vitePreprocess(),
			// Origen público, SOLO en build: kit 3 elimina la variable runtime
			// `ORIGIN` de adapter-node y la sustituye por esta opción, que queda
			// horneada en la imagen. La usa la protección CSRF de form actions y
			// remote functions: tras Cloudflare → LB → Traefik el origen no se
			// puede derivar de la request (mismo motivo por el que antes hacía
			// falta `ORIGIN` en runtime; ver deploy/lib/app.libsonnet). El job
			// `release` de CI la pasa como build-arg con el MISMO valor que
			// `serverAlias` en deploy/pro; sin la variable (Vercel, build local,
			// dev) kit deriva el origen de la request como siempre. El `||`
			// normaliza la cadena vacía del ARG por defecto del Dockerfile:
			// kit rechaza `paths.origin: ''` (config_origin_invalid).
			paths: { origin: process.env.ORIGIN || undefined },

			// Dos adapters, uno por build (SvelteKit solo admite uno y se elige al
			// compilar): el build del Dockerfile exporta ADAPTER=node y genera
			// `build/`, el servidor autocontenido de adapter-node que corre en el
			// clúster k0s sobre bun (fase 3 de la issue #30 de
			// villajilguero-oci-services; la 6.x de adapter-node es la línea
			// compatible con kit 3). Sin ADAPTER (build de Vercel, que entra por
			// su origen GitLab propio; y `bun run build` local) se usa
			// adapter-vercel, igual que hasta ahora: el proyecto de Vercel no
			// necesita ningún cambio.
			adapter:
				process.env.ADAPTER === 'node' ? adapterNode() : adapterVercel({ runtime: 'nodejs24.x' }),

			// CSP con nonces/hashes generados por SvelteKit para sus scripts inline.
			// `style-src 'unsafe-inline'`: las transiciones de Svelte y los `style=` de los
			// componentes inyectan estilos en línea que no pueden llevar nonce.
			// El resto de cabeceras de seguridad se fijan en `src/hooks.server.ts`.
			csp: {
				mode: 'auto',
				directives: {
					'default-src': ['self'],
					'script-src': ['self'],
					'style-src': ['self', 'unsafe-inline'],
					'img-src': ['self', 'data:'],
					'font-src': ['self'],
					'connect-src': ['self'],
					'object-src': ['none'],
					'base-uri': ['self'],
					'form-action': ['self'],
					'frame-ancestors': ['none']
				}
			},

			// Spans de OpenTelemetry de SvelteKit (handle/load/actions/+server):
			// opción de primer nivel en kit 3 (antes iba bajo `experimental`).
			// `src/instrumentation.server.ts` se carga solo (kit 3 la detecta sin
			// opción: requisito para instrumentar imports, p. ej. pg).
			tracing: { server: true }
		})
	],
	ssr: {
		// El barrel de `@callepuzzle/svelte-ui` arrastra formsnap y
		// sveltekit-superforms, que importan los módulos virtuales `$app/*`.
		// Vite 8 los externaliza en SSR y Node no sabe resolver `$app`: hay
		// que bundlarlos.
		noExternal: ['@callepuzzle/svelte-ui', '@callepuzzle/core', 'formsnap', 'sveltekit-superforms']
	},
	test: {
		expect: { requireAssertions: true },
		// El proyecto `client` corre en Chromium real (vitest browser mode):
		// los tests de componentes de la app empiezan con el `FamilySwitcher`.
		// `locale` fija `navigator.language`/Accept-Language del contexto: sin
		// ella el Chromium hereda la locale del sistema y, con la detección por
		// Accept-Language de la #78, los textos de los componentes saldrían en
		// el idioma del runner (en-US en CI) rompiendo las aserciones.
		// Si algún día no queda ninguno, que no falle la suite por eso.
		passWithNoTests: true,
		projects: [
			{
				extends: './vite.config.ts',
				test: {
					name: 'client',
					browser: {
						enabled: true,
						provider: playwright({ contextOptions: { locale: 'es-ES' } }),
						instances: [{ browser: 'chromium', headless: true }]
					},
					include: ['src/**/*.svelte.{test,spec}.{js,ts}'],
					exclude: ['src/lib/server/**']
				}
			},

			{
				extends: './vite.config.ts',
				test: {
					name: 'server',
					environment: 'node',
					include: ['src/**/*.{test,spec}.{js,ts}'],
					exclude: ['src/**/*.svelte.{test,spec}.{js,ts}', 'src/**/*.int.spec.{js,ts}']
				}
			},

			{
				extends: './vite.config.ts',
				test: {
					name: 'integration',
					environment: 'node',
					// Tests que ejercitan el adaptador Prisma real (seed de familias,
					// sesiones, hooks del plugin): necesitan un Postgres con las
					// migraciones aplicadas (`DATABASE_URL`; en CI hay un service).
					// El resto de la suite sigue funcionando sin base de datos.
					include: ['src/**/*.int.spec.{js,ts}'],
					setupFiles: ['src/lib/server/integration-setup.ts']
				}
			}
		]
	}
});
