import { defineConfig, devices } from '@playwright/test';
import { loadTestEnv } from './e2e/helpers/env';

const testEnv = loadTestEnv();
const baseURL = testEnv.BETTER_AUTH_URL ?? 'http://localhost:4174';

// Las variables de .env.test deben llegar al globalSetup (prisma migrate
// deploy) y al proceso del webServer; process.env tiene prioridad sobre los
// .env que cargan Vite/bun, así que el dev server usa la BD de test y no la
// de desarrollo.
Object.assign(process.env, testEnv);

export default defineConfig({
	// Los e2e viven junto a las rutas que prueban (`*.e2e.ts`), como el resto
	// de tests del repo; los helpers compartidos, en `e2e/`.
	testMatch: '**/*.e2e.{ts,js}',
	// BD de test compartida entre tests: sin paralelismo (cada spec la trunca
	// al empezar).
	fullyParallel: false,
	workers: 1,
	forbidOnly: !!process.env.CI,
	retries: process.env.CI ? 1 : 0,
	reporter: 'list',
	// Aplica las migraciones sobre la BD de test antes de lanzar los tests.
	globalSetup: './e2e/global-setup.ts',
	use: {
		baseURL,
		trace: 'retain-on-failure'
	},
	projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
	webServer: {
		// Dev server y no preview: en desarrollo `sendEmail` no abre conexión
		// (los emails quedan capturados en el log) y better-auth no activa el
		// rate limit, justo lo que el flujo OTP de los tests necesita.
		command: 'bun run dev -- --port 4174 --strictPort',
		// La URL de readiness no puede ser una ruta con loads de servidor:
		// Playwright arranca el servidor ANTES del globalSetup (migraciones) y
		// con la BD recién creada fallarían. robots.txt es estático y pública.
		url: `${baseURL}/robots.txt`,
		reuseExistingServer: !process.env.CI,
		timeout: 120_000,
		env: testEnv
	}
});
