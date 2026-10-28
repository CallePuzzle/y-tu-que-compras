<script lang="ts">
	import { invalidateAll } from '$app/navigation';
	import { enhance as kitEnhance } from '$app/forms';
	import { resolve } from '$app/paths';
	import { Modal } from '@callepuzzle/svelte-ui';
	import ArrowLeft from '@lucide/svelte/icons/arrow-left';
	import Pencil from '@lucide/svelte/icons/pencil';
	import Plus from '@lucide/svelte/icons/plus';
	import ShoppingBasket from '@lucide/svelte/icons/shopping-basket';
	import Trash2 from '@lucide/svelte/icons/trash-2';
	import { m } from '$lib/paraglide/messages.js';
	import { COLOR_CHIP, ICONS, type ListColor, type ListIcon } from '$lib/list-visuals.js';
	import { UNITS, itemSchema, type ItemData, type Unit } from '$lib/schemas/item.js';
	import { purchaseSchema } from '$lib/schemas/purchase.js';
	import { SvelteMap } from 'svelte/reactivity';
	import type { SubmitFunction } from '@sveltejs/kit';
	import { zod4Client } from 'sveltekit-superforms/adapters';
	import { superForm } from 'sveltekit-superforms/client';
	import type { PageProps } from './$types';

	let { data, form: actionData }: PageProps = $props();

	/** Una fila de items (la trae el load). */
	type ItemRow = PageProps['data']['items'][number];

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

	// El schema se construye EN RENDER, nunca en scope de módulo (regla i18n de
	// la librería). Ojo: `superForm` no soporta cambiar el schema, así que se
	// lee una vez por instancia; si el idioma cambia con la página abierta, los
	// mensajes se re-traducen al recargar (igual que en /lists).
	const schema = itemSchema({
		nameError: m.schema_items_name_error(),
		nameLabel: m.schema_items_name_label(),
		namePlaceholder: m.schema_items_name_placeholder(),
		quantityError: m.schema_items_quantity_error(),
		quantityLabel: m.schema_items_quantity_label(),
		unitError: m.schema_items_unit_error(),
		unitLabel: m.schema_items_unit_label()
	});

	// Icono de la lista para la cabecera (el cast recupera el literal del enum
	// tras venir de Prisma como string, igual que en /lists).
	const Icono = $derived(ICONS[data.list.icon as ListIcon]);

	// Aviso de éxito FUERA de los modales (editar y borrar); el error de crear
	// se queda bajo su formulario.
	let exito: string | null = $state(null);

	// ---- Alta rápida (formulario inline, siempre visible, checklist #68) ----
	// Con `invalidateAll: 'pessimistic'`, tras crear superforms espera al load
	// y el `resetForm` por defecto lo deja VACÍO: queda listo para encadenar
	// otra alta y el item nuevo aparece en la lista.
	//
	// `applyAction: 'never'` (#114): sin él, CUALQUIER recarga de los datos de
	// página (el toggle de comprado, editar, borrar, finalizar, volver a la
	// pestaña) rehace el formulario con el `form` vacío del load y machaca lo
	// que haya a medias. Así solo se actualiza con el resultado de SU acción:
	// lo escrito solo se borra al enviarlo.
	// svelte-ignore state_referenced_locally
	const addForm = superForm(data.form, {
		validators: zod4Client(schema),
		invalidateAll: 'pessimistic',
		applyAction: 'never'
	});
	const {
		form: addFormData,
		enhance: addEnhance,
		delayed: addDelayed,
		message: addMessage,
		errors: addErrors
	} = addForm;

	let addNameInput: HTMLInputElement | undefined = $state();

	// ---- Editar (modal con SU formulario, checklist #68) ----
	let itemEditado: ItemRow | undefined = $state();
	let editadaModal: { showModal(): void; close(): void } | undefined = $state();

	// svelte-ignore state_referenced_locally
	const editForm = superForm(data.editForm, {
		validators: zod4Client(schema),
		invalidateAll: 'pessimistic',
		onResult({ result }) {
			if (result.type === 'success') {
				// El texto concreto lo decide la acción y viaja en el resultado
				// (`message()`), como en /lists.
				const data = result.data as { form?: { message?: string } } | undefined;
				exito = data?.form?.message ?? m.items_updated();
				editadaModal?.close();
			}
		}
	});
	const {
		form: editFormData,
		enhance: editEnhance,
		delayed: editDelayed,
		message: editMessage,
		errors: editErrors
	} = editForm;

	/** Abre el modal en modo edición, con los datos del item cargados. */
	function abrirEdicion(item: ItemRow) {
		itemEditado = item;
		exito = null;
		editMessage.set(undefined);
		editErrors.clear();
		// El cast recupera los literales del enum tras venir de Prisma (string).
		editFormData.set({ name: item.name, quantity: item.quantity, unit: item.unit } as ItemData);
		editadaModal?.showModal();
	}

	// ---- Borrar (checklist #68): confirmación en una modal compartida, igual
	// que en /lists: el fallo se queda dentro del modal, el éxito lo cierra. ----
	let itemBorrado: ItemRow | undefined = $state();
	let borrarModal: { showModal(): void; close(): void } | undefined = $state();
	// Sin `update()` en fallo y con el botón deshabilitado en vuelo (#115),
	// igual que en /lists.
	let borrarError: string | null = $state(null);
	let borrando = $state(false);

	const onBorrarResult: SubmitFunction = ({ cancel }) => {
		if (borrando) return cancel();
		borrando = true;
		return async ({ result, update }) => {
			if (result.type === 'failure') {
				const failure = result.data as { error?: string } | undefined;
				borrarError = failure?.error ?? m.items_error();
			} else {
				borrarError = null;
				exito = m.items_deleted();
				borrarModal?.close();
				await update();
			}
			borrando = false;
		};
	};

	function abrirBorrado(item: ItemRow) {
		borrarError = null;
		itemBorrado = item;
		borrarModal?.showModal();
	}

	// ---- Finalizar compra (modal con resumen y total a mano, checklist #71) ----
	// La acción `?/finalize` (#70) hace todo el trabajo en el servidor; el
	// formulario solo lleva el total del ticket, validado por el MISMO schema
	// que usa el action. Construido EN RENDER, como los demás (regla i18n).
	const finalizeSchema = purchaseSchema({
		totalError: m.schema_purchase_total_error(),
		totalLabel: m.schema_purchase_total_label()
	});

	let finalizarModal: { showModal(): void; close(): void } | undefined = $state();

	// svelte-ignore state_referenced_locally
	const finalizeForm = superForm(data.finalizeForm, {
		validators: zod4Client(finalizeSchema),
		invalidateAll: 'pessimistic',
		onResult({ result }) {
			if (result.type === 'success') {
				// El texto concreto lo decide la acción y viaja en el resultado
				// (`message()`), como en el modal de edición. El load pesimista
				// trae la lista ya depurada: los comprados desaparecen de ella.
				const data = result.data as { form?: { message?: string } } | undefined;
				exito = data?.form?.message ?? m.purchases_success();
				finalizarModal?.close();
			}
		}
	});
	const {
		form: finalizeFormData,
		enhance: finalizeEnhance,
		delayed: finalizeDelayed,
		message: finalizeMessage,
		errors: finalizeErrors
	} = finalizeForm;

	/** Abre el modal de finalizar con el total EN BLANCO para escribirlo. */
	function abrirFinalizacion() {
		exito = null;
		finalizeMessage.set(undefined);
		finalizeErrors.clear();
		// El 0 que trae el formulario del load es el default del schema, no un
		// total real: el campo empieza vacío para que el total no se confirme
		// sin mirar. El cast es el mismo truco de `abrirEdicion`: undefined no
		// es un `number`, pero superforms lo acepta y zod lo exige al enviar.
		finalizeFormData.set({ total: undefined as unknown as number });
		finalizarModal?.showModal();
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
	function valorComprado(item: ItemRow): boolean {
		return compras.get(item.id) ?? item.purchased;
	}

	// Separación visual (checklist #69): pendientes arriba y comprados debajo,
	// atenuados y tachados. El orden ya trae el servidor los pendientes
	// primero (`listItems`), así que partir `data.items` conserva el `order`.
	const pendientes = $derived(data.items.filter((item) => !valorComprado(item)));
	const comprados = $derived(data.items.filter((item) => valorComprado(item)));

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

	// Refresco al volver a la pestaña (checklist #69): varios miembros pueden
	// estar editando la misma lista y la v1 no tiene tiempo real, así que lo
	// barato y suficiente es revalidar al volver a mirar. El efecto limpia su
	// listener cuando la página se destruye.
	//
	// PERO superforms rehace los formularios de los modales con el
	// `editForm`/`finalizeForm` que trae el load en cuanto se actualizan los
	// datos de página: revalidar ahora mismo MACHACARÍA lo que el usuario tenga
	// a medias. El refresco espera a una vuelta sin ningún `<dialog>` abierto
	// (el alta rápida ya no se rehace con el load: ver `applyAction` arriba).
	$effect(() => {
		function alVolver() {
			if (document.visibilityState !== 'visible') return;
			if (document.querySelector('dialog[open]')) return;
			void invalidateAll();
		}
		document.addEventListener('visibilitychange', alVolver);
		return () => document.removeEventListener('visibilitychange', alVolver);
	});
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

	<!-- Alta rápida inline (checklist #68): nombre, cantidad y unidad sin
	     modal, para encadenar altas desde el móvil. -->
	<form
		method="POST"
		action="?/create"
		use:addEnhance
		class="bg-base-200 rounded-box mt-4 flex flex-col gap-3 p-4"
	>
		<div class="flex flex-col gap-1">
			<label class="fieldset-label" for="add-name">{m.schema_items_name_label()}</label>
			<input
				bind:this={addNameInput}
				bind:value={$addFormData.name}
				aria-invalid={textoError($addErrors.name) ? 'true' : undefined}
				id="add-name"
				name="name"
				type="text"
				class="input w-full"
				placeholder={m.schema_items_name_placeholder()}
				required
				maxlength="100"
			/>
			{#if textoError($addErrors.name)}
				<p class="fieldset-label text-error" role="alert">{textoError($addErrors.name)}</p>
			{/if}
		</div>

		<!-- `flex-wrap` (#114): a 360px los tres no caben en una línea y el
		     botón baja a la suya en vez de desbordar. -->
		<div class="flex flex-wrap items-end gap-2">
			<div class="flex flex-col gap-1">
				<label class="fieldset-label" for="add-quantity">{m.schema_items_quantity_label()}</label>
				<input
					bind:value={$addFormData.quantity}
					aria-invalid={textoError($addErrors.quantity) ? 'true' : undefined}
					id="add-quantity"
					name="quantity"
					type="number"
					class="input w-20"
					step="any"
					inputmode="decimal"
					required
				/>
				{#if textoError($addErrors.quantity)}
					<p class="fieldset-label text-error" role="alert">{textoError($addErrors.quantity)}</p>
				{/if}
			</div>

			<div class="flex flex-col gap-1">
				<label class="fieldset-label" for="add-unit">{m.schema_items_unit_label()}</label>
				<!-- Selector de unidades predefinidas (checklist #68): el catálogo
				     UNITS con sus etiquetas traducidas. -->
				<select
					bind:value={$addFormData.unit}
					aria-invalid={textoError($addErrors.unit) ? 'true' : undefined}
					id="add-unit"
					name="unit"
					class="select w-28"
					required
				>
					{#each UNITS as unit (unit)}
						<option value={unit}>{UNIT_LABEL[unit]}</option>
					{/each}
				</select>
				{#if textoError($addErrors.unit)}
					<p class="fieldset-label text-error" role="alert">{textoError($addErrors.unit)}</p>
				{/if}
			</div>

			<button type="submit" class="btn btn-primary ml-auto" disabled={$addDelayed}>
				{#if $addDelayed}
					<span class="loading loading-spinner"></span>
				{/if}
				<Plus aria-hidden="true" />
				{m.items_add()}
			</button>
		</div>

		{#if $addMessage}
			<div class="alert alert-error text-sm" role="alert">
				{$addMessage}
			</div>
		{/if}
	</form>

	{#if data.items.length === 0}
		<!-- Estado vacío (checklist #68), con CTA que enfoca el alta. -->
		<div class="mt-8 flex flex-col items-center gap-3 text-center">
			<ShoppingBasket aria-hidden="true" class="size-10 opacity-40" />
			<p class="opacity-70">{m.items_empty()}</p>
			<button type="button" class="btn btn-primary" onclick={() => addNameInput?.focus()}>
				<Plus aria-hidden="true" />
				{m.items_add()}
			</button>
		</div>
	{:else}
		<!-- Una fila de item (checklists #68 y #69): checkbox de comprado,
		     nombre, cantidad y acciones. El snippet la comparten las dos
		     secciones (pendientes y comprados). -->
		{#snippet filaItem(item: ItemRow)}
			{@const comprado = valorComprado(item)}
			<li
				class={`bg-base-200 rounded-box flex items-center gap-3 px-4 py-3 ${comprado ? 'opacity-60' : ''}`}
			>
				<!-- Checkbox de comprado (checklist #69): envía `?/purchased` con
				     el id y el NUEVO valor. El hidden «false» + el checkbox
				     «true» dejan el valor correcto también en un envío nativo. -->
				<form method="POST" action="?/purchased" use:kitEnhance={alComprar(item.id)}>
					<input type="hidden" name="item" value={item.id} />
					<input type="hidden" name="purchased" value="false" />
					<input
						type="checkbox"
						name="purchased"
						value="true"
						class="checkbox checkbox-primary"
						checked={comprado}
						aria-label={comprado ? m.items_mark_pending() : m.items_mark_purchased()}
						onchange={(event) => {
							// Optimista ANTES del envío: la UI responde al toque; si
							// la acción falla, `alComprar` lo revierte.
							//
							// PERO el toggle nativo se deshace aquí mismo: el click
							// cambia la propiedad `checked` a espaldas de Svelte, y
							// al conmutar entre pendientes y comprados Svelte puede
							// reciclar la fila (las dos secciones comparten
							// plantilla) — `set_checked` no reasigna cuando su cache
							// ya coincide con el destino, así que la casilla podía
							// volver MARCADA a Pendientes tras un fallo. Con la
							// propiedad devuelta a `comprado`, cache y DOM quedan
							// alineados: el estado es quien pinta cada valor.
							// El valor NUEVO no se pierde: pasa al hidden y al checkbox se
							// le QUITA el `name`, para que el envío lleve UN solo valor —
							// el del hidden. Sin esto, al desmarcar el FormData llega con
							// el hidden «false» Y el checkbox «true» (la propiedad se
							// devolvió a su valor anterior arriba) y la acción se queda
							// con «true»: el desmarcado nunca se guardaba (issue #106).
							// Sin JS no hay toggle (no corre este `onchange`): el envío
							// nativo conserva el par hidden+checkbox intacto y el
							// servidor sigue leyéndolo bien.
							const input = event.currentTarget;
							const nuevo = input.checked;
							input.checked = comprado;
							input.removeAttribute('name');
							const hidden = input.form?.querySelector<HTMLInputElement>(
								'input[name="purchased"][type="hidden"]'
							);
							if (hidden) hidden.value = String(nuevo);
							compras.set(item.id, nuevo);
							falloCompra = null;
							input.form?.requestSubmit();
						}}
					/>
				</form>
				<p class={`min-w-0 flex-1 truncate font-medium ${comprado ? 'line-through' : ''}`}>
					{item.name}
				</p>
				<span class="badge badge-ghost shrink-0 tabular-nums">
					{item.quantity}
					{UNIT_LABEL[item.unit]}
				</span>
				<span class="flex items-center gap-1">
					<button
						type="button"
						class="btn btn-ghost btn-sm"
						title={m.items_edit()}
						onclick={() => abrirEdicion(item)}
					>
						<Pencil aria-hidden="true" />
						<span class="sr-only">{m.items_edit()}</span>
					</button>
					<button
						type="button"
						class="btn btn-ghost btn-sm"
						title={m.items_delete()}
						onclick={() => abrirBorrado(item)}
					>
						<Trash2 aria-hidden="true" />
						<span class="sr-only">{m.items_delete()}</span>
					</button>
				</span>
			</li>
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

<!-- Editar (checklist #68): una modal compartida con su propio formulario de
     superforms (id «edit-item») para que no se pise con el alta rápida. -->
<Modal
	bind:this={editadaModal}
	type="X"
	showButton={false}
	boxClass="modal-box max-w-md"
	strings={{ close: m.ui_close() }}
>
	<h2 class="text-lg font-bold">{m.items_edit()}</h2>

	<form method="POST" action="?/update" use:editEnhance class="mt-4 flex flex-col gap-4">
		<!-- El id del item editado viaja con el formulario. -->
		<input type="hidden" name="item" value={itemEditado?.id ?? ''} />

		<div class="flex flex-col gap-1">
			<label class="fieldset-label" for="edit-name">{m.schema_items_name_label()}</label>
			<input
				bind:value={$editFormData.name}
				aria-invalid={textoError($editErrors.name) ? 'true' : undefined}
				id="edit-name"
				name="name"
				type="text"
				class="input w-full"
				placeholder={m.schema_items_name_placeholder()}
				required
				maxlength="100"
			/>
			{#if textoError($editErrors.name)}
				<p class="fieldset-label text-error" role="alert">{textoError($editErrors.name)}</p>
			{/if}
		</div>

		<div class="grid grid-cols-2 gap-2">
			<div class="flex flex-col gap-1">
				<label class="fieldset-label" for="edit-quantity">{m.schema_items_quantity_label()}</label>
				<input
					bind:value={$editFormData.quantity}
					aria-invalid={textoError($editErrors.quantity) ? 'true' : undefined}
					id="edit-quantity"
					name="quantity"
					type="number"
					class="input w-full"
					step="any"
					inputmode="decimal"
					required
				/>
				{#if textoError($editErrors.quantity)}
					<p class="fieldset-label text-error" role="alert">{textoError($editErrors.quantity)}</p>
				{/if}
			</div>

			<div class="flex flex-col gap-1">
				<label class="fieldset-label" for="edit-unit">{m.schema_items_unit_label()}</label>
				<select
					bind:value={$editFormData.unit}
					aria-invalid={textoError($editErrors.unit) ? 'true' : undefined}
					id="edit-unit"
					name="unit"
					class="select w-full"
					required
				>
					{#each UNITS as unit (unit)}
						<option value={unit}>{UNIT_LABEL[unit]}</option>
					{/each}
				</select>
				{#if textoError($editErrors.unit)}
					<p class="fieldset-label text-error" role="alert">{textoError($editErrors.unit)}</p>
				{/if}
			</div>
		</div>

		{#if $editMessage}
			<div class="alert alert-error text-sm" role="alert">
				{$editMessage}
			</div>
		{/if}

		<button type="submit" class="btn btn-primary" disabled={$editDelayed}>
			{#if $editDelayed}
				<span class="loading loading-spinner"></span>
			{/if}
			{m.items_save()}
		</button>
	</form>
</Modal>

<!-- Borrar (checklist #68): una modal compartida; cada botón de la fila fija
     a qué item se borra antes de abrirla. -->
<Modal
	bind:this={borrarModal}
	type="X"
	showButton={false}
	boxClass="modal-box max-w-md"
	strings={{ close: m.ui_close() }}
>
	<h2 class="text-lg font-bold">{m.items_delete_title({ name: itemBorrado?.name ?? '' })}</h2>
	<p class="mt-1 text-sm opacity-70">{m.items_delete_description()}</p>

	{#if borrarError}
		<div class="alert alert-error mt-3 text-sm" role="alert">
			{borrarError}
		</div>
	{/if}

	<!-- El borrado no lleva schema de superforms (solo el id oculto), así que
	     va con el `enhance` del kit, como en /lists. -->
	<form
		method="POST"
		action="?/delete"
		use:kitEnhance={onBorrarResult}
		class="mt-4 flex justify-end"
	>
		<input type="hidden" name="item" value={itemBorrado?.id ?? ''} />
		<button type="submit" class="btn btn-error" disabled={borrando}>
			{#if borrando}
				<span class="loading loading-spinner"></span>
			{/if}
			{m.items_delete_confirm()}
		</button>
	</form>
</Modal>

<!-- Finalizar compra (checklist #71): resumen de los items comprados y el
     total del ticket escrito a mano. La confirmación envía `?/finalize`
     (#70), que crea el historial y actualiza la despensa en UNA transacción.
     Con SU formulario de superforms (id «finalize-purchase», lo pone el
     load) para no pisar al alta rápida ni al de edición. -->
<Modal
	bind:this={finalizarModal}
	type="X"
	showButton={false}
	boxClass="modal-box max-w-md"
	strings={{ close: m.ui_close() }}
>
	<h2 class="text-lg font-bold">{m.purchases_finalize()}</h2>
	<p class="mt-1 text-sm opacity-70">{m.purchases_modal_description()}</p>

	<!-- Resumen de lo comprado: lo mismo que se va a la despensa. Se lee de
	     `comprados` (el derivado con el toggle optimista), así que refleja
	     lo que el usuario ve, no un snapshot del servidor. Divs y no una
	     lista: los `li` del modal quedan en el DOM aunque el diálogo esté
	     cerrado y ensuciarían cualquier búsqueda de filas de items de la
	     página (los tests e2e localizan filas por `li` suelto). -->
	<h3 class="mt-4 text-sm font-semibold tracking-wide uppercase opacity-60">
		{m.purchases_modal_summary()}
	</h3>
	<div class="mt-2 flex flex-col gap-1">
		{#each comprados as item (item.id)}
			<div class="flex items-center justify-between gap-3 text-sm">
				<span class="min-w-0 truncate font-medium">{item.name}</span>
				<span class="badge badge-ghost shrink-0 tabular-nums">
					{item.quantity}
					{UNIT_LABEL[item.unit]}
				</span>
			</div>
		{/each}
	</div>

	<form method="POST" action="?/finalize" use:finalizeEnhance class="mt-4 flex flex-col gap-4">
		<div class="flex flex-col gap-1">
			<label class="fieldset-label" for="finalize-total">{m.schema_purchase_total_label()}</label>
			<!-- Sin `required` ni `min` nativos: el vacío y el negativo los
			     corta zod en cliente con el error del schema (igual que la
			     cantidad del alta rápida; sin JS el modal ni siquiera puede
			     abrirse). `step` guía los céntimos del importe. -->
			<input
				bind:value={$finalizeFormData.total}
				aria-invalid={textoError($finalizeErrors.total) ? 'true' : undefined}
				id="finalize-total"
				name="total"
				type="number"
				class="input w-full"
				step="0.01"
				inputmode="decimal"
				placeholder="0.00"
			/>
			{#if textoError($finalizeErrors.total)}
				<p class="fieldset-label text-error" role="alert">{textoError($finalizeErrors.total)}</p>
			{/if}
		</div>

		<!-- Los fallos del action (lista ajena, otro miembro se llevó los
		     comprados, error de servidor) se cuentan aquí dentro. -->
		{#if $finalizeMessage}
			<div class="alert alert-error text-sm" role="alert">
				{$finalizeMessage}
			</div>
		{/if}

		<div class="flex justify-end gap-2">
			<button type="button" class="btn btn-ghost" onclick={() => finalizarModal?.close()}>
				{m.ui_cancel()}
			</button>
			<button type="submit" class="btn btn-primary" disabled={$finalizeDelayed}>
				{#if $finalizeDelayed}
					<span class="loading loading-spinner"></span>
				{/if}
				{m.purchases_finalize()}
			</button>
		</div>
	</form>
</Modal>
