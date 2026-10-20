-- La pertenencia a un contexto es unica: `member/add` del plugin no
-- comprueba duplicados y sin esto un admin podria anadir dos veces al
-- mismo usuario (saldria duplicado en los listados de miembros).
CREATE UNIQUE INDEX "member_contextType_contextId_userId_key" ON "member"("contextType", "contextId", "userId");
