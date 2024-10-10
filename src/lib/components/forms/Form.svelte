<script lang="ts">
	import { t } from '$lib/translations';
	import { superForm, type SuperValidated, type Infer, type SuperForm } from 'sveltekit-superforms';
	import { zodClient } from 'sveltekit-superforms/adapters';
	import String from '$lib/components/forms/String.svelte';
	import ArrayInput from '$lib/components/forms/ArrayInput.svelte';
	import { ZodString, ZodArray, z } from 'zod';
	import { toast } from 'svelte-sonner';
	import type { Snippet } from 'svelte';
	import type { SuperFormData } from 'sveltekit-superforms/client';
	import SuperDebug from 'sveltekit-superforms';

	let {
		id = '',
		superform,
		schema,
		type,
		action,
		excludeFields = [],
		onshowCallback = () => {},
		children,
		// variables que mandamos al padre para poder meter más campos en el formulario
		form = $bindable(),
		formData = $bindable()
	}: {
		id?: string;
		superform: SuperValidated<Infer<any>>;
		schema: any;
		type: string;
		action?: string;
		excludeFields?: string[];
		onshowCallback: () => void;
		children?: Snippet;
		form?: SuperForm<any, any>;
		formData?: SuperFormData<any>;
	} = $props();
	form = superForm(superform, {
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

	const { enhance, delayed } = form;
	formData = form.form;
	let fields = schema.keyof().options;
	fields = fields.filter((field: string) => !excludeFields.includes(field));
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
				<ArrayInput {form} {field} {formData} />
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
