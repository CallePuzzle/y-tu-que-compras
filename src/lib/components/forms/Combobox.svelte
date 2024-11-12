<script module lang="ts">
	export type InputValue = {
		value: string;
		label: string;
	};
</script>

<script lang="ts">
	import { t } from '$lib/translations';
	import { createCombobox, melt, type ComboboxOptionProps } from '@melt-ui/svelte';
	import { fly } from 'svelte/transition';
	import { Control, Field, FieldErrors, Label } from 'formsnap';
	import { Icon } from 'svelte-icons-pack';
	import { AiOutlineUp, AiOutlineDown, AiOutlineCheck } from 'svelte-icons-pack/ai';
	import { type SuperForm, formFieldProxy } from 'sveltekit-superforms';

	let {
		form,
		field,
		type,
		placeholder,
		valueArray = [],
		stringArray = []
	}: {
		form: SuperForm<any, any>;
		field: string;
		type: string;
		placeholder: string;
		valueArray: InputValue[];
		stringArray: string[];
	} = $props();

	let inputArray = $derived.by(() => {
		if (stringArray.length > 0) {
			return stringArray.map((value) => ({ value, label: $t(type + '.' + value) }));
		}
		return valueArray;
	}) as InputValue[];
	let filteredInputArray = $state([]) as InputValue[];

	const toOption = (input: InputValue): ComboboxOptionProps<InputValue> => ({
		value: input,
		label: input.label
	});

	const {
		elements: { menu, input, option, label },
		states: { open, inputValue, touchedInput, selected },
		helpers: { isSelected }
	} = createCombobox<InputValue>({
		forceVisible: true,
		portal: '#combobox-menu'
	});

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
</script>

<Field {form} name={field}>
	<Control let:attrs>
		<Label class="flex justify-center items-center flex-col sm:flex-row my-2 relative">
			<span class="w-full max-w-xs">{$t(type + '.' + field)}</span>
			<input use:melt={$input} class="input input-bordered w-full max-w-xs" {placeholder} />

			<div class="absolute right-2 top-1/2 z-10 -translate-y-1/2 text-magnum-900">
				{#if $open}
					<Icon src={AiOutlineUp} size="1.5em" />
				{:else}
					<Icon src={AiOutlineDown} size="1.5em" />
				{/if}
			</div>
		</Label>
		<div id="combobox-menu"></div>
		{#if $open}
			<ul
				class=" z-10 flex max-h-[300px] flex-col overflow-hidden rounded-lg"
				use:melt={$menu}
				transition:fly={{ duration: 150, y: -5 }}
			>
				<div
					class="flex max-h-full flex-col gap-0 overflow-y-auto bg-base-content px-2 py-2 text-black"
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
								<div class="check absolute z-10 text-magnum-900">
									<Icon src={AiOutlineCheck} size="1.5em" />
								</div>
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
	</Control>
	<FieldErrors />
</Field>
