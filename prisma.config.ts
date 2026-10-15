import { defineConfig } from 'prisma/config';

// Sin DATABASE_URL no declaramos `datasource`: así `prisma generate` (que corre
// en el postinstall, donde puede no haber variables de entorno) sigue
// funcionando, y los comandos que sí la necesitan (`db push`, migraciones)
// fallan con el mensaje de Prisma en lugar de con un error opaco.
export default defineConfig({
	schema: 'prisma/schema.prisma',
	...(process.env.DATABASE_URL ? { datasource: { url: process.env.DATABASE_URL } } : {})
});
