<script lang="ts">
	import { invalidateAll } from '$app/navigation';
	import { enhance as kitEnhance } from '$app/forms';
	import { resolve } from '$app/paths';
	import { Modal } from '@callepuzzle/svelte-ui';
	import Minus from '@lucide/svelte/icons/minus';
	import Plus from '@lucide/svelte/icons/plus';
	import Refrigerator from '@lucide/svelte/icons/refrigerator';
	import ShoppingBasket from '@lucide/svelte/icons/shopping-basket';
	import ShoppingCart from '@lucide/svelte/icons/shopping-cart';
	import { m } from '$lib/paraglide/messages.js';
	import { UNIT_STEP, redondearCantidad } from '$lib/pantry-steps.js';
	import { readdSchema } from '$lib/schemas/pantry.js';
	import type { Unit } from '$lib/schemas/item.js';
	import type { SubmitFunction } from '@sveltejs/kit';
	import { zod4Client } from 'sveltekit-superforms/adapters';
	import { superForm } from 'sveltekit-superforms/client';
	import type { PageProps } from './$types';

	let { data, form: actionData }: PageProps = $props();

	/** Una fila de despensa (la trae el load). */
	type PantryRow = PageProps['data']['items'][number];

	/** Une el formato de error de superforms (string o lista) a texto plano. */
	function textoError(error: string | string[] | undefined): string | undefined {
		if (!error) return undefined;
		return Array.isArray(error) ? error.join(' ') : error;
	}

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

	// ---- Consumir / devolver (checklist #73): stepper −/+ por fila con
	// actualización OPTIMISTA, la misma técnica del toggle de comprado. ----
	// El ajuste que aún no ha confirmado el servidor viaja en `ajustes`
	// (id -> delta acumulado): la UI pinta la cantidad ENCIMA de la que trae
	// el load y retira el optimista cuando llega la verdad del servidor — o
	// en cuanto falla la petición, que es la reversión prometida. Como en el
	// toggle, el delta se anota en el click del botón (ANTES del envío) y el
	// submit function solo decide qué hacer con el resultado.
	const ajustes = $state(new Map<string, number>());
	let falloAjuste: string | null = $state(null);

	/** La cantidad mostrada: la del servidor más el ajuste en vuelo, sin negativos. */
	function cantidadVisible(item: PantryRow): number {
		const base = item.quantity + (ajustes.get(item.id) ?? 0);
		// El redondeo cierra el flotante a los 3 decimales de la columna (0,3
		// − 0,25 pintaría 0,049999…): lo que se muestra es lo que guardará la base.
		return Math.max(0, redondearCantidad(base));
	}

	/**
	 * Las dos secciones de la vista: lo que queda en casa y lo agotado. Un
	 * producto consumido hasta 0 NO desaparece: baja a «Agotados» atenuado —
	 * es la memoria de la compra habitual, con su botón de re-añadir a punto —
	 * y solo se va de la despensa si se quita explícitamente (#74).
	 */
	const enCasa = $derived(data.items.filter((item) => cantidadVisible(item) > 0));
	const agotados = $derived(data.items.filter((item) => cantidadVisible(item) === 0));

	/** Anota el delta del botón pulsado como ajuste en vuelo (optimista). */
	function anotarAjuste(id: string, delta: 1 | -1) {
		ajustes.set(id, redondearCantidad((ajustes.get(id) ?? 0) + delta));
		falloAjuste = null;
	} /**
	 * Resultado de un ajuste: en fallo revierte y avisa; en éxito refresca.
	 * El optimista se retira ANTES de pedir el load: si se quitara después
	 * del `await update()`, la mutación cae en la misma continuación asíncrona
	 * que el refresco y el navegador no llega a repintarla (visto en e2e) —
	 * el badge se quedaba con el delta para siempre. El coste es un parpadeo
	 * de la cantidad vieja durante la revalidación, inferior a un badge
	 * congelado en un valor que el servidor ya desmintió.
	 */
	function alAjustar(id: string): SubmitFunction {
		return () =>
			async ({ result, update }) => {
				if (result.type === 'success') {
					ajustes.delete(id);
					await update();
				} else {
					// Fallo (el servidor rechazó) o error (sin respuesta): la
					// reversión es retirar el optimista, y el badge vuelve al
					// estado que traen los datos. Sin `update` en fallo, como el
					// toggle de comprado: el aviso vive aquí y no se duplica.
					falloAjuste =
						result.type === 'failure'
							? ((result.data as { error?: string } | undefined)?.error ?? m.pantry_error())
							: m.pantry_error();
					ajustes.delete(id);
				}
			};
	}

	// ---- Re-añadir a la compra (checklist #74): modal con SU formulario de
	// superforms (id «readd-item», lo pone el load) para no pisar al ajuste.
	// El schema se construye EN RENDER, como los demás (regla i18n). ----
	const readdSchemaCompiled = readdSchema({
		listIdError: m.schema_readd_list_error(),
		listIdLabel: m.schema_readd_list_label(),
		quantityError: m.schema_items_quantity_error(),
		quantityLabel: m.pantry_readd_quantity_label(),
		pantryModeError: m.schema_readd_mode_error(),
		pantryModeLabel: m.pantry_readd_pantry_label(),
		newQuantityError: m.schema_readd_new_quantity_error(),
		newQuantityLabel: m.schema_readd_new_quantity_label()
	});

	// Aviso de éxito del re-añadido, fuera del modal (como editar en la lista).
	let exito: string | null = $state(null);

	/** El producto que se quiere re-añadir: fija título, id y cantidad por defecto. */
	let itemReAnadir: PantryRow | undefined = $state();
	let readdModal: { showModal(): void; close(): void } | undefined = $state();

	// svelte-ignore state_referenced_locally
	const readdForm = superForm(data.readdForm, {
		validators: zod4Client(readdSchemaCompiled),
		// Pesimista: el modal cierra cuando el load trae la lista con el item
		// y la despensa ya ajustadas, igual que el modal de edición.
		invalidateAll: 'pessimistic',
		onResult({ result }) {
			if (result.type === 'success') {
				// El texto concreto lo decide la acción y viaja en el resultado
				// (`message()`), como en los modales de la lista.
				const data = result.data as { form?: { message?: string } } | undefined;
				exito = data?.form?.message ?? m.pantry_readd_success();
				readdModal?.close();
			}
		}
	});
	const {
		form: readdFormData,
		enhance: readdEnhance,
		delayed: readdDelayed,
		message: readdMessage,
		errors: readdErrors
	} = readdForm;

	/** Abre el modal con el producto cargado y la primera lista por defecto. */
	function abrirReAnadir(item: PantryRow) {
		exito = null;
		itemReAnadir = item;
		readdMessage.set(undefined);
		readdErrors.clear();
		readdFormData.set({
			listId: data.lists[0]?.id ?? '',
			// La cantidad por defecto para la lista es la que hay en despensa:
			// «quiero lo mismo que me queda». Un agotado (a 0) no puede pedir
			// cero: se propone un paso de su unidad — 1 en las cuentas enteras
			// y 100 en g/ml; en kg/L manda el 1, que es como se compra.
			quantity: item.quantity > 0 ? item.quantity : Math.max(1, UNIT_STEP[item.unit]),
			pantryMode: 'keep',
			newQuantity: undefined
		});
		readdModal?.showModal();
	}

	// Refresco al volver a la pestaña: la despensa la mueven las compras, los
	// consumos y los re-añadidos de CUALQUIER miembro y la v1 no tiene tiempo
	// real, así que lo barato y suficiente es revalidar al volver a mirar — el
	// criterio «actualizada tras cada acción» de la #44. PERO el modal de
	// re-añadir lleva su formulario de superforms, que el load reharía con lo
	// que traiga: el refresco espera a una vuelta sin ningún `<dialog>`
	// abierto y con el formulario intacto (`isTainted`), igual que en la
	// vista de lista.
	$effect(() => {
		function alVolver() {
			if (document.visibilityState !== 'visible') return;
			if (document.querySelector('dialog[open]') || readdForm.isTainted()) return;
			void invalidateAll();
		}
		document.addEventListener('visibilitychange', alVolver);
		return () => document.removeEventListener('visibilitychange', alVolver);
	});

	/** La etiqueta del botón lleva el paso exacto: «Consumir 0.25 kg». */
	function etiquetaPaso(
		item: PantryRow,
		verbo: (params: { step: string; unit: string }) => string
	) {
		return verbo({ step: String(UNIT_STEP[item.unit]), unit: UNIT_LABEL[item.unit] });
	}
