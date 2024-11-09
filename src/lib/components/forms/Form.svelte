<script lang="ts">
	import { t } from '$lib/translations';
	import { superForm, type SuperValidated, type Infer, type SuperForm } from 'sveltekit-superforms';
	import { zodClient } from 'sveltekit-superforms/adapters';
	import String from '$lib/components/forms/String.svelte';
	import ArrayInput from '$lib/components/forms/ArrayInput.svelte';
	import { ZodString, ZodArray, ZodEnum } from 'zod';
	import { toast } from 'svelte-sonner';
	import type { Snippet } from 'svelte';
	import type { SuperFormData } from 'sveltekit-superforms/client';
	import SuperDebug from 'sveltekit-superforms';
	import Combobox from '$lib/components/forms/Combobox.svelte';

	let {
		id = '',
		superform,
		schema,
		type,
		action,
		excludeFields = [],
		onshowCallback = () => {},
		extraFields
	}: {
		id?: string;
		superform: SuperValidated<Infer<any>>;
		schema: any;
		type: string;
		action?: string;
		excludeFields?: string[];
		onshowCallback?: () => void;
		extraFields?: Snippet<[SuperForm<any, any>, SuperFormData<any>]>;
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
			if (form.valid && form.posted) onshowCallback();
		}
	});

	const { form: formData, enhance, delayed } = form;
	const fields = schema.keyof().options.filter((field: string) => !excludeFields.includes(field));
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
				<String {form} {field} {type} {schemaObj} {formData} />
			{/if}
			{#if schemaObj[field] instanceof ZodArray}
				<ArrayInput {form} {field} {type} {formData} />
			{/if}
			{#if schemaObj[field] instanceof ZodEnum}
				<Combobox {form} {field} {type} stringArray={schemaObj[field].options} placeholder="" />
			{/if}
		{/if}
	{/each}

	{#if extraFields}
		{@render extraFields(form, formData)}
	{/if}

	<div class="flex justify-center my-2">
		{#if $delayed}
			<span class="loading loading-dots loading-lg"></span>
		{:else}
			<button class="btn btn-accent">{$t(type + '.submit')}</button>
		{/if}
	</div>
</form>
<!-- <SuperDebug data={$formData} /> -->
