<script lang="ts">
	import { resolve } from '$app/paths';
	import ArrowLeft from '@lucide/svelte/icons/arrow-left';
	import { formatQuantity } from '$lib/format.js';
	import { m } from '$lib/paraglide/messages.js';
	import { getLocale } from '$lib/paraglide/runtime.js';
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
</script>

<svelte:head>
	<title>{data.purchase.listName} · {m.app_brand()}</title>
</svelte:head>

<section class="mx-auto max-w-md">
	<a href={resolve('/history')} class="btn btn-ghost btn-sm -ml-2">
		<ArrowLeft aria-hidden="true" />
		{m.ui_back()}
	</a>

	<!-- La compra se identifica por su lista de origen y su fecha: ambos viajan
	     en el snapshot (#75), y la lista se muestra aunque se haya borrado. -->
	<div class="mt-1">
		<h1 class="text-2xl font-bold">{data.purchase.listName}</h1>
		<p class="mt-1 opacity-70">{data.purchase.date}</p>
	</div>

	<!-- El total introducido a mano al finalizar (#70): nunca se recalcula. -->
	<div class="bg-base-200 rounded-box mt-4 flex items-center justify-between px-4 py-3">
		<span class="font-semibold">{m.history_total()}</span>
		<span class="font-bold tabular-nums">{data.purchase.total}</span>
	</div>

	<h2 class="mt-6 text-sm font-semibold tracking-wide uppercase opacity-60">
		{m.history_items()}
	</h2>
	<ul class="mt-2 flex list-none flex-col gap-2">
		{#each data.purchase.items as item (item.id)}
			<li class="bg-base-200 rounded-box flex items-center gap-2 px-3 py-2 sm:px-4">
				<p class="min-w-0 flex-1 truncate font-medium">{item.name}</p>
				<span class="badge badge-ghost tabular-nums"
					>{formatQuantity(item.quantity, getLocale())} {UNIT_LABEL[item.unit]}</span
				>
			</li>
		{/each}
	</ul>
</section>