</script>

<svelte:head>
	<title>{m.pantry_title()} · {m.app_brand()}</title>
</svelte:head>

<section class="mx-auto max-w-md">
	<h1 class="text-2xl font-bold">{m.pantry_title()}</h1>

	<!-- Error de un ajuste sin JS (consumir/devolver): con JS vive en
	     `falloAjuste`, que revierte el optimista sin recargar. -->
	{#if actionData?.error}
		<div class="alert alert-error mt-4 text-sm" role="alert">
			{actionData.error}
		</div>
	{/if}

	{#if falloAjuste}
		<div class="alert alert-warning mt-4 text-sm" role="alert">
			{falloAjuste}
		</div>
	{/if}

	{#if exito}
		<div class="alert alert-success mt-4 text-sm" role="status">
			{exito}
		</div>
	{/if}

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
		<!-- Una fila de producto: stepper −/+ (checklist #73) y botón de
		     re-añadir (checklist #74). El snippet lo comparten las dos
		     secciones («En casa» y «Agotados»); un agotado no pinta el −: de
		     cero no se puede consumir más, solo reponer o re-añadir. -->
		{#snippet filaProducto(item: PantryRow)}
			{@const cantidad = cantidadVisible(item)}
			<li
				class={`bg-base-200 rounded-box flex items-center gap-2 px-3 py-2 sm:px-4 ${cantidad === 0 ? 'opacity-60' : ''}`}
			>
				<p class="min-w-0 flex-1 truncate font-medium">{item.name}</p>
				<form
					method="POST"
					action="?/adjust"
					use:kitEnhance={alAjustar(item.id)}
					class="flex shrink-0 items-center gap-1"
				>
					<input type="hidden" name="item" value={item.id} />
					{#if cantidad > 0}
						<button
							type="submit"
							name="delta"
							value="-1"
							class="btn btn-ghost btn-sm"
							aria-label={etiquetaPaso(item, m.pantry_consume)}
							title={etiquetaPaso(item, m.pantry_consume)}
							onclick={() => anotarAjuste(item.id, -1)}
						>
							<Minus aria-hidden="true" />
						</button>
					{/if}
					<span class="badge badge-ghost tabular-nums">
						{cantidad}
						{UNIT_LABEL[item.unit]}
					</span>
					<button
						type="submit"
						name="delta"
						value="1"
						class="btn btn-ghost btn-sm"
						aria-label={etiquetaPaso(item, m.pantry_restock)}
						title={etiquetaPaso(item, m.pantry_restock)}
						onclick={() => anotarAjuste(item.id, 1)}
					>
						<Plus aria-hidden="true" />
					</button>
				</form>
				<!-- Re-añadir a la compra (checklist #74): abre el modal con el
				     selector de lista y el ajuste de despensa. En un agotado es EL
				     botón: la memoria de «esto se compra» lista para volver. -->
				<button
					type="button"
					class="btn btn-ghost btn-sm"
					title={m.pantry_readd()}
					aria-label={m.pantry_readd()}
					onclick={() => abrirReAnadir(item)}
				>
					<ShoppingCart aria-hidden="true" />
				</button>
			</li>
		{/snippet}

		<!-- «En casa»: lo que queda. Su cabecera solo cuando hay agotados
		     debajo (si no, sobra), como pendientes/comprados en la lista. -->
		{#if enCasa.length > 0}
			{#if agotados.length > 0}
				<h2 class="mt-4 text-sm font-semibold tracking-wide uppercase opacity-60">
					{m.pantry_section_home()}
				</h2>
			{/if}
			<ul class="mt-4 flex list-none flex-col gap-2">
				{#each enCasa as item (item.id)}
					{@render filaProducto(item)}
				{/each}
			</ul>
		{/if}

		<!-- «Agotados»: consumidos hasta 0. Se quedan en la despensa (el
		     servidor NO los borra) para poder re-añadirlos a la compra. -->
		{#if agotados.length > 0}
			<h2
				class={`text-sm font-semibold tracking-wide uppercase opacity-60 ${enCasa.length > 0 ? 'mt-6' : 'mt-4'}`}
			>
				{m.pantry_section_out()}
			</h2>
			<ul class={`flex list-none flex-col gap-2 ${enCasa.length > 0 ? 'mt-2' : 'mt-4'}`}>
				{#each agotados as item (item.id)}
					{@render filaProducto(item)}
				{/each}
			</ul>
		{/if}
	{/if}
</section>

<!-- Re-añadir a la compra (checklist #74): una modal compartida; cada botón
     de fila fija a qué producto se re-añade antes de abrirla. Con SU
     formulario de superforms (id «readd-item») para no pisar al ajuste. Los
     fallos del action (producto consumido por otro a la vez, lista borrada,
     error de servidor) se cuentan aquí dentro. -->
<Modal
	bind:this={readdModal}
	type="X"
	showButton={false}
	boxClass="modal-box max-w-md"
	strings={{ close: m.ui_close() }}
>
	<h2 class="text-lg font-bold">{m.pantry_readd_title({ name: itemReAnadir?.name ?? '' })}</h2>
	<p class="mt-1 text-sm opacity-70">{m.pantry_readd_description()}</p>

	{#if data.lists.length === 0}
		<!-- Sin listas no hay destino posible: se explica y se manda a crearlas. -->
		<div class="mt-4 flex flex-col items-center gap-3 text-center">
			<p class="opacity-70">{m.pantry_readd_no_lists()}</p>
			<a href={resolve('/lists')} class="btn btn-primary">{m.pantry_go_lists()}</a>
		</div>
	{:else}
		<form method="POST" action="?/readd" use:readdEnhance class="mt-4 flex flex-col gap-4">
			<!-- El id del producto de despensa viaja con el formulario. -->
			<input type="hidden" name="pantry" value={itemReAnadir?.id ?? ''} />

			<div class="flex flex-col gap-1">
				<label class="fieldset-label" for="readd-list">{m.schema_readd_list_label()}</label>
				<select
					bind:value={$readdFormData.listId}
					aria-invalid={textoError($readdErrors.listId) ? 'true' : undefined}
					id="readd-list"
					name="listId"
					class="select w-full"
					required
				>
					{#each data.lists as lista (lista.id)}
						<option value={lista.id}>{lista.name}</option>
					{/each}
				</select>
				{#if textoError($readdErrors.listId)}
					<p class="fieldset-label text-error" role="alert">{textoError($readdErrors.listId)}</p>
				{/if}
			</div>

			<div class="flex flex-col gap-1">
				<label class="fieldset-label" for="readd-quantity">{m.pantry_readd_quantity_label()}</label>
				<!-- Por defecto, la cantidad que hay en despensa: «lo mismo que
				     me queda». Sin `min` nativo: el corte lo hace zod en cliente
				     con el error del schema (igual que el alta de items). -->
				<input
					bind:value={$readdFormData.quantity}
					aria-invalid={textoError($readdErrors.quantity) ? 'true' : undefined}
					id="readd-quantity"
					name="quantity"
					type="number"
					class="input w-full"
					step="any"
					inputmode="decimal"
					required
				/>
				{#if textoError($readdErrors.quantity)}
					<p class="fieldset-label text-error" role="alert">
						{textoError($readdErrors.quantity)}
					</p>
				{/if}
			</div>

			<div class="flex flex-col gap-1">
				<span class="fieldset-label">{m.pantry_readd_pantry_label()}</span>
				<div class="flex flex-col gap-2">
					<label class="flex cursor-pointer items-center gap-2 text-sm">
						<input
							type="radio"
							class="radio radio-primary radio-sm"
							name="pantryMode"
							value="keep"
							bind:group={$readdFormData.pantryMode}
						/>
						{m.pantry_readd_keep()}
					</label>
					<label class="flex cursor-pointer items-center gap-2 text-sm">
						<input
							type="radio"
							class="radio radio-primary radio-sm"
							name="pantryMode"
							value="set"
							bind:group={$readdFormData.pantryMode}
						/>
						{m.pantry_readd_set()}
					</label>
					{#if $readdFormData.pantryMode === 'set'}
						<!-- Solo visible con «fijar nueva cantidad»: cuánto QUEDA. -->
						<div class="flex flex-col gap-1 pl-6">
							<label class="fieldset-label" for="readd-new-quantity"
								>{m.schema_readd_new_quantity_label()}</label
							>
							<input
								bind:value={$readdFormData.newQuantity}
								aria-invalid={textoError($readdErrors.newQuantity) ? 'true' : undefined}
								id="readd-new-quantity"
								name="newQuantity"
								type="number"
								class="input w-full"
								step="any"
								inputmode="decimal"
							/>
							{#if textoError($readdErrors.newQuantity)}
								<p class="fieldset-label text-error" role="alert">
									{textoError($readdErrors.newQuantity)}
								</p>
							{/if}
						</div>
					{/if}
					<label class="flex cursor-pointer items-center gap-2 text-sm">
						<input
							type="radio"
							class="radio radio-primary radio-sm"
							name="pantryMode"
							value="remove"
							bind:group={$readdFormData.pantryMode}
						/>
						{m.pantry_readd_remove()}
					</label>
				</div>
				{#if textoError($readdErrors.pantryMode)}
					<p class="fieldset-label text-error" role="alert">
						{textoError($readdErrors.pantryMode)}
					</p>
				{/if}
			</div>

			{#if $readdMessage}
				<div class="alert alert-error text-sm" role="alert">
					{$readdMessage}
				</div>
			{/if}

			<div class="flex justify-end gap-2">
				<button type="button" class="btn btn-ghost" onclick={() => readdModal?.close()}>
					{m.ui_cancel()}
				</button>
				<button type="submit" class="btn btn-primary" disabled={$readdDelayed}>
					{#if $readdDelayed}
						<span class="loading loading-spinner"></span>
					{/if}
					{m.pantry_readd()}
				</button>
			</div>
		</form>
	{/if}
</Modal>
