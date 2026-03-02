import { useEffect, useMemo, useState } from "react";
import { toastError, toastSuccess } from "../utils/toast";

const AREA_KEYS = [
  "project",
  "plc",
  "opc",
  "server",
  "tags",
  "database",
  "reports",
  "ai",
  "security",
  "help",
];

function titleCase(value) {
  const text = String(value || "").trim();
  if (!text) return "";
  return text.charAt(0).toUpperCase() + text.slice(1);
}

function emptyPermissions() {
  const out = {};
  for (const key of AREA_KEYS) {
    out[key] = { can_view: false, can_edit: false };
  }
  return out;
}

function normalizeRole(role) {
  const permissions = emptyPermissions();
  const src = role?.permissions && typeof role.permissions === "object" ? role.permissions : {};
  for (const key of AREA_KEYS) {
    const row = src[key] && typeof src[key] === "object" ? src[key] : {};
    const canEdit = Boolean(row.can_edit);
    const canView = Boolean(row.can_view) || canEdit;
    permissions[key] = { can_view: canView, can_edit: canEdit };
  }
  return {
    id: role?.id ?? null,
    name: String(role?.name || ""),
    description: String(role?.description || ""),
    is_system: Boolean(role?.is_system),
    permissions,
  };
}

function normalizeUser(user) {
  return {
    id: user?.id ?? null,
    username: String(user?.username || ""),
    display_name: String(user?.display_name || ""),
    disabled: Boolean(user?.disabled),
    roles: Array.isArray(user?.roles) ? user.roles.map((r) => ({ id: Number(r.id), name: String(r.name || "") })) : [],
  };
}

