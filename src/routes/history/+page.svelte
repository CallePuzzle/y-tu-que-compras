<script lang="ts">
	import { resolve } from '$app/paths';
	import History from '@lucide/svelte/icons/history';
	import ShoppingBasket from '@lucide/svelte/icons/shopping-basket';
	import { m } from '#lib/paraglide/messages.js';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();
</script>

<svelte:head>
	<title>{m.history_title()} · {m.app_brand()}</title>
</svelte:head>

<section class="mx-auto max-w-md">
	<h1 class="text-2xl font-bold">{m.history_title()}</h1>

	{#if data.groups.length === 0}
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
		<!-- Una sección por establecimiento (#187): el nombre VIVO si la tienda
		     existe o el del snapshot si se borró (el historial sobrevive a
		     ambos), y «Sin establecimiento» SIEMPRE al final. El orden ya trae
		     el servidor: secciones por su compra más reciente, compras por
		     fecha dentro de la suya. -->
		<div class="mt-4 flex flex-col gap-6">
			{#each data.groups as grupo (grupo.key)}
				<section aria-labelledby={`history-${grupo.key}`}>
					<h2
						id={`history-${grupo.key}`}
						class="text-sm font-semibold tracking-wide uppercase opacity-60"
					>
						{grupo.storeName ?? m.history_no_store()}
					</h2>

					<!-- Cada compra abre su detalle: lista de origen (la del
					     snapshot, que se conserva aunque la lista se borre), fecha y
					     total a mano. -->
					<ul class="mt-2 flex list-none flex-col gap-2">
						{#each grupo.purchases as compra (compra.id)}
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

					{#if grupo.hasMore}
						<!-- Carga incremental POR SECCIÓN (#187): el load ACUMULA (la
						     página de un offset incluye todo lo anterior), así que este
						     formulario GET añade al final de SU sección. Los offsets de
						     las DEMÁS secciones viajan en inputs ocultos para que
						     cargar una no reinicie las páginas de las otras. El router
						     de SvelteKit maneja los GET como un enlace y sin JavaScript
						     vale el submit nativo: el resultado es el mismo. Como
						     navegación, SvelteKit subiría al principio y reiniciaría el
						     foco (#117): `reset="false"` deja la vista donde estaba, y
						     `replacestate` evita una entrada de historial por cada
						     tanda («atrás» sale del historial, no deshace cargas). -->
						<form
							action={resolve('/history')}
							class="mt-2"
							data-sveltekit-reset="false"
							data-sveltekit-replacestate
						>
							{#each data.groups as otra (otra.key)}
								<input
									type="hidden"
									name={`offset-${otra.key}`}
									value={otra.key === grupo.key ? grupo.nextOffset : otra.offset}
								/>
							{/each}
							<button type="submit" class="btn btn-ghost btn-sm w-full">
								{m.history_load_more()}
							</button>
						</form>
					{/if}
				</section>
			{/each}
		</div>
	{/if}
</section>
