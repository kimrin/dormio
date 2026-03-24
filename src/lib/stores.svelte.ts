import { getToken, getClientId } from './auth.js';

export const authState = $state({
	isAuthenticated: false,
	clientId: ''
});

export function initAuth() {
	if (typeof window === 'undefined') return;
	authState.isAuthenticated = !!getToken();
	authState.clientId = getClientId();
}
