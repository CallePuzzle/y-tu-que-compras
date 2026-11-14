<script lang="ts">
	import Plus from '@lucide/svelte/icons/plus';
	import X from '@lucide/svelte/icons/x';
	import { Modal } from '@callepuzzle/svelte-ui';
	import UnitConflictChip from '#lib/components/UnitConflictChip.svelte';
	import { errorMessage } from '#lib/forms.js';
	import { mealTypeLabels } from '#lib/meal-types.js';
	import { m } from '#lib/paraglide/messages.js';
	import { UNITS } from '#lib/schemas/item.js';
	import { MEAL_TYPES, type MealPlanFormData } from '#lib/schemas/mealplan.js';
	import { unitLabels } from '#lib/units.js';
	import type { UnitConversion } from '#lib/unit-convert.js';
	import { zod4Client } from 'sveltekit-superforms/adapters';
	import { superForm } from 'sveltekit-superforms/client';
	import { recipeMealPlanFormSchema } from './schemas.js';
	import type { PageData } from './$types';

	/**
	 * Asignar UNA receta al menú (épica #232, tarea #242): el modal que abre
	 * el botón «Añadir al menú» de cada fila de /recipes. Consume el schema de
	 * menú del calendario extendido con el `recipeId`
	 * (`recipeMealPlanFormSchema`, ver `schemas.ts`) — el mismo que valida la
	 * acción `?/assignToMenu`. El día y el tipo se eligen aquí (el día
	 * arranca en el «hoy» que sirve el load, ya resuelto en servidor en la
	 * zona de la app) y el título y los ingredientes llegan PREFIJADOS desde
	 * la receta, editables: el menú que se guarda es un SNAPSHOT — una copia
	 * independiente que ni la edición ni el borrado de la receta alteran (el
	 * `recipeId` es solo trazabilidad del origen, ver `mealplans.ts`).
	 *
	 * La mecánica es la de `CreateMealPlanModal` (épica #212, #222): los
	 * ingredientes van ANIDADOS (array de objetos), así que el formulario
	 * viaja como JSON (`dataType: 'json'`), el grid del calendario se
	 * refresca con `invalidateAll: 'pessimistic'` y el 409 de hueco ocupado
	 * (`MealPlanExistsError`) se pinta DENTRO del modal para reintentar otro
	 * hueco, como en el calendario.
	 *
	 * El `recipeId` NO va en `$form` (un menú creado a mano no lo lleva): con
	 * dataType json superforms manda solo los datos validados y aquí se
	 * inyecta en el JSON de salida en `onSubmit` — el patrón del id en
	 * edición — para que lo valide el action con el schema extendido.
	 *
	 * Cada fila lleva el chip de unidad conflictiva (#243): si el nombre
	 * tecleado casa con un producto de despensa en OTRA unidad (los productos
	 * viajan en el load, con su unidad), avisa y propone la conversión
	 * exacta — con la fila ya en la unidad del producto, el `upsert` del
	 * guardado (`ensurePantryProducts`) cae en el producto EXISTENTE y no
	 * crea el segundo en despensa.
	 */
	type Props = {
		menuForm: PageData['menuForm'];
		/** Los productos de la despensa: id, nombre y unidad — autocompletado y chip. */
		pantryItems: PageData['pantryItems'];
		onSuccess: (message: string) => void;
	};

	/** Una receta del listado, tal y como la trae el load (la que se asigna). */
	type RecipeRow = PageData['recipes'][number];

	let { menuForm, pantryItems, onSuccess }: Props = $props();

	const UNIT_LABEL = unitLabels();
	const MEAL_LABEL = mealTypeLabels();

	/** Una fila de ingrediente vacía: como el item del alta rápida, cantidad 1 y «ud». */
	const EMPTY_INGREDIENT = { name: '', quantity: 1, unit: 'unit' } as const;

	let modal: { showModal(): void; close(): void } | undefined = $state();

	/**
	 * La receta que se está asignando: su id viaja en el JSON de salida
	 * (`recipeId`) y SU nombre e ingredientes fueron los prefijados. Siempre
	 * vive mientras el modal está abierto — el único camino de entrada es
	 * `open`.
	 */
	let recipe: RecipeRow | undefined = $state();

	// El aviso del modal es solo para FALLOS (400/409/500). En éxito el texto
	// viaja a la página con `onSuccess`, pero superforms aún aplicará el
	// resultado DESPUÉS de `onResult` y dejaría `$message` con el texto de
	// éxito dentro del dialog cerrado: el flag decide sin depender de carreras.
	let saveError = $state(false);

	// svelte-ignore state_referenced_locally
	const assignForm = superForm(menuForm, {
		validators: zod4Client(recipeMealPlanFormSchema()),
		dataType: 'json',
		invalidateAll: 'pessimistic',
		// El id de la receta de origen no va en `$form` y con dataType json
		// superforms manda solo los datos validados: se inyecta aquí, en el
		// JSON de salida. Si la validación de cliente falla no se manda nada,
		// así que pasar `$formData` entero es seguro; el action valida el id
		// con el schema extendido (`recipeMealPlanFormSchema`, ver
		// `schemas.ts`).
		onSubmit({ jsonData }) {
			if (recipe) {
				jsonData({ ...$formData, recipeId: recipe.id });
			}
		},
		onResult({ result }) {
			if (result.type === 'success') {
				// El texto concreto lo decide la acción y viaja en el resultado
				// (`message()`), como en el resto de modales de la app.
				const data = result.data as { form?: { message?: string } } | undefined;
				onSuccess(data?.form?.message ?? m.meal_plan_success());
				saveError = false;
				modal?.close();
			} else if (result.type === 'failure' || result.type === 'error') {
				saveError = true;
			}
		}
	});
	const { form: formData, enhance, delayed, message, errors } = assignForm;

	/**
	 * Abre el modal PARA UNA receta del listado: su título y sus ingredientes
	 * (nombre, cantidad y unidad, en su orden) llegan prefijados y editables,
	 * el día arranca en el «hoy» que el load sirve ya resuelto en la zona de
	 * la app y el tipo, en la comida — la principal del día, como en el
	 * calendario. La categoría `null` de la vista va como `''` para que viaje
	 * la que la receta tuviera (el servidor la revalida contra la familia); y
	 * el cast, como en el modal del calendario: recupera los literales del
	 * enum que el ancho del literal difumina.
	 */
	export function open(source: RecipeRow, todayKey: string) {
		recipe = source;
		message.set(undefined);
		errors.clear();
		saveError = false;
		formData.set({
			title: source.name,
			date: todayKey,
			mealType: 'lunch',
			ingredients: source.ingredients.map((ingredient) => ({
				name: ingredient.name,
				quantity: ingredient.quantity,
				unit: ingredient.unit,
				categoryId: ingredient.categoryId ?? ''
			}))
		} as MealPlanFormData);
		modal?.showModal();
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
	}

	/** Añade una fila de ingrediente al final, en blanco. */
	function addIngredient() {
		$formData.ingredients = [...$formData.ingredients, { ...EMPTY_INGREDIENT }];
	}

	/** Quita la fila del índice: puede quedarse en cero, el schema lo permite. */
	function removeIngredient(index: number) {
		$formData.ingredients = $formData.ingredients.filter((_, i) => i !== index);
	}
