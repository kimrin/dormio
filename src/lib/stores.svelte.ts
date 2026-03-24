import { getToken } from './auth.js';

export const authState = $state({
	isAuthenticated: false
});

export function initAuth() {
	if (typeof window === 'undefined') return;
	authState.isAuthenticated = !!getToken();
}
