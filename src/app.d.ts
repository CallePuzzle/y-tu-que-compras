// See https://svelte.dev/docs/kit/types#app.d.ts
// for information about these interfaces
declare global {
	namespace App {
		// interface Error {}
		interface Locals {
			/** Logger de pino con el `requestId` de la request (lo crea `handleLogging`). */
			log: import('pino').Logger;
			session?: import('#lib/server/auth').auth.$Infer.Session['session'];
			user?: import('#lib/server/auth').auth.$Infer.Session['user'];
			/**
			 * Familia activa resuelta por request (`handleFamilyContext`, issue #63):
			 * `undefined` sin sesión, `null` sin familia o sin elegir todavía. Las
			 * páginas la consumen con `requireActiveFamily` (#lib/server/family-context).
			 */
			activeFamily?: import('#lib/server/family-context.js').ActiveFamily | null;
			/**
			 * Id del error no controlado de esta request, si lo hubo: lo fija
			 * `handleError` y lo expone el 500 JSON de /api/v1 (`handleApiErrors`, #279).
			 */
			errorId?: string;
		}
		// interface PageData {}
		// interface PageState {}
		// interface Platform {}
	}
}

export {};
