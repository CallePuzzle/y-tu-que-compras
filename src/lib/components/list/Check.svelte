<script lang="ts">
	import { onMount } from 'svelte';
	import { CompletedSchemaWithId } from '$lib/schemas';
	import { superForm, superValidate, type SuperValidated, type Infer } from 'sveltekit-superforms';
	import { zod } from 'sveltekit-superforms/adapters';
	import { z } from 'zod';
	import type { SuperFormData } from 'sveltekit-superforms/client';
	import { zodClient } from 'sveltekit-superforms/adapters';

	let {
		id,
		name,
		completed,
		superform,
		superFormReady = false
	}: {
		id: number;
		name: string;
		completed: boolean;
		superform: SuperValidated<z.infer<typeof CompletedSchemaWithId>>;
		superFormReady?: boolean;
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
				{#if superFormReady}
					<form method="POST" action="" use:enhance>
						<input type="hidden" name="id" bind:value={$formData.id} />
						{#if $delayed}
							<span class="loading loading-dots loading-lg"></span>
						{:else}
							<button type="submit" class="checkbox {completed ? 'checked' : ''}"></button>
						{/if}
					</form>
				{/if}
				{name}
			</h3>
		</div>
	</div>
</div>
