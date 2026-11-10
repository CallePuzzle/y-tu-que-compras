<script lang="ts">
	import { enhance as enhanceAction } from '$app/forms';
	import { zodToFieldsJsonSchema } from '@callepuzzle/core/schema';
	import { FormFields, Modal } from '@callepuzzle/svelte-ui';
	import ChevronDown from '@lucide/svelte/icons/chevron-down';
	import ChevronUp from '@lucide/svelte/icons/chevron-up';
	import Pencil from '@lucide/svelte/icons/pencil';
	import Plus from '@lucide/svelte/icons/plus';
	import Tags from '@lucide/svelte/icons/tags';
	import Trash2 from '@lucide/svelte/icons/trash-2';
	import ConfirmModal from '#lib/components/ConfirmModal.svelte';
	import { m } from '#lib/paraglide/messages.js';
	import { useRefetchOnVisible } from '#lib/refetch-on-visible.svelte.js';
	import { categorySchema, type CategoryData } from '#lib/schemas/category.js';
	import { zod4Client } from 'sveltekit-superforms/adapters';
	import { superForm } from 'sveltekit-superforms/client';
	import type { PageProps } from './$types';

	let { data, form: actionData }: PageProps = $props();

	/** Una fila de la vista de categorías (la trae el load, ya en su orden). */
	type CategoryRow = PageProps['data']['categories'][number];

	// Modal compartida de crear/editar (un solo formulario, como en /lists):
	// `undefined` = crear, una fila = editar.
	let editedCategory: CategoryRow | undefined = $state();
	// Modal de borrado: la categoría elegida por su botón.
	let deletedCategory: CategoryRow | undefined = $state();

	// Referencia al `Modal` para abrirlo por código (showButton={false}) y
	// cerrarlo cuando la operación sale bien (el componente exporta `showModal`
	// y `close`).
	let categoriesModal: { showModal(): void; close(): void } | undefined = $state();

	// Aviso de éxito FUERA de los modales; el de error se enseña dentro, junto
	// al formulario, con `$message` (crear/editar) o en el `ConfirmModal`
	// (borrar). El de las acciones sin formulario propio (borrar/mover sin JS)
	// llega como `actionData.error`.
	let successMessage: string | null = $state(null);

	// El schema se construye EN RENDER, nunca en scope de módulo (regla i18n de
	// la librería). Ojo: `superForm` no soporta cambiar el schema, así que se lee
	// una vez por instancia; si el idioma cambia con la página abierta, los
	// mensajes se re-traducen al recargar (igual que en /lists y /families).
	const schema = categorySchema({
		nameError: m.schema_categories_name_error(),
		nameLabel: m.schema_categories_name_label(),
		namePlaceholder: m.schema_categories_name_placeholder()
	});

	const fields = zodToFieldsJsonSchema(schema).filter((field) => field.kind === 'string');

	// superForm se llama UNA vez por instancia (gestiona su estado reactivo
	// interno); envolverlo en `$derived` lo reinvocaría y rompería el formulario.
	// svelte-ignore state_referenced_locally
	const form = superForm(data.form, {
		validators: zod4Client(schema),
		onResult({ result }) {
			if (result.type === 'success') {
				// El texto concreto (creada vs. actualizada) lo decide la acción y
				// viaja en el resultado (`message()`), como en /lists.
				const data = result.data as { form?: { message?: string } } | undefined;
				successMessage = data?.form?.message ?? null;
				// Sin `invalidateAll()` a mano: superforms ya revalida el load
				// (`invalidateAll: true` por defecto) y otro más era un 2.º load.
				categoriesModal?.close();
			} else if (result.type === 'failure') {
				successMessage = null;
			}
		}
	});
	const { form: formData, enhance, delayed, message, errors } = form;

	/** Abre el modal en modo edición, con el nombre de la categoría cargado. */
	function openEdit(category: CategoryRow) {
		editedCategory = category;
		successMessage = null;
		message.set(undefined);
		errors.clear();
		// El schema es el mismo para crear y editar: los campos coinciden.
		formData.set({ name: category.name } as CategoryData);
		categoriesModal?.showModal();
	}

	/** Abre el modal en modo creación: vacío, sin rastro de la edición anterior. */
	function openCreate() {
		editedCategory = undefined;
		successMessage = null;
		message.set(undefined);
		errors.clear();
		form.reset();
		categoriesModal?.showModal();
	}

	// Borrar con confirmación: un `ConfirmModal` compartido; cada fila fija qué
	// categoría se borra antes de abrirlo.
	let deleteModal: ConfirmModal | undefined = $state();

	function openDelete(category: CategoryRow) {
		deletedCategory = category;
		deleteModal?.showModal();
	}

	// Refresco al volver a la pestaña: nombres y orden los mueven las gestiones
	// de cualquier miembro (ver `useRefetchOnVisible`).
	useRefetchOnVisible();
</script>

<svelte:head>
	<title>{m.categories_title()} · {m.app_brand()}</title>
