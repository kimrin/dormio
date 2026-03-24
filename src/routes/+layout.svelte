<script lang="ts">
	import './layout.css';
	import { onMount } from 'svelte';
	import { initAuth } from '$lib/stores.svelte.js';

	let { children } = $props();

	onMount(() => {
		initAuth();
	});
</script>

{@render children()}
