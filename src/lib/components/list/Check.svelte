<script lang="ts">
	import type { GroceryListExtended } from '$lib/schemas';

	let loading = $state(false);

	let {
		groceryList = $bindable()
	}: {
		groceryList: GroceryListExtended;
	} = $props();

	async function toggleCheck() {
		try {
			loading = true;
			const response = await fetch(
				`/api/toggle-check?id=${groceryList.id}&completed=${groceryList.completed}`,
				{
					method: 'GET'
				}
			);
			if (!response.ok) {
				throw new Error('Network response was not ok');
			}
			const result = await response.json();
			groceryList = result.groceryList;
			loading = false;
		} catch (error) {
			console.error('Error toggling check:', error);
			loading = false;
		}
	}
</script>

<div class="card bg-neutral text-neutral-content w-96 my-1">
	<div class="card-body flex flex-row items-center">
		<div class="flex flex-col basis-1/2">
			<h3 class="card-title">
				{#if loading}
					<span class="loading loading-dots loading-lg"></span>
				{:else}
					<button
						onclick={toggleCheck}
						class="checkbox {groceryList.completed ? 'checked' : ''}"
						aria-label="Toggle Check"
					></button>
				{/if}
				{groceryList.grocery.name}
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
