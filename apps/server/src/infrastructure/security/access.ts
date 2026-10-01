/**
 * The org permission policy (core/domain/permissions.ts) loaded into
 * `accesscontrol`, and the one function everything asks: may this member do
 * this to this record?
 *
 * Checks never throw — `tryCan` fails closed — and ownership (`:own`) is
 * enforced against the record passed in via its `ownerId`.
 */

import {
  type Action,
  GATES,
  GRANTS,
  INHERITS,
  type OrgRole,
  type Possession,
  type Resource,
  ROLES,
} from "@tino/core/domain/permissions";
import { AccessControl } from "accesscontrol";

export interface AccessSubject {
  memberId: string;
  role: OrgRole;
  status: string;
  orgStatus: string;
}

export interface AccessDecision {
  granted: boolean;
  /** Keep only the fields this role may see. */
  filter<T extends object>(data: T): Partial<T>;
}

export interface Access {
  check(
    subject: AccessSubject,
    action: Action,
    resource: Resource,
    possession: Possession,
    record?: object,
  ): AccessDecision;
}

export function createAccess(): Access {
  const ac = new AccessControl({}, { policy: { ownerField: "ownerId" } });
  for (const role of ROLES) {
    const chain = ac.grant(role);
    const parent = INHERITS[role];
    if (parent) chain.extend(parent);
    for (const g of GRANTS.filter((x) => x.role === role)) chain.action(g.action, g.resource, g.attributes);
  }
  for (const gate of GATES) ac.require(gate);
  ac.lock();

  const denied: AccessDecision = { granted: false, filter: () => ({}) };

  return {
    check(subject, action, resource, possession, record) {
      const context: Record<string, unknown> = {
        user: { id: subject.memberId },
        member: { status: subject.status },
        org: { status: subject.orgStatus },
      };
      if (record) context[resource] = record;
      try {
        const permission = ac.can(subject.role, context).do(`${action}:${possession}`, resource);
        if (!permission.granted) return denied;
        return { granted: true, filter: <T extends object>(data: T) => permission.filter(data) as Partial<T> };
      } catch {
        return denied;
      }
    },
  };
}
