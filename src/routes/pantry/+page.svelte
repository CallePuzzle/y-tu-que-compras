<script lang="ts">
	import { invalidateAll } from '$app/navigation';
	import { resolve } from '$app/paths';
	import Refrigerator from '@lucide/svelte/icons/refrigerator';
	import ShoppingBasket from '@lucide/svelte/icons/shopping-basket';
	import { m } from '$lib/paraglide/messages.js';
	import type { Unit } from '$lib/schemas/item.js';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();

	/**
	 * Etiquetas de las unidades: los valores del enum NUNCA se muestran tal
	 * cual (son identificadores estables en inglés), los traduce Paraglide.
	 * El mapa se construye EN RENDER, no en scope de módulo (regla i18n).
	 */
	const UNIT_LABEL: Record<Unit, string> = {
		unit: m.unit_unit(),
		kilogram: m.unit_kilogram(),
		gram: m.unit_gram(),
		liter: m.unit_liter(),
		milliliter: m.unit_milliliter(),
		package: m.unit_package(),
		can: m.unit_can(),
		dozen: m.unit_dozen()
	};

	// Refresco al volver a la pestaña: la despensa la mueven las compras de
	// CUALQUIER miembro (al finalizar, los comprados aterrizan aquí) y la v1
	// no tiene tiempo real, así que lo barato y suficiente es revalidar al
	// volver a mirar — el criterio «actualizada tras cada compra» de la #44.
	// La página no lleva formularios, así que aquí no hay nada que machacar.
	$effect(() => {
		function alVolver() {
			if (document.visibilityState !== 'visible') return;
			void invalidateAll();
		}
		document.addEventListener('visibilitychange', alVolver);
		return () => document.removeEventListener('visibilitychange', alVolver);
	});
</script>

<svelte:head>
	<title>{m.pantry_title()} · {m.app_brand()}</title>
</svelte:head>

<section class="mx-auto max-w-md">
	<h1 class="text-2xl font-bold">{m.pantry_title()}</h1>

	{#if data.items.length === 0}
		<!-- Estado vacío con CTA (checklist #72): la despensa se llena al
		     finalizar compras, así que el CTA manda a las listas. -->
		<div class="mt-8 flex flex-col items-center gap-3 text-center">
			<Refrigerator aria-hidden="true" class="size-10 opacity-40" />
			<p class="opacity-70">{m.pantry_empty()}</p>
			<a href={resolve('/lists')} class="btn btn-primary">
				<ShoppingBasket aria-hidden="true" />
				{m.pantry_go_lists()}
			</a>
		</div>
	{:else}
		<ul class="mt-4 flex list-none flex-col gap-2">
			{#each data.items as item (item.id)}
				<li class="bg-base-200 rounded-box flex items-center gap-3 px-4 py-3">
					<p class="min-w-0 flex-1 truncate font-medium">{item.name}</p>
					<span class="badge badge-ghost shrink-0 tabular-nums">
						{item.quantity}
						{UNIT_LABEL[item.unit]}
					</span>
				</li>
			{/each}
		</ul>
	{/if}
</section>
