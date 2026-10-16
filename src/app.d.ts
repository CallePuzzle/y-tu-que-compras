// See https://svelte.dev/docs/kit/types#app.d.ts
// for information about these interfaces
declare global {
	namespace App {
		// interface Error {}
		interface Locals {
			/** Logger de pino con el `requestId` de la request (lo crea `handleLogging`). */
			log: import('pino').Logger;
			session?: import('$lib/server/auth').auth.$Infer.Session['session'];
			user?: import('$lib/server/auth').auth.$Infer.Session['user'];
		}
		// interface PageData {}
		// interface PageState {}
		// interface Platform {}
	}
}

export {};
