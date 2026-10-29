<script lang="ts">
	import { invalidateAll } from '$app/navigation';
	import { resolve } from '$app/paths';
	import ArrowLeft from '@lucide/svelte/icons/arrow-left';
	import Plus from '@lucide/svelte/icons/plus';
	import ShoppingBasket from '@lucide/svelte/icons/shopping-basket';
	import ConfirmModal from '$lib/components/ConfirmModal.svelte';
	import { COLOR_CHIP, ICONS, type ListColor, type ListIcon } from '$lib/list-visuals.js';
	import { m } from '$lib/paraglide/messages.js';
	import { useRefetchOnVisible } from '$lib/refetch-on-visible.svelte.js';
	import { SvelteMap } from 'svelte/reactivity';
	import { createSwapy, utils, type Swapy } from 'swapy';
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

	// ---- Reordenar pendientes (#134): drag-to-swap con Swapy. ----
	// El patrón «dinámico» de la librería: los slots son POSICIONES estables
	// (su id lo decide el mapa) y el contenido de cada una lo decide el mapa;
	// con `manualSwap` es Svelte quien mueve el contenido al cambiar el mapa
	// — si Swapy moviera el DOM por su cuenta se pisaría con el keyed each.
	// Y con `swapMode: 'drop'`: el swap ocurre al SOLTAR sobre otra fila,
	// porque el modo hover de Swapy 1.0.5 revienta el drag (su animación de
	// asentamiento lee `dragEvent()` justo después de cerrarse y lanza
	// «Cannot read properties of null (reading 'relativeX')» — verificado en
	// Brave y Firefox —, aborta el flujo de `pointerup` y `onSwapEnd` nunca
	// dispara el POST). El swap se pinta al instante (optimista) y el POST
	// viaja cuando la sesión de arrastre termina; en fallo, el mapa vuelve al
	// orden que trae el load con el aviso delante, el mismo trato que el
	// toggle de comprado.
	//
	// El mapa es un `$derived` ESCRIBIBLE: su valor base es la identidad del
	// orden que trae el load, y cada asignación (swap en el aire, teclado,
	// reversión) lo pisa HASTA que los pendientes cambien — que es justo el
	// reset a la verdad del servidor: un POST confirmado llega con este
	// mismo orden (no se mueve nada) y un fallo vuelve aquí al revocarse.
	let slotItemMap = $derived(utils.initSlotItemMap(pendientes, 'id'));
	let falloReorden: string | null = $state(null);

	/** El contenedor Swapy de pendientes (el `<ol>` de la sección). */
	let contenedorPendientes: HTMLElement | undefined = $state();
	let swapyPendientes: Swapy | null = null;

	/**
	 * Las filas pintadas: slots en orden fijo con su item asignado. Las
	 * referencias colgantes (un item borrado por otro miembro antes de que
	 * el load re-sincronice el mapa) se saltan.
	 */
	const slottedPendientes = $derived(
		utils.toSlottedItems(pendientes, 'id', slotItemMap).filter((par) => par.item)
	);

	// Cualquier repintado de la sección deja el DOM distinto de lo que Swapy
	// cree: relee slots e items. El rAF espera a que el keyed each haya
	// movido sus nodos (los efectos corren con el DOM ya parcheado, pero el
	// reset del mapa de arriba encadena otro ciclo de render).
	$effect(() => {
		void slottedPendientes;
		requestAnimationFrame(() => swapyPendientes?.update());
	});

	$effect(() => {
		if (!contenedorPendientes) {
			return;
		}
		const instancia = createSwapy(contenedorPendientes, { manualSwap: true, swapMode: 'drop' });
		instancia.onSwap((event) => {
			// Optimista EN EL AIRE: con `swapMode: 'drop'` el swap dispara UNA
			// vez, al soltar sobre otra fila. El rAF deja pasar el ciclo del
			// evento, como en el ejemplo de la documentación para Svelte.
			requestAnimationFrame(() => {
				slotItemMap = event.newSlotItemMap.asArray;
			});
		});
		instancia.onSwapEnd((event) => {
			// La sesión terminó: aquí — y solo aquí — viaja el POST, con el
			// orden asentado de la última pasada de hover (el «settled» del
			// issue).
			if (event.hasChanged) {
				enviarOrden(event.slotItemMap.asArray.map((par) => par.item));
			}
		});
		swapyPendientes = instancia;
		return () => {
			instancia.destroy();
			swapyPendientes = null;
		};
	});

	let colaReorden: Promise<void> = Promise.resolve();

	/**
	 * El POST del orden nuevo, ENCADENADO: dos arrastres seguidos no pueden
	 * cruzar sus envíos — el servidor aplica el array completo de cada uno,
	 * así que manda el último ENVIADO, no el último recibido. La lista puede
	 * ser parcial (un pendiente creado por otro miembro mientras tanto no
	 * viaja): el servidor conserva su orden relativo detrás.
	 */
	function enviarOrden(ids: string[]) {
		colaReorden = colaReorden.then(async () => {
			const body = new FormData();
			for (const id of ids) {
				body.append('ids', id);
			}
			try {
				const respuesta = await fetch('?/reorder', { method: 'POST', body });
				if (!respuesta.ok) {
					throw new Error(`?/reorder -> ${respuesta.status}`);
				}
				falloReorden = null;
				// La verdad del servidor ya es este orden: el reset del mapa
				// que trae la invalidación es una no-operación a la vista.
				await invalidateAll();
			} catch {
				// Fallo (el servidor rechazó) o error (sin respuesta): la
				// reversión es volver al orden que traen los datos.
				slotItemMap = utils.initSlotItemMap(pendientes, 'id');
				falloReorden = m.items_error();
			}
		});
		return colaReorden;
	}

	/**
	 * El handle con teclado (#134): las flechas intercambian con el vecino
	 * directamente (un paso de teclado ya es una sesión terminada), por el
	 * mismo camino de mapa optimista + POST que el drag.
	 */
	function moverPendiente(itemId: string, delta: 1 | -1) {
		const de = slotItemMap.findIndex((par) => par.item === itemId);
		const a = de + delta;
		if (de === -1 || a < 0 || a >= slotItemMap.length) {
			return;
		}
		const mapa = slotItemMap.map((par) => ({ ...par }));
		[mapa[de].item, mapa[a].item] = [mapa[a].item, mapa[de].item];
		slotItemMap = mapa;
		falloReorden = null;
		enviarOrden(mapa.map((par) => par.item));
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

	<!-- Fallo del reorden (#134): el optimista ya se revirtió al orden
	     guardado; el aviso lo explica, como el del toggle de comprado. -->
	{#if falloReorden}
		<div class="alert alert-warning mt-4 text-sm" role="alert">
			{falloReorden}
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
		<!-- La fila reordenable viaja con el id de SU slot de Swapy (undefined
		     en los comprados: sección fija, sin handle). -->
		{#snippet filaItem(item: Item, slotId?: string)}
			<ItemRow
				{item}
				comprado={valorComprado(item)}
				{slotId}
				onMover={slotId ? (delta) => moverPendiente(item.id, delta) : undefined}
				onPurchasedResult={alComprar(item.id)}
				onToggle={(nuevo) => alTocar(item.id, nuevo)}
				onEdit={() => abrirEdicion(item)}
				onDelete={() => abrirBorrado(item)}
			/>
		{/snippet}

		<!-- Separación visual (checklist #69): pendientes arriba; los
		     comprados, debajo, atenuados y tachados. La cabecera de
		     «Pendientes» solo cuando hay comprados (si no, sobra).
		     Pendientes ES el contenedor Swapy (#134): una sección por
		     contenedor, para que los swaps no crucen particiones. -->
		{#if pendientes.length > 0}
			{#if comprados.length > 0}
				<h2 class="mt-4 text-sm font-semibold tracking-wide uppercase opacity-60">
					{m.items_section_pending()}
				</h2>
			{/if}
			<ol
				class="mt-4 flex list-none flex-col gap-2"
				data-swapy-container="pendientes"
				bind:this={contenedorPendientes}
			>
				{#each slottedPendientes as par (par.slotId)}
					{#if par.item}
						{@render filaItem(par.item, par.slotId)}
					{/if}
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
