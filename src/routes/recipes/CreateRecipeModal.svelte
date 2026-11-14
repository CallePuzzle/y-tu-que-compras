<script lang="ts">
	import Plus from '@lucide/svelte/icons/plus';
	import X from '@lucide/svelte/icons/x';
	import { Modal } from '@callepuzzle/svelte-ui';
	import { errorMessage } from '#lib/forms.js';
	import { m } from '#lib/paraglide/messages.js';
	import { UNITS } from '#lib/schemas/item.js';
	import type { RecipeFormData } from '#lib/schemas/recipe.js';
	import { unitLabels } from '#lib/units.js';
	import { zod4Client } from 'sveltekit-superforms/adapters';
	import { superForm } from 'sveltekit-superforms/client';
	import { recipeFormSchema } from './schemas.js';
	import type { PageData } from './$types';

	/**
	 * Crear y EDITAR recetas desde /recipes (épica #232, tarea #239). Consume
	 * el schema YA existente (`#lib/schemas/recipe.ts`, #238) vía
	 * `recipeFormSchema` de la ruta — el mismo que validan las acciones de
	 * crear y editar. Los ingredientes son FILAS DINÁMICAS (añadir/quitar,
	 * patrón CreateMealPlanModal) y el nombre se autocompleta con los
	 * productos de la despensa que trae el load (`datalist` nativo): al
	 * teclear un nombre que ES un producto de la familia, la fila HEREDA su
	 * unidad y lo ENLAZA (`pantryItemId`); un nombre inventado no sugiere nada
	 * y queda suelto — el servidor lo guarda sin FK y NADA se crea en la
	 * despensa (decisión de fase 2). El aviso de unidad conflictiva y su
	 * conversión viene después (#240): este modal deja la fila lista para que
	 * aquél añada su chip por fila.
	 *
	 * Los ingredientes van ANIDADOS (array de objetos), así que el formulario
	 * viaja como JSON (`dataType: 'json'`, requisito de superforms para
	 * estructuras anidadas — el FormData plano de los items no llega a esto).
	 *
	 * La edición REUTILIZA este modal: `openForEdit` precarga nombre, raciones
	 * e ingredientes de la receta elegida y el formulario pasa a `?/update`.
	 * El id NO va en `$form` (crear y editar comparten el mismo contrato), y
	 * con dataType json superforms manda solo los datos validados — el id se
	 * inyecta en el JSON de salida en `onSubmit` y lo valida el action con
	 * `recipeUpdateFormSchema` (el de crear más el id).
	 */
	type Props = {
		form: PageData['form'];
		/** Los productos de la despensa: id, nombre y unidad para el autocompletado. */
		pantryItems: PageData['pantryItems'];
		onSuccess: (message: string) => void;
	};

	/** Una receta del listado, tal y como la trae el load (para editar). */
	type RecipeRow = PageData['recipes'][number];

	let { form, pantryItems, onSuccess }: Props = $props();

	const UNIT_LABEL = unitLabels();

	/**
	 * Una fila de ingrediente vacía: como el item del alta rápida, cantidad 1
	 * y «ud», sin enlace a la despensa (cadena vacía = «sin producto»).
	 */
	const EMPTY_INGREDIENT = { name: '', quantity: 1, unit: 'unit', pantryItemId: '' } as const;

	let modal: { showModal(): void; close(): void } | undefined = $state();

	/**
	 * La receta en edición: `undefined` en creación. Mientras vive, el
	 * formulario apunta a `?/update` y su id viaja en el JSON de salida.
	 */
	let editing: RecipeRow | undefined = $state();

	// El aviso del modal es solo para FALLOS (400/409/500). En éxito el texto
	// viaja a la página con `onSuccess`, pero superforms aún aplicará el
	// resultado DESPUÉS de `onResult` y dejaría `$message` con el texto de
	// éxito dentro del dialog cerrado: el flag decide sin depender de carreras.
	let saveError = $state(false);

	// svelte-ignore state_referenced_locally
	const createForm = superForm(form, {
		validators: zod4Client(recipeFormSchema()),
		dataType: 'json',
		invalidateAll: 'pessimistic',
		// El id de la receta editada no va en `$form` (crear y editar comparten
		// el MISMO contrato) y con dataType json superforms manda solo los
		// datos validados: en edición se inyecta aquí, en el JSON de salida.
		// Si la validación de cliente falla no se manda nada, así que pasar
		// `$formData` entero es seguro; el action valida el id con el schema
		// extendido (`recipeUpdateFormSchema`, ver `schemas.ts`).
		onSubmit({ jsonData }) {
			if (editing) {
				jsonData({ ...$formData, id: editing.id });
			}
		},
		onResult({ result }) {
			if (result.type === 'success') {
				// El texto concreto lo decide la acción y viaja en el resultado
				// (`message()`), como en el resto de modales de la app.
				const data = result.data as { form?: { message?: string } } | undefined;
				onSuccess(data?.form?.message ?? (editing ? m.recipe_updated() : m.recipe_success()));
				saveError = false;
				modal?.close();
			} else if (result.type === 'failure' || result.type === 'error') {
				saveError = true;
			}
		}
	});
	const { form: formData, enhance, delayed, message, errors } = createForm;

	/** Abre el modal en modo creación: vacío, sin rastro de la edición anterior. */
	export function open() {
		editing = undefined;
		message.set(undefined);
		errors.clear();
		saveError = false;
		formData.set({
			name: '',
			servings: undefined,
			ingredients: [{ ...EMPTY_INGREDIENT }]
		} as RecipeFormData);
		modal?.showModal();
	}

	/**
	 * Abre el modal EN EDICIÓN, precargado con la receta elegida del listado:
	 * su nombre, sus raciones (`null` en la base = ausente en el formulario) y
	 * sus ingredientes en su orden. El enlace al producto de despensa que ya
	 * llevara cada ingrediente viaja de vuelta tal cual — solo tocar el nombre
	 * lo recalcula (ver `syncIngredientName`) — y la categoría `null` de la
	 * vista no llega: este formulario no trae select de categoría.
	 */
	export function openForEdit(recipe: RecipeRow) {
		editing = recipe;
		message.set(undefined);
		errors.clear();
		saveError = false;
		formData.set({
			name: recipe.name,
			servings: recipe.servings ?? undefined,
			ingredients: recipe.ingredients.map((ingredient) => ({
				name: ingredient.name,
				quantity: ingredient.quantity,
				unit: ingredient.unit,
				pantryItemId: ingredient.pantryItemId ?? ''
			}))
		} as RecipeFormData);
		modal?.showModal();
	}

	/**
	 * El nombre tecleado, sincronizado con su fila: si ES un producto de la
	 * despensa (mismo nombre visible), la fila HEREDA su unidad y lo ENLAZA
	 * (`pantryItemId`); al editar el nombre hacia uno inventado, el enlace se
	 * retira — cadena vacía, que el servidor guarda como `null`. El nombre
	 * mismo lo pone el `bind:value`; aquí llega el valor YA tecleado del
	 * evento. Se pasa por `form.update()` y no por una mutación directa de la
	 * fila: el estado de superforms es un store plano, y tocar un objeto
	 * anidado sin `update` no repinta el select de la unidad. Si el producto
	 * existe en varias unidades, manda la primera: elegir entre todas (y
	 * avisar del conflicto) es la tarea #240.
	 */
	function syncIngredientName(index: number, name: string) {
		formData.update((data) => {
			const row = data.ingredients[index];
			if (!row) {
				return data;
			}
			const product = pantryItems.find((item) => item.name === name);
			row.pantryItemId = product?.id ?? '';
			if (product) {
				row.unit = product.unit;
			}
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
	<h2 class="text-lg font-bold">{editing ? m.recipe_edit() : m.recipe_create()}</h2>

	<!-- Crear y editar comparten formulario: la acción (y el título y el
	     botón) la decide la receta en edición. -->
	<form
		method="POST"
		action={editing ? '?/update' : '?/create'}
		use:enhance
		class="mt-4 flex flex-col gap-4"
	>
		<!-- El id de la receta editada viaja DOS veces según el camino: en el
		     JSON de salida lo inyecta `onSubmit` (dataType json manda solo
		     los datos validados del schema, y su parser ignora los campos
		     planos) y en este input oculto para el submit NATIVO sin
		     JavaScript, donde el formulario viaja plano y `parseFormData`
		     lo reconstruye igual que en crear. -->
		<input type="hidden" name="id" value={editing?.id ?? ''} />

		<div class="flex flex-col gap-1">
			<label class="fieldset-label" for="recipe-name">{m.schema_recipes_name_label()}</label>
			<input
				bind:value={$formData.name}
				aria-invalid={errorMessage($errors.name) ? 'true' : undefined}
				id="recipe-name"
				name="name"
				type="text"
				class="input w-full"
				placeholder={m.schema_recipes_name_placeholder()}
				required
				maxlength="100"
			/>
			{#if errorMessage($errors.name)}
				<p class="fieldset-label text-error" role="alert">{errorMessage($errors.name)}</p>
			{/if}
		</div>

		<div class="flex flex-col gap-1">
			<label class="fieldset-label" for="recipe-servings">{m.schema_recipes_servings_label()}</label
			>
			<!-- Opcional en el schema (`undefined` = «no lo declara»), y aquí no
			     hay `bind:value`: el enlace numérico de Svelte deja el input
			     vacío como `null`, que el schema NO acepta — el valor lo fija
			     este handler, dejándolo `undefined` cuando el campo queda vacío.
			     Sin `min` nativo que tape el error del schema: el corte lo hace
			     zod en cliente (igual que la cantidad del item). -->
			<input
				aria-invalid={errorMessage($errors.servings) ? 'true' : undefined}
				id="recipe-servings"
				name="servings"
				type="number"
				class="input w-full"
				step="1"
				inputmode="numeric"
				value={$formData.servings ?? ''}
				oninput={(event) => {
					const raw = event.currentTarget.value;
					$formData.servings = raw === '' ? undefined : Number(raw);
				}}
			/>
			{#if errorMessage($errors.servings)}
				<p class="fieldset-label text-error" role="alert">{errorMessage($errors.servings)}</p>
			{/if}
		</div>

		<!-- Filas dinámicas de ingredientes (#239): cada una con su nombre
		     (autocompletado de despensa que hereda la unidad), cantidad
		     numérica y unidad del enum — los mismos contratos que un item. -->
		<div class="flex flex-col gap-2">
			{#each $formData.ingredients as ingredient, index (index)}
				<div class="bg-base-200 rounded-box flex flex-col gap-2 p-3">
					<div class="flex items-center justify-between gap-2">
						<label class="fieldset-label" for={`recipe-ingredient-name-${index}`}>
							{m.schema_recipes_ingredient_name_label()}
						</label>
						<button
							type="button"
							class="btn btn-ghost btn-xs"
							aria-label={m.schema_recipes_ingredient_remove()}
							onclick={() => removeIngredient(index)}
						>
							<X aria-hidden="true" />
						</button>
					</div>

					<input
						bind:value={ingredient.name}
						oninput={(event) => syncIngredientName(index, event.currentTarget.value)}
						aria-invalid={errorMessage($errors.ingredients?.[index]?.name) ? 'true' : undefined}
						id={`recipe-ingredient-name-${index}`}
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
							<label class="fieldset-label" for={`recipe-ingredient-quantity-${index}`}>
								{m.schema_items_quantity_label()}
							</label>
							<!-- Input numérico con teclado decimal (AC móvil), el mismo
							     trato que la cantidad del item. -->
							<input
								bind:value={ingredient.quantity}
								aria-invalid={errorMessage($errors.ingredients?.[index]?.quantity)
									? 'true'
									: undefined}
								id={`recipe-ingredient-quantity-${index}`}
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
							<label class="fieldset-label" for={`recipe-ingredient-unit-${index}`}>
								{m.schema_items_unit_label()}
							</label>
							<!-- La unidad hereda la del producto de despensa al
							     teclear su nombre (`syncIngredientName`); el usuario
							     puede cambiarla a mano después (el conflicto que avisa
							     la #240). -->
							<select
								bind:value={ingredient.unit}
								aria-invalid={errorMessage($errors.ingredients?.[index]?.unit) ? 'true' : undefined}
								id={`recipe-ingredient-unit-${index}`}
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
				</div>
			{/each}

			<button type="button" class="btn btn-outline btn-sm" onclick={addIngredient}>
				<Plus aria-hidden="true" />
				{m.schema_recipes_ingredient_add()}
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
			{editing ? m.recipe_save() : m.recipe_create()}
		</button>
	</form>

	<!-- Sugerencias de despensa (#239): los productos que el load trajo de la
	     familia, con su unidad junto al nombre (la que hereda la fila al
	     elegirlo). El `datalist` es el autocompletado NATIVO del navegador —
	     filtra mientras se escribe y no pisa lo tecleado; un nombre nuevo
	     simplemente no sugiere nada y su ingrediente queda suelto (sin FK,
	     sin crear producto: las recetas no compran). -->
	<datalist id="pantry-products">
		{#each pantryItems as product (product.id)}
			<option value={product.name}>{UNIT_LABEL[product.unit]}</option>
		{/each}
	</datalist>
</Modal>
