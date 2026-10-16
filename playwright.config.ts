import { defineConfig } from '@playwright/test';

export default defineConfig({
	webServer: {
		command: 'bun run build && bun run preview',
		port: 4173,
		reuseExistingServer: !process.env.CI,
		// El handle de auth corta el arranque sin baseURL y secreto, y better-auth lee
		// el data model de Prisma al inicializarse (sin conectar). Son valores solo
		// para el e2e: sin cookie de sesión no se toca la base de datos.
		env: {
			BETTER_AUTH_URL: 'http://localhost:4173',
			BETTER_AUTH_SECRET: 'e2e-only-secret-not-used-anywhere-else-0000',
			DATABASE_URL: 'postgresql://e2e-only:not-a-real-db@localhost:5432/e2e'
		}
	},
	testMatch: '**/*.e2e.{ts,js}'
});
