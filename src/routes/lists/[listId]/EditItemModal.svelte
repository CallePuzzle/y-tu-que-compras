<script lang="ts">
	import { Modal } from '@callepuzzle/svelte-ui';
	import { errorMessage } from '#lib/forms.js';
	import { m } from '#lib/paraglide/messages.js';
	import { UNITS, type ItemData } from '#lib/schemas/item.js';
	import { unitLabels } from '#lib/units.js';
	import { zod4Client } from 'sveltekit-superforms/adapters';
	import { superForm } from 'sveltekit-superforms/client';
	import { itemFormSchema } from './schemas.js';
	import type { PageData } from './$types';

	/**
	 * Editar (checklist #68): una modal compartida con su propio formulario de
	 * superforms (id «edit-item») para que no se pise con el alta rápida. Se
	 * abre con `open(item)`; el éxito la cierra y pasa el aviso a la página.
	 * Con la categoría opcional (#172): se precarga la del item y «Sin
	 * categoría» la quita al guardar.
	 */
	type Props = {
		form: PageData['editForm'];
		categories: PageData['categories'];
		onSuccess: (message: string) => void;
	};

	let { form, categories, onSuccess }: Props = $props();

	const UNIT_LABEL = unitLabels();

	let modal: { showModal(): void; close(): void } | undefined = $state();
	let editedItem: PageData['items'][number] | undefined = $state();

	// El aviso del modal es solo para FALLOS (400/404/500). En éxito el texto
	// viaja a la página con `onSuccess`, pero superforms aún aplicará el
	// resultado DESPUÉS de `onResult` y dejaría `$message` con el texto de
	// éxito dentro del dialog cerrado: el flag decide sin depender de carreras.
	let saveError = $state(false);

	// svelte-ignore state_referenced_locally
	const editForm = superForm(form, {
		validators: zod4Client(itemFormSchema()),
		invalidateAll: 'pessimistic',
		onResult({ result }) {
			if (result.type === 'success') {
				// El texto concreto lo decide la acción y viaja en el resultado
				// (`message()`), como en /lists.
				const data = result.data as { form?: { message?: string } } | undefined;
				onSuccess(data?.form?.message ?? m.items_updated());
				saveError = false;
				modal?.close();
			} else if (result.type === 'failure' || result.type === 'error') {
				saveError = true;
			}
		}
	});
	const { form: formData, enhance, delayed, message, errors } = editForm;

	/** Abre el modal en modo edición, con los datos del item cargados. */
	export function open(item: PageData['items'][number]) {
		editedItem = item;
		message.set(undefined);
		errors.clear();
		saveError = false;
		// El cast recupera los literales del enum tras venir de Prisma (string).
		// La categoría `null` va como `''`, el valor del option «Sin categoría».
		formData.set({
			name: item.name,
			quantity: item.quantity,
			unit: item.unit,
			categoryId: item.categoryId ?? ''
		} as ItemData);
		modal?.showModal();
	}
</script>

<Modal
	bind:this={modal}
	type="X"
	showButton={false}
	boxClass="modal-box max-w-md"
	strings={{ close: m.ui_close() }}
>
	<h2 class="text-lg font-bold">{m.items_edit()}</h2>

	<form method="POST" action="?/update" use:enhance class="mt-4 flex flex-col gap-4">
		<!-- El id del item editado viaja con el formulario. -->
		<input type="hidden" name="item" value={editedItem?.id ?? ''} />

		<div class="flex flex-col gap-1">
			<label class="fieldset-label" for="edit-name">{m.schema_items_name_label()}</label>
			<input
				bind:value={$formData.name}
				aria-invalid={errorMessage($errors.name) ? 'true' : undefined}
				id="edit-name"
				name="name"
				type="text"
				class="input w-full"
				placeholder={m.schema_items_name_placeholder()}
				required
				maxlength="100"
			/>
			{#if errorMessage($errors.name)}
				<p class="fieldset-label text-error" role="alert">{errorMessage($errors.name)}</p>
			{/if}
		</div>

		<div class="grid grid-cols-2 gap-2">
			<div class="flex flex-col gap-1">
				<label class="fieldset-label" for="edit-quantity">{m.schema_items_quantity_label()}</label>
				<input
					bind:value={$formData.quantity}
					aria-invalid={errorMessage($errors.quantity) ? 'true' : undefined}
					id="edit-quantity"
					name="quantity"
					type="number"
					class="input w-full"
					step="any"
					inputmode="decimal"
					required
				/>
				{#if errorMessage($errors.quantity)}
					<p class="fieldset-label text-error" role="alert">{errorMessage($errors.quantity)}</p>
				{/if}
			</div>

			<div class="flex flex-col gap-1">
				<label class="fieldset-label" for="edit-unit">{m.schema_items_unit_label()}</label>
				<select
					bind:value={$formData.unit}
					aria-invalid={errorMessage($errors.unit) ? 'true' : undefined}
					id="edit-unit"
					name="unit"
					class="select w-full"
					required
				>
					{#each UNITS as unit (unit)}
						<option value={unit}>{UNIT_LABEL[unit]}</option>
					{/each}
				</select>
				{#if errorMessage($errors.unit)}
					<p class="fieldset-label text-error" role="alert">{errorMessage($errors.unit)}</p>
				{/if}
			</div>
		</div>

		<!-- Categoría opcional (checklist #172): las mismas opciones que en el
		     alta; elegir «Sin categoría» guarda el item sin ella. -->
		<div class="flex flex-col gap-1">
			<label class="fieldset-label" for="edit-category">{m.schema_items_category_label()}</label>
			<select
				bind:value={$formData.categoryId}
				id="edit-category"
				name="categoryId"
				class="select w-full"
			>
				<option value="">{m.items_category_none()}</option>
				{#each categories as category (category.id)}
					<option value={category.id}>{category.name}</option>
				{/each}
			</select>
		</div>

		{#if saveError && $message}
			<div class="alert alert-error text-sm" role="alert">
				{$message}
			</div>
		{/if}

		<button type="submit" class="btn btn-primary" disabled={$delayed}>
			{#if $delayed}
				<span class="loading loading-spinner"></span>
			{/if}
			{m.items_save()}
		</button>
	</form>
</Modal>
