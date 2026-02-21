import { useCallback } from "react";
import { normalizeRoleIdList } from "../utils/projectHelpers";

export function useLiveMenuAccess({
  canViewDataPages,
  canViewScreenPages,
  canViewReportsPages,
  currentUserRoleIds,
}) {
  const canAccessLiveMenuItem = useCallback(
    (item) => {
      const type = String(item?.type || "").toLowerCase();
      const areaAllowed =
        type === "data"
          ? canViewDataPages
          : type === "reports"
          ? canViewReportsPages
          : canViewScreenPages;
      if (!areaAllowed) return false;
      const restricted = Boolean(item?.restricted);
      if (!restricted) return true;
      const allowedRoleIds = normalizeRoleIdList(item?.allowedRoleIds);
      if (!allowedRoleIds.length) return false;
      for (const id of allowedRoleIds) {
        if (currentUserRoleIds.has(id)) return true;
      }
      return false;
    },
    [canViewDataPages, canViewReportsPages, canViewScreenPages, currentUserRoleIds]
  );

  const isLiveMenuItemRoleRestricted = useCallback(
    (item) => {
      const restricted = Boolean(item?.restricted);
      if (!restricted) return false;
      const allowedRoleIds = normalizeRoleIdList(item?.allowedRoleIds);
      if (!allowedRoleIds.length) return true;
      for (const id of allowedRoleIds) {
        if (currentUserRoleIds.has(id)) return false;
      }
      return true;
    },
    [currentUserRoleIds]
  );

  return { canAccessLiveMenuItem, isLiveMenuItemRoleRestricted };
}
