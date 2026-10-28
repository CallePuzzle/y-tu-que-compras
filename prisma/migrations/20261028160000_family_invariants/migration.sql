-- Invariantes de familia en la BD (issue #104).
--
-- Los hooks del plugin de tenancy (`src/lib/server/tenancy.ts`) comprueban el
-- último admin y los topes «contando y luego actuando», y el plugin escribe
-- DESPUÉS y sin transacción: dos peticiones simultáneas ven el mismo recuento
-- y las dos pasan. Estos triggers son la garantía real; los hooks siguen
-- delante para dar el error de formulario en el camino normal.
--
-- Cada comprobación toma primero un advisory lock de transacción (por familia
-- y/o por usuario): la segunda petición espera a que la primera confirme y,
-- en READ COMMITTED, su recuento ya ve el cambio de la otra. Orden de bloqueo
-- siempre familia → usuario, así que no hay interbloqueos.
--
-- Los mensajes son los mismos que los de `tenancy.ts` (`FAMILY_LIMIT_MESSAGE`,
-- `FAMILY_MEMBERS_LIMIT_MESSAGE`, `LAST_FAMILY_ADMIN_MESSAGE`) y los topes los
-- de `MAX_FAMILIES_PER_USER` y `MAX_FAMILY_MEMBERS`: cambiar los dos a la vez.

-- Topes al dar de alta a un miembro: 20 por familia, 5 familias por usuario.
CREATE FUNCTION "member_enforce_family_limits"() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
	IF NEW."contextType" <> 'organization' THEN
		RETURN NEW;
	END IF;

	PERFORM pg_advisory_xact_lock(hashtext('family:' || NEW."contextId"));
	IF (
		SELECT count(*) FROM "member"
		WHERE "contextType" = 'organization' AND "contextId" = NEW."contextId"
	) >= 20 THEN
		RAISE EXCEPTION 'Family members limit reached: max 20.';
	END IF;

	PERFORM pg_advisory_xact_lock(hashtext('user-families:' || NEW."userId"));
	IF (
		SELECT count(*) FROM "member"
		WHERE "contextType" = 'organization' AND "userId" = NEW."userId"
	) >= 5 THEN
		RAISE EXCEPTION 'Family limit reached: max 5.';
	END IF;

	RETURN NEW;
END;
$$;

CREATE TRIGGER "member_family_limits"
BEFORE INSERT ON "member"
FOR EACH ROW EXECUTE FUNCTION "member_enforce_family_limits"();

-- Nadie quita (expulsar, abandonar) ni degrada al último admin de una familia.
--
-- Fuera quedan los cambios en cascada de una FK (`pg_trigger_depth() > 1`):
-- borrar la familia borra antes sus roles, y el `ON DELETE SET NULL` de
-- `member.roleId` deja a los admins sin rol; borrar una cuenta se lleva sus
-- membresías. En los dos casos lo que desaparece es la familia o el usuario,
-- no la administración de una familia que sigue viva.
CREATE FUNCTION "member_protect_last_family_admin"() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
	IF OLD."contextType" <> 'organization' OR OLD."roleId" IS NULL OR pg_trigger_depth() > 1 THEN
		RETURN COALESCE(NEW, OLD);
	END IF;
	IF TG_OP = 'UPDATE' AND NEW."roleId" IS NOT DISTINCT FROM OLD."roleId" THEN
		RETURN NEW;
	END IF;
	IF NOT EXISTS (
		SELECT 1 FROM "role"
		WHERE "id" = OLD."roleId" AND "name" = 'admin'
			AND "contextType" = 'organization' AND "contextId" = OLD."contextId"
	) THEN
		RETURN COALESCE(NEW, OLD);
	END IF;

	PERFORM pg_advisory_xact_lock(hashtext('family:' || OLD."contextId"));
	IF NOT EXISTS (
		SELECT 1 FROM "member"
		WHERE "contextType" = 'organization' AND "contextId" = OLD."contextId"
			AND "roleId" = OLD."roleId" AND "id" <> OLD."id"
	) THEN
		RAISE EXCEPTION 'Cannot remove the last admin of the family';
	END IF;

	RETURN COALESCE(NEW, OLD);
END;
$$;

CREATE TRIGGER "member_last_family_admin"
BEFORE DELETE OR UPDATE OF "roleId" ON "member"
FOR EACH ROW EXECUTE FUNCTION "member_protect_last_family_admin"();
