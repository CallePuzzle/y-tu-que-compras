# y tu qué compras ?

turso dev --db-file dev.db
bunx prisma generate
turso db shell http://127.0.0.1:8080 < prisma/migrations/0001_initial.sql
