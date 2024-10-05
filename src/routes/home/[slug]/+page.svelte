<script lang="ts">
	import type { PageData } from './$types';
	import { Icon } from 'svelte-icons-pack';
	import { LuApple } from 'svelte-icons-pack/lu';
	import { FaSolidListCheck } from 'svelte-icons-pack/fa';
	import { RiOthersFridgeLine } from 'svelte-icons-pack/ri';
	import { Routes } from '$lib/routes';

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

<div class="flex justify-center">
	<ul class="menu menu-horizontal bg-base-200 rounded-box mt-6">
		<li>
			<a
				class="tooltip"
				data-tip={Routes.grocery_index.name}
				href={Routes.grocery_index.generateUrl({ id: home.id })}
			>
				<Icon src={LuApple} size="2.5em" />
			</a>
		</li>
		<li>
			<a
				class="tooltip"
				data-tip={Routes.list_index.name}
				href={Routes.list_index.generateUrl({ id: home.id })}
			>
				<Icon src={FaSolidListCheck} size="2.5em" />
			</a>
		</li>
		<li>
			<a
				class="tooltip"
				data-tip={Routes.store_index.name}
				href={Routes.store_index.generateUrl({ id: home.id })}
			>
				<Icon src={RiOthersFridgeLine} size="2.5em" />
			</a>
		</li>
	</ul>
</div>
