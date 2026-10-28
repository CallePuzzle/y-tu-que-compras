<script lang="ts">
	import { enhance } from '$app/forms';
	import { Modal } from '@callepuzzle/svelte-ui';
	import { m } from '$lib/paraglide/messages.js';
	import type { Snippet } from 'svelte';
	import type { SubmitFunction } from '@sveltejs/kit';

	/**
	 * Modal de confirmación de una acción sin schema (borrar, expulsar,
	 * salir…): título, descripción y un formulario POST con sus campos ocultos.
	 * El patrón que repetían /lists, /lists/[listId] y /families/[familyId]:
	 *
	 * - El fallo se queda DENTRO del modal, abierto, con su mensaje; sin
	 *   `update()` (#115), que aplicaría `form.error` y lo duplicaría en la
	 *   alerta de página.
	 * - El éxito cierra el modal, avisa a la página (`onSuccess`) y deja que
	 *   `update` revalide; un redirect (salir/borrar familia) lo sigue el
	 *   router igual que un formulario sin JS.
	 * - Con la petición en vuelo el botón se deshabilita y un 2.º envío se
	 *   cancela (#115): un doble toque no manda otro POST.
	 */
	type Props = {
		title: string;
		description: string;
		confirmLabel: string;
		/** La acción del formulario (`?/delete`, `?/kick`…). */
		action: string;
		/** Campos ocultos del formulario (el id de lo que se confirma). */
		fields?: Record<string, string>;
		/** El texto del fallo cuando la acción no trae su propio `error`. */
		errorFallback: string;
		onSuccess?: () => void;
		/** Disparador propio; sin él, el modal se abre con `showModal()`. */
		trigger?: Snippet<[{ showModal: () => void }]>;
	};

	let {
		title,
		description,
		confirmLabel,
		action,
		fields = {},
		errorFallback,
		onSuccess,
		trigger
	}: Props = $props();

	let modal: { showModal(): void; close(): void } | undefined = $state();
	let error: string | null = $state(null);
	let enviando = $state(false);

	/** Abre el modal sin el rastro del intento anterior. */
	export function showModal() {
		error = null;
		modal?.showModal();
	}

	export function close() {
		modal?.close();
	}

	const onSubmit: SubmitFunction = ({ cancel }) => {
		if (enviando) return cancel();
		enviando = true;
		return async ({ result, update }) => {
			if (result.type === 'failure') {
				const failure = result.data as { error?: string } | undefined;
				error = failure?.error ?? errorFallback;
			} else {
				error = null;
				close();
				onSuccess?.();
				await update();
			}
			enviando = false;
		};
	};
</script>

{#snippet modalTrigger({ showModal: abrir }: { showModal: () => void })}
	{@render trigger?.({
		showModal: () => {
			error = null;
			abrir();
		}
	})}
{/snippet}

<Modal
	bind:this={modal}
	type="X"
	showButton={false}
	trigger={trigger ? modalTrigger : undefined}
	boxClass="modal-box max-w-md"
	strings={{ close: m.ui_close() }}
>
	<h2 class="text-lg font-bold">{title}</h2>
	<p class="mt-1 text-sm opacity-70">{description}</p>

	{#if error}
		<div class="alert alert-error mt-3 text-sm" role="alert">
			{error}
		</div>
	{/if}

	<form method="POST" {action} use:enhance={onSubmit} class="mt-4 flex justify-end">
		{#each Object.entries(fields) as [name, value] (name)}
			<input type="hidden" {name} {value} />
		{/each}
		<button type="submit" class="btn btn-error" disabled={enviando}>
			{#if enviando}
				<span class="loading loading-spinner"></span>
			{/if}
			{confirmLabel}
		</button>
	</form>
</Modal>
