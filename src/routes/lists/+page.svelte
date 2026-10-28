<script lang="ts">
	import { resolve } from '$app/paths';
	import { zodToFieldsJsonSchema } from '@callepuzzle/core/schema';
	import { FormFields, Modal } from '@callepuzzle/svelte-ui';
	import Check from '@lucide/svelte/icons/check';
	import Pencil from '@lucide/svelte/icons/pencil';
	import Plus from '@lucide/svelte/icons/plus';
	import ShoppingBasket from '@lucide/svelte/icons/shopping-basket';
	import Trash2 from '@lucide/svelte/icons/trash-2';
	import { m } from '$lib/paraglide/messages.js';
	import { useRefetchOnVisible } from '$lib/refetch-on-visible.svelte.js';
	import { textoError } from '$lib/forms.js';
	import ConfirmModal from '$lib/components/ConfirmModal.svelte';
	import {
		COLOR_CHIP,
		ICONS,
		colorLabels,
		iconLabels,
		type ListColor,
		type ListIcon
	} from '$lib/list-visuals.js';
	import { LIST_COLORS, listSchema, type ListData } from '$lib/schemas/list.js';
	import { zod4Client } from 'sveltekit-superforms/adapters';
	import { superForm } from 'sveltekit-superforms/client';
	import type { PageProps } from './$types';

	let { data, form: actionData }: PageProps = $props();

	/** Una fila de la vista de listas (la trae el load). */
	type ListRow = PageProps['data']['lists'][number];

	// Modal compartido de crear/editar (un solo formulario, como la invitación
	// de /families): `undefined` = crear, una fila = editar.
	let listaEditada: ListRow | undefined = $state();
	// Modal de borrado: la lista elegida por su botón.
	let listaBorrada: ListRow | undefined = $state();

	// Referencias a los modales para abrirlos por código (showButton={false}) y
	// cerrarlos cuando la operación sale bien (el componente exporta `showModal`
	// y `close`).
	let listasModal: { showModal(): void; close(): void } | undefined = $state();

	// Aviso de éxito FUERA de los modales; el de error se enseña dentro, junto
	// al formulario, con `$message` (crear/editar) o en el `ConfirmModal` (borrar).
	let exito: string | null = $state(null);

	// El schema se construye EN RENDER, nunca en scope de módulo (regla i18n de
	// la librería). Ojo: `superForm` no soporta cambiar el schema, así que se
	// lee una vez por instancia; si el idioma cambia con la página abierta, los
	// mensajes se re-traducen al recargar (igual que en /families).
	const schema = listSchema({
		nameError: m.schema_lists_name_error(),
		nameLabel: m.schema_lists_name_label(),
		namePlaceholder: m.schema_lists_name_placeholder(),
		colorError: m.schema_lists_color_error(),
		colorLabel: m.schema_lists_color_label(),
		iconError: m.schema_lists_icon_error(),
		iconLabel: m.schema_lists_icon_label()
	});

	// Solo el nombre va por la factoría de la librería (`FormFields`); color e
	// icono llevan selectores propios más ricos que un `<select>` (paleta y
	// catálogo visual, notas técnicas de la #31), conectados al mismo superforms
	// y con sus mismos errores.
	// Nombres traducidos de los selectores de color e icono (#118), en render.
	const COLOR_LABEL = colorLabels();
	const ICON_LABEL = iconLabels();

	const fields = zodToFieldsJsonSchema(schema).filter((field) => field.kind === 'string');

	// superForm se llama UNA vez por instancia (gestiona su estado reactivo
	// interno); envolverlo en `$derived` lo reinvocaría y rompería el formulario.
	// svelte-ignore state_referenced_locally
	const form = superForm(data.form, {
		validators: zod4Client(schema),
		onResult({ result }) {
			if (result.type === 'success') {
				// El texto concreto (creada vs. actualizada) lo decide la acción y
				// viaja en el resultado (`message()`), como en la invitación de
				// /families: no se lee de `$formData` porque hasta después de
				// `onResult` superforms no aplica el resultado.
				const data = result.data as { form?: { message?: string } } | undefined;
				exito = data?.form?.message ?? null;
				// Sin `invalidateAll()` a mano: superforms ya revalida el load
				// (`invalidateAll: true` por defecto) y otro más era un 2.º load.
				listasModal?.close();
			} else if (result.type === 'failure') {
				exito = null;
			}
		}
	});
	const { form: formData, enhance, delayed, message, errors } = form;

	/** Abre el modal en modo edición, con los datos de la lista cargados. */
	function abrirEdicion(lista: ListRow) {
		listaEditada = lista;
		exito = null;
		message.set(undefined);
		errors.clear();
		// El schema es el mismo para crear y editar (#66): los campos coinciden.
		// El cast recupera los literales del enum tras venir de Prisma (string).
		formData.set({ name: lista.name, color: lista.color, icon: lista.icon } as ListData);
		listasModal?.showModal();
	}

	/** Abre el modal en modo creación: vacío, sin rastro de la edición anterior. */
	function abrirCreacion() {
		listaEditada = undefined;
		exito = null;
		message.set(undefined);
		errors.clear();
		form.reset();
		listasModal?.showModal();
	}

	// Borrar con confirmación (checklist #66): un `ConfirmModal` compartido;
	// cada card fija qué lista se borra antes de abrirlo.
	let borrarModal: ConfirmModal | undefined = $state();

	function abrirBorrado(lista: ListRow) {
		listaBorrada = lista;
		borrarModal?.showModal();
	}

	// Refresco al volver a la pestaña: los contadores los mueven las altas,
	// compras y borrados de cualquier miembro (ver `useRefetchOnVisible`).
	useRefetchOnVisible();
