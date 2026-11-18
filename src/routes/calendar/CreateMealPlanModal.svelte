<script lang="ts">
	import Plus from '@lucide/svelte/icons/plus';
	import X from '@lucide/svelte/icons/x';
	import { Modal } from '@callepuzzle/svelte-ui';
	import { resolve } from '$app/paths';
	import ItemSearch from '#lib/components/ItemSearch.svelte';
	import UnitConflictChip from '#lib/components/UnitConflictChip.svelte';
	import { errorMessage } from '#lib/forms.js';
	import { mealTypeLabels } from '#lib/meal-types.js';
	import {
		indexNameSuggestions,
		mealIngredientPrefillState,
		prefillMealIngredient,
		type MealIngredientPrefillState
	} from '#lib/name-suggestions.js';
	import { m } from '#lib/paraglide/messages.js';
	import { UNITS } from '#lib/schemas/item.js';
	import { MEAL_TYPES, type MealPlanFormData } from '#lib/schemas/mealplan.js';
	import { unitLabels } from '#lib/units.js';
	import type { UnitConversion } from '#lib/unit-convert.js';
	import { zod4Client } from 'sveltekit-superforms/adapters';
	import { superForm } from 'sveltekit-superforms/client';
	import { matchesItemSearch } from '#lib/components/item-search.js';
	import { mealPlanWithRecipeSchema } from './schemas.js';
	import type { PageData } from './$types';

	/**
	 * Crear y EDITAR menús desde el calendario (épica #212, tareas #222 y
	 * #221): el modal que abre el día pulsado del grid. Consume el schema YA
	 * existente (`#lib/schemas/mealplan.ts`, #225) vía `mealPlanFormSchema`
	 * de la ruta — el mismo que validan las acciones de crear y editar, como
	 * en las listas. Los ingredientes son FILAS DINÁMICAS (añadir/quitar) y
	 * el nombre se autocompleta con TODOS los nombres que la familia ya
	 * conoce (#285: despensa, listas y recetas; `datalist` nativo: en móvil,
	 * sugerencias sin JavaScript propio). Al teclear uno — por nombre
	 * canónico —, la fila hereda su unidad y su categoría sin pisar lo
	 * elegido a mano (regla de #173); con la unidad del producto de despensa,
	 * el guardado (`ensurePantryProducts`) lo enlaza en vez de crear otro.
	 * El éxito cierra el modal y pasa el aviso a la página; el grid se
	 * refresca con el load pesimista.
	 *
	 * Los ingredientes van ANIDADOS (array de objetos), así que el formulario
	 * viaja como JSON (`dataType: 'json'`, requisito de superforms para
	 * estructuras anidadas — el FormData plano de los items no llega a esto).
	 *
	 * La edición (#221) REUTILIZA este modal: `openForEdit` precarga
	 * tipo/título/ingredientes del menú elegido en el detalle del día y el
	 * formulario pasa a `?/update`. El id NO va en `$form` (crear y editar
	 * comparten el mismo contrato), y con dataType json superforms manda solo
	 * los datos validados — el id se inyecta en el JSON de salida en
	 * `onSubmit` y lo valida el action con `mealPlanUpdateSchema` (el de
	 * crear más el id).
	 *
	 * Cada fila lleva el chip de unidad conflictiva (#243, retrofit del que
	 * ya usaba el modal de recetas): si el nombre tecleado casa con un
	 * producto de despensa en OTRA unidad (los productos viajan en el load,
	 * con su unidad), avisa y propone la conversión exacta — con la fila ya
	 * en la unidad del producto, el `upsert` del guardado
	 * (`ensurePantryProducts`) cae en el producto EXISTENTE y no crea el
	 * segundo en despensa.
	 *
	 * En CREACIÓN el modal es SOLO buscador (#252): el alta desde el
	 * calendario nace SIEMPRE de una receta — se filtran EN CLIENTE las que
	 * trae el load (`recipes`, con el mismo `matchesItemSearch` de lista,
	 * despensa y /recipes) y al elegir una se precargan SU título (no hay
	 * campo de título: es el de la receta) y SUS ingredientes, editables
	 * como snapshot (#242), con el chip del origen encima. Sin recetario no
	 * hay formulario: aviso y enlace a /recipes para crear la primera
	 * receta. El menú que se guarda es un SNAPSHOT — como en /recipes
	 * (#242): el `recipeId` solo traza el origen y el action lo valida con
	 * el schema extendido (`mealPlanWithRecipeSchema`); no va en `$form`
	 * (crear y editar comparten el mismo contrato) y se inyecta en el JSON
	 * de salida en `onSubmit`, como el id en edición. En EDICIÓN no hay
	 * buscador ni chip: la trazabilidad del origen no se toca al editar
	 * (#242) y el título vuelve a ser campo editable.
	 */
	type Props = {
		form: PageData['form'];
		/** Las categorías de la familia (el select opcional de cada ingrediente). */
		categories: PageData['categories'];
		/** Los productos de la despensa: id, nombre y unidad — el chip de unidad. */
		pantryItems: PageData['pantryItems'];
		/** Los nombres conocidos de la familia (#285): el `datalist` y el pre-relleno. */
		nameSuggestions: PageData['nameSuggestions'];
		/** Las recetas de la familia (#252): el catálogo del buscador en creación. */
		recipes: PageData['recipes'];
		onSuccess: (message: string) => void;
	};

	/** Un menú del día, tal y como lo trae el load para el detalle (#221). */
	type DayMealPlan = PageData['mealPlans'][string][number];

	/** Una receta del listado de la familia (#252): la que se elige como origen. */
	type RecipeRow = PageData['recipes'][number];

	let { form, categories, pantryItems, nameSuggestions, recipes, onSuccess }: Props = $props();

	const UNIT_LABEL = unitLabels();
	const MEAL_LABEL = mealTypeLabels();

	/** Una fila de ingrediente vacía: como el item del alta rápida, cantidad 1 y «ud». */
	const EMPTY_INGREDIENT = { name: '', quantity: 1, unit: 'unit', categoryId: '' } as const;

	/** Las sugerencias indexadas por canónico: cada tecla es una búsqueda directa. */
	const suggestionIndex = $derived(indexNameSuggestions(nameSuggestions));

	/**
	 * El pre-relleno de cada fila (#285), en paralelo a `$formData.ingredients`
	 * (mismo índice): su base al abrirse (o al precargar una receta) y si su
	 * unidad y su categoría las puso la sugerencia o la persona. No se pinta,
	 * así que no necesita ser reactivo; se mantiene alineado en abrir, elegir
	 * o soltar receta, añadir y quitar filas.
	 */
	let prefill: MealIngredientPrefillState[] = [];

	let modal: { showModal(): void; close(): void } | undefined = $state();

	/**
	 * El menú en edición (#221): `undefined` en creación. Mientras vive, el
	 * formulario apunta a `?/update` y su id viaja en el JSON de salida.
	 */
	let editing: DayMealPlan | undefined = $state();

	// El buscador de recetas (#252): la consulta la posee el modal (se
	// resetea al abrirse) y el filtro vive en el `$derived` de abajo.
	let searchQuery = $state('');

	/**
	 * La receta elegida como origen (#252): `undefined` en el alta manual.
	 * Mientras vive, su nombre e ingredientes fueron los prefijados y su id
	 * viaja en el JSON de salida (`recipeId`); quitar el chip la suelta y el
	 * guardado sale «sin receta». En edición no hay buscador ni chip: la
	 * trazabilidad del origen no se toca al editar (#242).
	 */
	let sourceRecipe: RecipeRow | undefined = $state();

	// Las recetas que casan con la consulta (nombre, normalizado — el MISMO
	// `matchesItemSearch` de lista, despensa y /recipes), en orden del
	// listado y capadas a cinco: una lista corta se elige a golpe de pulgar.
	// Sin consulta (o de solo espacios) no hay lista: el buscador no sugiere
	// nada hasta que se teclea.
	const matchingRecipes = $derived.by(() => {
		if (!searchQuery.trim()) {
			return [];
		}
		return recipes
			.filter((recipe) => matchesItemSearch({ name: recipe.name, categoryName: null }, searchQuery))
			.slice(0, 5);
	});

	// El aviso del modal es solo para FALLOS (400/409/500). En éxito el texto
	// viaja a la página con `onSuccess`, pero superforms aún aplicará el
	// resultado DESPUÉS de `onResult` y dejaría `$message` con el texto de
	// éxito dentro del dialog cerrado: el flag decide sin depender de carreras.
	let saveError = $state(false);

	// svelte-ignore state_referenced_locally
	const createForm = superForm(form, {
		validators: zod4Client(mealPlanWithRecipeSchema()),
		dataType: 'json',
		invalidateAll: 'pessimistic',
		// El id del menú editado y el `recipeId` de la receta elegida (#252)
		// no van en `$form` (crear y editar comparten el MISMO contrato) y con
		// dataType json superforms manda solo los datos validados: se inyectan
		// aquí, en el JSON de salida. Si la validación de cliente falla no se
		// manda nada, así que pasar `$formData` entero es seguro; el action
		// valida cada extra con su schema extendido (`mealPlanUpdateSchema` y
		// `mealPlanWithRecipeSchema`, ver `schemas.ts`). Sin receta elegida el
		// JSON sale sin `recipeId`: el alta manual de siempre, que el servidor
		// guarda «sin receta».
		onSubmit({ jsonData }) {
			if (sourceRecipe || editing) {
				jsonData({
					...$formData,
					...(sourceRecipe ? { recipeId: sourceRecipe.id } : {}),
					...(editing ? { id: editing.id } : {})
				});
			}
		},
		onResult({ result }) {
			if (result.type === 'success') {
				// El texto concreto lo decide la acción y viaja en el resultado
				// (`message()`), como en el resto de modales de la app.
				const data = result.data as { form?: { message?: string } } | undefined;
				onSuccess(data?.form?.message ?? (editing ? m.meal_plan_updated() : m.meal_plan_success()));
				saveError = false;
				modal?.close();
			} else if (result.type === 'failure' || result.type === 'error') {
				saveError = true;
			}
		}
	});
	const { form: formData, enhance, delayed, message, errors } = createForm;

	/** Abre el modal para UN día: la celda pulsada manda la clave `YYYY-MM-DD`. */
	export function open(dateKey: string) {
		editing = undefined;
		message.set(undefined);
		errors.clear();
		saveError = false;
		// El buscador arranca limpio y SIN receta de origen: cada creación
		// decide de nuevo si nace de una receta o a mano (#252).
		sourceRecipe = undefined;
		searchQuery = '';
		// El resto arranca limpio: comida (la principal del día) y una fila de
		// ingrediente vacía lista para escribir. El cast, como en editar item:
		// recupera los literales del enum que el ancho del literal difumina.
		formData.set({
			title: '',
			date: dateKey,
			mealType: 'lunch',
			ingredients: [{ ...EMPTY_INGREDIENT }]
		} as MealPlanFormData);
		prefill = [mealIngredientPrefillState(EMPTY_INGREDIENT)];
		modal?.showModal();
	}

	/**
	 * Abre el modal EN EDICIÓN (#221), precargado con el menú elegido en el
	 * detalle del día: su tipo, su título, su día (`dateKey`, la clave del
	 * grupo que trae el load) y sus ingredientes en su orden. La categoría
	 * `null` va como `''`, el valor del option «Sin categoría» — el mismo
	 * trato que en editar item.
	 */
	export function openForEdit(meal: DayMealPlan, dateKey: string) {
		editing = meal;
		message.set(undefined);
		errors.clear();
		saveError = false;
		// Sin buscador ni chip en edición (#252): el origen del menú no se toca
		// al editar (trazabilidad intacta, #242).
		sourceRecipe = undefined;
		searchQuery = '';
		formData.set({
			title: meal.title,
			date: dateKey,
			mealType: meal.mealType,
			ingredients: meal.ingredients.map((ingredient) => ({
				name: ingredient.name,
				quantity: ingredient.quantity,
				unit: ingredient.unit,
				categoryId: ingredient.categoryId ?? ''
			}))
		} as MealPlanFormData);
		prefill = $formData.ingredients.map((ingredient) => mealIngredientPrefillState(ingredient));
		modal?.showModal();
	}

	/**
	 * Elige UNA receta del buscador como origen (#252): la marca (su id
	 * viajará al guardar) y precarga SU título y sus ingredientes — nombre,
	 * cantidad, unidad y categoría en su orden, el mismo snapshot editable
	 * que `AssignRecipeModal.open` en /recipes (#242). El día de la celda y
	 * el tipo ya fijados se CONSERVAN: la receta solo aporta el contenido.
	 * La consulta se limpia: elegida la receta, la lista de coincidencias
	 * sobra — el snapshot (chip, tipo e ingredientes) manda. La categoría
	 * `null` de la vista va como `''`, el valor del option «Sin categoría»
	 * — el mismo trato que en editar item. Por `update`, como todo lo que
	 * toca el store de superforms.
	 */
	function pickRecipe(recipe: RecipeRow) {
		sourceRecipe = recipe;
		searchQuery = '';
		message.set(undefined);
		saveError = false;
		errors.clear();
		formData.update(
			(data) =>
				({
					...data,
					title: recipe.name,
					ingredients: recipe.ingredients.map((ingredient) => ({
						name: ingredient.name,
						quantity: ingredient.quantity,
						unit: ingredient.unit,
						categoryId: ingredient.categoryId ?? ''
					}))
				}) as typeof data
		);
		prefill = $formData.ingredients.map((ingredient) => mealIngredientPrefillState(ingredient));
	}

	/**
	 * Suelta la receta elegida (#252): de vuelta al buscador en limpio — el
	 * snapshot precargado se RETIRA con ella (ya no hay alta «sin receta»
	 * que lo herede: el título no tiene campo propio y un formulario
	 * huérfano no se puede guardar). El error de un intento fallido anterior
	 * tampoco viaja a la siguiente elección.
	 */
	function clearRecipe() {
		sourceRecipe = undefined;
		message.set(undefined);
		saveError = false;
		errors.clear();
		formData.update(
			(data) =>
				({
					...data,
					title: '',
					ingredients: [{ ...EMPTY_INGREDIENT }]
				}) as typeof data
		);
		prefill = [mealIngredientPrefillState(EMPTY_INGREDIENT)];
	}

	/**
	 * La conversión que el chip propuso (#243), aplicada a su fila: cantidad
	 * y unidad convertidas — el ENLACE al producto no va en este formulario
	 * (el schema de menú no lleva `pantryItemId`): lo resuelve el SERVIDOR al
	 * guardar (`ensurePantryProducts`, por nombre normalizado y unidad), y
	 * con la fila ya en la unidad del producto el upsert cae en el producto
	 * EXISTENTE. Mismo `update()` que en el modal de recetas: el estado de
	 * superforms es un store plano, y tocar un objeto anidado sin `update`
	 * no repinta el select ni retira el chip (que desaparece solo: la unidad
	 * queda igualada a la del producto).
	 */
	function applyConversion(index: number, conversion: UnitConversion) {
		formData.update((data) => {
			const row = data.ingredients[index];
			if (!row) {
				return data;
			}
			row.quantity = conversion.quantity;
			row.unit = conversion.unit;
			return data;
		});
		markManual(index, 'unit');
	}

	/** El estado de pre-relleno de la fila, creándolo si faltara. */
	function prefillOf(index: number) {
		return (prefill[index] ??= mealIngredientPrefillState(EMPTY_INGREDIENT));
	}

	/**
	 * El nombre tecleado, sincronizado con su fila (#285): casa por nombre
	 * CANÓNICO con las sugerencias de la familia y la fila hereda su unidad
	 * y su categoría salvo las elegidas a mano; dejar de casar retira lo que
	 * puso la sugerencia. La regla vive en `prefillMealIngredient`
	 * (`#lib/name-suggestions.ts`), la misma que las recetas. Por `update()`,
	 * como todo lo que toca el store de superforms: una mutación anidada
	 * directa no repinta los selects.
	 */
	function syncIngredientName(index: number, name: string) {
		formData.update((data) => {
			const row = data.ingredients[index];
			if (!row) {
				return data;
			}
			const result = prefillMealIngredient({ ...row, name }, prefillOf(index), suggestionIndex);
			row.unit = result.unit;
			row.categoryId = result.categoryId;
			prefill[index] = result.state;
			return data;
		});
	}

	/**
	 * La unidad o la categoría elegidas a mano (su select, o la conversión
	 * del chip para la unidad): desde ahí, teclear el nombre ya no las pisa.
	 */
	function markManual(index: number, field: 'unit' | 'category') {
		const state = prefillOf(index);
		if (field === 'unit') {
			state.unitManual = true;
			state.unitSuggested = false;
		} else {
			state.categoryManual = true;
			state.categorySuggested = false;
		}
	}

	/** Añade una fila de ingrediente al final, en blanco. */
	function addIngredient() {
		$formData.ingredients = [...$formData.ingredients, { ...EMPTY_INGREDIENT }];
		prefill = [...prefill, mealIngredientPrefillState(EMPTY_INGREDIENT)];
	}

	/** Quita la fila del índice: puede quedarse en cero, el schema lo permite. */
	function removeIngredient(index: number) {
		$formData.ingredients = $formData.ingredients.filter((_, i) => i !== index);
		prefill = prefill.filter((_, i) => i !== index);
	}
