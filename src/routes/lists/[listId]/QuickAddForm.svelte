<script lang="ts">
	import Plus from '@lucide/svelte/icons/plus';
	import { normalizeItemName } from '#lib/normalize-name.js';
	import { errorMessage } from '#lib/forms.js';
	import { m } from '#lib/paraglide/messages.js';
	import { UNITS, type Unit } from '#lib/schemas/item.js';
	import { unitLabels } from '#lib/units.js';
	import { zod4Client } from 'sveltekit-superforms/adapters';
	import { superForm } from 'sveltekit-superforms/client';
	import { indexNameSuggestions, prefillField } from './name-suggestions.js';
	import { itemFormSchema } from './schemas.js';
	import type { PageData } from './$types';

	/**
	 * Alta rápida (formulario inline, siempre visible, checklist #68): nombre,
	 * cantidad y unidad sin modal, para encadenar altas desde el móvil. Con
	 * la categoría opcional (#172): el select ofrece las categorías de la
	 * familia y «Sin categoría» no envía nada que clasificar. Con la
	 * sugerencia (#173): un nombre que la familia ya conoce rellena el select
	 * con su categoría — SIEMPRE editable, que es una sugerencia, no una
	 * imposición. Con el autocompletado (#283): un `datalist` ofrece los
	 * nombres que la familia ya conoce y casar uno rellena también la unidad,
	 * con la misma regla (lo manual manda).
	 */
	let {
		form,
		categories,
		suggestions
	}: {
		form: PageData['form'];
		categories: PageData['categories'];
		suggestions: PageData['nameSuggestions'];
	} = $props();

	const UNIT_LABEL = unitLabels();

	/** Las sugerencias indexadas por canónico: cada tecla es una búsqueda directa. */
	const suggestionIndex = $derived(indexNameSuggestions(suggestions));

	// Con `invalidateAll: 'pessimistic'`, tras crear superforms espera al load
	// y el `resetForm` por defecto lo deja VACÍO: queda listo para encadenar
	// otra alta y el item nuevo aparece en la lista.
	//
	// `applyAction: 'never'` (#114): sin él, CUALQUIER recarga de los datos de
	// página (el toggle de comprado, editar, borrar, finalizar, volver a la
	// pestaña) rehace el formulario con el `form` vacío del load y machaca lo
	// que haya a medias. Así solo se actualiza con el resultado de SU acción:
	// lo escrito solo se borra al enviarlo.

	// El color del aviso (#146): `$message` trae indistinto el texto de éxito
	// y el de error (`message()` del action, con o sin status), así que el
	// tipo de resultado decide el estilo — verde para confirmar el alta y
	// rojo solo para errores.
	let altaOk = $state(false);

	// Sugerencia por nombre (#173, ampliada a la unidad en #283): `suggested`
	// marca si la categoría que muestra el select la PUSO la sugerencia — y no
	// quien escribe. La regla del checklist: autocompletar al detectar
	// coincidencia SIN bloquear la edición manual, así que la sugerencia solo
	// rellena un select vacío o sustituye a OTRA sugerencia (nunca lo elegido a
	// mano), y el nombre dejando de casar retira la sugerencia anterior.
	let suggested = $state(false);

	// La unidad sigue la misma regla, pero su select nunca está «vacío» (arranca
	// en «ud»): por eso lleva su propia marca de elección manual. Retirar la
	// sugerencia la devuelve a la unidad por defecto del alta.
	const DEFAULT_UNIT: Unit = 'unit';
	let unitSuggested = $state(false);
	let unitManual = $state(false);

	/** Cada tecla en el nombre: aplica o retira la sugerencia, sin pisar lo manual. */
	function onNameInput() {
		const suggestion = suggestionIndex.get(normalizeItemName($formData.name));

		const category = prefillField(
			{ value: $formData.categoryId ?? '', suggested },
			suggestion?.categoryId,
			// Un select vacío está libre; uno con categoría que no puso la
			// sugerencia es elección manual.
			{ locked: !suggested && !!$formData.categoryId, fallback: '' }
		);
		$formData.categoryId = category.value;
		suggested = category.suggested;

		const unit = prefillField(
			{ value: $formData.unit, suggested: unitSuggested },
			suggestion?.unit,
			{ locked: unitManual, fallback: DEFAULT_UNIT }
		);
		$formData.unit = unit.value;
		unitSuggested = unit.suggested;
	}

	// svelte-ignore state_referenced_locally
	const addForm = superForm(form, {
		validators: zod4Client(itemFormSchema()),
		invalidateAll: 'pessimistic',
		applyAction: 'never',
		onResult({ result }) {
			altaOk = result.type === 'success';
			// El alta en limpio resetea el formulario (resetForm): la marca de
			// sugerencia tampoco sobrevive — el siguiente nombre empieza de cero.
			if (result.type === 'success') {
				suggested = false;
				unitSuggested = false;
				unitManual = false;
			}
		}
	});
	const { form: formData, enhance, delayed, message, errors } = addForm;

	let nameInput: HTMLInputElement | undefined = $state();

	/** Lleva el foco al nombre (el CTA del estado vacío). */
	export function focus() {
		nameInput?.focus();
	}
