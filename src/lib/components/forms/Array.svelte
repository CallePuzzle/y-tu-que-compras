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
	import type { SuperForm } from 'sveltekit-superforms';
	import type { SuperFormData } from 'sveltekit-superforms/client';
	import type { Snippet } from 'svelte';

	let {
		form,
		field,
		formData = $bindable(),
		children
	}: {
		form: SuperForm<any, any>;
		field: string;
		formData: SuperFormData<any>;
		children?: Snippet;
	} = $props();

	function removeByIndex(index: number) {
		$formData[field] = $formData[field].filter((_, i) => i !== index);
	}

	function add() {
		$formData[field] = [...$formData[field], ''];
	}
</script>

<Fieldset {form} name={field}>
	<Legend>Public URLs</Legend>
	{#each $formData[field] as _, i}
		<ElementField {form} name={field[i]}>
			<Control let:attrs>
				<Label class="sr-only">URL {i + 1}</Label>
				{#if children}
					{@render children()}
				{:else}
					<input type="string" {...attrs} bind:value={$formData[field][i]} />
				{/if}
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
