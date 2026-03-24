<script lang="ts">
	import { onMount } from 'svelte';
	import { base } from '$app/paths';
	import { authState, initAuth } from '$lib/stores.svelte.js';
	import { startOAuthFlow, logout, setClientId, getClientId } from '$lib/auth.js';
	import { fetchSleepForMonth, totalMinutes } from '$lib/fitbit.js';
	import type { DaySleepData } from '$lib/types.js';

	// ── State ──────────────────────────────────────────────────────────────────
	let today = new Date();
	let viewYear = $state(today.getFullYear());
	let viewMonth = $state(today.getMonth() + 1); // 1-12

	let sleepData = $state<Map<string, DaySleepData>>(new Map());
	let loading = $state(false);
	let loadError = $state('');
	let selectedDate = $state<string | null>(null);

	let clientIdInput = $state('');
	let showSetup = $state(false);

	// ── Derived ────────────────────────────────────────────────────────────────
	const calendarDays = $derived.by(() => {
		const firstDay = new Date(viewYear, viewMonth - 1, 1).getDay(); // 0=Sun
		const daysInMonth = new Date(viewYear, viewMonth, 0).getDate();
		const days: Array<{ date: string; day: number } | null> = [];
		for (let i = 0; i < firstDay; i++) days.push(null);
		for (let d = 1; d <= daysInMonth; d++) {
			days.push({
				day: d,
				date: `${viewYear}-${String(viewMonth).padStart(2, '0')}-${String(d).padStart(2, '0')}`
			});
		}
		return days;
	});

	const selectedSleep = $derived(selectedDate ? sleepData.get(selectedDate) ?? null : null);

	const monthLabel = $derived(
		new Date(viewYear, viewMonth - 1, 1).toLocaleString('default', { month: 'long', year: 'numeric' })
	);

	// ── Functions ──────────────────────────────────────────────────────────────
	async function loadMonth() {
		if (!authState.isAuthenticated) return;
		loading = true;
		loadError = '';
		try {
			sleepData = await fetchSleepForMonth(viewYear, viewMonth);
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

	function prevMonth() {
		if (viewMonth === 1) { viewYear--; viewMonth = 12; }
		else viewMonth--;
		loadMonth();
	}

	function nextMonth() {
		if (viewMonth === 12) { viewYear++; viewMonth = 1; }
		else viewMonth++;
		loadMonth();
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

	// Sleep phase color helpers
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
		if (authState.isAuthenticated) loadMonth();
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
				Set the OAuth callback URL to: <code class="rounded bg-slate-700 px-1.5 py-0.5 text-xs text-emerald-400">{typeof window !== 'undefined' ? window.location.origin : ''}{base}/callback</code>
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
				Connect your Fitbit account to visualize your sleep phases on a monthly calendar.
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
		<!-- Calendar view -->
		<div class="grid grid-cols-1 gap-6 lg:grid-cols-3">
			<!-- Calendar panel -->
			<div class="lg:col-span-2">
				<!-- Month nav -->
				<div class="mb-4 flex items-center justify-between">
					<button onclick={prevMonth} class="rounded-lg p-2 text-slate-400 hover:bg-slate-800 hover:text-slate-200">
						<svg class="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
							<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 19l-7-7 7-7" />
						</svg>
					</button>
					<span class="font-semibold text-slate-200">{monthLabel}</span>
					<button onclick={nextMonth} class="rounded-lg p-2 text-slate-400 hover:bg-slate-800 hover:text-slate-200">
						<svg class="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
							<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5l7 7-7 7" />
						</svg>
					</button>
				</div>

				<!-- Day of week headers -->
				<div class="mb-1 grid grid-cols-7 gap-1">
					{#each ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as dow}
						<div class="py-1 text-center text-xs font-medium text-slate-500">{dow}</div>
					{/each}
				</div>

				<!-- Loading / Error -->
				{#if loading}
					<div class="flex h-64 items-center justify-center">
						<div class="h-8 w-8 animate-spin rounded-full border-4 border-indigo-500 border-t-transparent"></div>
					</div>
				{:else if loadError}
					<div class="rounded-xl bg-red-900/30 p-4 text-center text-sm text-red-400">
						{loadError}
						<button onclick={loadMonth} class="ml-2 underline">Retry</button>
					</div>
				{:else}
					<!-- Calendar grid -->
					<div class="grid grid-cols-7 gap-1">
						{#each calendarDays as cell}
							{#if cell === null}
								<div></div>
							{:else}
								{@const hasSleep = sleepData.has(cell.date)}
								{@const isSelected = selectedDate === cell.date}
								{@const isToday = cell.date === `${today.getFullYear()}-${String(today.getMonth()+1).padStart(2,'0')}-${String(today.getDate()).padStart(2,'0')}`}
								{@const segments = sleepBarSegments(cell.date)}
								<button
									onclick={() => { selectedDate = isSelected ? null : cell.date; }}
									class="relative flex min-h-[72px] flex-col rounded-xl p-2 text-left transition-colors
										{isSelected ? 'bg-indigo-900/60 ring-2 ring-indigo-500' : 'bg-slate-800/60 hover:bg-slate-800'}
										{hasSleep ? 'cursor-pointer' : 'cursor-default'}"
								>
									<span class="mb-1 text-xs font-medium {isToday ? 'text-indigo-400' : 'text-slate-400'}">{cell.day}</span>
									{#if segments.length > 0}
										<!-- Phase bar -->
										<div class="mt-auto flex h-3 w-full overflow-hidden rounded-full">
											{#each segments as seg}
												<div style="width:{seg.pct}%; background:{phaseColor(seg.phase)};"></div>
											{/each}
										</div>
										<!-- Duration -->
										{@const log = sleepData.get(cell.date)?.mainSleep}
										{#if log}
											<span class="mt-1 text-[10px] text-slate-500">{formatDuration(log.minutesAsleep)}</span>
										{/if}
									{/if}
								</button>
							{/if}
						{/each}
					</div>
				{/if}

				<!-- Legend -->
				<div class="mt-4 flex flex-wrap gap-4">
					{#each [['deep','Deep'], ['rem','REM'], ['light','Light'], ['wake','Awake']] as [phase, label]}
						<div class="flex items-center gap-1.5">
							<div class="h-3 w-3 rounded-full" style="background:{phaseColor(phase)};"></div>
							<span class="text-xs text-slate-500">{label}</span>
						</div>
					{/each}
				</div>
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
