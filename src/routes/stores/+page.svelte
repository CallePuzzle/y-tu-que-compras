<script lang="ts">
	import { zodToFieldsJsonSchema } from '@callepuzzle/core/schema';
	import { FormFields, Modal } from '@callepuzzle/svelte-ui';
	import Pencil from '@lucide/svelte/icons/pencil';
	import Plus from '@lucide/svelte/icons/plus';
	import Store from '@lucide/svelte/icons/store';
	import Trash2 from '@lucide/svelte/icons/trash-2';
	import ConfirmModal from '#lib/components/ConfirmModal.svelte';
	import { m } from '#lib/paraglide/messages.js';
	import { useRefetchOnVisible } from '#lib/refetch-on-visible.svelte.js';
	import { storeSchema, type StoreData } from '#lib/schemas/store.js';
	import { zod4Client } from 'sveltekit-superforms/adapters';
	import { superForm } from 'sveltekit-superforms/client';
	import type { PageProps } from './$types';

	let { data, form: actionData }: PageProps = $props();

	/** Una fila de la vista de establecimientos (la trae el load, por creación). */
	type StoreRow = PageProps['data']['stores'][number];

	// Modal compartida de crear/editar (un solo formulario, como en /categories):
	// `undefined` = crear, una fila = editar.
	let establecimientoEditado: StoreRow | undefined = $state();
	// Modal de borrado: el establecimiento elegido por su botón.
	let establecimientoBorrado: StoreRow | undefined = $state();

	// Referencia al `Modal` para abrirlo por código (showButton={false}) y
	// cerrarlo cuando la operación sale bien (el componente exporta `showModal`
	// y `close`).
	let establecimientosModal: { showModal(): void; close(): void } | undefined = $state();

	// Aviso de éxito FUERA de los modales; el de error se enseña dentro, junto
	// al formulario, con `$message` (crear/editar) o en el `ConfirmModal`
	// (borrar). El de la acción sin formulario propio (borrar sin JS) llega
	// como `actionData.error`.
	let exito: string | null = $state(null);

	// El schema se construye EN RENDER, nunca en scope de módulo (regla i18n de
	// la librería). Ojo: `superForm` no soporta cambiar el schema, así que se lee
	// una vez por instancia; si el idioma cambia con la página abierta, los
	// mensajes se re-traducen al recargar (igual que en /lists y /categories).
	const schema = storeSchema({
		nameError: m.schema_stores_name_error(),
		nameLabel: m.schema_stores_name_label(),
		namePlaceholder: m.schema_stores_name_placeholder()
	});

	const fields = zodToFieldsJsonSchema(schema).filter((field) => field.kind === 'string');

	// superForm se llama UNA vez por instancia (gestiona su estado reactivo
	// interno); envolverlo en `$derived` lo reinvocaría y rompería el formulario.
	// svelte-ignore state_referenced_locally
	const form = superForm(data.form, {
		validators: zod4Client(schema),
		onResult({ result }) {
			if (result.type === 'success') {
				// El texto concreto (creado vs. actualizado) lo decide la acción y
				// viaja en el resultado (`message()`), como en /categories.
				const data = result.data as { form?: { message?: string } } | undefined;
				exito = data?.form?.message ?? null;
				// Sin `invalidateAll()` a mano: superforms ya revalida el load
				// (`invalidateAll: true` por defecto) y otro más era un 2.º load.
				establecimientosModal?.close();
			} else if (result.type === 'failure') {
				exito = null;
			}
		}
	});
	const { form: formData, enhance, delayed, message, errors } = form;

	/** Abre el modal en modo edición, con el nombre del establecimiento cargado. */
	function abrirEdicion(establecimiento: StoreRow) {
		establecimientoEditado = establecimiento;
		exito = null;
		message.set(undefined);
		errors.clear();
		// El schema es el mismo para crear y editar: los campos coinciden.
		formData.set({ name: establecimiento.name } as StoreData);
		establecimientosModal?.showModal();
	}

	/** Abre el modal en modo creación: vacío, sin rastro de la edición anterior. */
	function abrirCreacion() {
		establecimientoEditado = undefined;
		exito = null;
		message.set(undefined);
		errors.clear();
		form.reset();
		establecimientosModal?.showModal();
	}

	// Borrar con confirmación: un `ConfirmModal` compartido; cada botón de la
	// fila fija qué establecimiento se borra antes de abrirlo.
	let borrarModal: ConfirmModal | undefined = $state();

	function abrirBorrado(establecimiento: StoreRow) {
		establecimientoBorrado = establecimiento;
		borrarModal?.showModal();
	}

	// Refresco al volver a la pestaña: nombres los mueven las gestiones de
	// cualquier miembro (ver `useRefetchOnVisible`).
	useRefetchOnVisible();
