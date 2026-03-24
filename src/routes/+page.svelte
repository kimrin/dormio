<script lang="ts">
	import { onMount } from 'svelte';
	import { base } from '$app/paths';
	import { authState, initAuth } from '$lib/stores.svelte.js';
	import { startOAuthFlow, logout, setClientId, getClientId } from '$lib/auth.js';
	import { fetchRecentSleep, totalMinutes } from '$lib/fitbit.js';
	import type { DaySleepData } from '$lib/types.js';

	// ── State ──────────────────────────────────────────────────────────────────
	const todayStr = new Date().toISOString().slice(0, 10);

	let period = $state<14 | 28>(14);
	let sleepData = $state<Map<string, DaySleepData>>(new Map());
	let loading = $state(false);
	let loadError = $state('');
	let selectedDate = $state<string | null>(null);

	let clientIdInput = $state('');
	let showSetup = $state(false);

	// ── Derived ────────────────────────────────────────────────────────────────
	const gridDays = $derived.by(() => {
		const days: string[] = [];
		for (let i = period - 1; i >= 0; i--) {
			const d = new Date();
			d.setDate(d.getDate() - i);
			days.push(d.toISOString().slice(0, 10));
		}
		return days;
	});

	const selectedSleep = $derived(selectedDate ? sleepData.get(selectedDate) ?? null : null);

	// ── Functions ──────────────────────────────────────────────────────────────
	async function loadData() {
		if (!authState.isAuthenticated) return;
		loading = true;
		loadError = '';
		try {
			sleepData = await fetchRecentSleep();
		} catch (e) {
			loadError = e instanceof Error ? e.message : String(e);
			if (loadError === 'AUTH_EXPIRED') {
				authState.isAuthenticated = false;
				loadError = 'Session expired. Please reconnect.';
			}
		} finally {
			loading = false;
		}
	}

	function saveClientId() {
		setClientId(clientIdInput.trim());
		authState.clientId = clientIdInput.trim();
		showSetup = false;
	}

	function handleLogout() {
		logout();
		authState.isAuthenticated = false;
		sleepData = new Map();
		selectedDate = null;
	}

	function phaseColor(phase: string): string {
		return ({ deep: '#1d4ed8', light: '#60a5fa', rem: '#a855f7', wake: '#f59e0b' } as Record<string, string>)[phase] ?? '#94a3b8';
	}

	function phaseLabel(phase: string): string {
		return ({ deep: 'Deep', light: 'Light', rem: 'REM', wake: 'Awake' } as Record<string, string>)[phase] ?? phase;
	}

	function formatDuration(minutes: number): string {
		const h = Math.floor(minutes / 60);
		const m = minutes % 60;
		return h > 0 ? `${h}h ${m}m` : `${m}m`;
	}

	function sleepBarSegments(date: string) {
		const entry = sleepData.get(date);
		if (!entry?.mainSleep) return [];
		const m = totalMinutes(entry.mainSleep);
		const total = m.deep + m.light + m.rem + m.wake;
		if (total === 0) return [];
		return [
			{ phase: 'deep', pct: (m.deep / total) * 100 },
			{ phase: 'rem', pct: (m.rem / total) * 100 },
			{ phase: 'light', pct: (m.light / total) * 100 },
			{ phase: 'wake', pct: (m.wake / total) * 100 }
		].filter((s) => s.pct > 0);
	}

	// ── Lifecycle ──────────────────────────────────────────────────────────────
	onMount(() => {
		initAuth();
		clientIdInput = getClientId();
		if (authState.isAuthenticated) loadData();
	});
</script>

