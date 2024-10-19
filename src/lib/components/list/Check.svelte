<script lang="ts">
	import { CompletedSchemaWithId } from '$lib/schemas';
	import { superForm, superValidate, type SuperValidated } from 'sveltekit-superforms';
	import { z } from 'zod';
	import { zodClient } from 'sveltekit-superforms/adapters';

	let {
		id,
		name,
		completed,
		superform
	}: {
		id: number;
		name: string;
		completed: boolean;
		superform: SuperValidated<z.infer<typeof CompletedSchemaWithId>>;
	} = $props();

	const form = superForm(superform, {
		id: id + '-' + completed ? 'completed' : 'todo',
		validators: zodClient(CompletedSchemaWithId),
		dataType: 'json',
		delayMs: 100
	});
	const { form: formData, enhance, delayed } = form;
</script>

<div class="card bg-neutral text-neutral-content w-96 my-1">
	<div class="card-body flex flex-row items-center">
		<div class="flex flex-col basis-1/2">
			<h3 class="card-title">
				<form method="POST" action="?/toggleCheck" use:enhance>
					{#if $delayed}
						<span class="loading loading-dots loading-lg"></span>
					{:else}
						<button type="submit" class="checkbox {completed ? 'checked' : ''}"></button>
					{/if}
				</form>
				{name}
			</h3>
		</div>
	</div>
</div>
