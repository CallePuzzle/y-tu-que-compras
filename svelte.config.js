import adapterNode from '@sveltejs/adapter-node';
import adapterVercel from '@sveltejs/adapter-vercel';
import { vitePreprocess } from '@sveltejs/vite-plugin-svelte';

/** @type {import('@sveltejs/kit').Config} */
const config = {
	preprocess: vitePreprocess(),

	kit: {
		// Dos adapters, uno por build (SvelteKit solo admite uno y se elige al
		// compilar): el build del Dockerfile exporta ADAPTER=node y genera
		// `build/`, el servidor autocontenido de adapter-node que corre en el
		// clúster k0s sobre bun (fase 3 de la issue #30 de
		// villajilguero-oci-services; las 5.x de adapter-node son la línea
		// compatible con kit 2, la 6 exige kit 3). Sin ADAPTER (build de Vercel,
		// que entra por su origen GitLab propio; y `bun run build` local) se usa
		// adapter-vercel, igual que hasta ahora: el proyecto de Vercel no
		// necesita ningún cambio. El origen público (tras Cloudflare → Traefik)
		// lo fija `ORIGIN` en runtime, no aquí: ver deploy/ y el Dockerfile.
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