<div class="mx-auto max-w-5xl px-4 py-6">
	<!-- Header -->
	<header class="mb-6 flex items-center justify-between">
		<h1 class="text-2xl font-bold tracking-tight text-slate-100">dormio</h1>
		<div class="flex gap-2">
			{#if authState.isAuthenticated}
				<button
					onclick={handleLogout}
					class="rounded-lg bg-slate-800 px-3 py-1.5 text-sm text-slate-300 hover:bg-slate-700"
				>
					Disconnect
				</button>
			{:else}
				<button
					onclick={() => { showSetup = !showSetup; }}
					class="rounded-lg bg-slate-800 px-3 py-1.5 text-sm text-slate-300 hover:bg-slate-700"
				>
					Setup
				</button>
				<button
					onclick={() => startOAuthFlow()}
					disabled={!authState.clientId}
					class="rounded-lg bg-indigo-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-indigo-500 disabled:opacity-40"
				>
					Connect Fitbit
				</button>
			{/if}
		</div>
	</header>

	<!-- Setup panel -->
	{#if showSetup}
		<div class="mb-6 rounded-xl bg-slate-800 p-5">
			<h2 class="mb-3 font-semibold text-slate-200">Fitbit App Setup</h2>
			<p class="mb-4 text-sm text-slate-400">
				Register a personal app at <span class="text-indigo-400">dev.fitbit.com</span> and enter your Client ID below.
				Set the OAuth callback URL to: <code class="rounded bg-slate-700 px-1.5 py-0.5 text-xs text-emerald-400">{typeof window !== 'undefined' ? window.location.origin : ''}{base}/callback/</code>
			</p>
			<div class="flex gap-3">
				<input
					type="text"
					bind:value={clientIdInput}
					placeholder="Fitbit Client ID"
					class="flex-1 rounded-lg bg-slate-700 px-4 py-2 text-sm text-slate-100 placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-indigo-500"
				/>
				<button
					onclick={saveClientId}
					class="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-500"
				>
					Save
				</button>
			</div>
		</div>
	{/if}

	{#if !authState.isAuthenticated}
		<!-- Not connected state -->
		<div class="flex min-h-[60vh] flex-col items-center justify-center text-center">
			<div class="mb-6 text-6xl">🌙</div>
			<h2 class="mb-2 text-xl font-semibold text-slate-200">Sleep Calendar</h2>
			<p class="mb-8 max-w-sm text-slate-400">
				Connect your Fitbit account to visualize your sleep phases.
			</p>
			{#if !authState.clientId}
				<p class="text-sm text-amber-400">Set up your Fitbit Client ID first using the Setup button.</p>
			{:else}
				<button
					onclick={() => startOAuthFlow()}
					class="rounded-xl bg-indigo-600 px-6 py-3 font-medium text-white hover:bg-indigo-500"
				>
					Connect Fitbit
				</button>
			{/if}
		</div>
	{:else}
		<div class="grid grid-cols-1 gap-6 lg:grid-cols-3">
			<!-- Grid panel -->
			<div class="lg:col-span-2">
				<!-- Period selector -->
				<div class="mb-4 flex items-center gap-2">
					<button
						onclick={() => { period = 14; }}
						class="rounded-lg px-4 py-1.5 text-sm font-medium transition-colors
							{period === 14 ? 'bg-indigo-600 text-white' : 'bg-slate-800 text-slate-400 hover:bg-slate-700'}"
					>
						2 weeks
					</button>
					<button
						onclick={() => { period = 28; }}
						class="rounded-lg px-4 py-1.5 text-sm font-medium transition-colors
							{period === 28 ? 'bg-indigo-600 text-white' : 'bg-slate-800 text-slate-400 hover:bg-slate-700'}"
					>
						4 weeks
					</button>
				</div>

				<!-- Loading / Error -->
				{#if loading}
					<div class="flex h-64 items-center justify-center">
						<div class="h-8 w-8 animate-spin rounded-full border-4 border-indigo-500 border-t-transparent"></div>
					</div>
				{:else if loadError}
					<div class="rounded-xl bg-red-900/30 p-4 text-center text-sm text-red-400">
						{loadError}
						<button onclick={loadData} class="ml-2 underline">Retry</button>
					</div>
				{:else}
					<!-- Sleep grid -->
					<div class="grid grid-cols-7 gap-1">
						{#each gridDays as date}
							{@const hasSleep = sleepData.has(date)}
							{@const isSelected = selectedDate === date}
							{@const isToday = date === todayStr}
							{@const segments = sleepBarSegments(date)}
							{@const dayNum = parseInt(date.slice(8))}
							{@const dow = new Date(date + 'T12:00:00').toLocaleDateString('default', { weekday: 'short' })}
							<button
								onclick={() => { if (hasSleep) selectedDate = isSelected ? null : date; }}
								class="flex min-h-[80px] flex-col rounded-xl p-2 text-left transition-colors
									{isSelected ? 'bg-indigo-900/60 ring-2 ring-indigo-500' : 'bg-slate-800/60 hover:bg-slate-800'}
									{hasSleep ? 'cursor-pointer' : 'cursor-default'}"
							>
								<span class="text-[10px] text-slate-500">{dow}</span>
								<span class="text-xs font-medium {isToday ? 'text-indigo-400' : 'text-slate-300'}">{dayNum}</span>
								{#if segments.length > 0}
									<div class="mt-auto flex h-3 w-full overflow-hidden rounded-full">
										{#each segments as seg}
											<div style="width:{seg.pct}%; background:{phaseColor(seg.phase)};"></div>
										{/each}
									</div>
									{@const log = sleepData.get(date)?.mainSleep}
									{#if log}
										<span class="mt-1 text-[10px] text-slate-500">{formatDuration(log.minutesAsleep)}</span>
									{/if}
								{/if}
							</button>
						{/each}
					</div>

					<!-- Legend -->
					<div class="mt-4 flex flex-wrap gap-4">
						{#each [['deep','Deep'], ['rem','REM'], ['light','Light'], ['wake','Awake']] as [phase, label]}
							<div class="flex items-center gap-1.5">
								<div class="h-3 w-3 rounded-full" style="background:{phaseColor(phase)};"></div>
								<span class="text-xs text-slate-500">{label}</span>
							</div>
						{/each}
					</div>
				{/if}
			</div>

			<!-- Detail panel -->
			<div class="lg:col-span-1">
				{#if selectedSleep?.mainSleep}
					{@const log = selectedSleep.mainSleep}
					{@const m = totalMinutes(log)}
					{@const total = m.deep + m.light + m.rem + m.wake}
					<div class="rounded-xl bg-slate-800 p-5">
						<h3 class="mb-1 font-semibold text-slate-200">
							{new Date(selectedDate + 'T12:00:00').toLocaleDateString('default', { weekday: 'long', month: 'short', day: 'numeric' })}
						</h3>
						<p class="mb-4 text-sm text-slate-400">
							{new Date(log.startTime).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
							→
							{new Date(log.endTime).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
						</p>

						<!-- Phase bars -->
						<div class="mb-5 space-y-3">
							{#each [['deep', m.deep], ['rem', m.rem], ['light', m.light], ['wake', m.wake]] as [phase, mins]}
								{#if total > 0}
									<div>
										<div class="mb-1 flex justify-between text-xs">
											<span class="text-slate-300">{phaseLabel(phase as string)}</span>
											<span class="text-slate-500">{formatDuration(mins as number)}</span>
										</div>
										<div class="h-2.5 w-full overflow-hidden rounded-full bg-slate-700">
											<div
												class="h-full rounded-full transition-all"
												style="width:{((mins as number)/total)*100}%; background:{phaseColor(phase as string)};"
											></div>
										</div>
									</div>
								{/if}
							{/each}
						</div>

						<!-- Stats grid -->
						<div class="grid grid-cols-2 gap-3">
							<div class="rounded-lg bg-slate-700/50 p-3">
								<div class="text-xs text-slate-500">Total Sleep</div>
								<div class="font-semibold text-slate-200">{formatDuration(log.minutesAsleep)}</div>
							</div>
							<div class="rounded-lg bg-slate-700/50 p-3">
								<div class="text-xs text-slate-500">Time in Bed</div>
								<div class="font-semibold text-slate-200">{formatDuration(log.timeInBed)}</div>
							</div>
							<div class="rounded-lg bg-slate-700/50 p-3">
								<div class="text-xs text-slate-500">Efficiency</div>
								<div class="font-semibold text-slate-200">{log.efficiency}%</div>
							</div>
							<div class="rounded-lg bg-slate-700/50 p-3">
								<div class="text-xs text-slate-500">Awake</div>
								<div class="font-semibold text-slate-200">{formatDuration(m.wake)}</div>
							</div>
						</div>
					</div>
				{:else if selectedDate}
					<div class="rounded-xl bg-slate-800 p-5 text-center text-sm text-slate-500">
						No sleep data for this day.
					</div>
				{:else}
					<div class="rounded-xl bg-slate-800/40 p-5 text-center text-sm text-slate-600">
						Select a day to see details.
					</div>
				{/if}
			</div>
		</div>
	{/if}
</div>