</script>

<Modal
	bind:this={modal}
	type="X"
	showButton={false}
	boxClass="modal-box max-w-md"
	strings={{ close: m.ui_close() }}
>
	<h2 class="text-lg font-bold">{editing ? m.meal_plan_edit() : m.meal_plan_create()}</h2>

	<!-- El día del menú viaja como clave `YYYY-MM-DD` (`dayKeySchema`) y se
	     muestra fijo: lo eligió quien pulsó la celda, aquí no se edita. Para
	     el submit viaja en el input oculto del formulario de abajo. -->
	<div class="mt-4 flex items-center gap-2">
		<span class="fieldset-label">{m.schema_mealplans_date_label()}</span>
		<span class="badge badge-outline font-mono">{$formData.date}</span>
	</div>

	{#if !editing && recipes.length === 0}
		<!-- Sin recetario no hay alta desde el calendario (#252): el menú del
		     calendario nace SIEMPRE de una receta, así que sin ninguna la
		     única salida es ir a crear la primera a su página. -->
		<div class="mt-4 flex flex-col gap-4">
			<div class="alert alert-warning text-sm" role="alert">
				<span>{m.meal_plan_no_recipes()}</span>
			</div>
			<a href={resolve('/recipes')} class="btn btn-primary">{m.meal_plan_no_recipes_cta()}</a>
		</div>
	{/if}

	{#if !editing && recipes.length > 0}
		<!-- Buscador de recetas (#252), solo en CREACIÓN y FUERA del
		     formulario: no es un campo del menú y un Enter en él no ha de
		     intentar enviar nada. Filtra EN CLIENTE el catálogo de la familia
		     que trae el load — el MISMO `matchesItemSearch` de lista,
		     despensa y /recipes. Elegir una receta rellena el formulario de
		     abajo (título e ingredientes) y marca el origen con el chip; sin
		     receta elegida no hay formulario que enviar. -->
		<ItemSearch
			bind:query={searchQuery}
			id="meal-recipe-search"
			label={m.meal_plan_recipe_label()}
			placeholder={m.meal_plan_recipe_placeholder()}
		/>
		{#if matchingRecipes.length > 0}
			<!-- Hasta cinco coincidencias como botones nativos (patrón de los
			     `datalist` de la app): pulsar una elige la receta. -->
			<ul class="mt-4 flex flex-col gap-1" aria-label={m.meal_plan_recipe_results()}>
				{#each matchingRecipes as recipe (recipe.id)}
					<li>
						<button
							type="button"
							class="btn btn-outline btn-sm w-full justify-start"
							onclick={() => pickRecipe(recipe)}
						>
							{recipe.name}
						</button>
					</li>
				{/each}
			</ul>
		{:else if searchQuery.trim()}
			<!-- Con consulta y SIN coincidencias: el estado vacío del buscador. -->
			<p class="mt-4 text-sm opacity-70">{m.ui_search_no_results()}</p>
		{/if}

		{#if sourceRecipe}
			<!-- El chip de origen (#252): nombra la receta de la que nace el
			     snapshot y su X la suelta — de vuelta al buscador en limpio,
			     sin heredar el contenido al siguiente intento. -->
			<div class="badge badge-outline mt-4 max-w-full gap-1 py-3">
				<span class="truncate">{m.meal_plan_recipe_from({ name: sourceRecipe.name })}</span>
				<button
					type="button"
					class="btn btn-ghost btn-xs"
					aria-label={m.meal_plan_recipe_clear()}
					onclick={clearRecipe}
				>
					<X aria-hidden="true" />
				</button>
			</div>
		{/if}
	{/if}

	{#if editing || sourceRecipe}
		<!-- Crear (con receta elegida) y editar comparten formulario: la
		     acción (y el título y el botón) la decide el menú en edición. -->
		<form
			method="POST"
			action={editing ? '?/update' : '?/create'}
			use:enhance
			class="mt-4 flex flex-col gap-4"
		>
			<!-- El id del menú editado viaja DOS veces según el camino: en el
			     JSON de salida lo inyecta `onSubmit` (dataType json manda solo
			     los datos validados del schema, y su parser ignora los campos
			     planos) y en este input oculto para el submit NATIVO sin
			     JavaScript, donde el formulario viaja plano y `parseFormData`
			     lo reconstruye igual que en crear. -->
			<input type="hidden" name="id" value={editing?.id ?? ''} />
			<!-- El `recipeId` de la receta de origen (#252), el mismo trato que el
			     id: en el JSON de salida lo inyecta `onSubmit` (dataType json manda
			     solo los datos validados del schema) y en este input oculto viaja
			     para el submit NATIVO sin JavaScript. -->
			<input type="hidden" name="recipeId" value={sourceRecipe?.id ?? ''} />
			<input type="hidden" name="date" value={$formData.date} />

			{#if editing}
				<!-- El título SOLO existe en edición (#252): en creación es el de
				     la receta elegida — viaja en `$formData.title` con el resto
				     del snapshot, sin campo que lo edite aquí. -->
				<div class="flex flex-col gap-1">
					<label class="fieldset-label" for="meal-title">{m.schema_mealplans_title_label()}</label>
					<input
						bind:value={$formData.title}
						aria-invalid={errorMessage($errors.title) ? 'true' : undefined}
						id="meal-title"
						name="title"
						type="text"
						class="input w-full"
						placeholder={m.schema_mealplans_title_placeholder()}
						required
						maxlength="100"
					/>
					{#if errorMessage($errors.title)}
						<p class="fieldset-label text-error" role="alert">{errorMessage($errors.title)}</p>
					{/if}
				</div>
			{/if}

			<div class="flex flex-col gap-1">
				<label class="fieldset-label" for="meal-type">{m.schema_mealplans_meal_type_label()}</label>
				<select
					bind:value={$formData.mealType}
					aria-invalid={errorMessage($errors.mealType) ? 'true' : undefined}
					id="meal-type"
					name="mealType"
					class="select w-full"
					required
				>
					<!-- Un menú por comida y día: el único (familia, fecha, tipo) de la
				     base; un tipo repetido llega como error del action. -->
					{#each MEAL_TYPES as mealType (mealType)}
						<option value={mealType}>{MEAL_LABEL[mealType]}</option>
					{/each}
				</select>
				{#if errorMessage($errors.mealType)}
					<p class="fieldset-label text-error" role="alert">{errorMessage($errors.mealType)}</p>
				{/if}
			</div>

			<!-- Filas dinámicas de ingredientes (#222): cada una con su nombre
		     (autocompletado de despensa), cantidad numérica, unidad del enum y
		     categoría opcional — los mismos contratos que un item. -->
			<div class="flex flex-col gap-2">
				{#each $formData.ingredients as ingredient, index (index)}
					<div class="bg-base-200 rounded-box flex flex-col gap-2 p-3">
						<div class="flex items-center justify-between gap-2">
							<label class="fieldset-label" for={`meal-ingredient-name-${index}`}>
								{m.schema_mealplans_ingredient_name_label()}
							</label>
							<button
								type="button"
								class="btn btn-ghost btn-xs"
								aria-label={m.schema_mealplans_ingredient_remove()}
								onclick={() => removeIngredient(index)}
							>
								<X aria-hidden="true" />
							</button>
						</div>

						<input
							bind:value={ingredient.name}
							oninput={(event) => syncIngredientName(index, event.currentTarget.value)}
							aria-invalid={errorMessage($errors.ingredients?.[index]?.name) ? 'true' : undefined}
							id={`meal-ingredient-name-${index}`}
							name={`ingredients[${index}].name`}
							type="text"
							class="input w-full"
							list="meal-name-suggestions"
							autocomplete="off"
							maxlength="100"
						/>
						{#if errorMessage($errors.ingredients?.[index]?.name)}
							<p class="fieldset-label text-error" role="alert">
								{errorMessage($errors.ingredients?.[index]?.name)}
							</p>
						{/if}

						<div class="grid grid-cols-2 gap-2">
							<div class="flex flex-col gap-1">
								<label class="fieldset-label" for={`meal-ingredient-quantity-${index}`}>
									{m.schema_items_quantity_label()}
								</label>
								<!-- Input numérico con teclado decimal (AC móvil), el mismo
							     trato que la cantidad del item. -->
								<input
									bind:value={ingredient.quantity}
									aria-invalid={errorMessage($errors.ingredients?.[index]?.quantity)
										? 'true'
										: undefined}
									id={`meal-ingredient-quantity-${index}`}
									name={`ingredients[${index}].quantity`}
									type="number"
									class="input w-full"
									step="any"
									inputmode="decimal"
									required
								/>
								{#if errorMessage($errors.ingredients?.[index]?.quantity)}
									<p class="fieldset-label text-error" role="alert">
										{errorMessage($errors.ingredients?.[index]?.quantity)}
									</p>
								{/if}
							</div>

							<div class="flex flex-col gap-1">
								<label class="fieldset-label" for={`meal-ingredient-unit-${index}`}>
									{m.schema_items_unit_label()}
								</label>
								<select
									bind:value={ingredient.unit}
									onchange={() => markManual(index, 'unit')}
									aria-invalid={errorMessage($errors.ingredients?.[index]?.unit)
										? 'true'
										: undefined}
									id={`meal-ingredient-unit-${index}`}
									name={`ingredients[${index}].unit`}
									class="select w-full"
									required
								>
									{#each UNITS as unit (unit)}
										<option value={unit}>{UNIT_LABEL[unit]}</option>
									{/each}
								</select>
								{#if errorMessage($errors.ingredients?.[index]?.unit)}
									<p class="fieldset-label text-error" role="alert">
										{errorMessage($errors.ingredients?.[index]?.unit)}
									</p>
								{/if}
							</div>
						</div>

						<div class="flex flex-col gap-1">
							<label class="fieldset-label" for={`meal-ingredient-category-${index}`}>
								{m.schema_items_category_label()}
							</label>
							<select
								bind:value={ingredient.categoryId}
								onchange={() => markManual(index, 'category')}
								id={`meal-ingredient-category-${index}`}
								name={`ingredients[${index}].categoryId`}
								class="select w-full"
							>
								<option value="">{m.items_category_none()}</option>
								{#each categories as category (category.id)}
									<option value={category.id}>{category.name}</option>
								{/each}
							</select>
						</div>

						<!-- Aviso de unidad conflictiva (#243, retrofit del chip de
					     recetas): el nombre tecleado casa con un producto de
					     despensa en OTRA unidad (por nombre canónico, no solo
					     visible). El chip propone la conversión exacta y aquí se
					     aplica a SU fila — por `update`, como todo lo que toca el
					     store de superforms. -->
						<UnitConflictChip
							name={ingredient.name}
							unit={ingredient.unit}
							quantity={ingredient.quantity}
							pantryProducts={pantryItems}
							onApply={(conversion) => applyConversion(index, conversion)}
						/>
					</div>
				{/each}

				<button type="button" class="btn btn-outline btn-sm" onclick={addIngredient}>
					<Plus aria-hidden="true" />
					{m.schema_mealplans_ingredient_add()}
				</button>
			</div>

			{#if saveError && $message}
				<div class="alert alert-error text-sm" role="alert">
					{$message}
				</div>
			{/if}

			<button type="submit" class="btn btn-primary" disabled={$delayed}>
				{#if $delayed}
					<span class="loading loading-spinner"></span>
				{/if}
				{editing ? m.meal_plan_save() : m.meal_plan_create()}
			</button>
		</form>
	{/if}

	<!-- Sugerencias de nombre (#222, ampliadas en #285): los nombres que la
	     familia ya conoce — despensa, listas y recetas, uno por canónico —,
	     con su unidad junto al nombre (la que hereda la fila al elegirlo). El
	     `datalist` es el autocompletado NATIVO del navegador — filtra mientras
	     se escribe y no pisa lo tecleado; un nombre nuevo simplemente no
	     sugiere nada, y su producto lo crea la despensa al guardar
	     (`createMealPlan`, cantidad 0). -->
	<datalist id="meal-name-suggestions">
		{#each nameSuggestions as suggestion (suggestion.name)}
			<option value={suggestion.name}>{UNIT_LABEL[suggestion.unit]}</option>
		{/each}
	</datalist>
</Modal>
