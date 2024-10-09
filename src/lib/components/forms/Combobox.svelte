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
		inputValue = $bindable(''),
		form,
		field,
		formData
	}: {
		inputValue?: string;
		form: SuperForm<any, any>;
		field: string;
		formData: SuperFormData<any>;
	} = $props();

	let filteredFruits = $state([] as typeof fruits);
	let touchedInput = $state(false);
	let isComboxboxOpen = $state(false);
	let showFullList = $state(false);
	let selectedValue = $state($formData[field]);

	$effect(() => {
		showFullList = false;
		if (inputValue || (inputValue && touchedInput)) {
			filteredFruits = fruits.filter((pn) =>
				pn.value.toLowerCase().includes(inputValue.toLowerCase())
			);
			isComboxboxOpen = true;
		} else {
			filteredFruits = fruits;
			isComboxboxOpen = false;
		}
	});
	const { value } = formFieldProxy(form, field);
    const portal = null
</script>

<Field {form} name={field}>
	<Control let:attrs>
		<Label class="flex justify-center flex-col sm:flex-row my-2">
			<Combobox.Root
				items={showFullList ? fruits : filteredFruits}
				bind:inputValue
				bind:touchedInput
				selected={selectedValue}
				open={isComboxboxOpen}
				{portal}
				onSelectedChange={(valueChange: any) => {
					selectedValue = value;
					$value = valueChange.value;
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
		</Label>
	</Control>
	<FieldErrors />
</Field>
