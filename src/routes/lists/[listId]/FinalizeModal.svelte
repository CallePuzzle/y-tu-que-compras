<script lang="ts">
	import { Modal } from '@callepuzzle/svelte-ui';
	import { formatQuantity } from '$lib/format.js';
	import { textoError } from '$lib/forms.js';
	import { m } from '$lib/paraglide/messages.js';
	import { getLocale } from '$lib/paraglide/runtime.js';
	import { unitLabels } from '$lib/units.js';
	import { zod4Client } from 'sveltekit-superforms/adapters';
	import { superForm } from 'sveltekit-superforms/client';
	import { purchaseFormSchema } from './schemas.js';
	import type { PageData } from './$types';

	/**
	 * Finalizar compra (checklist #71): resumen de los items comprados y el
	 * total del ticket escrito a mano. La confirmación envía `?/finalize`
	 * (#70), que crea el historial y actualiza la despensa en UNA transacción;
	 * el formulario solo lleva el total, validado por el MISMO schema que usa
	 * el action. Con SU formulario de superforms (id «finalize-purchase», lo
	 * pone el load) para no pisar al alta rápida ni al de edición.
	 */
	type Props = {
		form: PageData['finalizeForm'];
		/** Los comprados que se muestran (con el toggle optimista aplicado). */
		comprados: PageData['items'];
		onSuccess: (message: string) => void;
	};

	let { form, comprados, onSuccess }: Props = $props();

	const UNIT_LABEL = unitLabels();

	let modal: { showModal(): void; close(): void } | undefined = $state();

	// svelte-ignore state_referenced_locally
	const finalizeForm = superForm(form, {
		validators: zod4Client(purchaseFormSchema()),
		invalidateAll: 'pessimistic',
		onResult({ result }) {
			if (result.type === 'success') {
				// El texto concreto lo decide la acción y viaja en el resultado
				// (`message()`), como en el modal de edición. El load pesimista
				// trae la lista ya depurada: los comprados desaparecen de ella.
				const data = result.data as { form?: { message?: string } } | undefined;
				onSuccess(data?.form?.message ?? m.purchases_success());
				modal?.close();
			}
		}
	});
	const { form: formData, enhance, delayed, message, errors } = finalizeForm;

	/** Abre el modal de finalizar con el total EN BLANCO para escribirlo. */
	export function open() {
		message.set(undefined);
		errors.clear();
		// El 0 que trae el formulario del load es el default del schema, no un
		// total real: el campo empieza vacío para que el total no se confirme
		// sin mirar. El cast es el mismo truco que en la edición: undefined no
		// es un `number`, pero superforms lo acepta y zod lo exige al enviar.
		formData.set({ total: undefined as unknown as number });
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
				<!-- Sin `truncate` (issue #152): el nombre salta a varias líneas,
			     igual que en la fila de la lista. -->
				<span class="min-w-0 font-medium break-words">{item.name}</span>
				<span class="badge badge-ghost shrink-0 tabular-nums">
					{formatQuantity(item.quantity, getLocale())}
					{UNIT_LABEL[item.unit]}
				</span>
			</div>
		{/each}
	</div>

	<form method="POST" action="?/finalize" use:enhance class="mt-4 flex flex-col gap-4">
		<div class="flex flex-col gap-1">
			<label class="fieldset-label" for="finalize-total">{m.schema_purchase_total_label()}</label>
			<!-- Sin `required` ni `min` nativos: el vacío y el negativo los
			     corta zod en cliente con el error del schema (igual que la
			     cantidad del alta rápida; sin JS el modal ni siquiera puede
			     abrirse). `step` guía los céntimos del importe. -->
			<input
				bind:value={$formData.total}
				aria-invalid={textoError($errors.total) ? 'true' : undefined}
				id="finalize-total"
				name="total"
				type="number"
				class="input w-full"
				step="0.01"
				inputmode="decimal"
				placeholder={m.purchases_total_placeholder()}
			/>
			{#if textoError($errors.total)}
				<p class="fieldset-label text-error" role="alert">{textoError($errors.total)}</p>
			{/if}
		</div>

		<!-- Los fallos del action (lista ajena, otro miembro se llevó los
		     comprados, error de servidor) se cuentan aquí dentro. -->
		{#if $message}
			<div class="alert alert-error text-sm" role="alert">
				{$message}
			</div>
		{/if}

		<div class="flex justify-end gap-2">
			<button type="button" class="btn btn-ghost" onclick={() => modal?.close()}>
				{m.ui_cancel()}
			</button>
			<button type="submit" class="btn btn-primary" disabled={$delayed}>
				{#if $delayed}
					<span class="loading loading-spinner"></span>
				{/if}
				{m.purchases_finalize()}
			</button>
		</div>
	</form>
</Modal>
