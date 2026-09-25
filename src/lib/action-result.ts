import type { ZodError } from "zod";
import type { FriendlyError } from "@/lib/db/errors";

export type ActionResult<T = null> = { ok: true; data: T } | { ok: false; error: string; field?: string };

export function actionError(error: string, field?: string): ActionResult<never> {
  return field ? { ok: false, error, field } : { ok: false, error };
}

export function fromFriendly(error: FriendlyError): ActionResult<never> {
  return actionError(error.message, error.field);
}

export function fromZod(error: ZodError): ActionResult<never> {
  const issue = error.issues[0];
  const field = issue?.path[0];
  return actionError(issue?.message ?? "Please check the form and try again.", field ? String(field) : undefined);
}
