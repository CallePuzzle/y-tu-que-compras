<script lang="ts">
	import { Icon } from 'svelte-icons-pack';
	import { LuApple } from 'svelte-icons-pack/lu';
	import { FaSolidListCheck } from 'svelte-icons-pack/fa';
	import { RiOthersFridgeLine } from 'svelte-icons-pack/ri';
	import { AiOutlineHome } from 'svelte-icons-pack/ai';
	import { BiStore } from 'svelte-icons-pack/bi';
	import { Routes } from '$lib/routes';
	import IconComponent from '$lib/components/layout/IconComponent.svelte';

	import type { PageData } from './$types';

	let {
		children,
		data
	}: {
		children: any;
		data: PageData;
	} = $props();

	const home = data.home;
</script>

<div class="hero bg-base-200">
	<div class="hero-content flex-col lg:flex-row">
		<IconComponent icon={home.icon} size="4em" />
		<div>
			<h1 class="text-5xl font-bold">{home.name}</h1>
			<p class="py-6">
				{home.description}
			</p>
		</div>
	</div>
</div>

{@render children()}

<div class="flex justify-center">
	<ul class="menu menu-horizontal bg-base-200 rounded-box mt-6">
		<li>
			<a
				class="tooltip"
				data-tip={Routes.home_index.name}
				href={Routes.home_index.generateUrl({ id: home.id })}
			>
				<Icon src={AiOutlineHome} size="2.5em" />
			</a>
		</li>
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
				data-tip={Routes.fridge_index.name}
				href={Routes.fridge_index.generateUrl({ id: home.id })}
			>
				<Icon src={RiOthersFridgeLine} size="2.5em" />
			</a>
		</li>
		<li>
			<a
				class="tooltip"
				data-tip={Routes.store_index.name}
				href={Routes.store_index.generateUrl({ id: home.id })}
			>
				<Icon src={BiStore} size="2.5em" />
			</a>
		</li>
	</ul>
</div>
