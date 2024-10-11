<script lang="ts">
	import Combobox from '$lib/components/forms/partials/Combobox.svelte';
	import { type SuperForm, formFieldProxy } from 'sveltekit-superforms';
	import type { SuperFormData } from 'sveltekit-superforms/client';
	import { Control, Field, FieldErrors, Label } from 'formsnap';

	const fruits = [
		{ value: 'mango', label: 'Mango' },
		{ value: 'watermelon', label: 'Watermelon' },
		{ value: 'apple', label: 'Apple' },
		{ value: 'pineapple', label: 'Pineapple' },
		{ value: 'orange', label: 'Orange' }
	];

	let {
		inputValueLabel = $bindable(''),
		inputValue = $bindable(''),
		form,
		field,
		formData,
		multiple = false,
		i = 0
	}: {
		inputValueLabel?: string;
		inputValue?: string;
		form: SuperForm<any, any>;
		field: string;
		formData: SuperFormData<any>;
		multiple?: boolean;
		i?: number;
	} = $props();

	let filteredFruits = $state([] as typeof fruits);
	let touchedInput = $state(false);
	let isComboxboxOpen = $state(false);
	let showFullList = $state(false);
	let selectedValue = $state($formData[field][i]);

	$effect(() => {
		showFullList = false;
		if (inputValueLabel || (inputValueLabel && touchedInput)) {
			filteredFruits = fruits.filter((pn) =>
				pn.value.toLowerCase().includes(inputValueLabel.toLowerCase())
			);
			isComboxboxOpen = true;
		} else {
			filteredFruits = fruits;
			isComboxboxOpen = false;
		}
	});
	const { value } = formFieldProxy(form, field[i]);
	const portal = null;
</script>

<Field {form} name={field}>
	<Control let:attrs>
		<Label class="flex justify-center flex-col sm:flex-row my-2">
			<Combobox {form} {field} {formData} {i} bind:inputValue bind:inputValueLabel />
		</Label>
	</Control>
	<FieldErrors />
</Field>
