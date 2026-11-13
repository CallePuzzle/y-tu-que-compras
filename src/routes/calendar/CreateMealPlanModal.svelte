<script lang="ts">
	import Plus from '@lucide/svelte/icons/plus';
	import X from '@lucide/svelte/icons/x';
	import { Modal } from '@callepuzzle/svelte-ui';
	import { errorMessage } from '#lib/forms.js';
	import { mealTypeLabels } from '#lib/meal-types.js';
	import { m } from '#lib/paraglide/messages.js';
	import { UNITS } from '#lib/schemas/item.js';
	import { MEAL_TYPES, type MealPlanFormData } from '#lib/schemas/mealplan.js';
	import { unitLabels } from '#lib/units.js';
	import { zod4Client } from 'sveltekit-superforms/adapters';
	import { superForm } from 'sveltekit-superforms/client';
	import { mealPlanFormSchema } from './schemas.js';
	import type { PageData } from './$types';

	/**
	 * Crear menú desde el calendario (épica #212, tarea #222): el modal que
	 * abre el día pulsado del grid. Consume el schema YA existente
	 * (`#lib/schemas/mealplan.ts`, #225) vía `mealPlanFormSchema` de la ruta —
	 * el mismo que valida el action, como en las listas. Los ingredientes son
	 * FILAS DINÁMICAS (añadir/quitar) y el nombre se autocompleta con los
	 * productos de la despensa que trae el load (`datalist` nativo: en móvil,
	 * sugerencias sin JavaScript propio). El éxito cierra el modal y pasa el
	 * aviso a la página; el grid se refresca con el load pesimista.
	 *
	 * Los ingredientes van ANIDADOS (array de objetos), así que el formulario
	 * viaja como JSON (`dataType: 'json'`, requisito de superforms para
	 * estructuras anidadas — el FormData plano de los items no llega a esto).
	 * Es creación SOLO (#221 traerá el detalle y la edición): `open(dateKey)`
	 * fija el día y el resto arranca limpio.
	 */
	type Props = {
		form: PageData['form'];
		/** Las categorías de la familia (el select opcional de cada ingrediente). */
		categories: PageData['categories'];
		/** Nombres de producto de la despensa, para el autocompletado del nombre. */
		pantryNames: string[];
		onSuccess: (message: string) => void;
	};

	let { form, categories, pantryNames, onSuccess }: Props = $props();

	const UNIT_LABEL = unitLabels();
	const MEAL_LABEL = mealTypeLabels();

	/** Una fila de ingrediente vacía: como el item del alta rápida, cantidad 1 y «ud». */
	const EMPTY_INGREDIENT = { name: '', quantity: 1, unit: 'unit', categoryId: '' } as const;

	let modal: { showModal(): void; close(): void } | undefined = $state();

	// El aviso del modal es solo para FALLOS (400/409/500). En éxito el texto
	// viaja a la página con `onSuccess`, pero superforms aún aplicará el
	// resultado DESPUÉS de `onResult` y dejaría `$message` con el texto de
	// éxito dentro del dialog cerrado: el flag decide sin depender de carreras.
	let saveError = $state(false);

	// svelte-ignore state_referenced_locally
	const createForm = superForm(form, {
		validators: zod4Client(mealPlanFormSchema()),
		dataType: 'json',
		invalidateAll: 'pessimistic',
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
	const { form: formData, enhance, delayed, message, errors } = createForm;

	/** Abre el modal para UN día: la celda pulsada manda la clave `YYYY-MM-DD`. */
	export function open(dateKey: string) {
		message.set(undefined);
		errors.clear();
		saveError = false;
		// El resto arranca limpio: comida (la principal del día) y una fila de
		// ingrediente vacía lista para escribir. El cast, como en editar item:
		// recupera los literales del enum que el ancho del literal difumina.
		formData.set({
			title: '',
			date: dateKey,
			mealType: 'lunch',
			ingredients: [{ ...EMPTY_INGREDIENT }]
		} as MealPlanFormData);
		modal?.showModal();
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
	<h2 class="text-lg font-bold">{m.meal_plan_create()}</h2>

	<form method="POST" action="?/create" use:enhance class="mt-4 flex flex-col gap-4">
		<!-- El día del menú viaja como clave `YYYY-MM-DD` (`dayKeySchema`) y se
		     muestra fijo: lo eligió quien pulsó la celda, aquí no se edita. -->
		<input type="hidden" name="date" value={$formData.date} />
		<div class="flex items-center gap-2">
			<span class="fieldset-label">{m.schema_mealplans_date_label()}</span>
			<span class="badge badge-outline font-mono">{$formData.date}</span>
		</div>

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
						aria-invalid={errorMessage($errors.ingredients?.[index]?.name) ? 'true' : undefined}
						id={`meal-ingredient-name-${index}`}
						name={`ingredients[${index}].name`}
						type="text"
						class="input w-full"
						list="pantry-products"
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
								aria-invalid={errorMessage($errors.ingredients?.[index]?.unit) ? 'true' : undefined}
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
			{m.meal_plan_create()}
		</button>
	</form>

	<!-- Sugerencias de despensa (#222): los nombres que el load trajo de la
	     familia. El `datalist` es el autocompletado NATIVO del navegador —
	     filtra mientras se escribe y no pisa lo tecleado; un nombre nuevo
	     simplemente no sugiere nada, y su producto lo crea la despensa al
	     guardar (`createMealPlan`, cantidad 0). -->
	<datalist id="pantry-products">
		{#each pantryNames as name (name)}
			<option value={name}></option>
		{/each}
	</datalist>
</Modal>
