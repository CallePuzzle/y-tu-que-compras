<script lang="ts">
	import { Modal } from '@callepuzzle/svelte-ui';
	import { textoError } from '$lib/forms.js';
	import { m } from '$lib/paraglide/messages.js';
	import { UNITS, type ItemData } from '$lib/schemas/item.js';
	import { unitLabels } from '$lib/units.js';
	import { zod4Client } from 'sveltekit-superforms/adapters';
	import { superForm } from 'sveltekit-superforms/client';
	import { itemFormSchema } from './schemas.js';
	import type { PageData } from './$types';

	/**
	 * Editar (checklist #68): una modal compartida con su propio formulario de
	 * superforms (id «edit-item») para que no se pise con el alta rápida. Se
	 * abre con `open(item)`; el éxito la cierra y pasa el aviso a la página.
	 */
	type Props = {
		form: PageData['editForm'];
		onSuccess: (message: string) => void;
	};

	let { form, onSuccess }: Props = $props();

	const UNIT_LABEL = unitLabels();

	let modal: { showModal(): void; close(): void } | undefined = $state();
	let itemEditado: PageData['items'][number] | undefined = $state();

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
				modal?.close();
			}
		}
	});
	const { form: formData, enhance, delayed, message, errors } = editForm;

	/** Abre el modal en modo edición, con los datos del item cargados. */
	export function open(item: PageData['items'][number]) {
		itemEditado = item;
		message.set(undefined);
		errors.clear();
		// El cast recupera los literales del enum tras venir de Prisma (string).
		formData.set({ name: item.name, quantity: item.quantity, unit: item.unit } as ItemData);
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
		<input type="hidden" name="item" value={itemEditado?.id ?? ''} />

		<div class="flex flex-col gap-1">
			<label class="fieldset-label" for="edit-name">{m.schema_items_name_label()}</label>
			<input
				bind:value={$formData.name}
				aria-invalid={textoError($errors.name) ? 'true' : undefined}
				id="edit-name"
				name="name"
				type="text"
				class="input w-full"
				placeholder={m.schema_items_name_placeholder()}
				required
				maxlength="100"
			/>
			{#if textoError($errors.name)}
				<p class="fieldset-label text-error" role="alert">{textoError($errors.name)}</p>
			{/if}
		</div>

		<div class="grid grid-cols-2 gap-2">
			<div class="flex flex-col gap-1">
				<label class="fieldset-label" for="edit-quantity">{m.schema_items_quantity_label()}</label>
				<input
					bind:value={$formData.quantity}
					aria-invalid={textoError($errors.quantity) ? 'true' : undefined}
					id="edit-quantity"
					name="quantity"
					type="number"
					class="input w-full"
					step="any"
					inputmode="decimal"
					required
				/>
				{#if textoError($errors.quantity)}
					<p class="fieldset-label text-error" role="alert">{textoError($errors.quantity)}</p>
				{/if}
			</div>

			<div class="flex flex-col gap-1">
				<label class="fieldset-label" for="edit-unit">{m.schema_items_unit_label()}</label>
				<select
					bind:value={$formData.unit}
					aria-invalid={textoError($errors.unit) ? 'true' : undefined}
					id="edit-unit"
					name="unit"
					class="select w-full"
					required
				>
					{#each UNITS as unit (unit)}
						<option value={unit}>{UNIT_LABEL[unit]}</option>
					{/each}
				</select>
				{#if textoError($errors.unit)}
					<p class="fieldset-label text-error" role="alert">{textoError($errors.unit)}</p>
				{/if}
			</div>
		</div>

		{#if $message}
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
