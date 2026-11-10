<script lang="ts">
	import type { SubmitFunction } from '$app/forms';
	import { page } from '$app/state';
	import { resolve } from '$app/paths';
	import ArrowLeft from '@lucide/svelte/icons/arrow-left';
	import Plus from '@lucide/svelte/icons/plus';
	import ShoppingBasket from '@lucide/svelte/icons/shopping-basket';
	import ConfirmModal from '#lib/components/ConfirmModal.svelte';
	import ItemSearch from '#lib/components/ItemSearch.svelte';
	import { matchesItemSearch } from '#lib/components/item-search.js';
	import { COLOR_CHIP, ICONS, type ListColor, type ListIcon } from '#lib/list-visuals.js';
	import { m } from '#lib/paraglide/messages.js';
	import { useRefetchOnVisible } from '#lib/refetch-on-visible.svelte.js';
	import { continueOnboardingTour } from '#lib/utils/tour.js';
	import { SvelteMap } from 'svelte/reactivity';
	import EditItemModal from './EditItemModal.svelte';
	import FinalizeModal from './FinalizeModal.svelte';
	import ItemRow from './ItemRow.svelte';
	import QuickAddForm from './QuickAddForm.svelte';
	import type { PageProps } from './$types';

	// La página coordina: los formularios viven en sus componentes (alta
	// rápida, fila, editar, finalizar) y aquí quedan el estado optimista de
	// comprado, las secciones y los avisos de página.
	let { data, form: actionData }: PageProps = $props();

	/** Una fila de items (la trae el load). */
	type Item = PageProps['data']['items'][number];

	// Icono de la lista para la cabecera (el cast recupera el literal del enum
	// tras venir de Prisma como string, igual que en /lists). Fallback
	// defensivo: un icono retirado del catálogo no rompe el render.
	const Icon = $derived(ICONS[data.list.icon as ListIcon] ?? ICONS['shopping-basket']);

	// Aviso de éxito FUERA de los modales (editar, borrar y finalizar); el
	// error de crear se queda bajo su formulario.
	let successMessage: string | null = $state(null);

	let quickAdd: QuickAddForm | undefined = $state();
	let editModal: EditItemModal | undefined = $state();
	let finalizeModal: FinalizeModal | undefined = $state();

	// ---- Borrar (checklist #68): confirmación en un `ConfirmModal` compartido,
	// igual que en /lists: el fallo se queda dentro, el éxito lo cierra. ----
	let deletedItem: Item | undefined = $state();
	let deleteModal: ConfirmModal | undefined = $state();

	function abrirEdicion(item: Item) {
		successMessage = null;
		editModal?.open(item);
	}

	function abrirBorrado(item: Item) {
		deletedItem = item;
		deleteModal?.showModal();
	}

	function openFinalize() {
		successMessage = null;
		finalizeModal?.open();
	}

	// ---- Comprado (checklist #69): checkbox con actualización OPTIMISTA. ----
	// El valor que aún no ha confirmado el servidor viaja en `compras`
	// (id -> valor): la UI lo pinta ENCIMA de `item.purchased` y lo retira
	// cuando el load trae la verdad del servidor — o en cuanto falla la
	// petición, que es la reversión prometida en el checklist.
	//
	// SvelteMap y no `$state(new Map())`: el deep-proxy de `$state` no cubre
	// los Map (ver pantry/+page.svelte), y sin él el checkbox no repintaba el
	// optimista hasta que llegaba el servidor.
	const purchasedOverrides = new SvelteMap<string, boolean>();
	let purchaseError: string | null = $state(null);

	/** El comprado mostrado: el optimista si lo hay; si no, el del servidor. */
	function isPurchased(item: Item): boolean {
		return purchasedOverrides.get(item.id) ?? item.purchased;
	}

	// Separación visual (checklist #69): pendientes arriba y comprados debajo,
	// atenuados y tachados. El orden ya trae el servidor los pendientes
	// primero (`listItems`), así que partir `data.items` conserva el `order`.
	//
	// Buscador (#208): el filtrado es EN CLIENTE — el load ya trae todos los
	// items — con la consulta en `$state` y las listas en `$derived`, sin
	// debounce. Casa por subcadena contra el nombre o la categoría,
	// normalizando ambos lados («telefono» encuentra «Teléfono fijo»).
	let searchQuery = $state('');

	/** `data.items` ya pasado por el filtro del buscador. */
	const filteredItems = $derived(data.items.filter((item) => matchesItemSearch(item, searchQuery)));
	const pendingItems = $derived(filteredItems.filter((item) => !isPurchased(item)));
	const purchasedItems = $derived(filteredItems.filter((item) => isPurchased(item)));

	/** Los comprados SIN filtrar (#208): finalizar es una acción de LISTA — el botón y el modal no desaparecen al filtrar. */
	const purchasedAllItems = $derived(data.items.filter((item) => isPurchased(item)));

	/** El toque en el checkbox: el optimista se pinta antes del envío. */
	function handleToggle(id: string, checked: boolean) {
		purchasedOverrides.set(id, checked);
		purchaseError = null;
	}

	/** Resultado del toggle: en fallo revierte y avisa; en éxito refresca. */
	function handlePurchasedResult(id: string): SubmitFunction {
		return () =>
			async ({ result, update }) => {
				if (result.type === 'success') {
					// El load traerá la verdad del servidor — incluidos los cambios
					// de otros miembros —; el optimista se retira al terminar para
					// que el checkbox no parpadee durante la recarga.
					await update();
				} else {
					// Fallo (el servidor rechazó) o error (sin respuesta): la
					// reversión es retirar el optimista, y el checkbox vuelve al
					// estado que traen los datos. Sin `update` en fallo: el error
					// se avisa aquí y no se duplica en el alert de `actionData`.
					purchaseError =
						result.type === 'failure'
							? ((result.data as { error?: string } | undefined)?.error ?? m.items_error())
							: m.items_error();
				}
				purchasedOverrides.delete(id);
			};
	}

	// Refresco al volver a la pestaña (ver `useRefetchOnVisible`): el alta
	// rápida no necesita guardia, el load ya no la rehace (`applyAction`).
	useRefetchOnVisible();

	// Tour de onboarding (#142): los dos pasos de esta página (alta rápida y
	// finalizar) son de detalle, así que la propia lista es la de ejemplo del
	// ctx y el paso de finalizar se ancla sólo con algo comprado.
	$effect(() => {
		void continueOnboardingTour(page.url.pathname, data.user ?? null, {
			exampleListId: data.list.id,
			hasPurchasedItems: data.items.some((item) => item.purchased)
		});
	});
