<script lang="ts">
	import { Icon } from 'svelte-icons-pack';
	import { LuApple } from 'svelte-icons-pack/lu';
	import { FaSolidListCheck } from 'svelte-icons-pack/fa';
	import { RiOthersFridgeLine } from 'svelte-icons-pack/ri';
	import { Routes } from '$lib/routes';

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

{@render children()}

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
