<script lang="ts">
	import { Routes } from '$lib/routes';
	import { userSchema } from '$lib/schemas/user';
	import Form from '$lib/components/Form.svelte';
	import { t } from '$lib/translations';

	import type { PageData } from './$types';

	let {
		data
	}: {
		data: PageData;
	} = $props();

	const superform = data.form;
	const groceries = data.groceries;
</script>

<ul class="list-disc pl-5">
	{#each groceries as grocery}
		<li class="mb-2">
			<div class="card shadow-lg compact bg-base-100">
				<div class="card-body">
					<h2 class="card-title">{grocery.name}</h2>
					<p>{grocery.description}</p>
				</div>
			</div>
		</li>
	{/each}
</ul>
