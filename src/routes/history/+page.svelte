<script lang="ts">
	import { resolve } from '$app/paths';
	import History from '@lucide/svelte/icons/history';
	import ShoppingBasket from '@lucide/svelte/icons/shopping-basket';
	import { m } from '$lib/paraglide/messages.js';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();
</script>

<svelte:head>
	<title>{m.history_title()} · {m.app_brand()}</title>
</svelte:head>

<section class="mx-auto max-w-md">
	<h1 class="text-2xl font-bold">{m.history_title()}</h1>

	{#if data.purchases.length === 0}
		<!-- Estado vacío con CTA (como la despensa): el historial se llena al
		     finalizar compras, así que el CTA manda a las listas. -->
		<div class="mt-8 flex flex-col items-center gap-3 text-center">
			<History aria-hidden="true" class="size-10 opacity-40" />
			<p class="opacity-70">{m.history_empty()}</p>
			<a href={resolve('/lists')} class="btn btn-primary">
				<ShoppingBasket aria-hidden="true" />
				{m.history_go_lists()}
			</a>
		</div>
	{:else}
		<!-- Cada compra abre su detalle: lista de origen (la del snapshot, que
		     se conserva aunque la lista se borre), fecha y total a mano. El
		     orden ya trae el servidor: más reciente primero (#76). -->
		<ul class="mt-4 flex list-none flex-col gap-2">
			{#each data.purchases as compra (compra.id)}
				<li class="bg-base-200 rounded-box">
					<a
						href={resolve('/history/[purchaseId]', { purchaseId: compra.id })}
						class="flex items-center gap-3 px-3 py-2 sm:px-4"
					>
						<span class="min-w-0 flex-1">
							<span class="block truncate font-medium">{compra.listName}</span>
							<span class="block text-sm opacity-70">{compra.date}</span>
						</span>
						<span class="badge badge-ghost shrink-0 tabular-nums">{compra.total}</span>
					</a>
				</li>
			{/each}
		</ul>

		{#if data.hasMore}
			<!-- Carga incremental (#76): el load ACUMULA (la página de un offset
			     incluye todo lo anterior), así que este formulario GET añade al
			     final de lo ya pintado. El router de SvelteKit maneja los GET como
			     un enlace (navegación en cliente) y sin JavaScript vale el submit
			     nativo: el resultado es el mismo. -->
			<form action={resolve('/history')} class="mt-4">
				<input type="hidden" name="offset" value={data.nextOffset} />
				<button type="submit" class="btn btn-ghost w-full">{m.history_load_more()}</button>
			</form>
		{/if}
	{/if}
</section>
