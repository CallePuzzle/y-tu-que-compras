<script>
	
	let newProduct = ""
	/**
     * @type {any[]}
     */
	let products = []

	function addProduct() {
		products.push(newProduct)
	}
</script>

<svelte:head>
	<title>Home</title>
	<meta name="description" content="Svelte demo app" />
</svelte:head>

<section>
	<input bind:value={newProduct} type="text">
	<button on:click={addProduct}>Añadir</button>

	{newProduct}
	{products}
	<ul>
		{#each products as item}
			<li>{item}</li>
		{/each}
	</ul>
</section>

<style>
	section {
		display: flex;
		flex-direction: column;
		justify-content: center;
		align-items: center;
		flex: 0.6;
	}
</style>
