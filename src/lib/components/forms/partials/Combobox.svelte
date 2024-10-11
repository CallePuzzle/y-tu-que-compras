<script module>
	export interface ComboxObject {
		value: string;
		label: string;
		filterValue?: string;
	}
</script>

<script lang="ts">
	import { Combobox } from 'bits-ui';
	import { type SuperForm, formFieldProxy } from 'sveltekit-superforms';
	import type { SuperFormData } from 'sveltekit-superforms/client';

	let {
		inputValueLabel = $bindable(''),
		inputValue = $bindable(''),
		form,
		field,
		formData,
		inputArray,
		i = 0
	}: {
		inputValueLabel?: string;
		inputValue?: string;
		form: SuperForm<any, any>;
		field: string;
		formData: SuperFormData<any>;
		inputArray: ComboxObject[];
		i?: number;
	} = $props();

	let filtered = $state([] as typeof inputArray);
	let touchedInput = $state(false);
	let isComboxboxOpen = $state(false);
	let showFullList = $state(false);
	let selectedValue = $state($formData[field][i]);

	function normalizeContains(comboboxObjectValue: string, inputValueLabel: string): boolean {
		const collator = new Intl.Collator('es', { sensitivity: 'base', usage: 'search' });
		for (let i = 0; i <= comboboxObjectValue.length - inputValueLabel.length; i++) {
			const substring = comboboxObjectValue.slice(i, i + inputValueLabel.length);
			if (collator.compare(substring, inputValueLabel) === 0) {
				return true;
			}
		}
		return false;
	}

	$effect(() => {
		showFullList = false;
		if (inputValueLabel || (inputValueLabel && touchedInput)) {
			filtered = inputArray.filter((pn) => {
				if (pn.filterValue) {
					return normalizeContains(pn.filterValue.toLowerCase(), inputValueLabel.toLowerCase());
				}
				return normalizeContains(pn.value.toLowerCase(), inputValueLabel.toLowerCase());
			});
			isComboxboxOpen = true;
		} else {
			filtered = inputArray;
			isComboxboxOpen = false;
		}
	});
	const { value } = formFieldProxy(form, field[i]);
	const portal = null;
</script>

<Combobox.Root
	items={showFullList ? inputArray : filtered}
	bind:inputValue={inputValueLabel}
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
	<Combobox.Input class="input input-bordered w-full max-w-xs" />
	<Combobox.Label />

	<Combobox.Content
		class="bg-primary-content w-full rounded-xl border border-muted px-1 py-3 shadow-popover outline-none"
	>
		{#each filtered as item (item.value)}
			<Combobox.Item
				class="flex h-10 w-full select-none items-center rounded-button py-3 pl-5 pr-1.5 text-sm capitalize outline-none transition-all duration-75 data-[highlighted]:bg-muted"
				value={item.value}
				label={item.label}
			>
				{item.label}
				<Combobox.ItemIndicator class="ml-auto" asChild={false}></Combobox.ItemIndicator>
			</Combobox.Item>
		{:else}
			<span class="block px-5 py-2 text-sm text-muted-foreground"> No results found </span>
		{/each}
	</Combobox.Content>
	<Combobox.HiddenInput name="array" />
</Combobox.Root>
