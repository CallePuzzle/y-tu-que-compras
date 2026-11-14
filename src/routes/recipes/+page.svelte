<script lang="ts">
	import ChefHat from '@lucide/svelte/icons/chef-hat';
	import Pencil from '@lucide/svelte/icons/pencil';
	import Plus from '@lucide/svelte/icons/plus';
	import Trash2 from '@lucide/svelte/icons/trash-2';
	import ConfirmModal from '#lib/components/ConfirmModal.svelte';
	import ItemSearch from '#lib/components/ItemSearch.svelte';
	import { matchesItemSearch } from '#lib/components/item-search.js';
	import { m } from '#lib/paraglide/messages.js';
	import { useRefetchOnVisible } from '#lib/refetch-on-visible.svelte.js';
	import CreateRecipeModal from './CreateRecipeModal.svelte';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();

	/** Una fila de la vista de recetas (la trae el load, alfabética). */
	type RecipeRow = PageProps['data']['recipes'][number];

	// Aviso de éxito FUERA de los modales; el de error se enseña dentro, junto
	// al formulario (crear/editar) o en el ConfirmModal (borrar).
	let successMessage: string | null = $state(null);

	// Modal compartida de crear/editar (un solo formulario): `undefined` =
	// crear, una fila = editar. La referencia la abre la página (`open` y
	// `openForEdit` del propio modal).
	let createModal: CreateRecipeModal | undefined = $state();

	/** Abre el modal en modo creación. */
	function openCreate() {
		successMessage = null;
		createModal?.open();
	}

	/** Abre el modal en modo edición, precargado con la receta elegida. */
	function openEdit(recipe: RecipeRow) {
		successMessage = null;
		createModal?.openForEdit(recipe);
	}

	// Borrar con confirmación: un `ConfirmModal` compartido (patrón items);
	// cada botón de la fila fija qué receta se borra antes de abrirlo.
	let deletedRecipe: RecipeRow | undefined = $state();
	let deleteModal: ConfirmModal | undefined = $state();

	function openDelete(recipe: RecipeRow) {
		deletedRecipe = recipe;
		deleteModal?.showModal();
	}

	// Buscador (filtro por nombre EN CLIENTE, #239): el load ya trae todas las
	// recetas, consulta en `$state` y listado en `$derived`, sin debounce — el
	// mismo `matchesItemSearch` de lista y despensa, que aquí solo tiene
	// nombre que casar (las recetas no llevan categoría).
	let searchQuery = $state('');

	/** `data.recipes` ya pasado por el filtro del buscador. */
	const filteredRecipes = $derived(
		data.recipes.filter((recipe) =>
			matchesItemSearch({ name: recipe.name, categoryName: null }, searchQuery)
		)
	);

	// Refresco al volver a la pestaña: recetas las mueven las gestiones de
	// cualquier miembro (ver `useRefetchOnVisible`).
	useRefetchOnVisible();
</script>

<svelte:head>
	<title>{m.recipe_title()} · {m.app_brand()}</title>
</svelte:head>

<section class="mx-auto max-w-md">
	<div class="flex items-center justify-between gap-2">
		<h1 class="text-2xl font-bold">{m.recipe_title()}</h1>
		<button type="button" class="btn btn-primary btn-sm" onclick={() => openCreate()}>
			<Plus aria-hidden="true" />
			{m.recipe_create()}
		</button>
	</div>

	{#if successMessage}
		<div class="alert alert-success mt-4 text-sm" role="status">
			{successMessage}
		</div>
	{/if}

	{#if data.recipes.length === 0}
		<!-- Estado vacío con CTA. -->
		<div class="mt-8 flex flex-col items-center gap-3 text-center">
			<ChefHat aria-hidden="true" class="size-10 opacity-40" />
			<p class="opacity-70">{m.recipe_empty()}</p>
			<button type="button" class="btn btn-primary" onclick={() => openCreate()}>
				<Plus aria-hidden="true" />
				{m.recipe_create()}
			</button>
		</div>
	{:else}
		<!-- El filtro va tras los avisos y antes del listado, como en la
		     despensa: visible siempre que haya recetas (este es el `{:else}`
		     del estado vacío). -->
		<ItemSearch bind:query={searchQuery} />

		{#if filteredRecipes.length === 0}
			<!-- Sin resultados: la consulta no casa con ninguna receta; no es el
			     estado vacío de la familia. -->
			<p class="mt-8 text-center opacity-70">{m.ui_search_no_results()}</p>
		{:else}
			<!-- Alfabéticas (el orden lo trae el load del servidor) y con su
			     badge de raciones cuando la receta lo declara. Sin `truncate`
			     (issue #152): el nombre largo salta a varias líneas. -->
			<ul class="mt-4 flex flex-col gap-2">
				{#each filteredRecipes as recipe (recipe.id)}
					<li class="bg-base-200 rounded-box flex items-center gap-1 px-3 py-2">
						<div class="min-w-0 flex-1">
							<p class="font-medium break-words">{recipe.name}</p>
							{#if recipe.servings !== null}
								<span class="badge badge-ghost badge-sm mt-0.5 tabular-nums">
									{m.recipe_servings({ count: recipe.servings })}
								</span>
							{/if}
						</div>
						<span class="flex items-center gap-1">
							<button
								type="button"
								class="btn btn-ghost btn-sm"
								title={m.recipe_edit()}
								onclick={() => openEdit(recipe)}
							>
								<Pencil aria-hidden="true" />
								<span class="sr-only">{m.recipe_edit()}</span>
							</button>
							<button
								type="button"
								class="btn btn-ghost btn-sm"
								title={m.recipe_delete()}
								onclick={() => openDelete(recipe)}
							>
								<Trash2 aria-hidden="true" />
								<span class="sr-only">{m.recipe_delete()}</span>
							</button>
						</span>
					</li>
				{/each}
			</ul>
		{/if}
	{/if}
</section>

<!-- Crear/editar: una modal compartida; el título, la acción del formulario
     y los datos cargados dependen del modo (los decide el propio modal). -->
<CreateRecipeModal
	bind:this={createModal}
	form={data.form}
	pantryItems={data.pantryItems}
	onSuccess={(message) => (successMessage = message)}
/>

<!-- Borrar: una modal compartida; cada botón de la fila fija a qué receta se
     refiere antes de abrirla. La despensa y los menús no cambian: el fallo
     vive dentro del modal (lo gestiona el ConfirmModal) y el éxito avisa a la
     página como el resto de acciones. -->
<ConfirmModal
	bind:this={deleteModal}
	title={m.recipe_delete_title({ name: deletedRecipe?.name ?? '' })}
	description={m.recipe_delete_description()}
	confirmLabel={m.recipe_delete_confirm()}
	action="?/delete"
	fields={{ id: deletedRecipe?.id ?? '' }}
	errorFallback={m.recipe_error()}
	onSuccess={() => (successMessage = m.recipe_deleted())}
/>