</script>

<form
	method="POST"
	action="?/create"
	use:enhance
	class="bg-base-200 rounded-box mt-4 flex flex-col gap-3 p-4"
>
	<div class="flex flex-col gap-1">
		<label class="fieldset-label" for="add-name">{m.schema_items_name_label()}</label>
		<input
			bind:this={nameInput}
			bind:value={$formData.name}
			oninput={onNameInput}
			aria-invalid={errorMessage($errors.name) ? 'true' : undefined}
			id="add-name"
			name="name"
			type="text"
			class="input w-full"
			list="add-name-suggestions"
			autocomplete="off"
			placeholder={m.schema_items_name_placeholder()}
			required
			maxlength="100"
		/>
		{#if errorMessage($errors.name)}
			<p class="fieldset-label text-error" role="alert">{errorMessage($errors.name)}</p>
		{/if}
		<!-- Autocompletado de nombres (#283): los que la familia ya conoce, con
		     su unidad junto al nombre (el patrón de recetas, #239). El
		     `datalist` es el autocompletado NATIVO — filtra mientras se escribe
		     y no pisa lo tecleado —; elegir una opción dispara `input` y con él
		     el pre-relleno. Un nombre nuevo no sugiere nada y se da de alta tal
		     cual. Id propio: el modal de editar lleva el suyo en la misma página. -->
		<datalist id="add-name-suggestions">
			{#each suggestions as suggestion (suggestion.name)}
				<option value={suggestion.name}>{UNIT_LABEL[suggestion.unit]}</option>
			{/each}
		</datalist>
	</div>

	<!-- `flex-wrap` (#114): a 360px los tres no caben en una línea y el
	     botón baja a la suya en vez de desbordar. -->
	<div class="flex flex-wrap items-end gap-2">
		<div class="flex flex-col gap-1">
			<label class="fieldset-label" for="add-quantity">{m.schema_items_quantity_label()}</label>
			<input
				bind:value={$formData.quantity}
				aria-invalid={errorMessage($errors.quantity) ? 'true' : undefined}
				id="add-quantity"
				name="quantity"
				type="number"
				class="input w-20"
				step="any"
				inputmode="decimal"
				required
			/>
			{#if errorMessage($errors.quantity)}
				<p class="fieldset-label text-error" role="alert">{errorMessage($errors.quantity)}</p>
			{/if}
		</div>

		<div class="flex flex-col gap-1">
			<label class="fieldset-label" for="add-unit">{m.schema_items_unit_label()}</label>
			<!-- Selector de unidades predefinidas (checklist #68): el catálogo
			     UNITS con sus etiquetas traducidas. -->
			<select
				bind:value={$formData.unit}
				onchange={() => {
					unitManual = true;
					unitSuggested = false;
				}}
				aria-invalid={errorMessage($errors.unit) ? 'true' : undefined}
				id="add-unit"
				name="unit"
				class="select w-28"
				required
			>
				{#each UNITS as unit (unit)}
					<option value={unit}>{UNIT_LABEL[unit]}</option>
				{/each}
			</select>
			{#if errorMessage($errors.unit)}
				<p class="fieldset-label text-error" role="alert">{errorMessage($errors.unit)}</p>
			{/if}
		</div>

		<button type="submit" class="btn btn-primary ml-auto" disabled={$delayed}>
			{#if $delayed}
				<span class="loading loading-spinner"></span>
			{/if}
			<Plus aria-hidden="true" />
			{m.items_add()}
		</button>
	</div>

	<!-- Categoría opcional (checklist #172): las de la familia, en su orden.
	     El option vacío viaja como `''` y el servidor lo guarda como «sin
	     categoría» — el mismo significado que no enviar el campo. La
	     sugerencia (#173) la rellena sola para nombres conocidos; el
	     `onchange` marca toda elección MANUAL (los cambios programáticos de
	     la sugerencia no disparan eventos) para que la siguiente tecla no la
	     pise: lo elegido a mano manda siempre. -->
	<div class="flex flex-col gap-1">
		<label class="fieldset-label" for="add-category">{m.schema_items_category_label()}</label>
		<select
			bind:value={$formData.categoryId}
			onchange={() => (suggested = false)}
			id="add-category"
			name="categoryId"
			class="select w-full"
		>
			<option value="">{m.items_category_none()}</option>
			{#each categories as category (category.id)}
				<option value={category.id}>{category.name}</option>
			{/each}
		</select>
	</div>

	{#if $message}
		<!-- #146: el éxito del alta va en verde (`alert-success`) y los
		     errores (lista borrada, fallo de servidor) en rojo, con los
		     roles aria que les toca como en el resto de la app. -->
		<div
			class={`alert text-sm ${altaOk ? 'alert-success' : 'alert-error'}`}
			role={altaOk ? 'status' : 'alert'}
		>
			{$message}
		</div>
	{/if}
</form>