</script>

<svelte:head>
	<title>{data.list.name} · {m.app_brand()}</title>
</svelte:head>

<section class="mx-auto max-w-md">
	<a href={resolve('/lists')} class="btn btn-ghost btn-sm -ml-2"
		><ArrowLeft aria-hidden="true" /> {m.ui_back()}</a
	>

	<div class="mt-1 flex items-center gap-3">
		<span
			class={`flex size-10 shrink-0 items-center justify-center rounded-full ${COLOR_CHIP[data.list.color as ListColor] ?? COLOR_CHIP.yellow}`}
		>
			<Icon aria-hidden="true" class="size-5" />
		</span>
		<h1 class="min-w-0 truncate text-2xl font-bold">{data.list.name}</h1>
	</div>

	<!-- Error de las acciones sin JS (borrar): con JS vive dentro de su modal. -->
	{#if actionData?.error}
		<div class="alert alert-error mt-4 text-sm" role="alert">
			{actionData.error}
		</div>
	{/if}

	{#if successMessage}
		<div class="alert alert-success mt-4 text-sm" role="status">
			{successMessage}
		</div>
	{/if}

	{#if purchaseError}
		<div class="alert alert-warning mt-4 text-sm" role="alert">
			{purchaseError}
		</div>
	{/if}

	<QuickAddForm
		bind:this={quickAdd}
		form={data.form}
		categories={data.categories}
		suggestions={data.categorySuggestions}
	/>

	{#if data.items.length === 0}
		<!-- Estado vacío (checklist #68), con CTA que enfoca el alta. -->
		<div class="mt-8 flex flex-col items-center gap-3 text-center">
			<ShoppingBasket aria-hidden="true" class="size-10 opacity-40" />
			<p class="opacity-70">{m.items_empty()}</p>
			<button type="button" class="btn btn-primary" onclick={() => quickAdd?.focus()}>
				<Plus aria-hidden="true" />
				{m.items_add()}
			</button>
		</div>
	{:else}
		<!-- Buscador (#208): entre el alta rápida y la lista, visible siempre
		     que haya artículos (este es el `{:else}` del estado vacío). -->
		<ItemSearch bind:query={searchQuery} />

		{#snippet itemRow(item: Item)}
			<ItemRow
				{item}
				purchased={isPurchased(item)}
				onPurchasedResult={handlePurchasedResult(item.id)}
				onToggle={(checked) => handleToggle(item.id, checked)}
				onEdit={() => abrirEdicion(item)}
				onDelete={() => abrirBorrado(item)}
			/>
		{/snippet}

		{#if filteredItems.length === 0}
			<!-- Sin resultados (#208): la consulta del buscador no casa con
			     ningún artículo; no es el estado vacío de la lista. -->
			<p class="mt-8 text-center opacity-70">{m.ui_search_no_results()}</p>
		{:else}
			<!-- Separación visual (checklist #69): pendientes arriba; los
			     comprados, debajo, atenuados y tachados. La cabecera de
			     «Pendientes» solo cuando hay comprados (si no, sobra). -->
			{#if pendingItems.length > 0}
				{#if purchasedItems.length > 0}
					<h2 class="mt-4 text-sm font-semibold tracking-wide uppercase opacity-60">
						{m.items_section_pending()}
					</h2>
				{/if}
				<ol class="mt-4 flex list-none flex-col gap-2">
					{#each pendingItems as item (item.id)}
						{@render itemRow(item)}
					{/each}
				</ol>
			{/if}

			{#if purchasedItems.length > 0}
				<h2 class="mt-6 text-sm font-semibold tracking-wide uppercase opacity-60">
					{m.items_section_purchased()}
				</h2>
				<ol class="mt-2 flex list-none flex-col gap-2">
					{#each purchasedItems as item (item.id)}
						{@render itemRow(item)}
					{/each}
				</ol>
			{/if}
		{/if}

		<!-- CTA de finalizar (checklist #71): solo con algo comprado — sin
		     comprados no hay compra que cerrar y el action lo rechazaría.
		     SIN filtrar (#208): es una acción de lista y no desaparece aunque
		     la búsqueda deje fuera los comprados. `id` de ancla del tour
		     (#142): paso «Finalizar compra». -->
		{#if purchasedAllItems.length > 0}
			<button
				type="button"
				id="tour-finalize"
				class="btn btn-primary mt-6 w-full"
				onclick={openFinalize}
			>
				<ShoppingBasket aria-hidden="true" />
				{m.purchases_finalize()}
			</button>
		{/if}
	{/if}
</section>

<EditItemModal
	bind:this={editModal}
	form={data.editForm}
	categories={data.categories}
	onSuccess={(message) => (successMessage = message)}
/>

<!-- Borrar (checklist #68): una modal compartida; cada botón de la fila fija
     a qué item se borra antes de abrirla. -->
<ConfirmModal
	bind:this={deleteModal}
	title={m.items_delete_title({ name: deletedItem?.name ?? '' })}
	description={m.items_delete_description()}
	confirmLabel={m.items_delete_confirm()}
	action="?/delete"
	fields={{ item: deletedItem?.id ?? '' }}
	errorFallback={m.items_error()}
	onSuccess={() => (successMessage = m.items_deleted())}
/>

<!-- SIN filtrar (#208): el modal resume TODA la compra que se cierra,
     no solo lo que deja ver la búsqueda. -->
<FinalizeModal
	bind:this={finalizeModal}
	form={data.finalizeForm}
	stores={data.stores}
	purchasedItems={purchasedAllItems}
	onSuccess={(message) => (successMessage = message)}
/>
