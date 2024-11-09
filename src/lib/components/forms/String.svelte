<script lang="ts">
	import { t } from '$lib/translations';
	import { Control, Field, FieldErrors, Label } from 'formsnap';
	import type { SuperForm } from 'sveltekit-superforms';
	import type { SuperFormData } from 'sveltekit-superforms/client';

	let {
		form,
		field,
		type,
		schemaObj,
		formData
	}: {
		form: SuperForm<any, any>;
		field: string;
		type: string;
		schemaObj: any;
		formData: SuperFormData<any>;
	} = $props();
</script>

<Field {form} name={field}>
	<Control let:attrs>
		<Label class="flex justify-center items-center flex-col sm:flex-row my-2">
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
