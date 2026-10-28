/**
 * Tipos del punto de entrada interno `@sveltejs/kit/internal/server`.
 *
 * El `exports` del package.json de Kit declara `types: ./types/index.d.ts`
 * para esta ruta, y ese fichero NO es un módulo — TypeScript no puede tipar
 * `import { with_request_store } from '@sveltejs/kit/internal/server'` (error
 * «is not a module»). La implementación existe y es estable (la usa el propio
 * servidor de Kit); solo falta su firma.
 *
 * Se usa en los tests de integración (`*.int.spec.ts`) para correr código que
 * llama a `getRequestEvent()` fuera de `handle()` de SvelteKit, con el evento
 * del test haciendo de request real.
 */
declare module '@sveltejs/kit/internal/server' {
	/**
	 * Ejecuta `fn` con ese store de request (el que `getRequestEvent()` lee),
	 * vía el mismo AsyncLocalStorage que usa el servidor de Kit.
	 */
	export function with_request_store<T>(store: unknown, fn: () => T): T;
}
