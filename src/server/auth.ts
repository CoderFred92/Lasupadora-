import type { Request, Response, NextFunction } from 'express';
import { db, verifySessionToken } from './db.ts';

export interface PermissionSet {
  view: boolean;
  create: boolean;
  edit: boolean;
  approve: boolean;
  delete: boolean;
  export: boolean;
  manage: boolean;
}

export interface AuthContext {
  memberId: string;
  membershipNumber: string;
  fullName: string;
  email: string;
  branchId: string;
  subdivisionId: string;
  roles: {
    roleId: string;
    slug: string;
    displayName: string;
    scopeLevel: 'national' | 'branch' | 'subdivision' | 'self' | 'public';
    branchId: string | null;
    subdivisionId: string | null;
  }[];
  permissions: Record<string, PermissionSet>;
  isNationalScope: boolean;
  scopedBranchIds: string[];
  scopedSubdivisionIds: string[];
}

export function parseCookies(header: string | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  if (!header) return out;
  for (const pair of header.split(';')) {
    const idx = pair.indexOf('=');
    if (idx > -1) {
      const k = pair.slice(0, idx).trim();
      const v = pair.slice(idx + 1).trim();
      out[k] = decodeURIComponent(v);
    }
  }
  return out;
}

export function loadAuthContext(memberId: string): AuthContext | null {
  const member = db
    .prepare(`SELECT id, membership_number, full_name, email, branch_id, subdivision_id, membership_status FROM members WHERE id = ?`)
    .get(memberId) as {
      id: string;
      membership_number: string;
      full_name: string;
      email: string;
      branch_id: string;
      subdivision_id: string;
      membership_status: string;
    } | undefined;

  if (!member || member.membership_status === 'Suspended' || member.membership_status === 'Deceased') {
    return null;
  }

  const roleRows = db
    .prepare(
      `SELECT r.id AS roleId, r.slug, r.display_name AS displayName, r.scope_level AS scopeLevel, mr.branch_id AS branchId, mr.subdivision_id AS subdivisionId
       FROM member_roles mr
       JOIN roles r ON r.id = mr.role_id
       WHERE mr.member_id = ? AND mr.is_active = 1`
    )
    .all(memberId) as AuthContext['roles'];

  const permRows = db
    .prepare(
      `SELECT rp.module,
        MAX(rp.can_view) AS can_view,
        MAX(rp.can_create) AS can_create,
        MAX(rp.can_edit) AS can_edit,
        MAX(rp.can_approve) AS can_approve,
        MAX(rp.can_delete) AS can_delete,
        MAX(rp.can_export) AS can_export,
        MAX(rp.can_manage) AS can_manage
       FROM member_roles mr
       JOIN role_permissions rp ON rp.role_id = mr.role_id
       WHERE mr.member_id = ? AND mr.is_active = 1
       GROUP BY rp.module`
    )
    .all(memberId) as {
      module: string;
      can_view: number;
      can_create: number;
      can_edit: number;
      can_approve: number;
      can_delete: number;
      can_export: number;
      can_manage: number;
    }[];

  const permissions: Record<string, PermissionSet> = {};
  for (const p of permRows) {
    permissions[p.module] = {
      view: Boolean(p.can_view),
      create: Boolean(p.can_create),
      edit: Boolean(p.can_edit),
      approve: Boolean(p.can_approve),
      delete: Boolean(p.can_delete),
      export: Boolean(p.can_export),
      manage: Boolean(p.can_manage),
    };
  }

  const isNationalScope = roleRows.some((r) => r.scopeLevel === 'national');
  const scopedBranchIds = Array.from(new Set(roleRows.filter((r) => r.scopeLevel === 'branch' && r.branchId).map((r) => r.branchId as string)));
  const scopedSubdivisionIds = Array.from(new Set(roleRows.filter((r) => r.scopeLevel === 'subdivision' && r.subdivisionId).map((r) => r.subdivisionId as string)));

  return {
    memberId: member.id,
    membershipNumber: member.membership_number,
    fullName: member.full_name,
    email: member.email,
    branchId: member.branch_id,
    subdivisionId: member.subdivision_id,
    roles: roleRows,
    permissions,
    isNationalScope,
    scopedBranchIds,
    scopedSubdivisionIds,
  };
}

export interface AuthedRequest extends Request {
  auth?: AuthContext;
}

export function attachAuth(req: AuthedRequest, _res: Response, next: NextFunction) {
  const authHeader = req.headers.authorization;
  const bearerToken = authHeader && authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : '';
  const cookies = parseCookies(req.headers.cookie);
  const token = bearerToken || cookies.lasupadora_session;
  if (token) {
    const parsed = verifySessionToken(token);
    if (parsed) {
      const ctx = loadAuthContext(parsed.memberId);
      if (ctx) req.auth = ctx;
    }
  }
  next();
}

export function requireAuth(req: AuthedRequest, res: Response, next: NextFunction) {
  if (!req.auth) {
    res.status(401).json({ error: 'Authentication required. Please sign in.' });
    return;
  }
  next();
}

export function requirePermission(moduleName: string, action: keyof PermissionSet) {
  return (req: AuthedRequest, res: Response, next: NextFunction) => {
    if (!req.auth) {
      res.status(401).json({ error: 'Authentication required.' });
      return;
    }
    const modPerms = req.auth.permissions[moduleName];
    if (!modPerms || !modPerms[action]) {
      res.status(403).json({
        error: `Access denied: your current role does not hold '${action}' permission for '${moduleName}'.`,
      });
      return;
    }
    next();
  };
}

export function canAccessScope(auth: AuthContext, branchId?: string | null, subdivisionId?: string | null): boolean {
  if (auth.isNationalScope) return true;
  if (branchId && auth.scopedBranchIds.includes(branchId)) return true;
  if (subdivisionId && auth.scopedSubdivisionIds.includes(subdivisionId)) return true;
  return false;
}
