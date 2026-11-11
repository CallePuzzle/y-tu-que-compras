<script lang="ts">
	import Search from '@lucide/svelte/icons/search';
	import X from '@lucide/svelte/icons/x';
	import { m } from '#lib/paraglide/messages.js';

	/**
	 * Buscador de artículos (#208), compartido por la lista y la despensa:
	 * filtrado EN CLIENTE — el load ya trae todos los items —, así que el
	 * componente solo recoge la consulta (sin debounce, el filtrado vive en
	 * `$derived` de la página) y ofrece el botón de limpiar. La consulta la
	 * posee la página vía `bind:query`; el match (nombre o categoría,
	 * normalizado) está en `item-search.ts`.
	 */
	let { query = $bindable('') }: { query?: string } = $props();
</script>

<div class="mt-4 flex flex-col gap-1">
	<label class="fieldset-label" for="item-search">{m.ui_search_label()}</label>
	<!-- La lupa, dentro del campo (posición absoluta); el X de limpiar solo
	     aparece con algo escrito — sin consulta no hay nada que limpiar. -->
	<div class="relative">
		<Search
			aria-hidden="true"
			class="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 opacity-60"
		/>
		<input
			id="item-search"
			type="text"
			class="input w-full pr-9 pl-9"
			placeholder={m.ui_search_placeholder()}
			autocomplete="off"
			bind:value={query}
		/>
		{#if query}
			<button
				type="button"
				class="btn btn-ghost btn-sm absolute top-1/2 right-1 -translate-y-1/2"
				title={m.ui_search_clear()}
				aria-label={m.ui_search_clear()}
				onclick={() => (query = '')}
			>
				<X aria-hidden="true" class="size-4" />
			</button>
		{/if}
	</div>
</div>
