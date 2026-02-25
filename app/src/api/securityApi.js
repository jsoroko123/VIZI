import { requestJson } from "./http";

export function listSecurityRoles() {
  return requestJson("/api/security/roles");
}
