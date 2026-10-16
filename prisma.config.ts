import 'dotenv/config';
import { defineConfig } from 'prisma/config';

// `dotenv/config` carga el .env (si existe) porque ni bun ni el CLI de Prisma 7
// lo inyectan por su cuenta: sin esto, `bunx prisma ...` y los scripts de
// package.json no ven DATABASE_URL. Si no hay .env (postinstall, CI) no hace
// nada, y nunca sobreescribe variables ya presentes en el entorno.
//
// Sin DATABASE_URL no declaramos `datasource`: así `prisma generate` (que corre
// en el postinstall, donde puede no haber variables de entorno) sigue
// funcionando, y los comandos que sí la necesitan (`db push`, migraciones)
// fallan con el mensaje de Prisma en lugar de con un error opaco.
export default defineConfig({
	schema: 'prisma/schema.prisma',
	...(process.env.DATABASE_URL ? { datasource: { url: process.env.DATABASE_URL } } : {})
});
