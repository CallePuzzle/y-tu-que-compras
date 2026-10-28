<script lang="ts">
	import Check from '@lucide/svelte/icons/check';
	import Globe from '@lucide/svelte/icons/globe';
	import { m } from '$lib/paraglide/messages.js';
	import DropdownMenu from './DropdownMenu.svelte';
	import { getLocale, locales, setLocale, type Locale } from '$lib/paraglide/runtime.js';

	// Selector de idioma (issue #78). En la cabecera (`navbar-end` del layout),
	// visible también en móvil: dos locales, sin ajustes a los que esconderlo.
	//
	// La persistencia la pone Paraglide: `setLocale` escribe su cookie
	// (`PARAGLIDE_LOCALE`, primera de la estrategia) y recarga la página, de
	// modo que el siguiente SSR ya sale entero en la locale elegida — textos,
	// emails que la request dispare y formatos de `$lib/format.ts`.
	interface Props {
		class?: string;
	}

	let { class: className }: Props = $props();

	// La locale activa en render (la de la request en SSR): marca el item con
	// el check. No es reactiva a propósito: cambiar de idioma RECARGA la
	// página, no hay estado que reaccionar en caliente.
	const actual: Locale = getLocale();

	// Nombres nativos de cada idioma (no se traducen: así los reconoce quien
	// aún no entiende la interfaz). Viajan por Paraglide igualmente, como el
	// resto de texto visible.
	const NOMBRE: Record<Locale, string> = {
		es: m.ui_language_es(),
		en: m.ui_language_en()
	};
</script>

<!-- Menú con apertura por estado, no por foco (#116): ver `DropdownMenu`.
     Elegir cierra el menú, aunque `setLocale` recargue la página enseguida. -->
<DropdownMenu
	label={m.ui_language()}
	triggerClass="btn btn-ghost"
	menuClass="w-40"
	class={className}
>
	{#snippet trigger()}
		<Globe />
	{/snippet}
	{#snippet items({ close })}
		{#each locales as locale (locale)}
			<li role="none">
				<button
					type="button"
					role="menuitemradio"
					aria-checked={locale === actual}
					onclick={() => {
						close();
						setLocale(locale);
					}}
				>
					<!-- El hueco del check alinea los nombres cuando uno lo lleva. -->
					{#if locale === actual}
						<Check aria-hidden="true" />
					{:else}
						<span class="size-4" aria-hidden="true"></span>
					{/if}
					{NOMBRE[locale]}
				</button>
			</li>
		{/each}
	{/snippet}
</DropdownMenu>
