<script lang="ts">
	import { Modal } from '@callepuzzle/svelte-ui';
	import IngredientStatusRow from '#lib/components/IngredientStatusRow.svelte';
	import { errorMessage } from '#lib/forms.js';
	import type { ProductPantryStatus } from '#lib/pantry-status.js';
	import { dayPantryStatus } from '#lib/pantry-status.js';
	import { m } from '#lib/paraglide/messages.js';
	import { zod4Client } from 'sveltekit-superforms/adapters';
	import { superForm } from 'sveltekit-superforms/client';
	import { recipeDumpFormSchema } from './schemas.js';
	import type { PageData } from './$types';

	/**
	 * Detalle de UNA receta (issue #290): el modal que abre el NOMBRE de cada
	 * fila de /recipes, con el mismo trazado que el detalle de día del
	 * calendario (`DayDetailModal`): nombre, raciones e ingredientes con la
	 * cantidad localizada y la unidad traducida (la fila es el componente
	 * COMPARTIDO `IngredientStatusRow`), el badge de despensa de cada
	 * ingrediente (#244: suficiente / lo que falta / falta, el cálculo puro
	 * de `pantry-status.ts` sobre LOS INGREDIENTES DE LA RECETA — no hay día
	 * concreto: la necesidad de la receta se compara con la despensa tal
	 * cual, agregada por producto igual que en el calendario) y el volcado a
	 * la compra (el tronco de #245): cada ingrediente lleva su botón de
	 * añadir lo que falta y el pie ofrece «añadir lo que falta de la receta»
	 * a la lista que se elija.
	 *
	 * El déficit lo recalcula SIEMPRE el servidor al volcar
	 * (`dumpRecipeToList`): el badge solo orienta y el botón solo señala su
	 * ingrediente — la mecánica del formulario es la del calendario, con
	 * `dataType: 'json'`, el load pesimista, el fallo DENTRO del modal para
	 * reintentar y el éxito cerrando y avisando a la página
	 * (`onDumpSuccess`). Sin listas se explica y no hay nada que volcar. Las
	 * acciones de la receta (añadir al menú, editar, borrar) siguen en los
	 * botones de la fila: este modal no repite ninguna.
	 */
	type Props = {
		/** La despensa de la familia como mapa id → cantidad (#244): contra lo que el cálculo compara la necesidad de la receta. */
		pantryQuantities: PageData['pantryQuantities'];
		/** Las listas de la familia: el destino del volcado (#290). */
		lists: PageData['lists'];
		/** El formulario del volcado, con id propio (`dump-recipe`). */
		dumpForm: PageData['dumpForm'];
		/** El volcado entró en la lista: la página avisa FUERA del modal, como al crear. */
		onDumpSuccess: (message: string) => void;
	};

	/** Una fila de la vista de recetas, tal y como la trae el load. */
	type RecipeRow = PageData['recipes'][number];

	let { pantryQuantities, lists, dumpForm: initialDumpForm, onDumpSuccess }: Props = $props();

	let modal: { showModal(): void; close(): void } | undefined = $state();

	/**
	 * La receta mostrada: su snapshot llega al abrirse y el modal no repinta
	 * sus datos con el load (una edición repite el click sobre el nombre
	 * fresco). El volcado no la toca: escribe en la lista, así que los
	 * badges siguen exactos tras volcar.
	 */
	let recipe: RecipeRow | undefined = $state();

	// El estado de despensa de la receta abierta (#244): el cálculo puro
	// agregado por producto sobre SUS ingredientes, contra la despensa que
	// trae el load. Cada ingrediente consulta el resultado por su
	// `pantryItemId` (los sin FK, bajo `null`), igual que en el calendario.
	const NO_STATUSES = new Map<string | null, ProductPantryStatus>();
	const pantryStatuses = $derived(
		recipe ? dayPantryStatus([{ ingredients: recipe.ingredients }], pantryQuantities) : NO_STATUSES
	);

	// ¿Hay algo que volcar (#290)? Cuentan los dos estados con déficit:
	// insuficiente (falta para la receta) y sin producto (no hay despensa
	// que cubra nada). El botón de la receta se deshabilita si no hay nada —
	// igual que el individual de un producto cubierto —; el servidor LO
	// RECALCULA de todas formas al recibir el envío.
	const recipeHasDeficit = $derived(
		[...pantryStatuses.values()].some((status) => status.status !== 'enough')
	);

	// ---- Volcado a la compra (#290): un formulario para la receta entera y
	// para cada botón de ingrediente. Pesimista como el resto de acciones:
	// el detalle cierra cuando el load trae la verdad — que aquí no cambia
	// nada visible (la despensa no se toca), así que el aviso viaja a la
	// página. El fallo se queda DENTRO, como el de crear/editar. ----

	// El aviso del modal es solo para FALLOS (400/404/500). En éxito el
	// texto viaja a la página con `onDumpSuccess`, pero superforms aún
	// aplicará el resultado DESPUÉS de `onResult` y dejaría `$message` con
	// el texto dentro del dialog cerrado (misma razón que en el calendario).
	let dumpError = $state(false);

	/**
	 * El destino del volcado en vuelo: `undefined` = la receta entera; el id
	 * del ingrediente = individual. Lo fija el botón pulsado (el click corre
	 * antes del submit) y `onSubmit` lo inyecta en el JSON de salida — con
	 * `dataType: 'json'` superforms manda solo los datos validados del
	 * schema, y `JSON.stringify` suelta los valores undefined.
	 */
	let dumpTarget: string | undefined = $state(undefined);

	// svelte-ignore state_referenced_locally
	const dumpForm = superForm(initialDumpForm, {
		validators: zod4Client(recipeDumpFormSchema()),
		dataType: 'json',
		invalidateAll: 'pessimistic',
		onSubmit({ jsonData }) {
			jsonData({ ...$dumpFormData, ingredientId: dumpTarget });
		},
		onResult({ result }) {
			if (result.type === 'success') {
				// El texto concreto lo decide la acción y viaja en el resultado
				// (`message()`), como en el resto de modales de la app.
				const data = result.data as { form?: { message?: string } } | undefined;
				onDumpSuccess(data?.form?.message ?? '');
				dumpError = false;
				modal?.close();
			} else if (result.type === 'failure' || result.type === 'error') {
				dumpError = true;
			}
		}
	});
	const {
		form: dumpFormData,
		enhance: dumpEnhance,
		delayed: dumpDelayed,
		message: dumpMessage,
		errors: dumpErrors
	} = dumpForm;

	/** Abre el detalle de UNA receta del listado. */
	export function open(source: RecipeRow) {
		recipe = source;
		// El volcado (#290) arranca limpio: destino «la receta entera» y la
		// primera lista por defecto, como el detalle del calendario.
		dumpTarget = undefined;
		dumpMessage.set(undefined);
		dumpErrors.clear();
		dumpError = false;
		dumpFormData.set({ recipeId: source.id, listId: lists[0]?.id ?? '' });
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
			     cantidad localizada, unidad traducida, badge de despensa y
			     volcado individual — la fila COMPARTIDA con el calendario
			     (`IngredientStatusRow`), aquí contra la necesidad de LA
			     RECETA, sin día que agregue. -->
			<div class="mt-3 flex flex-col gap-1">
				<p class="fieldset-label">{m.meal_plan_ingredients()}</p>
				<ul class="flex flex-col gap-1">
					{#each recipe.ingredients as ingredient (ingredient.id)}
						{@const status = pantryStatuses.get(ingredient.pantryItemId)}
						<IngredientStatusRow
							{ingredient}
							{status}
							dumpFormId="recipe-dump"
							dumpDisabled={status?.status === 'enough' || lists.length === 0 || $dumpDelayed}
							onDump={() => (dumpTarget = ingredient.id)}
						/>
					{/each}
				</ul>
			</div>
		{:else}
			<!-- Mensaje propio de receta: el del calendario habla de «menú». -->
			<p class="mt-4 text-sm opacity-70">{m.recipe_no_ingredients()}</p>
		{/if}

		<!-- Volcado a la lista de la compra (#290): lo que falta de la
		     receta, a la lista que se elija. Un solo formulario para la
		     receta entera y para los botones de ingrediente de arriba (los
		     envían con `form=` desde fuera); sin listas no hay destino
		     posible y se explica, como en el calendario. El fallo del action
		     se cuenta aquí dentro; el éxito cierra el detalle y avisa a la
		     página. Solo con ingredientes: una receta sin ellos no tiene
		     nada que volcar. -->
		{#if recipe.ingredients.length > 0}
			{#if lists.length === 0}
				<p class="mt-4 text-sm opacity-70">{m.calendar_dump_no_lists()}</p>
			{:else}
				<form
					id="recipe-dump"
					method="POST"
					action="?/dump"
					use:dumpEnhance
					class="mt-4 flex flex-col gap-2"
				>
					<!-- La receta del volcado viaja DOS veces según el camino: en
					     el JSON de salida (dataType json manda solo los datos
					     validados del schema, ya con su valor de `$form`) y en
					     este input oculto para el submit NATIVO sin JavaScript,
					     donde el formulario viaja plano y `parseFormData` lo
					     reconstruye igual que en el calendario. -->
					<input type="hidden" name="recipeId" value={recipe.id} />
					<div class="flex items-end gap-2">
						<div class="flex flex-1 flex-col gap-1">
							<label class="fieldset-label" for="recipe-dump-list">
								{m.schema_readd_list_label()}
							</label>
							<select
								bind:value={$dumpFormData.listId}
								id="recipe-dump-list"
								name="listId"
								class="select w-full"
								required
							>
								{#each lists as list (list.id)}
									<option value={list.id}>{list.name}</option>
								{/each}
							</select>
							{#if errorMessage($dumpErrors.listId)}
								<p class="fieldset-label text-error" role="alert">
									{errorMessage($dumpErrors.listId)}
								</p>
							{/if}
						</div>
						<button
							type="submit"
							class="btn btn-outline"
							disabled={!recipeHasDeficit || $dumpDelayed}
							onclick={() => (dumpTarget = undefined)}
						>
							{#if $dumpDelayed}
								<span class="loading loading-spinner"></span>
							{/if}
							{m.recipe_dump_all()}
						</button>
					</div>

					{#if dumpError && $dumpMessage}
						<div class="alert alert-error text-sm" role="alert">
							{$dumpMessage}
						</div>
					{/if}
				</form>
			{/if}
		{/if}
	{/if}
</Modal>