</script>

<svelte:head>
	<title>{m.lists_title()} · {m.app_brand()}</title>
</svelte:head>

<section class="mx-auto max-w-md">
	<div class="flex items-center justify-between gap-2">
		<h1 class="text-2xl font-bold">{m.lists_title()}</h1>
		<button type="button" class="btn btn-primary btn-sm" onclick={() => abrirCreacion()}>
			<Plus aria-hidden="true" />
			{m.lists_create()}
		</button>
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

	{#if data.lists.length === 0}
		<!-- Estado vacío con CTA (checklist #66). -->
		<div class="mt-8 flex flex-col items-center gap-3 text-center">
			<ShoppingBasket aria-hidden="true" class="size-10 opacity-40" />
			<p class="opacity-70">{m.lists_empty()}</p>
			<button type="button" class="btn btn-primary" onclick={() => abrirCreacion()}>
				<Plus aria-hidden="true" />
				{m.lists_create()}
			</button>
		</div>
	{:else}
		<ul class="mt-4 flex flex-col gap-2">
			{#each data.lists as lista (lista.id)}
				{@const Icon = ICONS[lista.icon as ListIcon]}
				<li class="bg-base-200 rounded-box flex items-center gap-3 px-4 py-3">
					<span
						class={`flex size-10 shrink-0 items-center justify-center rounded-full ${COLOR_CHIP[lista.color as ListColor]}`}
					>
						<Icon aria-hidden="true" class="size-5" />
					</span>
					<!-- El nombre y el contador abren el detalle de items (#68); los
					     botones de editar y borrar quedan fuera del enlace. -->
					<a href={resolve('/lists/[listId]', { listId: lista.id })} class="min-w-0 flex-1">
						<p class="truncate font-medium">{lista.name}</p>
						<!-- Contador de pendientes (checklist #69): lo que falta por
						     comprar; una lista vacía lo dice tal cual y una completada
						     lo celebra. -->
						<p class="text-sm opacity-60">
							{#if lista.itemCount === 0}
								{m.lists_no_items()}
							{:else if lista.pendingCount === 0}
								{m.lists_all_purchased()}
							{:else}
								{m.lists_pending_count({ count: lista.pendingCount })}
							{/if}
						</p>
					</a>
					<span class="flex items-center gap-1">
						<button
							type="button"
							class="btn btn-ghost btn-sm"
							title={m.lists_edit()}
							onclick={() => abrirEdicion(lista)}
						>
							<Pencil aria-hidden="true" />
							<span class="sr-only">{m.lists_edit()}</span>
						</button>
						<button
							type="button"
							class="btn btn-ghost btn-sm"
							title={m.lists_delete()}
							onclick={() => abrirBorrado(lista)}
						>
							<Trash2 aria-hidden="true" />
							<span class="sr-only">{m.lists_delete()}</span>
						</button>
					</span>
				</li>
			{/each}
		</ul>
	{/if}
</section>

<!-- Crear/editar (checklist #66): una modal compartida; el título, la acción
     del formulario y los datos cargados dependen del modo. -->
<Modal
	bind:this={listasModal}
	type="X"
	showButton={false}
	boxClass="modal-box max-w-md"
	strings={{ close: m.ui_close() }}
>
	<h2 class="text-lg font-bold">{listaEditada ? m.lists_edit() : m.lists_create()}</h2>

	<form
		method="POST"
		action={listaEditada ? '?/update' : '?/create'}
		use:enhance
		class="mt-4 flex flex-col gap-4"
	>
		<!-- El id de la lista editada viaja con el formulario; crear no lo lleva. -->
		{#if listaEditada}
			<input type="hidden" name="listId" value={listaEditada.id} />
		{/if}

		<FormFields
			{form}
			{formData}
			{fields}
			strings={{ required: m.form_required(), optional: m.form_optional() }}
		/>

		<!-- Selector de color: la paleta semántica daisyUI (LIST_COLORS). -->
		<fieldset class="fieldset">
			<legend class="fieldset-legend">{m.schema_lists_color_label()}</legend>
			<div class="flex flex-wrap gap-2" role="radiogroup" aria-label={m.schema_lists_color_label()}>
				{#each LIST_COLORS as color (color)}
					<button
						type="button"
						role="radio"
						aria-checked={$formData.color === color}
						aria-label={COLOR_LABEL[color]}
						title={COLOR_LABEL[color]}
						class={`flex size-8 items-center justify-center rounded-full transition ${COLOR_CHIP[color]} ${$formData.color === color ? 'ring-base-content ring-offset-base-100 ring-2 ring-offset-2' : ''}`}
						onclick={() => ($formData.color = color)}
					>
						{#if $formData.color === color}
							<Check aria-hidden="true" class="size-4" />
						{/if}
					</button>
				{/each}
			</div>
			{#if textoError($errors.color)}
				<p class="fieldset-label text-error" role="alert">{textoError($errors.color)}</p>
			{/if}
		</fieldset>

		<!-- Selector de icono: el catálogo lucide (LIST_ICONS), en botones. -->
		<fieldset class="fieldset">
			<legend class="fieldset-legend">{m.schema_lists_icon_label()}</legend>
			<div class="flex flex-wrap gap-1" role="radiogroup" aria-label={m.schema_lists_icon_label()}>
				{#each Object.entries(ICONS) as [iconName, Icono] (iconName)}
					<button
						type="button"
						role="radio"
						aria-checked={$formData.icon === iconName}
						aria-label={ICON_LABEL[iconName as ListIcon]}
						title={ICON_LABEL[iconName as ListIcon]}
						class={`btn btn-square btn-sm ${$formData.icon === iconName ? 'btn-primary' : 'btn-ghost'}`}
						onclick={() => ($formData.icon = iconName as ListIcon)}
					>
						<Icono aria-hidden="true" class="size-4" />
					</button>
				{/each}
			</div>
			{#if textoError($errors.icon)}
				<p class="fieldset-label text-error" role="alert">{textoError($errors.icon)}</p>
			{/if}
		</fieldset>

		{#if $message}
			<div class="alert alert-error text-sm" role="alert">
				{$message}
			</div>
		{/if}

		<button type="submit" class="btn btn-primary" disabled={$delayed}>
			{#if $delayed}
				<span class="loading loading-spinner"></span>
			{/if}
			{listaEditada ? m.lists_save() : m.lists_create()}
		</button>
	</form>
</Modal>

<!-- Borrar (checklist #66): una modal compartida; cada botón de la card fija
     a qué lista se borra antes de abrirla. -->
<ConfirmModal
	bind:this={borrarModal}
	title={m.lists_delete_title({ name: listaBorrada?.name ?? '' })}
	description={m.lists_delete_description()}
	confirmLabel={m.lists_delete_confirm()}
	action="?/delete"
	fields={{ listId: listaBorrada?.id ?? '' }}
	errorFallback={m.lists_error()}
	onSuccess={() => (exito = m.lists_deleted())}
/>
