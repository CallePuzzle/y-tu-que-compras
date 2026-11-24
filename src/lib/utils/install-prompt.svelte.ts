import { browser } from '$app/env';

/** El evento `beforeinstallprompt` no está en `lib.dom` (no estándar). */
export interface BeforeInstallPromptEvent extends Event {
	prompt(): Promise<void>;
	userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>;
}

/**
 * Captura GLOBAL del evento `beforeinstallprompt` (#291). El navegador lo
 * dispara una sola vez por página, en cuanto considera la app instalable, y
 * puede ser ANTES de que el chunk de la landing cargue e hidrate: un listener
 * en el propio componente lo perdería (en dev pasa siempre; en producción,
 * con red lenta de móvil, también puede). Por eso el listener vive en este
 * módulo, que `hooks.client.ts` importa en el entry — el punto más temprano
 * del cliente, antes de los chunks de ruta — y el componente lee el estado
 * compartido (mismo patrón que `tour-ui.svelte.ts`).
 *
 * El `preventDefault` retira el banner automático del navegador en TODA la
 * app (el botón explícito solo está en la landing, pero el banner se
 * suprime igualmente dentro): la instalación se promueve solo con el botón
 * de la issue #291.
 */

/** El evento en sí, sin envolver en `$state`: es de un solo uso y opaco. */
let captured: BeforeInstallPromptEvent | null = null;

/** Señal reactiva para la UI: ¿hay un prompt nativo capturado y disponible? */
export const installPromptUi = $state({ available: false });

/** El evento capturado, para `prompt()` desde el click. Null si no lo hay. */
export function getCapturedInstallPrompt(): BeforeInstallPromptEvent | null {
	return captured;
}

/** El evento es de un solo uso: consumido el prompt, se retira. */
export function releaseCapturedInstallPrompt(): void {
	captured = null;
	installPromptUi.available = false;
}

if (browser) {
	window.addEventListener('beforeinstallprompt', (event) => {
		event.preventDefault();
		captured = event as BeforeInstallPromptEvent;
		installPromptUi.available = true;
	});
	// Instalada (prompt aceptado): el botón deja de tener sentido.
	window.addEventListener('appinstalled', () => {
		releaseCapturedInstallPrompt();
	});
}
