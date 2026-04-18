import { useCallback } from "react";
import { getLiveMenuPageDefinition, normalizeRoleIdList } from "../utils/projectHelpers";

export function useLiveMenuAccess({
  canViewArea,
  currentUserRoleIds,
}) {
  const canAccessLiveMenuItem = useCallback(
    (item) => {
      const type = String(item?.type || "").toLowerCase();
      const areaKey =
        type === "data"
          ? "database"
          : type === "page"
          ? String(getLiveMenuPageDefinition(item?.pageKey)?.areaKey || "").trim()
          : "project";
      const areaAllowed = areaKey ? canViewArea(areaKey) : false;
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
    [canViewArea, currentUserRoleIds]
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
