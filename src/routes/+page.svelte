<script lang="ts">
	import { onMount } from 'svelte';
import { authState, initAuth } from '$lib/stores.svelte.js';
	import { startOAuthFlow, logout, getClientId } from '$lib/auth.js';
	import { fetchRecentSleep, totalMinutes } from '$lib/fitbit.js';
	import type { DaySleepData, SleepLog } from '$lib/types.js';

	const todayStr = new Date().toISOString().slice(0, 10);
	const JP_DOW = ['日', '月', '火', '水', '木', '金', '土'];

	// Japanese national holidays 2025–2027
	const JP_HOLIDAYS = new Set([
		// 2025
		'2025-01-01','2025-01-13',
		'2025-02-11','2025-02-24',
		'2025-03-20',
		'2025-04-29',
		'2025-05-03','2025-05-04','2025-05-05','2025-05-06',
		'2025-07-21',
		'2025-08-11',
		'2025-09-15','2025-09-23',
		'2025-10-13',
		'2025-11-03','2025-11-24',
		// 2026
		'2026-01-01','2026-01-12',
		'2026-02-11','2026-02-23',
		'2026-03-20',
		'2026-04-29',
		'2026-05-03','2026-05-04','2026-05-05','2026-05-06',
		'2026-07-20',
		'2026-08-11',
		'2026-09-21','2026-09-23',
		'2026-10-12',
		'2026-11-03','2026-11-23',
		// 2027
		'2027-01-01','2027-01-11',
		'2027-02-11','2027-02-23',
		'2027-03-21',
		'2027-04-29',
		'2027-05-03','2027-05-04','2027-05-05',
		'2027-07-19',
		'2027-08-11',
		'2027-09-20','2027-09-23',
		'2027-10-11',
		'2027-11-03','2027-11-23',
	]);

	// Timeline window: 15:00 → 16:00 next day (25 hours)
	// Extra margin covers long sleeps ending in mid-afternoon (e.g. 02:29–15:13)
	const WIN_START_HOUR = 15;
	const WIN_MS = 25 * 3600 * 1000;
	const H = (h: number) => h / 25 * 100; // hours-from-start → %
	const HOUR_MARKERS = [
		{ label: '15', pct: H(0) },
		{ label: '18', pct: H(3) },
		{ label: '21', pct: H(6) },
		{ label: '00', pct: H(9) },
		{ label: '03', pct: H(12) },
		{ label: '06', pct: H(15) },
		{ label: '09', pct: H(18) },
		{ label: '12', pct: H(21) },
		{ label: '15', pct: H(24) },
	];
	const MIDNIGHT_PCT = H(9); // 00:00 is 9h from 15:00

	// ── State ──────────────────────────────────────────────────────────────────
	let period = $state<14 | 28>(14);
	let pageOffset = $state(0); // days to look back from today
	let allSleepData = $state<Map<string, DaySleepData>>(new Map());
	let loading = $state(false);
	let loadError = $state('');
	let selectedDate = $state<string | null>(null);
	let darkMode = $state(true);

	// ── Derived ────────────────────────────────────────────────────────────────
	const gridDays = $derived.by(() => {
		const days: string[] = [];
		for (let i = period - 1; i >= 0; i--) {
			const d = new Date();
			d.setDate(d.getDate() - pageOffset - i);
			days.push(d.toISOString().slice(0, 10));
		}
		return days;
	});

	const selectedSleep = $derived(selectedDate ? allSleepData.get(selectedDate) ?? null : null);

	// ── Helpers ────────────────────────────────────────────────────────────────
	function dateLabel(dateStr: string): string {
		const d = new Date(dateStr + 'T12:00:00');
		const mm = String(d.getMonth() + 1).padStart(2, '0');
		const dd = String(d.getDate()).padStart(2, '0');
		return `${mm}-${dd}（${JP_DOW[d.getDay()]}）`;
	}

	function dateLabelClass(dateStr: string, hasLog: boolean): string {
		if (dateStr === todayStr) return 'text-indigo-500 dark:text-indigo-400 font-medium';
		if (JP_HOLIDAYS.has(dateStr)) return 'text-red-500 dark:text-red-400';
		const dow = new Date(dateStr + 'T12:00:00').getDay();
		if (dow === 6) return 'text-blue-500 dark:text-blue-400';
		return hasLog ? 'text-gray-700 dark:text-slate-300' : 'text-gray-400 dark:text-slate-600';
	}

	function levelColor(level: string): string {
		const colors: Record<string, string> = {
			deep: '#2563eb',
			light: '#60a5fa',
			rem: '#a855f7',
			wake: '#ef4444',
			asleep: '#60a5fa',
			restless: '#f97316',
			awake: '#ef4444',
		};
		return colors[level] ?? '#94a3b8';
	}

	// Compute the display window for a row.
	// If the primary sleep starts before WIN_START_HOUR, anchor to prev-day WIN_START_HOUR.
	// If no primary sleep, use prev-day WIN_START_HOUR as default (same convention).
	function getRowWin(dateStr: string, log: SleepLog | null): { winStart: number; winEnd: number } {
		if (log) {
			const base = new Date(log.startTime);
			base.setHours(WIN_START_HOUR, 0, 0, 0);
			if (new Date(log.startTime).getHours() < WIN_START_HOUR) base.setDate(base.getDate() - 1);
			const ws = base.getTime();
			return { winStart: ws, winEnd: ws + WIN_MS };
		}
		const base = new Date(dateStr + 'T12:00:00');
		base.setDate(base.getDate() - 1);
		base.setHours(WIN_START_HOUR, 0, 0, 0);
		const ws = base.getTime();
		return { winStart: ws, winEnd: ws + WIN_MS };
	}

	// Build renderable segments from a sleep log, clipped to [clipStart, winEnd] inside [winStart, winEnd].
	function makeSegments(
		log: SleepLog,
		winStart: number,
		winEnd: number,
		clipStart = winStart
	): Array<{ left: number; width: number; level: string }> {
		function clip(s: number, e: number, level: string) {
			const cs = Math.max(s, clipStart);
			const ce = Math.min(e, winEnd);
			if (ce <= cs) return null;
			return { left: (cs - winStart) / WIN_MS * 100, width: (ce - cs) / WIN_MS * 100, level };
		}
		if (log.levels?.data?.length) {
			return log.levels.data.flatMap((seg) => {
				const s = new Date(seg.dateTime).getTime();
				const r = clip(s, s + seg.seconds * 1000, seg.level);
				return r ? [r] : [];
			});
		}
		const r = clip(new Date(log.startTime).getTime(), new Date(log.endTime).getTime(), 'asleep');
		return r ? [r] : [];
	}

	function prevDateStr(dateStr: string): string {
		const d = new Date(dateStr + 'T12:00:00');
		d.setDate(d.getDate() - 1);
		return d.toISOString().slice(0, 10);
	}

	function formatHHMM(minutes: number): string {
		const h = Math.floor(minutes / 60);
		const m = minutes % 60;
		return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
	}

	function formatDuration(minutes: number): string {
		const h = Math.floor(minutes / 60);
		const m = minutes % 60;
		return h > 0 ? `${h}h ${m}m` : `${m}m`;
	}

	function phaseLabel(phase: string): string {
		return ({ deep: 'Deep', light: 'Light', rem: 'REM', wake: 'Awake' } as Record<string, string>)[phase] ?? phase;
	}

	// ── Theme ──────────────────────────────────────────────────────────────────
	function applyTheme(dark: boolean) {
		if (dark) document.documentElement.classList.add('dark');
		else document.documentElement.classList.remove('dark');
	}

	function toggleTheme() {
		darkMode = !darkMode;
		applyTheme(darkMode);
		localStorage.setItem('dormio_theme', darkMode ? 'dark' : 'light');
	}

	// ── Data loading ───────────────────────────────────────────────────────────
	async function loadData(beforeDate?: string) {
		if (!authState.isAuthenticated) return;
		loading = true;
		loadError = '';
		try {
			const newData = await fetchRecentSleep(beforeDate);
			if (beforeDate) {
				allSleepData = new Map([...allSleepData, ...newData]);
			} else {
				allSleepData = newData;
			}
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

	// ── Pagination ─────────────────────────────────────────────────────────────
	async function goBack() {
		pageOffset += period;
		selectedDate = null;
		// Fetch more data if oldest displayed day isn't covered yet
		const oldest = gridDays[0];
		const dates = Array.from(allSleepData.keys()).sort();
		const oldestFetched = dates[0] ?? todayStr;
		if (oldest < oldestFetched) {
			const bd = new Date(oldest + 'T12:00:00');
			bd.setDate(bd.getDate() + 1);
			await loadData(bd.toISOString().slice(0, 10));
		}
	}

	function goForward() {
		pageOffset = Math.max(0, pageOffset - period);
		selectedDate = null;
	}

	function setPeriod(p: 14 | 28) {
		period = p;
		pageOffset = 0;
		selectedDate = null;
	}

	function handleLogout() {
		logout();
		authState.isAuthenticated = false;
		allSleepData = new Map();
		selectedDate = null;
	}

	// ── Lifecycle ──────────────────────────────────────────────────────────────
	onMount(() => {
		const saved = localStorage.getItem('dormio_theme');
		darkMode = saved !== 'light';
		applyTheme(darkMode);
		initAuth();
		if (authState.isAuthenticated) loadData();
	});
</script>

<div class="mx-auto max-w-5xl px-4 py-6">
	<!-- Header -->
	<header class="mb-6 flex items-center justify-between">
		<h1 class="text-2xl font-bold tracking-tight text-gray-900 dark:text-slate-100">dormio</h1>
		<div class="flex items-center gap-2">
			<button
				onclick={toggleTheme}
				class="rounded-lg bg-gray-200 dark:bg-slate-800 px-3 py-1.5 text-sm text-gray-600 dark:text-slate-400 hover:bg-gray-300 dark:hover:bg-slate-700"
				aria-label="Toggle theme"
			>
				{#if darkMode}☀️{:else}🌙{/if}
			</button>
			{#if authState.isAuthenticated}
				<button
					onclick={handleLogout}
					class="rounded-lg bg-gray-200 dark:bg-slate-800 px-3 py-1.5 text-sm text-gray-700 dark:text-slate-300 hover:bg-gray-300 dark:hover:bg-slate-700"
				>
					Disconnect
				</button>
			{:else}
				<button
					onclick={() => startOAuthFlow()}
					class="rounded-lg bg-indigo-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-indigo-500"
				>
					Connect Fitbit
				</button>
			{/if}
		</div>
	</header>

	{#if !authState.isAuthenticated}
		<div class="flex min-h-[60vh] flex-col items-center justify-center text-center">
			<div class="mb-6 text-6xl">🌙</div>
			<h2 class="mb-2 text-xl font-semibold text-gray-800 dark:text-slate-200">Sleep Calendar</h2>
			<p class="mb-8 max-w-sm text-gray-600 dark:text-slate-400">
				Connect your Fitbit account to visualize your sleep phases.
			</p>
			<button
				onclick={() => startOAuthFlow()}
				class="rounded-xl bg-indigo-600 px-6 py-3 font-medium text-white hover:bg-indigo-500"
			>
				Connect Fitbit
			</button>
		</div>
	{:else}
		<div class="grid grid-cols-1 gap-6 lg:grid-cols-3">
			<!-- Timeline panel -->
			<div class="lg:col-span-2">
				<!-- Controls -->
				<div class="mb-4 flex items-center gap-2">
					<button
						onclick={() => setPeriod(14)}
						class="rounded-lg px-4 py-1.5 text-sm font-medium transition-colors
							{period === 14 ? 'bg-indigo-600 text-white' : 'bg-gray-200 dark:bg-slate-800 text-gray-600 dark:text-slate-400 hover:bg-gray-300 dark:hover:bg-slate-700'}"
					>
						2 weeks
					</button>
					<button
						onclick={() => setPeriod(28)}
						class="rounded-lg px-4 py-1.5 text-sm font-medium transition-colors
							{period === 28 ? 'bg-indigo-600 text-white' : 'bg-gray-200 dark:bg-slate-800 text-gray-600 dark:text-slate-400 hover:bg-gray-300 dark:hover:bg-slate-700'}"
					>
						4 weeks
					</button>
					<div class="ml-auto flex items-center gap-1">
						<button
							onclick={goBack}
							class="rounded-lg bg-gray-200 dark:bg-slate-800 px-3 py-1.5 text-sm text-gray-600 dark:text-slate-400 hover:bg-gray-300 dark:hover:bg-slate-700"
						>
							◀
						</button>
						<button
							onclick={goForward}
							disabled={pageOffset === 0}
							class="rounded-lg bg-gray-200 dark:bg-slate-800 px-3 py-1.5 text-sm text-gray-600 dark:text-slate-400 hover:bg-gray-300 dark:hover:bg-slate-700 disabled:opacity-30"
						>
							▶
						</button>
					</div>
				</div>

				{#if loading}
					<div class="flex h-64 items-center justify-center">
						<div class="h-8 w-8 animate-spin rounded-full border-4 border-indigo-500 border-t-transparent"></div>
					</div>
				{:else if loadError}
					<div class="rounded-xl bg-red-50 dark:bg-red-900/30 p-4 text-center text-sm text-red-600 dark:text-red-400">
						{loadError}
						<button onclick={() => loadData()} class="ml-2 underline">Retry</button>
					</div>
				{:else}
					<!-- Hour axis header -->
					<div class="mb-1 flex items-end gap-2">
						<div class="w-28 shrink-0"></div>
						<div class="relative h-4 flex-1">
							{#each HOUR_MARKERS as { label, pct }}
								<span
									class="absolute -translate-x-1/2 text-[10px] text-gray-400 dark:text-slate-500"
									style="left:{pct}%">{label}</span
								>
							{/each}
						</div>
						<div class="w-14 shrink-0"></div>
					</div>

					<!-- Day rows -->
					<div class="space-y-0.5">
						{#each gridDays as date}
							{@const entry = allSleepData.get(date)}
							{@const log = entry?.mainSleep ?? null}
							{@const isSelected = selectedDate === date}
							{@const { winStart, winEnd } = getRowWin(date, log)}
							{@const midnight = new Date(date + 'T00:00:00').getTime()}
							{@const prevLog = allSleepData.get(prevDateStr(date))?.mainSleep ?? null}
							{@const primarySegs = log ? makeSegments(log, winStart, winEnd) : []}
							{@const spilloverSegs = (prevLog && new Date(prevLog.endTime).getTime() > midnight)
								? makeSegments(prevLog, winStart, winEnd, midnight)
								: []}

							<button
								onclick={() => { if (log || spilloverSegs.length) selectedDate = isSelected ? null : date; }}
								class="flex w-full items-center gap-2 rounded-lg px-1 py-1 transition-colors
									{isSelected ? 'bg-indigo-100 dark:bg-indigo-900/40 ring-1 ring-indigo-400 dark:ring-indigo-600' : (log || spilloverSegs.length) ? 'hover:bg-gray-100 dark:hover:bg-slate-800/60' : ''}
									{(log || spilloverSegs.length) ? 'cursor-pointer' : 'cursor-default'}"
							>
								<span class="w-28 shrink-0 text-left text-sm tabular-nums {dateLabelClass(date, !!log)}">
									{dateLabel(date)}
								</span>

								<div class="relative h-7 flex-1 overflow-hidden rounded bg-gray-200 dark:bg-slate-800/60">
									{#each HOUR_MARKERS as { pct }}
										<div class="absolute inset-y-0 w-px bg-gray-300/80 dark:bg-slate-700/60" style="left:{pct}%"></div>
									{/each}
									<div class="absolute inset-y-0 w-px bg-gray-400 dark:bg-slate-500" style="left:{MIDNIGHT_PCT}%"></div>
									{#each spilloverSegs as seg}
										<div
											class="absolute inset-y-0 opacity-50"
											style="left:{seg.left}%; width:{seg.width}%; background:{levelColor(seg.level)};"
										></div>
									{/each}
									{#each primarySegs as seg}
										<div
											class="absolute inset-y-0"
											style="left:{seg.left}%; width:{seg.width}%; background:{levelColor(seg.level)};"
										></div>
									{/each}
								</div>

								<span class="w-14 shrink-0 text-right text-sm tabular-nums {log ? 'text-gray-700 dark:text-slate-300' : 'text-gray-300 dark:text-slate-700'}">
									{log ? formatHHMM(log.minutesAsleep) : '—'}
								</span>
							</button>
						{/each}
					</div>

					<!-- Legend -->
					<div class="mt-4 flex flex-wrap gap-4">
						{#each [['deep', 'Deep'], ['rem', 'REM'], ['light', 'Light'], ['wake', 'Awake']] as [phase, label]}
							<div class="flex items-center gap-1.5">
								<div class="h-3 w-3 rounded-sm" style="background:{levelColor(phase)};"></div>
								<span class="text-xs text-gray-500 dark:text-slate-500">{label}</span>
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
					<div class="rounded-xl bg-gray-100 dark:bg-slate-800 p-5">
						<h3 class="mb-1 font-semibold text-gray-800 dark:text-slate-200">
							{new Date(selectedDate + 'T12:00:00').toLocaleDateString('default', {
								weekday: 'long', month: 'short', day: 'numeric'
							})}
						</h3>
						<p class="mb-4 text-sm text-gray-600 dark:text-slate-400">
							{new Date(log.startTime).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
							→
							{new Date(log.endTime).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
						</p>

						<div class="mb-5 space-y-3">
							{#each [['deep', m.deep], ['rem', m.rem], ['light', m.light], ['wake', m.wake]] as [phase, mins]}
								{#if total > 0}
									<div>
										<div class="mb-1 flex justify-between text-xs">
											<span class="text-gray-700 dark:text-slate-300">{phaseLabel(phase as string)}</span>
											<span class="text-gray-500 dark:text-slate-500">{formatDuration(mins as number)}</span>
										</div>
										<div class="h-2.5 w-full overflow-hidden rounded-full bg-gray-200 dark:bg-slate-700">
											<div
												class="h-full rounded-full transition-all"
												style="width:{((mins as number) / total) * 100}%; background:{levelColor(phase as string)};"
											></div>
										</div>
									</div>
								{/if}
							{/each}
						</div>

						<div class="grid grid-cols-2 gap-3">
							<div class="rounded-lg bg-gray-200 dark:bg-slate-700/50 p-3">
								<div class="text-xs text-gray-500 dark:text-slate-500">Total Sleep</div>
								<div class="font-semibold text-gray-800 dark:text-slate-200">{formatDuration(log.minutesAsleep)}</div>
							</div>
							<div class="rounded-lg bg-gray-200 dark:bg-slate-700/50 p-3">
								<div class="text-xs text-gray-500 dark:text-slate-500">Time in Bed</div>
								<div class="font-semibold text-gray-800 dark:text-slate-200">{formatDuration(log.timeInBed)}</div>
							</div>
							<div class="rounded-lg bg-gray-200 dark:bg-slate-700/50 p-3">
								<div class="text-xs text-gray-500 dark:text-slate-500">Efficiency</div>
								<div class="font-semibold text-gray-800 dark:text-slate-200">{log.efficiency}%</div>
							</div>
							<div class="rounded-lg bg-gray-200 dark:bg-slate-700/50 p-3">
								<div class="text-xs text-gray-500 dark:text-slate-500">Awake</div>
								<div class="font-semibold text-gray-800 dark:text-slate-200">{formatDuration(m.wake)}</div>
							</div>
						</div>
					</div>
				{:else if selectedDate}
					<div class="rounded-xl bg-gray-100 dark:bg-slate-800 p-5 text-center text-sm text-gray-500 dark:text-slate-500">
						No sleep data for this day.
					</div>
				{:else}
					<div class="rounded-xl bg-gray-50 dark:bg-slate-800/40 p-5 text-center text-sm text-gray-400 dark:text-slate-600">
						Select a day to see details.
					</div>
				{/if}
			</div>
		</div>
	{/if}
</div>
