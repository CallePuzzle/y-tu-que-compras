<script lang="ts">
	import { Combobox } from 'bits-ui';

	const fruits = [
		{ value: 'mango', label: 'Mango' },
		{ value: 'watermelon', label: 'Watermelon' },
		{ value: 'apple', label: 'Apple' },
		{ value: 'pineapple', label: 'Pineapple' },
		{ value: 'orange', label: 'Orange' }
	];

	let {
		inputValue = $bindable(''),
		index
	}: {
		inputValue?: string;
		index?: number;
	} = $props();

	let filteredFruits = $state([] as typeof fruits);
	let touchedInput = $state(false);
	let isComboxboxOpen = $state(false);
	let showFullList = $state(false);

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
</script>

<Combobox.Root
	items={showFullList ? fruits : filteredFruits}
	bind:inputValue
	bind:touchedInput
	open={isComboxboxOpen}
	portal="null"
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
	<Combobox.HiddenInput name="favoriteFruit" />
</Combobox.Root>