export default function SecurityManager({ canManage, currentUserId }) {
  const [loading, setLoading] = useState(false);
  const [roles, setRoles] = useState([]);
  const [users, setUsers] = useState([]);
  const [selectedRoleId, setSelectedRoleId] = useState("new");
  const [selectedUserId, setSelectedUserId] = useState("new");
  const [roleDraft, setRoleDraft] = useState(() => normalizeRole({}));
  const [userDraft, setUserDraft] = useState({
    id: null,
    username: "",
    display_name: "",
    password: "",
    disabled: false,
    role_ids: [],
  });

  const roleOptions = useMemo(
    () => roles.map((role) => ({ id: Number(role.id), name: String(role.name || "") })),
    [roles]
  );

  useEffect(() => {
    if (!canManage) return;
    let mounted = true;
    async function load() {
      setLoading(true);
      try {
        const [rolesRes, usersRes] = await Promise.all([
          fetch("/api/security/roles"),
          fetch("/api/security/users"),
        ]);
        const rolesJson = await rolesRes.json().catch(() => ({}));
        const usersJson = await usersRes.json().catch(() => ({}));
        if (!rolesRes.ok) throw new Error(rolesJson?.error || "Failed to load roles.");
        if (!usersRes.ok) throw new Error(usersJson?.error || "Failed to load users.");
        if (!mounted) return;
        const nextRoles = (Array.isArray(rolesJson?.roles) ? rolesJson.roles : []).map(normalizeRole);
        const nextUsers = (Array.isArray(usersJson?.users) ? usersJson.users : []).map(normalizeUser);
        setRoles(nextRoles);
        setUsers(nextUsers);
      } catch (err) {
        toastError(err?.message || "Failed to load security data.");
      } finally {
        if (mounted) setLoading(false);
      }
    }
    void load();
    return () => {
      mounted = false;
    };
  }, [canManage]);

  useEffect(() => {
    if (selectedRoleId === "new") {
      setRoleDraft(normalizeRole({}));
      return;
    }
    const role = roles.find((item) => Number(item.id) === Number(selectedRoleId));
    if (role) setRoleDraft(normalizeRole(role));
  }, [selectedRoleId, roles]);

  useEffect(() => {
    if (selectedUserId === "new") {
      setUserDraft({
        id: null,
        username: "",
        display_name: "",
        password: "",
        disabled: false,
        role_ids: [],
      });
      return;
    }
    const user = users.find((item) => Number(item.id) === Number(selectedUserId));
    if (user) {
      setUserDraft({
        id: user.id,
        username: user.username,
        display_name: user.display_name,
        password: "",
        disabled: Boolean(user.disabled),
        role_ids: user.roles.map((role) => Number(role.id)),
      });
    }
  }, [selectedUserId, users]);

  if (!canManage) {
    return (
      <div
        style={{
          border: "1px solid var(--border)",
          borderRadius: 12,
          padding: 12,
          background: "var(--bg-elev)",
          color: "var(--text-muted)",
          fontSize: 12,
        }}
      >
        Your account does not have permission to manage users or roles.
      </div>
    );
  }

  const loadSecurity = async () => {
    setLoading(true);
    try {
      const [rolesRes, usersRes] = await Promise.all([
        fetch("/api/security/roles"),
        fetch("/api/security/users"),
      ]);
      const rolesJson = await rolesRes.json().catch(() => ({}));
      const usersJson = await usersRes.json().catch(() => ({}));
      if (!rolesRes.ok) throw new Error(rolesJson?.error || "Failed to load roles.");
      if (!usersRes.ok) throw new Error(usersJson?.error || "Failed to load users.");
      setRoles((Array.isArray(rolesJson?.roles) ? rolesJson.roles : []).map(normalizeRole));
      setUsers((Array.isArray(usersJson?.users) ? usersJson.users : []).map(normalizeUser));
    } catch (err) {
      toastError(err?.message || "Failed to load security data.");
    } finally {
      setLoading(false);
    }
  };

  const saveRole = async () => {
    const payload = {
      name: roleDraft.name,
      description: roleDraft.description,
      permissions: AREA_KEYS.map((key) => ({
        area_key: key,
        can_view: Boolean(roleDraft.permissions?.[key]?.can_view),
        can_edit: Boolean(roleDraft.permissions?.[key]?.can_edit),
      })),
    };
    try {
      const res = await fetch(
        roleDraft.id ? `/api/security/roles/${roleDraft.id}` : "/api/security/roles",
        {
          method: roleDraft.id ? "PUT" : "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        }
      );
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json?.error || "Failed to save role.");
      toastSuccess("Role saved.");
      await loadSecurity();
      setSelectedRoleId(json?.role?.id ? Number(json.role.id) : "new");
    } catch (err) {
      toastError(err?.message || "Failed to save role.");
    }
  };

  const deleteRole = async () => {
    if (!roleDraft.id) return;
    try {
      const res = await fetch(`/api/security/roles/${roleDraft.id}`, { method: "DELETE" });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json?.error || "Failed to delete role.");
      toastSuccess("Role deleted.");
      setSelectedRoleId("new");
      await loadSecurity();
    } catch (err) {
      toastError(err?.message || "Failed to delete role.");
    }
  };

  const saveUser = async () => {
    const payload = {
      username: userDraft.username,
      display_name: userDraft.display_name,
      password: userDraft.password,
      disabled: userDraft.disabled,
      role_ids: userDraft.role_ids,
    };
    try {
      const res = await fetch(
        userDraft.id ? `/api/security/users/${userDraft.id}` : "/api/security/users",
        {
          method: userDraft.id ? "PUT" : "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        }
      );
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json?.error || "Failed to save user.");
      toastSuccess("User saved.");
      await loadSecurity();
      setSelectedUserId(json?.user?.id ? Number(json.user.id) : "new");
    } catch (err) {
      toastError(err?.message || "Failed to save user.");
    }
  };

  const deleteUser = async () => {
    if (!userDraft.id) return;
    try {
      const res = await fetch(`/api/security/users/${userDraft.id}`, { method: "DELETE" });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json?.error || "Failed to delete user.");
      toastSuccess("User deleted.");
      setSelectedUserId("new");
      await loadSecurity();
    } catch (err) {
      toastError(err?.message || "Failed to delete user.");
    }
  };

  return (
    <div style={{ width: "100%", display: "grid", gap: 10, alignContent: "start", alignItems: "start" }}>
      <div style={{ fontWeight: 800, fontSize: 15 }}>Access Control</div>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(380px, 1fr))",
          gap: 10,
          alignItems: "start",
          alignContent: "start",
        }}
      >
        <div style={{ border: "1px solid var(--border)", borderRadius: 12, padding: 12, background: "var(--bg-elev)", display: "grid", gap: 10 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <div style={{ fontWeight: 700, fontSize: 13 }}>Roles</div>
            <button
              type="button"
              onClick={() => setSelectedRoleId("new")}
              style={{ border: "1px solid var(--border)", borderRadius: 8, padding: "5px 9px", fontSize: 11, fontWeight: 700, background: "var(--bg)", color: "var(--text)", cursor: "pointer" }}
            >
              New Role
            </button>
          </div>
          <select
            value={selectedRoleId}
            onChange={(e) => setSelectedRoleId(e.target.value === "new" ? "new" : Number(e.target.value))}
            style={{ border: "1px solid var(--border)", borderRadius: 8, padding: "6px 8px", minHeight: 34, background: "var(--bg)", color: "var(--text)", fontSize: 12 }}
          >
            <option value="new">New role...</option>
            {roles.map((role) => (
              <option key={`role-option-${role.id}`} value={role.id}>
                {role.name}
              </option>
            ))}
          </select>
          <label style={{ display: "grid", gap: 4, fontSize: 11, fontWeight: 700, color: "var(--text-muted)" }}>
            Role Name
            <input
              value={roleDraft.name}
              onChange={(e) => setRoleDraft((prev) => ({ ...prev, name: e.target.value }))}
              readOnly={Boolean(roleDraft.is_system)}
              style={{ border: "1px solid var(--border)", borderRadius: 8, padding: "6px 8px", minHeight: 34, background: "var(--bg)", color: "var(--text)", fontSize: 12, opacity: roleDraft.is_system ? 0.8 : 1 }}
            />
          </label>
          <label style={{ display: "grid", gap: 4, fontSize: 11, fontWeight: 700, color: "var(--text-muted)" }}>
            Description
            <input
              value={roleDraft.description}
              onChange={(e) => setRoleDraft((prev) => ({ ...prev, description: e.target.value }))}
              style={{ border: "1px solid var(--border)", borderRadius: 8, padding: "6px 8px", minHeight: 34, background: "var(--bg)", color: "var(--text)", fontSize: 12 }}
            />
          </label>
          <div style={{ display: "grid", gap: 6, border: "1px solid var(--border)", borderRadius: 10, padding: 8 }}>
            {AREA_KEYS.map((key) => (
              <div key={`perm-${key}`} style={{ display: "grid", gridTemplateColumns: "1fr auto auto", alignItems: "center", gap: 8 }}>
                <div style={{ fontSize: 12, fontWeight: 600 }}>{titleCase(key)}</div>
                <label style={{ display: "inline-flex", alignItems: "center", gap: 4, fontSize: 11 }}>
                  <input
                    type="checkbox"
                    checked={Boolean(roleDraft.permissions?.[key]?.can_view)}
                    onChange={(e) =>
                      setRoleDraft((prev) => ({
                        ...prev,
                        permissions: {
                          ...prev.permissions,
                          [key]: {
                            ...prev.permissions[key],
                            can_view: e.target.checked,
                            can_edit: e.target.checked ? prev.permissions[key].can_edit : false,
                          },
                        },
                      }))
                    }
                  />
                  View
                </label>
                <label style={{ display: "inline-flex", alignItems: "center", gap: 4, fontSize: 11 }}>
                  <input
                    type="checkbox"
                    checked={Boolean(roleDraft.permissions?.[key]?.can_edit)}
                    onChange={(e) =>
                      setRoleDraft((prev) => ({
                        ...prev,
                        permissions: {
                          ...prev.permissions,
                          [key]: {
                            can_view: e.target.checked ? true : prev.permissions[key].can_view,
                            can_edit: e.target.checked,
                          },
                        },
                      }))
                    }
                  />
                  Edit
                </label>
              </div>
            ))}
          </div>
          <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
            {roleDraft.id && !roleDraft.is_system ? (
              <button
                type="button"
                onClick={deleteRole}
                style={{ border: "1px solid #f04438", borderRadius: 8, padding: "6px 10px", minHeight: 34, background: "#f04438", color: "white", fontSize: 11, fontWeight: 700, cursor: "pointer" }}
              >
                Delete
              </button>
            ) : null}
            <button
              type="button"
              onClick={saveRole}
              style={{ border: "1px solid #2f6dff", borderRadius: 8, padding: "6px 10px", minHeight: 34, background: "#2f6dff", color: "white", fontSize: 11, fontWeight: 700, cursor: "pointer" }}
            >
              Save Role
            </button>
          </div>
        </div>

        <div style={{ border: "1px solid var(--border)", borderRadius: 12, padding: 12, background: "var(--bg-elev)", display: "grid", gap: 10 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <div style={{ fontWeight: 700, fontSize: 13 }}>Users</div>
            <button
              type="button"
              onClick={() => setSelectedUserId("new")}
              style={{ border: "1px solid var(--border)", borderRadius: 8, padding: "5px 9px", fontSize: 11, fontWeight: 700, background: "var(--bg)", color: "var(--text)", cursor: "pointer" }}
            >
              New User
            </button>
          </div>
          <select
            value={selectedUserId}
            onChange={(e) => setSelectedUserId(e.target.value === "new" ? "new" : Number(e.target.value))}
            style={{ border: "1px solid var(--border)", borderRadius: 8, padding: "6px 8px", minHeight: 34, background: "var(--bg)", color: "var(--text)", fontSize: 12 }}
          >
            <option value="new">New user...</option>
            {users.map((item) => (
              <option key={`user-option-${item.id}`} value={item.id}>
                {item.username}
              </option>
            ))}
          </select>
          <label style={{ display: "grid", gap: 4, fontSize: 11, fontWeight: 700, color: "var(--text-muted)" }}>
            Username
            <input
              value={userDraft.username}
              onChange={(e) => setUserDraft((prev) => ({ ...prev, username: e.target.value }))}
              style={{ border: "1px solid var(--border)", borderRadius: 8, padding: "6px 8px", minHeight: 34, background: "var(--bg)", color: "var(--text)", fontSize: 12 }}
            />
          </label>
          <label style={{ display: "grid", gap: 4, fontSize: 11, fontWeight: 700, color: "var(--text-muted)" }}>
            Display Name
            <input
              value={userDraft.display_name}
              onChange={(e) => setUserDraft((prev) => ({ ...prev, display_name: e.target.value }))}
              style={{ border: "1px solid var(--border)", borderRadius: 8, padding: "6px 8px", minHeight: 34, background: "var(--bg)", color: "var(--text)", fontSize: 12 }}
            />
          </label>
          <label style={{ display: "grid", gap: 4, fontSize: 11, fontWeight: 700, color: "var(--text-muted)" }}>
            {userDraft.id ? "Reset Password (optional)" : "Password"}
            <input
              type="password"
              value={userDraft.password}
              onChange={(e) => setUserDraft((prev) => ({ ...prev, password: e.target.value }))}
              style={{ border: "1px solid var(--border)", borderRadius: 8, padding: "6px 8px", minHeight: 34, background: "var(--bg)", color: "var(--text)", fontSize: 12 }}
            />
          </label>
          <label style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 12, fontWeight: 600 }}>
            <input
              type="checkbox"
              checked={Boolean(userDraft.disabled)}
              onChange={(e) => setUserDraft((prev) => ({ ...prev, disabled: e.target.checked }))}
              disabled={Number(userDraft.id) === Number(currentUserId)}
            />
            Disabled
          </label>
          <div style={{ border: "1px solid var(--border)", borderRadius: 10, padding: 8, display: "grid", gap: 6 }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: "var(--text-muted)" }}>Assigned Roles</div>
            {roleOptions.map((role) => (
              <label key={`user-role-${role.id}`} style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 12 }}>
                <input
                  type="checkbox"
                  checked={userDraft.role_ids.includes(role.id)}
                  onChange={(e) =>
                    setUserDraft((prev) => ({
                      ...prev,
                      role_ids: e.target.checked
                        ? [...prev.role_ids, role.id]
                        : prev.role_ids.filter((id) => id !== role.id),
                    }))
                  }
                />
                {role.name}
              </label>
            ))}
          </div>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
            <div style={{ fontSize: 11, color: "var(--text-muted)" }}>{loading ? "Loading..." : ""}</div>
            <div style={{ display: "flex", gap: 8 }}>
              {userDraft.id ? (
                <button
                  type="button"
                  onClick={deleteUser}
                  disabled={Number(userDraft.id) === Number(currentUserId)}
                  style={{ border: "1px solid #f04438", borderRadius: 8, padding: "6px 10px", minHeight: 34, background: "#f04438", color: "white", fontSize: 11, fontWeight: 700, cursor: Number(userDraft.id) === Number(currentUserId) ? "not-allowed" : "pointer", opacity: Number(userDraft.id) === Number(currentUserId) ? 0.45 : 1 }}
                >
                  Delete
                </button>
              ) : null}
              <button
                type="button"
                onClick={saveUser}
                style={{ border: "1px solid #2f6dff", borderRadius: 8, padding: "6px 10px", minHeight: 34, background: "#2f6dff", color: "white", fontSize: 11, fontWeight: 700, cursor: "pointer" }}
              >
                Save User
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
