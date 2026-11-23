<script module lang="ts">
	import { browser } from '$app/env';

	/** El evento `beforeinstallprompt` no está en `lib.dom` (no estándar). */
	interface BeforeInstallPromptEvent extends Event {
		prompt(): Promise<void>;
		userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>;
	}

	/**
	 * Captura del evento a nivel de módulo, y no en la instancia del
	 * componente: el navegador lo dispara en cuanto considera instalable la
	 * página, lo que puede ser ANTES de que la landing hidrate — y un
	 * listener de instancia lo perdería. El módulo de la app se ejecuta
	 * siempre antes del `load` (los módulos van deferred), y Chrome dispara
	 * el evento después de evaluar la instalabilidad, ya con el `load`
	 * pasado: la ventana alcanza al caso real (en dev, que sirve los módulos
	 * mucho más tarde, el evento sí se puede perder; lo palian los tests con
	 * el evento sintético). Con `$state` de módulo el capture vale tanto
	 * para el evento temprano como para uno que llegue después de montar. El
	 * `preventDefault` retira el banner automático del navegador: solo el
	 * botón explícito (#291).
	 */
	let captured: BeforeInstallPromptEvent | null = $state(null);

	if (browser) {
		window.addEventListener('beforeinstallprompt', (event) => {
			event.preventDefault();
			captured = event as BeforeInstallPromptEvent;
		});
		// Instalada (prompt aceptado): el botón deja de tener sentido.
		window.addEventListener('appinstalled', () => {
			captured = null;
		});
	}
</script>

<script lang="ts">
	import Download from '@lucide/svelte/icons/download';
	import Share from '@lucide/svelte/icons/share';
	import SquarePlus from '@lucide/svelte/icons/square-plus';
	import { Modal } from '@callepuzzle/svelte-ui';
	import { m } from '#lib/paraglide/messages.js';

	/**
	 * Botón «Instalar aplicación» de la landing (issue #291): la app ya es
	 * instalable (manifest y service worker, issue #135), esto facilita
	 * hacerlo con el prompt nativo del navegador. Dos modos, decididos al
	 * montar (el SSR no tiene `window`, así que oculto por defecto):
	 *
	 * - `ios` (Safari de iPhone/iPad, donde el evento no llega nunca): al
	 *   pulsar abre un modal con las instrucciones («Compartir → Añadir a
	 *   pantalla de inicio»), que es como se instala ahí.
	 * - El resto (Chrome/Edge/Brave, desktop y Android): visible solo mientras
	 *   haya un `beforeinstallprompt` capturado (ver el `<script module>`);
	 *   al pulsar, prompt nativo. Firefox, o ya instalada
	 *   (`display-mode: standalone`), sin evento: oculto.
	 */

	type Mode = 'hidden' | 'ios';

	let mode: Mode = $state('hidden');
	let iosModal: { showModal(): void } | undefined = $state();

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

	/** ¿Hay prompt nativo disponible? El SSR corta en `browser` sin tocar `window`. */
	const canPrompt = $derived(browser && captured !== null && !isStandalone());

	$effect(() => {
		if (!browser || isStandalone()) return;
		if (isIos()) mode = 'ios';
	});

	async function install() {
		if (mode === 'ios') {
			iosModal?.showModal();
			return;
		}
		const event = captured;
		if (!event) return;
		await event.prompt();
		// `userChoice` resuelve al cerrar el prompt nativo (aceptado o
		// descartado): el evento es de un solo uso, así que pase lo que pase el
		// botón se retira; si se instaló, `appinstalled` llega por su lado.
		await event.userChoice;
		captured = null;
	}
</script>

{#if mode === 'ios' || canPrompt}
	<button type="button" class="btn btn-outline" onclick={install}>
		<Download aria-hidden="true" />
		{m.landing_install_app()}
	</button>
{/if}

<!-- Instrucciones para iOS, que no tiene prompt nativo (issue #291): mismos
     iconos lucide y estilo que el resto de componentes. -->
<Modal
	bind:this={iosModal}
	type="X"
	showButton={false}
	boxClass="modal-box max-w-md"
	strings={{ close: m.landing_install_ios_close() }}
>
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
</Modal>
