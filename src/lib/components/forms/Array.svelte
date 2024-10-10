<script lang="ts">
	import { t } from '$lib/translations';
	import {
		Fieldset,
		Legend,
		ElementField,
		Control,
		Label,
		FieldErrors,
		Description
	} from 'formsnap';
	import Combobox from '$lib/components/forms/Combobox.svelte';
	import { type SuperForm, formFieldProxy } from 'sveltekit-superforms';
	import type { SuperFormData } from 'sveltekit-superforms/client';
	import type { Snippet } from 'svelte';

	let {
		form,
		field,
		formData,
		children
	}: {
		form: SuperForm<any, any>;
		field: string;
		formData: SuperFormData<any>;
		children?: Snippet;
	} = $props();

	function removeByIndex(index: number) {
		comboboxInputValue = comboboxInputValue.filter((_, i) => i !== index);
		$formData[field] = $formData[field].filter((_, i) => i !== index);
	}

	function add() {
		comboboxInputValue = [...comboboxInputValue, ''];
		$formData[field] = [...$formData[field], ''];
	}
	let comboboxInputValue = $state([]);
	const { value } = formFieldProxy(form, field);
	$effect(() => {
		$value = comboboxInputValue;
	});
	$inspect(comboboxInputValue);
</script>

<Fieldset {form} name={field}>
	<Legend>Public URLs</Legend>
	{#each $formData[field] as _, i}
		<ElementField {form} name={field[i]}>
			<Control let:attrs>
				<Label class="sr-only">URL {i + 1}</Label>
				<Combobox {form} {field} {formData} {i} bind:inputValue={comboboxInputValue[i]} />
				<button type="button" onclick={() => removeByIndex(i)}> Remove URL </button>
			</Control>
			<Description class="sr-only">
				This URL will be publicly available on your profile.
			</Description>
		</ElementField>
	{/each}
	<FieldErrors />
	<button type="button" onclick={add}>Add URL</button>
</Fieldset>
