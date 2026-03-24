import { getValidToken } from './auth.js';
import type { DaySleepData, SleepLog } from './types.js';

const API_BASE = 'https://winter-mode-8b9b.kittykimura.workers.dev';

async function apiFetch<T>(path: string): Promise<T> {
	const token = await getValidToken();
	if (!token) throw new Error('Not authenticated');

	const res = await fetch(`${API_BASE}${path}`, {
		headers: { Authorization: `Bearer ${token}` }
	});

	if (!res.ok) {
		if (res.status === 401) throw new Error('AUTH_EXPIRED');
		throw new Error(`API error ${res.status}: ${await res.text()}`);
	}

	return res.json();
}

export async function fetchSleepForMonth(
	year: number,
	month: number
): Promise<Map<string, DaySleepData>> {
	// Fitbit list API: fetch up to 100 records after the start of month
	const startDate = `${year}-${String(month).padStart(2, '0')}-01`;
	const endYear = month === 12 ? year + 1 : year;
	const endMonth = month === 12 ? 1 : month + 1;
	const endDate = `${endYear}-${String(endMonth).padStart(2, '0')}-01`;

	const url = `/1.2/user/-/sleep/list.json?afterDate=${startDate}&beforeDate=${endDate}&sort=asc&offset=0&limit=100`;
	const data = await apiFetch<{ sleep: SleepLog[] }>(url);

	const byDate = new Map<string, DaySleepData>();

	for (const log of data.sleep) {
		const date = log.dateOfSleep;
		if (!byDate.has(date)) {
			byDate.set(date, { date, logs: [], mainSleep: null });
		}
		const entry = byDate.get(date)!;
		entry.logs.push(log);
		if (log.isMainSleep) entry.mainSleep = log;
	}

	// For days with logs but no isMainSleep=true, use the longest
	for (const entry of byDate.values()) {
		if (!entry.mainSleep && entry.logs.length > 0) {
			entry.mainSleep = entry.logs.reduce((a, b) =>
				a.duration > b.duration ? a : b
			);
		}
	}

	return byDate;
}

export function totalMinutes(log: SleepLog): { deep: number; light: number; rem: number; wake: number } {
	if (log.type === 'stages' && log.levels?.summary) {
		const s = log.levels.summary;
		return {
			deep: s.deep?.minutes ?? 0,
			light: s.light?.minutes ?? 0,
			rem: s.rem?.minutes ?? 0,
			wake: s.wake?.minutes ?? 0
		};
	}
	// classic sleep (no stages) — fall back to asleep/awake split
	return {
		deep: 0,
		light: Math.round(log.minutesAsleep * 0.6),
		rem: Math.round(log.minutesAsleep * 0.2),
		wake: log.minutesAwake ?? 0
	};
}
