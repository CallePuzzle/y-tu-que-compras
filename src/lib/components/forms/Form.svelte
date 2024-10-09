<script lang="ts">
	import { t } from '$lib/translations';
	import { superForm, type SuperValidated, type Infer } from 'sveltekit-superforms';
	import { zodClient } from 'sveltekit-superforms/adapters';
	import String from '$lib/components/forms/String.svelte';
	import Array from '$lib/components/forms/Array.svelte';
	import { ZodString, ZodArray, z } from 'zod';
	import SuperDebug from 'sveltekit-superforms';
	import { toast } from 'svelte-sonner';
	import Combobox from '$lib/components/forms/Combobox.svelte';
	import type { Snippet } from 'svelte';

	let {
		id = '',
		superform,
		schema,
		type,
		action,
		onshowCallback = () => {},
		children
	}: {
		id?: string;
		superform: SuperValidated<Infer<any>>;
		schema: any;
		type: string;
		action?: string;
		onshowCallback: () => void;
		children?: Snippet;
	} = $props();
	const form = superForm(superform, {
		id: id + '-' + type,
		validators: zodClient(schema),
		dataType: 'json',
		delayMs: 100,
		onUpdated: ({ form }: { form: any }) => {
			if (form.message) {
				if (form.posted && form.valid) toast.success(form.message);
				else toast.error(form.message);
			}
			onshowCallback();
		}
	});

	const { form: formData, enhance, delayed } = form;
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

<form method="POST" class="flex flex-col" {action} use:enhance>
	{#each fields as field}
		{#if field === 'id'}
			<input type="hidden" name="id" bind:value={$formData[field]} />
		{:else}
			{#if isString(schemaObj[field])}
				<Combobox {form} {field} {type} {schemaObj} {formData} />
			{/if}
			{#if schemaObj[field] instanceof ZodArray}
				<Array {form} {field} {type} {schemaObj} {formData} />
			{/if}
		{/if}
	{/each}

	{#if children}
		{@render children()}
	{/if}

	<div class="flex justify-center my-2">
		{#if $delayed}
			<span class="loading loading-dots loading-lg"></span>
		{:else}
			<button class="btn btn-accent">{$t(type + '.submit')}</button>
		{/if}
	</div>
</form>
<SuperDebug data={$formData} />
