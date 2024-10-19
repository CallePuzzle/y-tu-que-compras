<script lang="ts">
	import { CompletedSchemaWithId } from '$lib/schemas';
	import { superForm, type SuperValidated } from 'sveltekit-superforms';
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
		id: id + '-todocheck',
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
					<input type="hidden" name="id" bind:value={$formData.id} />
					<input type="hidden" name="completed" bind:value={$formData.completed} />
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

<style>
	.checked {
		background-repeat: no-repeat;
		animation: checkmark var(--animation-input, 0.2s) ease-out;
		background-color: var(--chkbg);
		background-image: linear-gradient(-45deg, transparent 65%, var(--chkbg) 65.99%),
			linear-gradient(45deg, transparent 75%, var(--chkbg) 75.99%),
			linear-gradient(-45deg, var(--chkbg) 40%, transparent 40.99%),
			linear-gradient(
				45deg,
				var(--chkbg) 30%,
				var(--chkfg) 30.99%,
				var(--chkfg) 40%,
				transparent 40.99%
			),
			linear-gradient(-45deg, var(--chkfg) 50%, var(--chkbg) 50.99%);
	}
</style>
