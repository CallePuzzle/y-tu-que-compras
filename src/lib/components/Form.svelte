<script lang="ts">
	import { t } from '$lib/translations';
	import { Control, Field, FieldErrors, Label } from 'formsnap';
	import { superForm } from 'sveltekit-superforms';
	import { zodClient } from 'sveltekit-superforms/adapters';

	let {
		superform,
		schema,
		type
	}: {
		superform: any;
		schema: any;
		type: string;
	} = $props();
	const form = superForm(superform, {
		validators: zodClient(schema)
	});

	const { form: formData } = form;
	const fields = schema.keyof().options;
	const schemaObj = schema.shape;
</script>

<form method="POST" class="flex flex-col">
	{#each fields as field}
		<Field {form} name={field}>
			<Control let:attrs>
				<Label class="flex justify-center flex-col sm:flex-row my-2">
					<span class="w-full max-w-xs">{$t(type + '.' + field)}</span>
					<input
						class="input input-bordered w-full max-w-xs"
						{...attrs}
						bind:value={$formData[field]}
						required={!schemaObj[field].isOptional()}
						minlength={schemaObj[field].minLength}
						maxlength={schemaObj[field].maxLength}
					/>
				</Label>
			</Control>
			<FieldErrors />
		</Field>
	{/each}

	<div class="flex justify-center my-2">
		<button class="btn btn-accent">{$t(type + '.submit')}</button>
	</div>
</form>
