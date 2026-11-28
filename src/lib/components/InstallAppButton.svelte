<script lang="ts">
	import Download from '@lucide/svelte/icons/download';
	import EllipsisVertical from '@lucide/svelte/icons/ellipsis-vertical';
	import Share from '@lucide/svelte/icons/share';
	import SquarePlus from '@lucide/svelte/icons/square-plus';
	import { Modal } from '@callepuzzle/svelte-ui';
	import { browser } from '$app/env';
	import { m } from '#lib/paraglide/messages.js';
	import {
		getCapturedInstallPrompt,
		installPromptUi,
		releaseCapturedInstallPrompt
	} from '#lib/utils/install-prompt.svelte.js';

	/**
	 * Botón «Instalar aplicación» de la landing (issue #291): la app ya es
	 * instalable (manifest y service worker, issue #135), esto facilita
	 * hacerlo. Tres caminos, decididos al montar (el SSR no tiene `window`,
	 * así que oculto por defecto):
	 *
	 * - Prompt nativo: visible en cuanto hay un `beforeinstallprompt`
	 *   capturado (lo recoge el entry, ver `#lib/utils/install-prompt.svelte.ts`);
	 *   al pulsar, el prompt del navegador. Es el camino de Chrome/Edge/Brave.
	 * - `ios` (Safari de iPhone/iPad, donde el evento no llega nunca): al
	 *   pulsar abre un modal con las instrucciones («Compartir → Añadir a
	 *   pantalla de inicio»), que es como se instala ahí.
	 * - `android`: en Android el evento NO llega en muchos casos reales con
	 *   la app perfectamente instalable — el heurístico de engagement de
	 *   Chrome (~30s de interacción en un perfil que no la ha usado), el
	 *   recuerdo de haber descartado el banner automático tiempo atrás (la
	 *   app lo mostraba antes de #291, ya era instalable desde #135), los
	 *   navegadores in-app (WhatsApp, Instagram…), Firefox Android o bugs de
	 *   Chrome en algunos dispositivos. Ocultar el botón sin evento dejaba
	 *   sin salida a todo ese público: se muestra igual y el click abre un
	 *   modal con las instrucciones del menú del navegador. Si el evento
	 *   acaba llegando (p. ej. superado el engagement), el click pasa solo
	 *   al prompt nativo.
	 *
	 * Ya instalada (`display-mode: standalone`), oculto en todos los casos.
	 */

	type Mode = 'hidden' | 'ios' | 'android';

	let mode: Mode = $state('hidden');
	let helpModal: { showModal(): void } | undefined = $state();

	/** ¿La app ya corre instalada (standalone)? Entonces el botón no aporta nada. */
	function isStandalone(): boolean {
		return window.matchMedia('(display-mode: standalone)').matches;
	}

	/**
	 * ¿Safari de iOS/iPadOS? Por `userAgent`, con el matiz de iPadOS 13+, que
	 * se hace pasar por macOS: `Macintosh` + pantalla táctil
	 * (`maxTouchPoints` mayor que 1) la delata.
	 */
	function isIos(): boolean {
		const ua = navigator.userAgent;
		return /iPad|iPhone|iPod/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1);
	}

	/** ¿Android? Los iPadOS disfrazados de macOS no pasan por aquí. */
	function isAndroid(): boolean {
		return /Android/.test(navigator.userAgent);
	}

	/** ¿Hay prompt nativo disponible? El SSR corta en `browser` sin tocar `window`. */
	const canPrompt = $derived(browser && installPromptUi.available && !isStandalone());

	$effect(() => {
		if (!browser || isStandalone()) return;
		if (isIos()) mode = 'ios';
		else if (isAndroid()) mode = 'android';
	});

	// Instalada desde esta misma página (prompt aceptado): el modo móvil
	// deja de tener sentido aunque el evento ya estuviera consumido.
	$effect(() => {
		if (!browser) return;
		const hide = () => (mode = 'hidden');
		window.addEventListener('appinstalled', hide);
		return () => window.removeEventListener('appinstalled', hide);
	});

	async function install() {
		const event = getCapturedInstallPrompt();
		if (event && !isStandalone()) {
			await event.prompt();
			// `userChoice` resuelve al cerrar el prompt nativo (aceptado o
			// descartado): el evento es de un solo uso, así que pase lo que
			// pase se retira; si se instaló, `appinstalled` llega por su lado.
			await event.userChoice;
			releaseCapturedInstallPrompt();
			return;
		}
		// Sin evento (iOS siempre; Android cuando el navegador no lo dispara):
		// instrucciones manuales del menú del navegador.
		helpModal?.showModal();
	}
</script>

{#if mode !== 'hidden' || canPrompt}
	<button type="button" class="btn btn-outline" onclick={install}>
		<Download aria-hidden="true" />
		{m.landing_install_app()}
	</button>
{/if}

<!-- Instrucciones para quien no tiene prompt nativo (iOS siempre; Android
     cuando el navegador no dispara el evento, issue #291): mismos iconos
     lucide y estilo que el resto de componentes. -->
<Modal
	bind:this={helpModal}
	type="X"
	showButton={false}
	boxClass="modal-box max-w-md"
	strings={{ close: m.landing_install_ios_close() }}
>
	{#if mode === 'ios'}
		<h2 class="text-lg font-bold">{m.landing_install_ios_title()}</h2>
		<ol class="mt-3 list-none space-y-2 text-sm">
			<li class="flex items-start gap-2">
				<Share aria-hidden="true" class="text-primary mt-0.5 size-5 shrink-0" />
				<span>{m.landing_install_ios_step_share()}</span>
			</li>
			<li class="flex items-start gap-2">
				<SquarePlus aria-hidden="true" class="text-primary mt-0.5 size-5 shrink-0" />
				<span>{m.landing_install_ios_step_add()}</span>
			</li>
		</ol>
	{:else}
		<h2 class="text-lg font-bold">{m.landing_install_android_title()}</h2>
		<ol class="mt-3 list-none space-y-2 text-sm">
			<li class="flex items-start gap-2">
				<EllipsisVertical aria-hidden="true" class="text-primary mt-0.5 size-5 shrink-0" />
				<span>{m.landing_install_android_step_menu()}</span>
			</li>
			<li class="flex items-start gap-2">
				<Share aria-hidden="true" class="text-primary mt-0.5 size-5 shrink-0" />
				<span>{m.landing_install_android_step_chrome()}</span>
			</li>
		</ol>
	{/if}
</Modal>
