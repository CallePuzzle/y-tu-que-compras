import prisma from './prisma.js';
import { apiError } from './api-error.js';

// Pertenencia a la familia en la API pública /api/v1 (épica #260, tarea #269).
//
// La API NO usa la familia activa de la cookie (`requireActiveFamily`): la
// familia sale SIEMPRE del `familyId` de la URL, y antes de tocar ningún dato
// se comprueba que el usuario del token sea miembro de ella en la tabla
// `member` (la misma verdad que usa `resolveActiveFamily` para la web).

/** Código estable del 403 de pertenencia. */
const FORBIDDEN_CODE = 'forbidden';

/** Mensaje del 403: el mismo exista o no la familia. */
const FORBIDDEN_MESSAGE = 'Not a member of this family';

/** ¿Es `userId` miembro de la familia `familyId`? */
export async function isFamilyMember(userId: string, familyId: string): Promise<boolean> {
	const membership = await prisma.member.findUnique({
		where: {
			contextType_contextId_userId: { contextType: 'organization', contextId: familyId, userId }
		},
		select: { id: true }
	});
	return membership !== null;
}

/**
 * Corte de pertenencia de los endpoints `/api/v1/families/:familyId/...`:
 * devuelve `null` si el usuario es miembro, o la 403 con el envelope de
 * `apiError` lista para devolver (`if (forbidden) return forbidden;`).
 *
 * Una familia inexistente responde también 403 (y no 404): sin pertenencia no
 * se revela si el id existe, igual que la web trata una cookie con un id
 * ajeno. El 404 queda para recursos (listas, items) que no son de la familia
 * de la URL, una vez comprobada la pertenencia.
 */
export async function requireApiFamilyMember(
	userId: string,
	familyId: string
): Promise<Response | null> {
	if (await isFamilyMember(userId, familyId)) {
		return null;
	}
	return apiError(403, FORBIDDEN_CODE, FORBIDDEN_MESSAGE);
}
