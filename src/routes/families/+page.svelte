<script lang="ts">
	import { invalidateAll } from '$app/navigation';
	import { zodToFieldsJsonSchema } from '@callepuzzle/core/schema';
	import { FormFields, Modal } from '@callepuzzle/svelte-ui';
	import Plus from '@lucide/svelte/icons/plus';
	import { m } from '$lib/paraglide/messages.js';
	import { createFamilySchema } from '$lib/schemas/family.js';
	import { zod4Client } from 'sveltekit-superforms/adapters';
	import { superForm } from 'sveltekit-superforms/client';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();

	// Referencia al `Modal` para cerrarlo cuando la creación sale bien (el
	// componente exporta `showModal` y `close`).
	let modal: { showModal(): void; close(): void } | undefined = $state();

	// Resultado de la última creación que se cuenta FUERA del modal (el de éxito:
	// el de error se enseña dentro, junto al formulario, con `$message`).
	let exito: string | null = $state(null);

	// El schema se construye EN RENDER, nunca en scope de módulo (regla i18n de
	// la librería). Ojo: `superForm` no soporta cambiar el schema, así que se lee
	// una vez por instancia; si el idioma cambia con la página abierta, los
	// mensajes se re-traducen al recargar (igual que en el login).
	const schema = createFamilySchema({
		nameError: m.schema_families_name_error(),
		nameLabel: m.schema_families_name_label(),
		namePlaceholder: m.schema_families_name_placeholder()
	});

	const fields = zodToFieldsJsonSchema(schema);

	// superForm se llama UNA vez por instancia (gestiona su estado reactivo
	// interno); envolverlo en `$derived` lo reinvocaría y rompería el formulario.
	// svelte-ignore state_referenced_locally
	const form = superForm(data.form, {
		validators: zod4Client(schema),
		onResult({ result }) {
			if (result.type === 'success') {
				// La familia ya existe: el load revalidado la trae a la lista y el
				// aviso de éxito queda en la página, no dentro del modal cerrado.
				exito = m.families_success();
				modal?.close();
				void invalidateAll();
			} else if (result.type === 'failure') {
				exito = null;
			}
		}
	});
	const { form: formData, enhance, delayed, message } = form;

	// Al (re)abrir el modal se limpia el rastro del intento anterior: ni el
	// mensaje de error antiguo ni el aviso de éxito de la familia ya creada.
	function abrirModal(showModal: () => void) {
		exito = null;
		message.set(undefined);
		showModal();
	}
</script>

<svelte:head>
	<title>{m.families_title()} · {m.app_brand()}</title>
</svelte:head>

<section class="mx-auto max-w-md">
	<h1 class="text-2xl font-bold">{m.families_title()}</h1>

	<div class="mt-4">
		<Modal
			bind:this={modal}
			type="X"
			boxClass="modal-box max-w-md"
			strings={{ close: m.ui_close() }}
		>
			{#snippet trigger({ showModal })}
				<button type="button" class="btn btn-primary" onclick={() => abrirModal(showModal)}>
					<Plus aria-hidden="true" />
					{m.families_create()}
				</button>
			{/snippet}

			<h2 class="text-lg font-bold">{m.families_create()}</h2>
			<form method="POST" action="?/create" use:enhance class="mt-4 flex flex-col gap-4">
				<FormFields
					{form}
					{formData}
					{fields}
					strings={{ required: m.form_required(), optional: m.form_optional() }}
				/>

				{#if $message && !exito}
					<div class="alert alert-error text-sm" role="alert">
						{$message}
					</div>
				{/if}

				<button type="submit" class="btn btn-primary" disabled={$delayed}>
					{#if $delayed}
						<span class="loading loading-spinner"></span>
					{/if}
					{m.families_create()}
				</button>
			</form>
		</Modal>
	</div>

	{#if exito}
		<div class="alert alert-success mt-4 text-sm" role="status">
			{exito}
		</div>
	{/if}

	{#if data.families.length === 0}
		<p class="mt-4 opacity-70">{m.families_empty()}</p>
	{:else}
		<ul class="mt-4 flex flex-col gap-2">
			{#each data.families as family (family.id)}
				<li class="bg-base-200 rounded-box px-4 py-3">{family.name}</li>
			{/each}
		</ul>
	{/if}
</section>
