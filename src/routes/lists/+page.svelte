<script lang="ts">
	import { invalidateAll } from '$app/navigation';
	import { enhance as kitEnhance } from '$app/forms';
	import { zodToFieldsJsonSchema } from '@callepuzzle/core/schema';
	import { FormFields, Modal } from '@callepuzzle/svelte-ui';
	import Apple from '@lucide/svelte/icons/apple';
	import Baby from '@lucide/svelte/icons/baby';
	import Beef from '@lucide/svelte/icons/beef';
	import Beer from '@lucide/svelte/icons/beer';
	import Book from '@lucide/svelte/icons/book';
	import Candy from '@lucide/svelte/icons/candy';
	import Carrot from '@lucide/svelte/icons/carrot';
	import Cat from '@lucide/svelte/icons/cat';
	import Check from '@lucide/svelte/icons/check';
	import ClipboardList from '@lucide/svelte/icons/clipboard-list';
	import Coffee from '@lucide/svelte/icons/coffee';
	import Croissant from '@lucide/svelte/icons/croissant';
	import CupSoda from '@lucide/svelte/icons/cup-soda';
	import Dog from '@lucide/svelte/icons/dog';
	import Egg from '@lucide/svelte/icons/egg';
	import Fish from '@lucide/svelte/icons/fish';
	import Flower2 from '@lucide/svelte/icons/flower-2';
	import Gamepad2 from '@lucide/svelte/icons/gamepad-2';
	import Gift from '@lucide/svelte/icons/gift';
	import Hammer from '@lucide/svelte/icons/hammer';
	import Heart from '@lucide/svelte/icons/heart';
	import House from '@lucide/svelte/icons/house';
	import Laptop from '@lucide/svelte/icons/laptop';
	import Leaf from '@lucide/svelte/icons/leaf';
	import ListChecks from '@lucide/svelte/icons/list-checks';
	import Milk from '@lucide/svelte/icons/milk';
	import Music from '@lucide/svelte/icons/music';
	import Paintbrush from '@lucide/svelte/icons/paintbrush';
	import Pencil from '@lucide/svelte/icons/pencil';
	import Pill from '@lucide/svelte/icons/pill';
	import Pizza from '@lucide/svelte/icons/pizza';
	import Plus from '@lucide/svelte/icons/plus';
	import ShoppingBag from '@lucide/svelte/icons/shopping-bag';
	import ShoppingBasket from '@lucide/svelte/icons/shopping-basket';
	import ShoppingCart from '@lucide/svelte/icons/shopping-cart';
	import Smartphone from '@lucide/svelte/icons/smartphone';
	import Sparkles from '@lucide/svelte/icons/sparkles';
	import Star from '@lucide/svelte/icons/star';
	import Ticket from '@lucide/svelte/icons/ticket';
	import Trash2 from '@lucide/svelte/icons/trash-2';
	import WashingMachine from '@lucide/svelte/icons/washing-machine';
	import Wine from '@lucide/svelte/icons/wine';
	import Wrench from '@lucide/svelte/icons/wrench';
	import { m } from '$lib/paraglide/messages.js';
	import { LIST_COLORS, LIST_ICONS, listSchema, type ListData } from '$lib/schemas/list.js';
	import type { SubmitFunction } from '@sveltejs/kit';
	import { zod4Client } from 'sveltekit-superforms/adapters';
	import { superForm } from 'sveltekit-superforms/client';
	import type { PageProps } from './$types';

	let { data, form: actionData }: PageProps = $props();

	/** Una fila de la vista de listas (la trae el load). */
	type ListRow = PageProps['data']['lists'][number];

	type ListColor = (typeof LIST_COLORS)[number];
	type ListIcon = (typeof LIST_ICONS)[number];

	/**
	 * Catálogo de iconos del selector: el nombre del schema es la ruta de import
	 * de lucide, así que el mapa vive junto a los imports y el `satisfies`
	 * garantiza en compilación que el catálogo entero está representado (un
	 * nombre sin componente no se podría renderizar).
	 */
	const ICONS = {
		// Genéricos
		'list-checks': ListChecks,
		'clipboard-list': ClipboardList,
		'shopping-basket': ShoppingBasket,
		'shopping-cart': ShoppingCart,
		'shopping-bag': ShoppingBag,
		star: Star,
		heart: Heart,
		sparkles: Sparkles,
		gift: Gift,
		ticket: Ticket,
		house: House,
		// Comida y bebida
		apple: Apple,
		carrot: Carrot,
		croissant: Croissant,
		egg: Egg,
		fish: Fish,
		beef: Beef,
		milk: Milk,
		pizza: Pizza,
		candy: Candy,
		coffee: Coffee,
		beer: Beer,
		wine: Wine,
		'cup-soda': CupSoda,
		// Hogar y demás
		baby: Baby,
		dog: Dog,
		cat: Cat,
		pill: Pill,
		leaf: Leaf,
		'flower-2': Flower2,
		paintbrush: Paintbrush,
		wrench: Wrench,
		hammer: Hammer,
		'washing-machine': WashingMachine,
		laptop: Laptop,
		smartphone: Smartphone,
		'gamepad-2': Gamepad2,
		book: Book,
		music: Music
	} as const satisfies Record<ListIcon, unknown>;

	/**
	 * Chip de color: el nombre daisyUI que guarda el schema traducido a clases
	 * LITERALES — Tailwind no genera clases dinámicas (`bg-${color}` no existe
	 * en el CSS compilado), así que la paleta completa se declara aquí.
	 */
	const COLOR_CHIP: Record<ListColor, string> = {
		primary: 'bg-primary text-primary-content',
		secondary: 'bg-secondary text-secondary-content',
		accent: 'bg-accent text-accent-content',
		neutral: 'bg-neutral text-neutral-content',
		info: 'bg-info text-info-content',
		success: 'bg-success text-success-content',
		warning: 'bg-warning text-warning-content',
		error: 'bg-error text-error-content'
	};

	/** Une el formato de error de superforms (string o lista) a texto plano. */
	function textoError(error: string | string[] | undefined): string | undefined {
		if (!error) return undefined;
		return Array.isArray(error) ? error.join(' ') : error;
	}

	// Modal compartido de crear/editar (un solo formulario, como la invitación
	// de /families): `undefined` = crear, una fila = editar.
	let listaEditada: ListRow | undefined = $state();
	// Modal de borrado: la lista elegida por su botón.
	let listaBorrada: ListRow | undefined = $state();

	// Referencias a los modales para abrirlos por código (showButton={false}) y
	// cerrarlos cuando la operación sale bien (el componente exporta `showModal`
	// y `close`).
	let listasModal: { showModal(): void; close(): void } | undefined = $state();
	let borrarModal: { showModal(): void; close(): void } | undefined = $state();

	// Aviso de éxito FUERA de los modales; el de error se enseña dentro, junto
	// al formulario, con `$message` (crear/editar) o `borrarError` (borrar).
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
				listasModal?.close();
				void invalidateAll();
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

	// Borrar con confirmación (checklist #66): una modal compartida; cada card
	// fija a quién se borra antes de abrirla. Mismo trato que expulsar en
	// /families: el fallo se queda dentro del modal, el éxito lo cierra.
	let borrarError: string | null = $state(null);

	const onBorrarResult: SubmitFunction =
		() =>
		async ({ result, update }) => {
			if (result.type === 'failure') {
				const failure = result.data as { error?: string } | undefined;
				borrarError = failure?.error ?? m.lists_error();
			} else {
				borrarError = null;
				exito = m.lists_deleted();
				borrarModal?.close();
			}
			await update();
		};

	function abrirBorrado(lista: ListRow) {
		borrarError = null;
		listaBorrada = lista;
		borrarModal?.showModal();
	}
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
					<!-- El detalle de items (contador, #68) llegará con su modelo (#67). -->
					<p class="min-w-0 flex-1 truncate font-medium">{lista.name}</p>
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
			<input type="hidden" name="lista" value={listaEditada.id} />
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
						aria-label={color}
						title={color}
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
						aria-label={iconName}
						title={iconName}
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
<Modal
	bind:this={borrarModal}
	type="X"
	showButton={false}
	boxClass="modal-box max-w-md"
	strings={{ close: m.ui_close() }}
>
	<h2 class="text-lg font-bold">{m.lists_delete_title({ name: listaBorrada?.name ?? '' })}</h2>
	<p class="mt-1 text-sm opacity-70">{m.lists_delete_description()}</p>

	{#if borrarError}
		<div class="alert alert-error mt-3 text-sm" role="alert">
			{borrarError}
		</div>
	{/if}

	<!-- El borrado no lleva schema de superforms (solo el id oculto), así que
	     va con el `enhance` del kit, como en la gestión de miembros. -->
	<form
		method="POST"
		action="?/delete"
		use:kitEnhance={onBorrarResult}
		class="mt-4 flex justify-end"
	>
		<input type="hidden" name="lista" value={listaBorrada?.id ?? ''} />
		<button type="submit" class="btn btn-error">{m.lists_delete_confirm()}</button>
	</form>
</Modal>
