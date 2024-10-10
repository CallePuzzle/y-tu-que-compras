<script lang="ts">
	import { t } from '$lib/translations';
	import { Fieldset, Legend, ElementField, Control, Label, FieldErrors } from 'formsnap';
	import Combobox from '$lib/components/forms/partials/Combobox.svelte';
	import { type SuperForm, formFieldProxy } from 'sveltekit-superforms';
	import type { SuperFormData } from 'sveltekit-superforms/client';
	import type { ComboxObject } from '$lib/components/forms/partials/Combobox.svelte';

	let {
		form,
		field,
		type,
		formData,
		comboxArray
	}: {
		form: SuperForm<any, any>;
		field: string;
		type: string;
		formData: SuperFormData<any>;
		comboxArray: ComboxObject[];
	} = $props();

	let comboboxInputValue = $state([]);
	const { value } = formFieldProxy(form, field);
	$effect(() => {
		$value = comboboxInputValue;
	});

	function removeByIndex(index: number) {
		comboboxInputValue = comboboxInputValue.filter((_, i) => i !== index);
		$formData[field] = $formData[field].filter((_, i) => i !== index);
	}

	function add() {
		comboboxInputValue = [...comboboxInputValue, ''];
		$formData[field] = [...$formData[field], ''];
	}
</script>

<Fieldset {form} name={field}>
	<Legend>{$t(type + '.' + field)}</Legend>
	{#each $formData[field] as _, i}
		<ElementField {form} name={field[i]}>
			<Control let:attrs>
				<Label class="sr-only">{$t(type + '.' + field)} {i + 1}</Label>
				<Combobox
					{form}
					{field}
					{formData}
					{i}
					bind:inputValue={comboboxInputValue[i]}
					inputArray={comboxArray}
				/>
				<button type="button" onclick={() => removeByIndex(i)}> Borrar </button>
			</Control>
		</ElementField>
	{/each}
	<FieldErrors />
	<button type="button" onclick={add}>Añadir</button>
</Fieldset>
