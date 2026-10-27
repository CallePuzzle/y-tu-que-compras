<script lang="ts">
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
	// y rellena el formulario con el VACÍO que trae: queda listo para
	// encadenar otra alta y el item nuevo aparece en la lista.
	// svelte-ignore state_referenced_locally
	const addForm = superForm(data.form, {
		validators: zod4Client(schema),
		invalidateAll: 'pessimistic'
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
	let borrarError: string | null = $state(null);

	const onBorrarResult: SubmitFunction =
		() =>
		async ({ result, update }) => {
			if (result.type === 'failure') {
				const failure = result.data as { error?: string } | undefined;
				borrarError = failure?.error ?? m.items_error();
			} else {
				borrarError = null;
				exito = m.items_deleted();
				borrarModal?.close();
			}
			await update();
		};

	function abrirBorrado(item: ItemRow) {
		borrarError = null;
		itemBorrado = item;
		borrarModal?.showModal();
	}
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

		<div class="flex items-end gap-2">
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
		<!-- Orden visual (checklist #68): el `order` que calculó el servidor al
		     crear; los primeros arriba. -->
		<ol class="mt-4 flex list-none flex-col gap-2">
			{#each data.items as item (item.id)}
				<li class="bg-base-200 rounded-box flex items-center gap-3 px-4 py-3">
					<p class="min-w-0 flex-1 truncate font-medium">{item.name}</p>
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
			{/each}
		</ol>
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
		<button type="submit" class="btn btn-error">{m.items_delete_confirm()}</button>
	</form>
</Modal>
