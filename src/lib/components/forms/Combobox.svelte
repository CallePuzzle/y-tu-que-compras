<script module lang="ts">
	export type InputValue = {
		value: string;
		label: string;
	};
</script>

<script lang="ts">
	import { createCombobox, melt, type ComboboxOptionProps } from '@melt-ui/svelte';
	import { fly } from 'svelte/transition';
	import { Control, Field, FieldErrors, Label } from 'formsnap';
	import { type SuperForm, formFieldProxy } from 'sveltekit-superforms';

	let {
		form,
		field,
		inputArray,
		title,
		placeholder
	}: {
		form: SuperForm<any, any>;
		field: string;
		inputArray: InputValue[];
		title: string;
		placeholder: string;
	} = $props();

	const toOption = (input: InputValue): ComboboxOptionProps<InputValue> => ({
		value: input,
		label: input.label
	});

	const {
		elements: { menu, input, option, label },
		states: { open, inputValue, touchedInput, selected },
		helpers: { isSelected }
	} = createCombobox<InputValue>({
		forceVisible: true
	});

	let filteredInputArray = $state(inputArray);

	$effect(() => {
		if (!$open) {
			$inputValue = $selected?.label ?? '';
			$value = $selected?.value.value ?? '';
		}
		filteredInputArray = $touchedInput
			? inputArray.filter(({ value, label }) => {
					const normalizedInput = $inputValue.toLowerCase();
					return label.toLowerCase().includes(normalizedInput);
				})
			: inputArray;
	});
	const { value } = formFieldProxy(form, field);
	$inspect($value);
</script>

<Field {form} name={field}>
	<Control let:attrs>
		<Label class="flex justify-center flex-col sm:flex-row my-2">
			<div class="flex flex-col gap-1">
				<!-- svelte-ignore a11y-label-has-associated-control - $label contains the 'for' attribute -->
				<label use:melt={$label}>
					<span class="text-sm font-medium text-magnum-900">{title}:</span>
				</label>

				<div class="relative">
					<input
						use:melt={$input}
						class="input input-bordered flex h-10 items-center justify-between rounded-lg
            px-3 pr-12"
						{placeholder}
					/>
					<div class="absolute right-2 top-1/2 z-10 -translate-y-1/2 text-magnum-900">
						<!-- {#if $open}
				icono chevron-up
			{:else}
				icon chevron-down
			{/if} -->
					</div>
				</div>
			</div>
			{#if $open}
				<ul
					class=" z-10 flex max-h-[300px] flex-col overflow-hidden rounded-lg"
					use:melt={$menu}
					transition:fly={{ duration: 150, y: -5 }}
				>
					<!-- svelte-ignore a11y-no-noninteractive-tabindex -->
					<div
						class="flex max-h-full flex-col gap-0 overflow-y-auto bg-base-content px-2 py-2 text-black"
						tabindex="0"
					>
						{#each filteredInputArray as item, index (index)}
							<li
								use:melt={$option(toOption(item))}
								class="relative cursor-pointer scroll-my-2 rounded-md py-2 pl-4 pr-4
          hover:bg-magnum-100
          data-[highlighted]:bg-magnum-200 data-[highlighted]:text-magnum-900
            data-[disabled]:opacity-50"
							>
								{#if $isSelected(item)}
									<div class="check absolute left-2 top-1/2 z-10 text-magnum-900">icon check</div>
								{/if}
								<div class="pl-4">
									<span class="font-medium">{item.label}</span>
								</div>
							</li>
						{:else}
							<li class="relative cursor-pointer rounded-md py-1 pl-8 pr-4">No results found</li>
						{/each}
					</div>
				</ul>
			{/if}
		</Label>
	</Control>
	<FieldErrors />
</Field>