</svelte:head>

<section class="mx-auto max-w-md">
	<div class="flex items-center justify-between gap-2">
		<h1 class="text-2xl font-bold">{m.categories_title()}</h1>
		<button type="button" class="btn btn-primary btn-sm" onclick={() => openCreate()}>
			<Plus aria-hidden="true" />
			{m.categories_create()}
		</button>
	</div>

	<!-- Error de las acciones sin JS (borrar y mover): con JS vive dentro de su
	     modal (borrar) o la propia fila lo reordena (mover). -->
	{#if actionData?.error}
		<div class="alert alert-error mt-4 text-sm" role="alert">
			{actionData.error}
		</div>
	{/if}

	{#if successMessage}
		<div class="alert alert-success mt-4 text-sm" role="status">
			{successMessage}
		</div>
	{/if}

	{#if data.categories.length === 0}
		<!-- Estado vacío con CTA. -->
		<div class="mt-8 flex flex-col items-center gap-3 text-center">
			<Tags aria-hidden="true" class="size-10 opacity-40" />
			<p class="opacity-70">{m.categories_empty()}</p>
			<button type="button" class="btn btn-primary" onclick={() => openCreate()}>
				<Plus aria-hidden="true" />
				{m.categories_create()}
			</button>
		</div>
	{:else}
		<!-- `ol`, no `ul`: la vista ES un orden, y lo cuenta la semántica. -->
		<ol class="mt-4 flex flex-col gap-2">
			{#each data.categories as category, i (category.id)}
				<li class="bg-base-200 rounded-box flex items-center gap-1 px-3 py-2">
					<span class="min-w-0 flex-1 truncate font-medium">{category.name}</span>
					<span class="flex items-center gap-1">
						<!-- Reordenar: el cliente solo dice qué fila y dirección; el
						     orden nuevo lo calcula el servidor (`?/move`). En los
						     bordes el botón queda deshabilitado. -->
						<form method="POST" action="?/move" use:enhanceAction class="contents">
							<input type="hidden" name="categoryId" value={category.id} />
							<input type="hidden" name="direction" value="up" />
							<button
								type="submit"
								class="btn btn-ghost btn-sm"
								title={m.categories_move_up()}
								disabled={i === 0}
							>
								<ChevronUp aria-hidden="true" />
								<span class="sr-only">{m.categories_move_up()}</span>
							</button>
						</form>
						<form method="POST" action="?/move" use:enhanceAction class="contents">
							<input type="hidden" name="categoryId" value={category.id} />
							<input type="hidden" name="direction" value="down" />
							<button
								type="submit"
								class="btn btn-ghost btn-sm"
								title={m.categories_move_down()}
								disabled={i === data.categories.length - 1}
							>
								<ChevronDown aria-hidden="true" />
								<span class="sr-only">{m.categories_move_down()}</span>
							</button>
						</form>
						<button
							type="button"
							class="btn btn-ghost btn-sm"
							title={m.categories_edit()}
							onclick={() => openEdit(category)}
						>
							<Pencil aria-hidden="true" />
							<span class="sr-only">{m.categories_edit()}</span>
						</button>
						<button
							type="button"
							class="btn btn-ghost btn-sm"
							title={m.categories_delete()}
							onclick={() => openDelete(category)}
						>
							<Trash2 aria-hidden="true" />
							<span class="sr-only">{m.categories_delete()}</span>
						</button>
					</span>
				</li>
			{/each}
		</ol>
	{/if}
</section>

<!-- Crear/editar: una modal compartida; el título, la acción del formulario
     y los datos cargados dependen del modo. -->
<Modal
	bind:this={categoriesModal}
	type="X"
	showButton={false}
	boxClass="modal-box max-w-md"
	strings={{ close: m.ui_close() }}
>
	<h2 class="text-lg font-bold">
		{editedCategory ? m.categories_edit() : m.categories_create()}
	</h2>

	<form
		method="POST"
		action={editedCategory ? '?/update' : '?/create'}
		use:enhance
		class="mt-4 flex flex-col gap-4"
	>
		<!-- El id de la categoría editada viaja con el formulario; crear no lo lleva. -->
		{#if editedCategory}
			<input type="hidden" name="categoryId" value={editedCategory.id} />
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
			{editedCategory ? m.categories_save() : m.categories_create()}
		</button>
	</form>
</Modal>

<!-- Borrar: una modal compartida; cada botón de la fila fija a qué categoría
     se borra antes de abrirla. -->
<ConfirmModal
	bind:this={deleteModal}
	title={m.categories_delete_title({ name: deletedCategory?.name ?? '' })}
	description={m.categories_delete_description()}
	confirmLabel={m.categories_delete_confirm()}
	action="?/delete"
	fields={{ categoryId: deletedCategory?.id ?? '' }}
	errorFallback={m.categories_error()}
	onSuccess={() => (successMessage = m.categories_deleted())}
/>
