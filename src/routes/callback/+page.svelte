<script lang="ts">
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import { base } from '$app/paths';
	import { handleCallback } from '$lib/auth.js';
	import { authState } from '$lib/stores.svelte.js';

	let status = $state<'processing' | 'error'>('processing');
	let errorMsg = $state('');

	onMount(async () => {
		const params = new URLSearchParams(window.location.search);
		const code = params.get('code');
		const error = params.get('error');

		if (error) {
			status = 'error';
			errorMsg = error;
			return;
		}

		if (!code) {
			status = 'error';
			errorMsg = 'No authorization code received.';
			return;
		}

		try {
			await handleCallback(code);
			authState.isAuthenticated = true;
			goto(`${base}/`);
		} catch (e) {
			status = 'error';
			errorMsg = e instanceof Error ? e.message : String(e);
		}
	});
</script>

<div class="flex min-h-screen items-center justify-center">
	{#if status === 'processing'}
		<div class="text-center">
			<div class="mb-4 text-2xl">Connecting to Fitbit...</div>
			<div class="mx-auto h-8 w-8 animate-spin rounded-full border-4 border-indigo-500 border-t-transparent"></div>
		</div>
	{:else}
		<div class="text-center">
			<div class="mb-2 text-2xl text-red-400">Connection failed</div>
			<p class="text-slate-400">{errorMsg}</p>
			<a href="{base}/" class="mt-4 inline-block text-indigo-400 underline">Back to home</a>
		</div>
	{/if}
</div>
