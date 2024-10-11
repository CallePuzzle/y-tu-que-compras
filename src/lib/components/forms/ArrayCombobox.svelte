<script lang="ts">
	import { onMount } from 'svelte';
	import { t } from '$lib/translations';
	import { Fieldset, Legend, ElementField, Control, Label, FieldErrors } from 'formsnap';
	import Combobox from '$lib/components/forms/partials/Combobox.svelte';
	import { Icon } from 'svelte-icons-pack';
	import { FaSolidDeleteLeft } from 'svelte-icons-pack/fa';
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

	let comboboxInputValue: string[] = $state([]);
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

	onMount(() => {
		// Añadimos una lista vacía para que se pueda añadir un nuevo elemento
		add();
	});
</script>

<Fieldset {form} name={field} class="grid grid-cols-2">
	<div>
		<Legend>{$t(type + '.' + field)}</Legend>
	</div>
	{#each $formData[field] as _, i}
		<div class="flex {i > 0 ? 'col-start-2' : ''}">
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
					<button type="button" onclick={() => removeByIndex(i)}
						><Icon src={FaSolidDeleteLeft} /></button
					>
				</Control>
			</ElementField>
		</div>
	{/each}
	<div>
		<FieldErrors />
	</div>
	<div>
		<button type="button" onclick={add}>Añadir</button>
	</div>
</Fieldset>