</script>

<Modal
	bind:this={modal}
	type="X"
	showButton={false}
	boxClass="modal-box max-w-md"
	strings={{ close: m.ui_close() }}
>
	<h2 class="text-lg font-bold">{m.recipe_assign_menu()}</h2>

	<form method="POST" action="?/assignToMenu" use:enhance class="mt-4 flex flex-col gap-4">
		<!-- El recipeId de la receta asignada viaja DOS veces según el camino: en
		     el JSON de salida lo inyecta `onSubmit` (dataType json manda solo los
		     datos validados del schema, y su parser ignora los campos planos) y en
		     este input oculto para el submit NATIVO sin JavaScript, donde el
		     formulario viaja plano y `parseFormData` lo reconstruye igual que en
		     el calendario. -->
		<input type="hidden" name="recipeId" value={recipe?.id ?? ''} />

		<!-- El día del menú viaja como clave `YYYY-MM-DD` (`dayKeySchema`) y se
		     muestra fijo: es el «hoy» que sirvió el load (o el que este modal
		     precargó al abrirse), aquí no se edita. -->
		<input type="hidden" name="date" value={$formData.date} />
		<div class="flex items-center gap-2">
			<span class="fieldset-label">{m.schema_mealplans_date_label()}</span>
			<span class="badge badge-outline font-mono">{$formData.date}</span>
		</div>

		<div class="flex flex-col gap-1">
			<label class="fieldset-label" for="assign-title">{m.schema_mealplans_title_label()}</label>
			<!-- Prefijado con el nombre de la receta y editable: lo que se
			     guarda es el título del MENÚ (snapshot), no un enlace vivo. -->
			<input
				bind:value={$formData.title}
				aria-invalid={errorMessage($errors.title) ? 'true' : undefined}
				id="assign-title"
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

		<div class="flex flex-col gap-1">
			<label class="fieldset-label" for="assign-meal-type">
				{m.schema_mealplans_meal_type_label()}
			</label>
			<select
				bind:value={$formData.mealType}
				aria-invalid={errorMessage($errors.mealType) ? 'true' : undefined}
				id="assign-meal-type"
				name="mealType"
				class="select w-full"
				required
			>
				<!-- Un menú por comida y día: el único (familia, fecha, tipo) de la
				     base; un tipo repetido llega como 409 que este mismo modal
				     pinta, para reintentar otro hueco. -->
				{#each MEAL_TYPES as mealType (mealType)}
					<option value={mealType}>{MEAL_LABEL[mealType]}</option>
				{/each}
			</select>
			{#if errorMessage($errors.mealType)}
				<p class="fieldset-label text-error" role="alert">{errorMessage($errors.mealType)}</p>
			{/if}
		</div>

		<!-- Filas dinámicas de ingredientes: prefijadas desde la receta y
		     editables — nombre (autocompletado de despensa), cantidad numérica
		     y unidad del enum, los mismos contratos que un item. Al guardar,
		     cada ingrediente crea su producto de despensa a cantidad 0 si
		     faltaba (`ensurePantryProducts`, intacto de fase 1). -->
		<div class="flex flex-col gap-2">
			{#each $formData.ingredients as ingredient, index (index)}
				<div class="bg-base-200 rounded-box flex flex-col gap-2 p-3">
					<div class="flex items-center justify-between gap-2">
						<label class="fieldset-label" for={`assign-ingredient-name-${index}`}>
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
						aria-invalid={errorMessage($errors.ingredients?.[index]?.name) ? 'true' : undefined}
						id={`assign-ingredient-name-${index}`}
						name={`ingredients[${index}].name`}
						type="text"
						class="input w-full"
						list="assign-pantry-products"
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
							<label class="fieldset-label" for={`assign-ingredient-quantity-${index}`}>
								{m.schema_items_quantity_label()}
							</label>
							<!-- Input numérico con teclado decimal (AC móvil), el mismo
							     trato que la cantidad del item. -->
							<input
								bind:value={ingredient.quantity}
								aria-invalid={errorMessage($errors.ingredients?.[index]?.quantity)
									? 'true'
									: undefined}
								id={`assign-ingredient-quantity-${index}`}
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
							<label class="fieldset-label" for={`assign-ingredient-unit-${index}`}>
								{m.schema_items_unit_label()}
							</label>
							<select
								bind:value={ingredient.unit}
								aria-invalid={errorMessage($errors.ingredients?.[index]?.unit) ? 'true' : undefined}
								id={`assign-ingredient-unit-${index}`}
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

					<!-- Aviso de unidad conflictiva (#243): el nombre tecleado casa
					     con un producto de despensa en OTRA unidad (por nombre
					     canónico, no solo visible). El chip propone la conversión
					     exacta y aquí se aplica a SU fila — por `update`, como todo
					     lo que toca el store de superforms. -->
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
			<!-- Aquí muere el 409 de hueco ocupado: dentro del modal, que sigue
			     abierto para reintentar otro día o tipo (patrón calendario). -->
			<div class="alert alert-error text-sm" role="alert">
				{$message}
			</div>
		{/if}

		<button type="submit" class="btn btn-primary" disabled={$delayed}>
			{#if $delayed}
				<span class="loading loading-spinner"></span>
			{/if}
			{m.recipe_assign_menu()}
		</button>
	</form>

	<!-- Sugerencias de despensa: los productos que el load trajo de la
	     familia, con su unidad junto al nombre. El `datalist` es el
	     autocompletado NATIVO del navegador — filtra mientras se escribe y no
	     pisa lo tecleado; un nombre nuevo simplemente no sugiere nada, y su
	     producto lo crea la despensa al guardar (`createMealPlan`, cantidad
	     0). Id propio: el modal de recetas de esta misma página ya pinta su
	     `datalist`. -->
	<datalist id="assign-pantry-products">
		{#each pantryItems as product (product.id)}
			<option value={product.name}>{UNIT_LABEL[product.unit]}</option>
		{/each}
	</datalist>
</Modal>
