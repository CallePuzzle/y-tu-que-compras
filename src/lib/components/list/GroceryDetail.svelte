<script lang="ts">
	import type { GroceryListExtended } from '$lib/schemas';
	import type { HTMLInputAttributes } from 'svelte/elements';
	import type { H } from 'vitest/dist/chunks/environment.LoooBwUu.js';

	let loading = $state(false);

	let {
		groceryList = $bindable()
	}: {
		groceryList: GroceryListExtended;
	} = $props();
	console.log(groceryList);
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
	async function updateQuantity(event: InputEvent) {
		const target = event.target as HTMLInputElement;
		if (!target) return;
		try {
			loading = true;
			const response = await fetch(
				`/api/update-quantity?id=${groceryList.id}&quantity=${target.value}`,
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
			console.error('Error updating quantity:', error);
			loading = false;
		}
	}
	async function updateUnit(event: InputEvent) {
		const target = event.target as HTMLInputElement;
		if (!target) return;
		try {
			loading = true;
			const response = await fetch(`/api/update-unit?id=${groceryList.id}&unit=${target.value}`, {
				method: 'GET'
			});
			if (!response.ok) {
				throw new Error('Network response was not ok');
			}
			const result = await response.json();
			groceryList = result.groceryList;
			loading = false;
		} catch (error) {
			console.error('Error updating unit:', error);
			loading = false;
		}
	}
</script>

<div class="card bg-neutral text-neutral-content w-96 my-1">
	<div class="card-body flex flex-row items-center">
		<div class="flex flex-col basis-1/2">
			<p class="card-title">
				{#if loading}
					<span class="loading loading-dots loading-lg"></span>
				{:else}
					<button
						onclick={toggleCheck}
						class="checkbox {groceryList.completed ? 'checked' : ''}"
						aria-label="Toggle Check"
					></button>
				{/if}
				<button onclick={toggleCheck} aria-label="Toggle Check">{groceryList.grocery.name}</button>
			</p>
		</div>
		<div class="flex flex-row basis-1/2">
			<input
				type="number"
				class="input input-bordered w-20"
				value={groceryList.quantity}
				onchange={updateQuantity}
			/>
			<select class="select select-bordered" value={groceryList.unit} onchange={updateUnit}>
				<option value="kg">kilos</option>
				<option value="g">gramos</option>
				<option value="unit">unidades</option>
			</select>
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
