import { paraglideVitePlugin } from '@inlang/paraglide-js';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'vitest/config';
import { playwright } from '@vitest/browser-playwright';
import { sveltekit } from '@sveltejs/kit/vite';

export default defineConfig({
	plugins: [
		paraglideVitePlugin({
			project: './project.inlang',
			outdir: './src/lib/paraglide',
			// Estrategia de detección (issue #78): la cookie manda (persistencia de
			// la elección del selector); sin cookie, la inicial sale de
			// `Accept-Language` (`preferredLanguage`); `globalVariable` mantiene el
			// override en caliente del runtime en cliente; la base, último recurso.
			// Ha de coincidir con el `--strategy` del postinstall: el CLI no lee
			// esta configuración del plugin de Vite.
			strategy: ['cookie', 'globalVariable', 'preferredLanguage', 'baseLocale']
		}),
		tailwindcss(),
		sveltekit()
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
