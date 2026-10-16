import adapter from '@sveltejs/adapter-vercel';
import { vitePreprocess } from '@sveltejs/vite-plugin-svelte';

/** @type {import('@sveltejs/kit').Config} */
const config = {
	preprocess: vitePreprocess(),

	kit: {
		// Despliegue en Vercel (funciones serverless Node). El runtime va explícito: sin él,
		// el adapter lo deduce de la versión de Node que hace el build y falla con las que
		// Vercel no soporta. Mantenerlo alineado con `.tool-versions` y `engines.node`.
		adapter: adapter({ runtime: 'nodejs24.x' }),

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

		// Experimentales (warning esperado al compilar): `tracing.server` activa la
		// emisión de spans de SvelteKit (handle/load/actions/+server) y
		// `instrumentation.server` carga `src/instrumentation.server.ts` antes del
		// código de la app (requisito para instrumentar imports, p. ej. pg).
		experimental: {
			tracing: { server: true },
			instrumentation: { server: true }
		}
	}
};

export default config;
