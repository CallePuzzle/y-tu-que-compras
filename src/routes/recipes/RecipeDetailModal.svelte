<script lang="ts">
	import { Modal } from '@callepuzzle/svelte-ui';
	import { formatQuantity } from '#lib/format.js';
	import { m } from '#lib/paraglide/messages.js';
	import { getLocale } from '#lib/paraglide/runtime.js';
	import { unitLabels } from '#lib/units.js';
	import type { PageData } from './$types';

	/**
	 * Detalle de UNA receta (issue #290): el modal que abre el NOMBRE de cada
	 * fila de /recipes — solo lectura estática, espejo del detalle de día del
	 * calendario (`DayDetailModal`): nombre, raciones y ingredientes con la
	 * cantidad localizada (`formatQuantity` + locale) y la unidad traducida
	 * (`unit_*`, el enum nunca se muestra tal cual).
	 *
	 * A diferencia del calendario, aquí NO hay badges de estado de despensa
	 * ni volcado a la compra (allí se calculan para UN día concreto y en la
	 * vista de recetas no hay día), NI categorías de ingrediente (el detalle
	 * del calendario tampoco las pinta), NI acciones dentro: solo cerrar —
	 * las acciones siguen en los botones de cada fila (añadir al menú,
	 * editar, borrar). Sin formulario: los `modalAbierto` del e2e, que
	 * discriminan por `form[action=…]`, no pueden confundirse con él.
	 */
	/** Una fila de la vista de recetas, tal y como la trae el load. */
	type RecipeRow = PageData['recipes'][number];

	let modal: { showModal(): void; close(): void } | undefined = $state();

	/**
	 * La receta mostrada: su snapshot llega al abrirse y el modal es de solo
	 * lectura, así que no necesita seguir al load (una edición repite el
	 * click sobre el nombre fresco).
	 */
	let recipe: RecipeRow | undefined = $state();

	const UNIT_LABEL = unitLabels();

	/** Abre el detalle de UNA receta del listado. */
	export function open(source: RecipeRow) {
		recipe = source;
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
	{#if recipe}
		<h2 class="text-lg font-bold">{recipe.name}</h2>

		{#if recipe.servings !== null}
			<p class="mt-1">
				<!-- El mismo badge de la fila: raciones solo si la receta lo declara. -->
				<span class="badge badge-ghost badge-sm tabular-nums">
					{m.recipe_servings({ count: recipe.servings })}
				</span>
			</p>
		{/if}

		{#if recipe.ingredients.length > 0}
			<!-- Ingredientes en su orden (el `position` que el load respeta):
			     cantidad con los separadores de la locale e unidad traducida,
			     como el `article` del calendario. -->
			<div class="mt-3 flex flex-col gap-1">
				<p class="fieldset-label">{m.meal_plan_ingredients()}</p>
				<ul class="flex flex-col gap-1">
					{#each recipe.ingredients as ingredient (ingredient.id)}
						<li class="flex items-baseline gap-2 text-sm">
							<span class="shrink-0 font-mono text-xs opacity-80">
								{formatQuantity(ingredient.quantity, getLocale())}
								{UNIT_LABEL[ingredient.unit]}
							</span>
							<span>{ingredient.name}</span>
						</li>
					{/each}
				</ul>
			</div>
		{:else}
			<!-- Mensaje propio de receta: el del calendario habla de «menú». -->
			<p class="mt-4 text-sm opacity-70">{m.recipe_no_ingredients()}</p>
		{/if}
	{/if}
</Modal>
