import { useCallback } from "react";
import { normalizeRoleIdList } from "../utils/projectHelpers";

export function useLiveMenuAccess({
  canViewDataPages,
  canViewScreenPages,
  currentUserRoleIds,
}) {
  const canAccessLiveMenuItem = useCallback(
    (item) => {
      const areaAllowed =
        String(item?.type || "").toLowerCase() === "data"
          ? canViewDataPages
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
    [canViewDataPages, canViewScreenPages, currentUserRoleIds]
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
