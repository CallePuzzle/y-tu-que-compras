<script lang="ts">
	import { resolve } from '$app/paths';
	import ArrowLeft from '@lucide/svelte/icons/arrow-left';
	import Plus from '@lucide/svelte/icons/plus';
	import ShoppingBasket from '@lucide/svelte/icons/shopping-basket';
	import ConfirmModal from '$lib/components/ConfirmModal.svelte';
	import { COLOR_CHIP, ICONS, type ListColor, type ListIcon } from '$lib/list-visuals.js';
	import { m } from '$lib/paraglide/messages.js';
	import { useRefetchOnVisible } from '$lib/refetch-on-visible.svelte.js';
	import { SvelteMap } from 'svelte/reactivity';
	import type { SubmitFunction } from '@sveltejs/kit';
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
	// tras venir de Prisma como string, igual que en /lists).
	const Icono = $derived(ICONS[data.list.icon as ListIcon]);

	// Aviso de éxito FUERA de los modales (editar, borrar y finalizar); el
	// error de crear se queda bajo su formulario.
	let exito: string | null = $state(null);

	let altaRapida: QuickAddForm | undefined = $state();
	let editarModal: EditItemModal | undefined = $state();
	let finalizarModal: FinalizeModal | undefined = $state();

	// ---- Borrar (checklist #68): confirmación en un `ConfirmModal` compartido,
	// igual que en /lists: el fallo se queda dentro, el éxito lo cierra. ----
	let itemBorrado: Item | undefined = $state();
	let borrarModal: ConfirmModal | undefined = $state();

	function abrirEdicion(item: Item) {
		exito = null;
		editarModal?.open(item);
	}

	function abrirBorrado(item: Item) {
		itemBorrado = item;
		borrarModal?.showModal();
	}

	function abrirFinalizacion() {
		exito = null;
		finalizarModal?.open();
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
	const compras = new SvelteMap<string, boolean>();
	let falloCompra: string | null = $state(null);

	/** El comprado mostrado: el optimista si lo hay; si no, el del servidor. */
	function valorComprado(item: Item): boolean {
		return compras.get(item.id) ?? item.purchased;
	}

	// Separación visual (checklist #69): pendientes arriba y comprados debajo,
	// atenuados y tachados. El orden ya trae el servidor los pendientes
	// primero (`listItems`), así que partir `data.items` conserva el `order`.
	const pendientes = $derived(data.items.filter((item) => !valorComprado(item)));
	const comprados = $derived(data.items.filter((item) => valorComprado(item)));

	/** El toque en el checkbox: el optimista se pinta antes del envío. */
	function alTocar(id: string, nuevo: boolean) {
		compras.set(id, nuevo);
		falloCompra = null;
	}

	/** Resultado del toggle: en fallo revierte y avisa; en éxito refresca. */
	function alComprar(id: string): SubmitFunction {
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
					falloCompra =
						result.type === 'failure'
							? ((result.data as { error?: string } | undefined)?.error ?? m.items_error())
							: m.items_error();
				}
				compras.delete(id);
			};
	}

	// Refresco al volver a la pestaña (ver `useRefetchOnVisible`): el alta
	// rápida no necesita guardia, el load ya no la rehace (`applyAction`).
	useRefetchOnVisible();
</script>

<svelte:head>
	<title>{data.list.name} · {m.app_brand()}</title>
</svelte:head>

<section class="mx-auto max-w-md">
	<a href={resolve('/lists')} class="btn btn-ghost btn-sm -ml-2">
		<ArrowLeft aria-hidden="true" />
		{m.ui_back()}
	</a>

	<div class="mt-1 flex items-center gap-3">
		<span
			class={`flex size-10 shrink-0 items-center justify-center rounded-full ${COLOR_CHIP[data.list.color as ListColor]}`}
		>
			<Icono aria-hidden="true" class="size-5" />
		</span>
		<h1 class="min-w-0 truncate text-2xl font-bold">{data.list.name}</h1>
	</div>

	<!-- Error de las acciones sin JS (borrar): con JS vive dentro de su modal. -->
	{#if actionData?.error}
		<div class="alert alert-error mt-4 text-sm" role="alert">
			{actionData.error}
		</div>
	{/if}

	{#if exito}
		<div class="alert alert-success mt-4 text-sm" role="status">
			{exito}
		</div>
	{/if}

	{#if falloCompra}
		<div class="alert alert-warning mt-4 text-sm" role="alert">
			{falloCompra}
		</div>
	{/if}

	<QuickAddForm bind:this={altaRapida} form={data.form} />

	{#if data.items.length === 0}
		<!-- Estado vacío (checklist #68), con CTA que enfoca el alta. -->
		<div class="mt-8 flex flex-col items-center gap-3 text-center">
			<ShoppingBasket aria-hidden="true" class="size-10 opacity-40" />
			<p class="opacity-70">{m.items_empty()}</p>
			<button type="button" class="btn btn-primary" onclick={() => altaRapida?.focus()}>
				<Plus aria-hidden="true" />
				{m.items_add()}
			</button>
		</div>
	{:else}
		{#snippet filaItem(item: Item)}
			<ItemRow
				{item}
				comprado={valorComprado(item)}
				onPurchasedResult={alComprar(item.id)}
				onToggle={(nuevo) => alTocar(item.id, nuevo)}
				onEdit={() => abrirEdicion(item)}
				onDelete={() => abrirBorrado(item)}
			/>
		{/snippet}

		<!-- Separación visual (checklist #69): pendientes arriba; los
		     comprados, debajo, atenuados y tachados. La cabecera de
		     «Pendientes» solo cuando hay comprados (si no, sobra). -->
		{#if pendientes.length > 0}
			{#if comprados.length > 0}
				<h2 class="mt-4 text-sm font-semibold tracking-wide uppercase opacity-60">
					{m.items_section_pending()}
				</h2>
			{/if}
			<ol class="mt-4 flex list-none flex-col gap-2">
				{#each pendientes as item (item.id)}
					{@render filaItem(item)}
				{/each}
			</ol>
		{/if}

		{#if comprados.length > 0}
			<h2 class="mt-6 text-sm font-semibold tracking-wide uppercase opacity-60">
				{m.items_section_purchased()}
			</h2>
			<ol class="mt-2 flex list-none flex-col gap-2">
				{#each comprados as item (item.id)}
					{@render filaItem(item)}
				{/each}
			</ol>

			<!-- CTA de finalizar (checklist #71): solo con algo comprado — sin
			     comprados no hay compra que cerrar y el action lo rechazaría. -->
			<button type="button" class="btn btn-primary mt-6 w-full" onclick={abrirFinalizacion}>
				<ShoppingBasket aria-hidden="true" />
				{m.purchases_finalize()}
			</button>
		{/if}
	{/if}
</section>

<EditItemModal
	bind:this={editarModal}
	form={data.editForm}
	onSuccess={(texto) => (exito = texto)}
/>

<!-- Borrar (checklist #68): una modal compartida; cada botón de la fila fija
     a qué item se borra antes de abrirla. -->
<ConfirmModal
	bind:this={borrarModal}
	title={m.items_delete_title({ name: itemBorrado?.name ?? '' })}
	description={m.items_delete_description()}
	confirmLabel={m.items_delete_confirm()}
	action="?/delete"
	fields={{ item: itemBorrado?.id ?? '' }}
	errorFallback={m.items_error()}
	onSuccess={() => (exito = m.items_deleted())}
/>

<FinalizeModal
	bind:this={finalizarModal}
	form={data.finalizeForm}
	{comprados}
	onSuccess={(texto) => (exito = texto)}
/>
