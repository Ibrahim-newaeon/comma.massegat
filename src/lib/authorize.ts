// src/lib/authorize.ts
// SINGLE enforcement point for RBAC. UI hiding is cosmetic only.

export type Role = 'member' | 'moderator' | 'admin';

export type Action =
  | 'channel:read'
  | 'channel:write'
  | 'channel:create'
  | 'group:create'
  | 'dm:create'
  | 'file:upload'
  | 'call:join'
  | 'message:delete:any'
  | 'user:create'
  | 'user:deactivate'
  | 'user:reset_password'
  | 'user:change_role'
  | 'audit:read'
  | 'config:retention';

const MATRIX: Record<Action, Role[]> = {
  'channel:read': ['member', 'moderator', 'admin'],
  'channel:write': ['member', 'moderator', 'admin'],
  'dm:create': ['member', 'moderator', 'admin'],
  'file:upload': ['member', 'moderator', 'admin'],
  'call:join': ['member', 'moderator', 'admin'],
  // A PUBLIC channel is org-wide structure — who gets to add one to everyone's
  // sidebar is a moderation decision.
  'channel:create': ['moderator', 'admin'],
  // A PRIVATE group is three people arranging a project. Requiring a moderator
  // for that just pushes the conversation to WhatsApp, which is worse for
  // everyone including the moderator.
  'group:create': ['member', 'moderator', 'admin'],
  'message:delete:any': ['moderator', 'admin'],
  'user:create': ['admin'],
  'user:deactivate': ['admin'],
  'user:reset_password': ['admin'],
  'user:change_role': ['admin'],
  'audit:read': ['admin'],
  'config:retention': ['admin'],
};

export type Actor = { id: string; role: string; isActive: boolean };

export function can(actor: Actor | null, action: Action): boolean {
  if (!actor || !actor.isActive) return false;
  const allowed = MATRIX[action];
  if (!allowed) return false;
  return allowed.includes(actor.role as Role);
}

export class ForbiddenError extends Error {
  constructor(action: Action) {
    super(`Forbidden: ${action}`);
    this.name = 'ForbiddenError';
  }
}

export function authorize(actor: Actor | null, action: Action): asserts actor is Actor {
  if (!can(actor, action)) throw new ForbiddenError(action);
}