</script>

<svelte:head>
	<title>{m.stores_title()} · {m.app_brand()}</title>
</svelte:head>

<section class="mx-auto max-w-md">
	<div class="flex items-center justify-between gap-2">
		<h1 class="text-2xl font-bold">{m.stores_title()}</h1>
		<button type="button" class="btn btn-primary btn-sm" onclick={() => abrirCreacion()}>
			<Plus aria-hidden="true" />
			{m.stores_create()}
		</button>
	</div>

	<!-- Error de la acción sin JS (borrar): con JS vive dentro de su modal. -->
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

	{#if data.stores.length === 0}
		<!-- Estado vacío con CTA. -->
		<div class="mt-8 flex flex-col items-center gap-3 text-center">
			<Store aria-hidden="true" class="size-10 opacity-40" />
			<p class="opacity-70">{m.stores_empty()}</p>
			<button type="button" class="btn btn-primary" onclick={() => abrirCreacion()}>
				<Plus aria-hidden="true" />
				{m.stores_create()}
			</button>
		</div>
	{:else}
		<!-- Sin orden manual: la vista los muestra por orden de creación, como
		     las listas (capa #182). -->
		<ul class="mt-4 flex flex-col gap-2">
			{#each data.stores as establecimiento (establecimiento.id)}
				<li class="bg-base-200 rounded-box flex items-center gap-1 px-3 py-2">
					<span class="min-w-0 flex-1 truncate font-medium">{establecimiento.name}</span>
					<span class="flex items-center gap-1">
						<button
							type="button"
							class="btn btn-ghost btn-sm"
							title={m.stores_edit()}
							onclick={() => abrirEdicion(establecimiento)}
						>
							<Pencil aria-hidden="true" />
							<span class="sr-only">{m.stores_edit()}</span>
						</button>
						<button
							type="button"
							class="btn btn-ghost btn-sm"
							title={m.stores_delete()}
							onclick={() => abrirBorrado(establecimiento)}
						>
							<Trash2 aria-hidden="true" />
							<span class="sr-only">{m.stores_delete()}</span>
						</button>
					</span>
				</li>
			{/each}
		</ul>
	{/if}
</section>

<!-- Crear/editar: una modal compartida; el título, la acción del formulario
     y los datos cargados dependen del modo. -->
<Modal
	bind:this={establecimientosModal}
	type="X"
	showButton={false}
	boxClass="modal-box max-w-md"
	strings={{ close: m.ui_close() }}
>
	<h2 class="text-lg font-bold">
		{establecimientoEditado ? m.stores_edit() : m.stores_create()}
	</h2>

	<form
		method="POST"
		action={establecimientoEditado ? '?/update' : '?/create'}
		use:enhance
		class="mt-4 flex flex-col gap-4"
	>
		<!-- El id del establecimiento editado viaja con el formulario; crear no lo lleva. -->
		{#if establecimientoEditado}
			<input type="hidden" name="storeId" value={establecimientoEditado.id} />
		{/if}

		<FormFields
			{form}
			{formData}
			{fields}
			strings={{ required: m.form_required(), optional: m.form_optional() }}
		/>

		{#if $message}
			<div class="alert alert-error text-sm" role="alert">
				{$message}
			</div>
		{/if}

		<button type="submit" class="btn btn-primary" disabled={$delayed}>
			{#if $delayed}
				<span class="loading loading-spinner"></span>
			{/if}
			{establecimientoEditado ? m.stores_save() : m.stores_create()}
		</button>
	</form>
</Modal>

<!-- Borrar: una modal compartida; cada botón de la fila fija a qué establecimiento
     se borra antes de abrirla. -->
<ConfirmModal
	bind:this={borrarModal}
	title={m.stores_delete_title({ name: establecimientoBorrado?.name ?? '' })}
	description={m.stores_delete_description()}
	confirmLabel={m.stores_delete_confirm()}
	action="?/delete"
	fields={{ storeId: establecimientoBorrado?.id ?? '' }}
	errorFallback={m.stores_error()}
	onSuccess={() => (exito = m.stores_deleted())}
/>
