import type { Page } from '@playwright/test';

/**
 * Simula «cambiar de pestaña y volver» sin navegador real: el navegador no
 * deja alterar `document.visibilityState`, así que se sombrea con
 * `defineProperty` (el getter vive en el prototipo) y se disparan los dos
 * `visibilitychange`. Es exactamente lo que escuchan los efectos de
 * revalidación al volver de `/lists` y `/lists/[listId]`.
 */
export async function volverALaPestana(page: Page): Promise<void> {
	await page.evaluate(() => {
		Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true });
		document.dispatchEvent(new Event('visibilitychange'));
		Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true });
		document.dispatchEvent(new Event('visibilitychange'));
	});
}
