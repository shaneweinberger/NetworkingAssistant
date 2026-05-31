const PASSWORD = import.meta.env.VITE_APP_PASSWORD || 'password';
const AUTH_KEY = 'app_authenticated';

export function authenticate(password: string): boolean {
  if (password === PASSWORD) {
    localStorage.setItem(AUTH_KEY, 'true');
    return true;
  }
  return false;
}

export function isAuthenticated(): boolean {
  return localStorage.getItem(AUTH_KEY) === 'true';
}

export function logout(): void {
  localStorage.removeItem(AUTH_KEY);
}
