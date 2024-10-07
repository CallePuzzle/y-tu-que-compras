<script lang="ts">
	import { t } from '$lib/translations';
	import { superForm } from 'sveltekit-superforms';
	import { zodClient } from 'sveltekit-superforms/adapters';
	import String from '$lib/components/forms/String.svelte';
	import Array from '$lib/components/forms/Array.svelte';
	import { ZodString, ZodArray } from 'zod';
	import SuperDebug from 'sveltekit-superforms';

	let {
		superform,
		schema,
		type,
		action
	}: {
		superform: any;
		schema: any;
		type: string;
		action?: string;
	} = $props();
	const form = superForm(superform, {
		validators: zodClient(schema)
	});

	const { form: formData } = form;
	const fields = schema.keyof().options;
	const schemaObj = schema.shape;
	console.log(formData);
</script>

<form method="POST" class="flex flex-col" {action}>
	{#each fields as field}
		{#if field === 'id'}
			<input type="hidden" name="id" bind:value={$formData.id} />
		{:else}
			{#if schemaObj[field] instanceof ZodString}
				<String {form} {field} {type} {schemaObj} {formData} />
			{/if}
			{#if schemaObj[field] instanceof ZodArray}
				<Array {form} {field} {type} {schemaObj} {formData} />
			{/if}
		{/if}
	{/each}

	<div class="flex justify-center my-2">
		<button class="btn btn-accent">{$t(type + '.submit')}</button>
	</div>
</form>

<SuperDebug data={$formData} />
