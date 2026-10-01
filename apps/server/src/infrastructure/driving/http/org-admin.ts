/**
 * The org plugin's operations, as the routes use them. Each goes through
 * better-auth's own endpoint, so its checks apply — who may invite, who may
 * change a role, the last owner can't be demoted, an invitation is only
 * accepted by the address it was sent to — and its errors come back as
 * `OrgAdminError` with a status and a message fit to show.
 */
import type { Auth } from "better-auth";

export class OrgAdminError extends Error {
  constructor(
    readonly status: 400 | 401 | 403 | 404 | 409,
    message: string,
  ) {
    super(message);
    this.name = "OrgAdminError";
  }
}

export interface OrgAdmin {
  /** Create an org with `userId` as its owner (the plugin's create-org checks apply). */
  createOrg(input: { name: string; slug: string; userId: string }): Promise<{ id: string; slug: string; name: string }>;
  /** Add an account to an org directly — joining by domain. */
  addMember(input: { orgId: string; userId: string; role: "admin" | "member" }): Promise<void>;
  invite(headers: Headers, input: { orgId: string; email: string; role: "admin" | "member" }): Promise<void>;
  acceptInvitation(headers: Headers, invitationId: string): Promise<void>;
  cancelInvitation(headers: Headers, invitationId: string): Promise<void>;
  updateRole(headers: Headers, input: { orgId: string; memberId: string; role: "admin" | "member" }): Promise<void>;
}

// biome-ignore lint/suspicious/noExplicitAny: plugin endpoints aren't on the base Auth type
type Endpoint = (args: any) => Promise<any>;
interface OrgApi {
  createOrganization: Endpoint;
  addMember: Endpoint;
  createInvitation: Endpoint;
  acceptInvitation: Endpoint;
  cancelInvitation: Endpoint;
  updateMemberRole: Endpoint;
}

async function call<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    const e = err as { status?: string | number; statusCode?: number; body?: { message?: string }; message?: string };
    const code = typeof e.statusCode === "number" ? e.statusCode : typeof e.status === "number" ? e.status : 0;
    const named: Record<string, OrgAdminError["status"]> = {
      BAD_REQUEST: 400,
      UNAUTHORIZED: 401,
      FORBIDDEN: 403,
      NOT_FOUND: 404,
      CONFLICT: 409,
    };
    const status = (code as OrgAdminError["status"]) || named[String(e.status)] || 0;
    if (status) throw new OrgAdminError(status, e.body?.message ?? e.message ?? "request refused");
    throw err;
  }
}

export function createOrgAdmin(auth: Auth): OrgAdmin {
  const api = auth.api as unknown as OrgApi;
  return {
    async createOrg({ name, slug, userId }) {
      const org = await call(() => api.createOrganization({ body: { name, slug, userId } }));
      return { id: org.id, slug: org.slug, name: org.name };
    },
    async addMember({ orgId, userId, role }) {
      await call(() => api.addMember({ body: { organizationId: orgId, userId, role } }));
    },
    async invite(headers, { orgId, email, role }) {
      await call(() => api.createInvitation({ headers, body: { organizationId: orgId, email, role, resend: true } }));
    },
    async acceptInvitation(headers, invitationId) {
      await call(() => api.acceptInvitation({ headers, body: { invitationId } }));
    },
    async cancelInvitation(headers, invitationId) {
      await call(() => api.cancelInvitation({ headers, body: { invitationId } }));
    },
    async updateRole(headers, { orgId, memberId, role }) {
      await call(() => api.updateMemberRole({ headers, body: { organizationId: orgId, memberId, role } }));
    },
  };
}
