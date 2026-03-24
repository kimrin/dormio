export interface SleepLevel {
	dateTime: string;
	level: 'deep' | 'light' | 'rem' | 'wake';
	seconds: number;
}

export interface SleepLevelSummary {
	deep: { count: number; minutes: number; thirtyDayAvgMinutes: number };
	light: { count: number; minutes: number; thirtyDayAvgMinutes: number };
	rem: { count: number; minutes: number; thirtyDayAvgMinutes: number };
	wake: { count: number; minutes: number; thirtyDayAvgMinutes: number };
}

export interface SleepLog {
	dateOfSleep: string;
	duration: number; // milliseconds
	efficiency: number;
	endTime: string;
	infoCode: number;
	isMainSleep: boolean;
	levels: {
		data: SleepLevel[];
		shortData: SleepLevel[];
		summary: SleepLevelSummary;
	};
	logId: number;
	minutesAfterWakeup: number;
	minutesAsleep: number;
	minutesAwake: number;
	minutesToFallAsleep: number;
	startTime: string;
	timeInBed: number;
	type: 'stages' | 'classic';
}

export interface SleepResponse {
	sleep: SleepLog[];
	summary: {
		stages: SleepLevelSummary;
		totalMinutesAsleep: number;
		totalSleepRecords: number;
		totalTimeInBed: number;
	};
}

export interface TokenData {
	access_token: string;
	refresh_token: string;
	expires_at: number; // unix ms
	user_id: string;
	scope: string;
}

export interface DaySleepData {
	date: string; // YYYY-MM-DD
	logs: SleepLog[];
	mainSleep: SleepLog | null;
}
