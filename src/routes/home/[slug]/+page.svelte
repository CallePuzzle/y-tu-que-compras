<script lang="ts">
	import type { PageData } from './$types';

	let {
		data
	}: {
		data: PageData;
	} = $props();

	const home = data.home;
</script>

<div class="hero bg-base-200">
	<div class="hero-content flex-col lg:flex-row">
		<img
			src="https://img.daisyui.com/images/stock/photo-1635805737707-575885ab0820.webp"
			class="max-w-sm rounded-lg shadow-2xl"
		/>
		<div>
			<h1 class="text-5xl font-bold">{home.name}</h1>
			<p class="py-6">
				{home.description}
			</p>
		</div>
	</div>
</div>
