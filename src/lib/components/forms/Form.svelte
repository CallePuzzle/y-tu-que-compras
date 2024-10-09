<script lang="ts">
	import { t } from '$lib/translations';
	import { superForm, type SuperValidated, type Infer } from 'sveltekit-superforms';
	import { zodClient } from 'sveltekit-superforms/adapters';
	import String from '$lib/components/forms/String.svelte';
	import Array from '$lib/components/forms/Array.svelte';
	import { ZodString, ZodArray, z } from 'zod';
	import SuperDebug from 'sveltekit-superforms';

	let {
		superform,
		schema,
		type,
		action,
		onshowCallback = () => {}
	}: {
		superform: SuperValidated<Infer<any>>;
		schema: any;
		type: string;
		action?: string;
		onshowCallback: (arg: any) => void;
	} = $props();
	const form = superForm(superform, {
		validators: zodClient(schema),
		dataType: 'json',
		delayMs: 100
	});

	const { form: formData, enhance, delayed, message } = form;
	const fields = schema.keyof().options;
	const schemaObj = schema.shape;

	function isString(field: any) {
		// https://zod.dev/?id=optionals
		if (field.unwrap) {
			return field.unwrap() instanceof ZodString;
		}
		return field instanceof ZodString;
	}
</script>

{#if $message}
	<div role="alert" class="alert alert-success" use:onshowCallback>{$message}</div>
{:else}
	<form method="POST" class="flex flex-col" {action} use:enhance>
		{#each fields as field}
			{#if field === 'id'}
				<input type="hidden" name="id" bind:value={$formData[field]} />
			{:else}
				{#if isString(schemaObj[field])}
					<String {form} {field} {type} {schemaObj} {formData} />
				{/if}
				{#if schemaObj[field] instanceof ZodArray}
					<Array {form} {field} {type} {schemaObj} {formData} />
				{/if}
			{/if}
		{/each}

		<div class="flex justify-center my-2">
			{#if $delayed}
				<span class="loading loading-dots loading-lg"></span>
			{:else}
				<button class="btn btn-accent">{$t(type + '.submit')}</button>
			{/if}
		</div>
	</form>
{/if}
<SuperDebug data={$formData} />
