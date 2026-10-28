<script lang="ts">
	import { page } from '$app/state';
	import { resolve } from '$app/paths';
	import House from '@lucide/svelte/icons/house';
	import { m } from '$lib/paraglide/messages.js';

	// Página de error propia (#118): sin ella SvelteKit pinta la suya, en
	// inglés y sin el layout de la app. Se renderiza DENTRO del layout raíz.
	//
	// - 404: texto propio (el de SvelteKit es «Not Found», en inglés).
	// - Otros 4xx: el mensaje del `error()` de la acción/endpoint, que la app
	//   ya escribe traducido (p. ej. `families/active`).
	// - 5xx: genérico; el mensaje de SvelteKit («Internal Error») no se enseña.
	const mensaje = $derived(
		page.status === 404
			? m.error_not_found()
			: page.status < 500 && page.error?.message
				? page.error.message
				: m.error_unexpected()
	);
</script>

<svelte:head>
	<title>{m.error_title({ status: page.status })} · {m.app_brand()}</title>
</svelte:head>

<section class="mx-auto flex max-w-md flex-col items-center gap-4 py-8 text-center">
	<h1 class="text-2xl font-bold">{m.error_title({ status: page.status })}</h1>
	<p class="opacity-70">{mensaje}</p>
	<a href={resolve('/')} class="btn btn-primary">
		<House aria-hidden="true" />
		{m.error_home()}
	</a>
</section>
