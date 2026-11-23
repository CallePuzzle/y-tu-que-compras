<script lang="ts">
	import { Modal } from '@callepuzzle/svelte-ui';
	import { formatQuantity } from '#lib/format.js';
	import { errorMessage } from '#lib/forms.js';
	import { m } from '#lib/paraglide/messages.js';
	import { getLocale } from '#lib/paraglide/runtime.js';
	import { unitLabels } from '#lib/units.js';
	import { zod4Client } from 'sveltekit-superforms/adapters';
	import { superForm } from 'sveltekit-superforms/client';
	import { purchaseFormSchema } from './schemas.js';
	import type { PageData } from './$types';

	/**
	 * Finalizar compra (checklist #71): resumen de los items comprados, el
	 * total del ticket escrito a mano y el establecimiento de la familia
	 * (opcional, #185). La confirmación envía `?/finalize` (#70), que crea el
	 * historial y actualiza la despensa en UNA transacción; el formulario
	 * viaja validado por el MISMO schema que usa el action. Con SU formulario
	 * de superforms (id «finalize-purchase», lo pone el load) para no pisar al
	 * alta rápida ni al de edición.
	 */
	type Props = {
		form: PageData['finalizeForm'];
		/** Los comprados que se muestran (con el toggle optimista aplicado). */
		purchasedItems: PageData['items'];
		/** Los establecimientos de la familia (#185), por orden de creación. */
		stores: PageData['stores'];
		onSuccess: (message: string) => void;
	};

	let { form, purchasedItems, stores, onSuccess }: Props = $props();

	const UNIT_LABEL = unitLabels();

	let modal: { showModal(): void; close(): void } | undefined = $state();

	// La confirmación de cerrar la compra SIN establecimiento (#293): el
	// option vacío puede ser un olvido, así que el primer envío sin tienda se
	// corta y se pregunta INLINE en este modal (sin segundo dialog apilado ni
	// confirm() nativo, y sin los problemas de foco/z-index que traería).
	// `confirmPending` mantiene la alerta visible; `storeConfirmed` deja pasar
	// el reenvío de «Sí». La puerta es puramente de UI: el servidor sigue
	// aceptando la compra sin tienda — igual que sin JS.
	let confirmPending = $state(false);
	let storeConfirmed = $state(false);
	let confirmYes: HTMLButtonElement | undefined = $state();
	let storeSelect: HTMLSelectElement | undefined = $state();

	$effect(() => {
		// La pregunta ya se anuncia por `role="alert"`; el foco aterriza en el
		// botón de «Sí» para que responder sea un Enter.
		if (confirmPending) confirmYes?.focus();
	});

	// svelte-ignore state_referenced_locally
	const finalizeForm = superForm(form, {
		validators: zod4Client(purchaseFormSchema()),
		invalidateAll: 'pessimistic',
		// El hook corre ANTES de la validación en cliente, así que aquí se
		// decide la pregunta (#293): con tienda elegida o con el «Sí» ya dado,
		// el envío pasa tal cual. Sin tienda, solo se corta si el resto del
		// formulario (el total) ya es válido — si no, no se cancela y zod
		// enseña sus errores de siempre: el confirm solo sale cuando la compra
		// podría cerrarse de verdad. El `submit()` de «Sí» re-entra por aquí
		// con el flag puesto, y esta vez deja pasar.
		async onSubmit({ cancel }) {
			if (storeConfirmed || $formData.storeId) return;
			const validated = await finalizeForm.validateForm();
			if (!validated.valid) return;
			cancel();
			confirmPending = true;
		},
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

	/** Abre el modal con el total EN BLANCO y el establecimiento en «Sin…». */
	export function open() {
		message.set(undefined);
		errors.clear();
		// La pregunta sin establecimiento también empieza de cero en cada
		// apertura (#293): ni la alerta ni el «Sí» dado antes de cancelar se
		// arrastran a la siguiente compra.
		confirmPending = false;
		storeConfirmed = false;
		// El 0 que trae el formulario del load es el default del schema, no un
		// total real: el campo empieza vacío para que el total no se confirme
		// sin mirar. El cast es el mismo truco que en la edición: undefined no
		// es un `number`, pero superforms lo acepta y zod lo exige al enviar.
		// El establecimiento vuelve al option vacío (#185): lo elegido antes de
		// cancelar no se arrastra a la siguiente compra.
		formData.set({ total: undefined as unknown as number, storeId: '' });
		modal?.showModal();
	}

	/** «Sí, finalizar sin establecimiento»: deja pasar el envío y cierra. */
	function confirmWithoutStore() {
		confirmPending = false;
		storeConfirmed = true;
		finalizeForm.submit();
	}

	/** «No, elegir establecimiento»: retira la pregunta y foco al select. */
	function pickStore() {
		confirmPending = false;
		storeSelect?.focus();
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
		{#each purchasedItems as item (item.id)}
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
				aria-invalid={errorMessage($errors.total) ? 'true' : undefined}
				id="finalize-total"
				name="total"
				type="number"
				class="input w-full"
				step="0.01"
				inputmode="decimal"
				placeholder={m.purchases_total_placeholder()}
			/>
			{#if errorMessage($errors.total)}
				<p class="fieldset-label text-error" role="alert">{errorMessage($errors.total)}</p>
			{/if}
		</div>

		<!-- Establecimiento opcional (#185): los de la familia, en su orden
		     de creación. El option vacío viaja como `''` y el servidor
		     guarda la compra sin establecimiento — el mismo significado
		     que no enviar el campo. El id lo valida el SERVIDOR contra la
		     familia: uno rancio o ajeno explicará el fallo en este mismo
		     modal. -->
		<div class="flex flex-col gap-1">
			<label class="fieldset-label" for="finalize-store">{m.schema_purchase_store_label()}</label>
			<!-- Cambiar el establecimiento retira la pregunta sola (#293): si hay
			     tienda elegida ya no hay nada que confirmar. -->
			<select
				bind:value={$formData.storeId}
				bind:this={storeSelect}
				id="finalize-store"
				name="storeId"
				class="select w-full"
				onchange={() => (confirmPending = false)}
			>
				<option value="">{m.purchases_store_none()}</option>
				{#each stores as store (store.id)}
					<option value={store.id}>{store.name}</option>
				{/each}
			</select>
		</div>

		<!-- La pregunta del cierre sin establecimiento (#293), en el mismo
		     modal: `role="alert"` la anuncia y los dos botones resuelven sin
		     apilar otro dialog. El foco la recibe el botón de «Sí» (efecto).
		     Los botones van APILADOS en estrecho (un `btn` no encoge: una fila
		     con los dos desbordaría la alerta) y en fila a la derecha en
		     pantallas anchas, como el pie del modal. -->
		{#if confirmPending}
			<div class="alert alert-warning text-sm" role="alert">
				<div class="flex w-full min-w-0 flex-col gap-2">
					<span>{m.purchases_store_confirm_message()}</span>
					<!-- Los dos botones SIEMPRE apilados y a lo ancho: juntos no
					     caben en una fila ni en el ancho del modal (un `btn` no
					     encoge ni parte el texto). «Sí» primero en DOM y arriba,
					     igual que el foco que recibe. -->
					<div class="flex flex-col gap-2">
						<button
							bind:this={confirmYes}
							type="button"
							class="btn btn-sm"
							onclick={confirmWithoutStore}
						>
							{m.purchases_store_confirm_yes()}
						</button>
						<button type="button" class="btn btn-ghost btn-sm" onclick={pickStore}>
							{m.purchases_store_confirm_no()}
						</button>
					</div>
				</div>
			</div>
		{/if}

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
