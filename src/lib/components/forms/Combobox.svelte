<script lang="ts">
	import { Combobox } from 'bits-ui';
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

<Combobox.Root
	items={showFullList ? fruits : filteredFruits}
	bind:inputValueLabel
	bind:touchedInput
	selected={selectedValue}
	open={isComboxboxOpen}
	{portal}
	onSelectedChange={(valueChange: any) => {
		selectedValue = value;
		$value = valueChange.value;
		inputValue = valueChange.value;
	}}
>
	<Combobox.Input />
	<Combobox.Label />

	<Combobox.Content>
		{#each filteredFruits as fruit (fruit.value)}
			<Combobox.Item value={fruit.value} label={fruit.label}>
				{fruit.label}
				<Combobox.ItemIndicator class="ml-auto" asChild={false}></Combobox.ItemIndicator>
			</Combobox.Item>
		{:else}
			<span class="block px-5 py-2 text-sm text-muted-foreground"> No results found </span>
		{/each}
	</Combobox.Content>
	<Combobox.HiddenInput name="array" />
</Combobox.Root>
