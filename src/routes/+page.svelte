<script lang="ts">
	import { m } from '#lib/paraglide/messages.js';
</script>

<svelte:head>
	<title>{m.app_brand()}</title>
	<meta name="description" content={m.app_tagline()} />
</svelte:head>

<section class="hero bg-base-200 rounded-box min-h-[50vh]">
	<div class="hero-content text-center">
		<div class="max-w-md">
			<h1 class="text-5xl font-bold">{m.app_brand()}</h1>
			<p class="py-6">{m.app_tagline()}</p>
		</div>
	</div>
</section>
