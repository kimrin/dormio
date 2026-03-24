const STORAGE_TOKEN_KEY = 'dormio_token';
const STORAGE_VERIFIER_KEY = 'dormio_pkce_verifier';
const STORAGE_CLIENT_ID_KEY = 'dormio_client_id';

function getRedirectUri(): string {
	if (typeof window === 'undefined') return '';
	const base = import.meta.env.BASE_URL.replace(/\/$/, '');
	return `${window.location.origin}${base}/callback/`;
}

function generateRandomString(length: number): string {
	const array = new Uint8Array(length);
	crypto.getRandomValues(array);
	return Array.from(array, (b) => b.toString(16).padStart(2, '0')).join('').slice(0, length);
}

async function sha256(plain: string): Promise<ArrayBuffer> {
	const encoder = new TextEncoder();
	const data = encoder.encode(plain);
	return crypto.subtle.digest('SHA-256', data);
}

function base64URLEncode(buffer: ArrayBuffer): string {
	const bytes = new Uint8Array(buffer);
	let str = '';
	for (const b of bytes) str += String.fromCharCode(b);
	return btoa(str).replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
}

export function getClientId(): string {
	return localStorage.getItem(STORAGE_CLIENT_ID_KEY) ?? '';
}

export function setClientId(id: string): void {
	localStorage.setItem(STORAGE_CLIENT_ID_KEY, id);
}

export async function startOAuthFlow(): Promise<void> {
	const clientId = getClientId();
	if (!clientId) throw new Error('Client ID not set');

	const verifier = generateRandomString(64);
	const challenge = base64URLEncode(await sha256(verifier));
	localStorage.setItem(STORAGE_VERIFIER_KEY, verifier);

	const params = new URLSearchParams({
		client_id: clientId,
		response_type: 'code',
		code_challenge: challenge,
		code_challenge_method: 'S256',
		scope: 'sleep',
		redirect_uri: getRedirectUri()
	});

	window.location.href = `https://www.fitbit.com/oauth2/authorize?${params}`;
}

export async function handleCallback(code: string): Promise<void> {
	const clientId = getClientId();
	const verifier = localStorage.getItem(STORAGE_VERIFIER_KEY);
	if (!clientId || !verifier) throw new Error('Missing OAuth state');

	const res = await fetch('https://api.fitbit.com/oauth2/token', {
		method: 'POST',
		headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
		body: new URLSearchParams({
			client_id: clientId,
			grant_type: 'authorization_code',
			code,
			code_verifier: verifier,
			redirect_uri: getRedirectUri()
		})
	});

	if (!res.ok) {
		const err = await res.text();
		throw new Error(`Token exchange failed: ${err}`);
	}

	const data = await res.json();
	const token: import('./types.js').TokenData = {
		access_token: data.access_token,
		refresh_token: data.refresh_token,
		expires_at: Date.now() + data.expires_in * 1000,
		user_id: data.user_id,
		scope: data.scope
	};

	localStorage.setItem(STORAGE_TOKEN_KEY, JSON.stringify(token));
	localStorage.removeItem(STORAGE_VERIFIER_KEY);
}

export function getToken(): import('./types.js').TokenData | null {
	const raw = localStorage.getItem(STORAGE_TOKEN_KEY);
	if (!raw) return null;
	try {
		return JSON.parse(raw);
	} catch {
		return null;
	}
}

export async function refreshAccessToken(): Promise<import('./types.js').TokenData | null> {
	const token = getToken();
	const clientId = getClientId();
	if (!token || !clientId) return null;

	const res = await fetch('https://api.fitbit.com/oauth2/token', {
		method: 'POST',
		headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
		body: new URLSearchParams({
			client_id: clientId,
			grant_type: 'refresh_token',
			refresh_token: token.refresh_token
		})
	});

	if (!res.ok) {
		localStorage.removeItem(STORAGE_TOKEN_KEY);
		return null;
	}

	const data = await res.json();
	const newToken: import('./types.js').TokenData = {
		access_token: data.access_token,
		refresh_token: data.refresh_token,
		expires_at: Date.now() + data.expires_in * 1000,
		user_id: data.user_id,
		scope: data.scope
	};

	localStorage.setItem(STORAGE_TOKEN_KEY, JSON.stringify(newToken));
	return newToken;
}

export async function getValidToken(): Promise<string | null> {
	let token = getToken();
	if (!token) return null;
	if (Date.now() > token.expires_at - 60_000) {
		token = await refreshAccessToken();
	}
	return token?.access_token ?? null;
}

export function logout(): void {
	localStorage.removeItem(STORAGE_TOKEN_KEY);
}
