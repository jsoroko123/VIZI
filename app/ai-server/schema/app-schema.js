async function ensureFormulaSchema(pool) {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS formula_header (
      id BIGSERIAL PRIMARY KEY,
      name VARCHAR(50),
      description VARCHAR(250),
      plant_code INTEGER,
      version INTEGER,
      animal_type VARCHAR(50),
      valid_from TIMESTAMPTZ,
      total_weight NUMERIC(18,4),
      weight_unit VARCHAR(50),
      archive INTEGER NOT NULL DEFAULT 0,
      active INTEGER NOT NULL DEFAULT 1,
      product_price NUMERIC(18,4),
      price_unit VARCHAR(50),
      route_index INTEGER,
      use_percentage BOOLEAN,
      max_batch_weight NUMERIC(18,4),
      finished_product_id BIGINT,
      removed BOOLEAN,
      use_flush BOOLEAN,
      calc_total_weight NUMERIC(18,4),
      require_100_percent BOOLEAN,
      require_product_check BOOLEAN,
      formula_product_type_index INTEGER,
      is_new BOOLEAN,
      date_created TIMESTAMPTZ,
      species_index INTEGER,
      life_stage VARCHAR(50),
      flowrate INTEGER,
      is_template BOOLEAN,
      disabled_on_job BOOLEAN,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);
  await pool.query(`ALTER TABLE formula_header ADD COLUMN IF NOT EXISTS name VARCHAR(50);`);
  await pool.query(`ALTER TABLE formula_header ADD COLUMN IF NOT EXISTS description VARCHAR(250);`);
  await pool.query(`ALTER TABLE formula_header ADD COLUMN IF NOT EXISTS plant_code INTEGER;`);
  await pool.query(`ALTER TABLE formula_header ADD COLUMN IF NOT EXISTS version INTEGER;`);
  await pool.query(`ALTER TABLE formula_header ADD COLUMN IF NOT EXISTS animal_type VARCHAR(50);`);
  await pool.query(`ALTER TABLE formula_header ADD COLUMN IF NOT EXISTS valid_from TIMESTAMPTZ;`);
  await pool.query(`ALTER TABLE formula_header ADD COLUMN IF NOT EXISTS total_weight NUMERIC(18,4);`);
  await pool.query(`ALTER TABLE formula_header ADD COLUMN IF NOT EXISTS weight_unit VARCHAR(50);`);
  await pool.query(`ALTER TABLE formula_header ADD COLUMN IF NOT EXISTS archive INTEGER NOT NULL DEFAULT 0;`);
  await pool.query(`ALTER TABLE formula_header ADD COLUMN IF NOT EXISTS active INTEGER NOT NULL DEFAULT 1;`);
  await pool.query(`ALTER TABLE formula_header ADD COLUMN IF NOT EXISTS product_price NUMERIC(18,4);`);
  await pool.query(`ALTER TABLE formula_header ADD COLUMN IF NOT EXISTS price_unit VARCHAR(50);`);
  await pool.query(`ALTER TABLE formula_header ADD COLUMN IF NOT EXISTS route_index INTEGER;`);
  await pool.query(`ALTER TABLE formula_header ADD COLUMN IF NOT EXISTS use_percentage BOOLEAN;`);
  await pool.query(`ALTER TABLE formula_header ADD COLUMN IF NOT EXISTS max_batch_weight NUMERIC(18,4);`);
  await pool.query(`ALTER TABLE formula_header ADD COLUMN IF NOT EXISTS finished_product_id BIGINT;`);
  await pool.query(`ALTER TABLE formula_header ADD COLUMN IF NOT EXISTS removed BOOLEAN;`);
  await pool.query(`ALTER TABLE formula_header ADD COLUMN IF NOT EXISTS use_flush BOOLEAN;`);
  await pool.query(`ALTER TABLE formula_header ADD COLUMN IF NOT EXISTS calc_total_weight NUMERIC(18,4);`);
  await pool.query(`ALTER TABLE formula_header ADD COLUMN IF NOT EXISTS require_100_percent BOOLEAN;`);
  await pool.query(`ALTER TABLE formula_header ADD COLUMN IF NOT EXISTS require_product_check BOOLEAN;`);
  await pool.query(`ALTER TABLE formula_header ADD COLUMN IF NOT EXISTS formula_product_type_index INTEGER;`);
  await pool.query(`ALTER TABLE formula_header ADD COLUMN IF NOT EXISTS is_new BOOLEAN;`);
  await pool.query(`ALTER TABLE formula_header ADD COLUMN IF NOT EXISTS date_created TIMESTAMPTZ;`);
  await pool.query(`ALTER TABLE formula_header ADD COLUMN IF NOT EXISTS species_index INTEGER;`);
  await pool.query(`ALTER TABLE formula_header ADD COLUMN IF NOT EXISTS life_stage VARCHAR(50);`);
  await pool.query(`ALTER TABLE formula_header ADD COLUMN IF NOT EXISTS flowrate INTEGER;`);
  await pool.query(`ALTER TABLE formula_header ADD COLUMN IF NOT EXISTS is_template BOOLEAN;`);
  await pool.query(`ALTER TABLE formula_header ADD COLUMN IF NOT EXISTS disabled_on_job BOOLEAN;`);
  await pool.query(`ALTER TABLE formula_header ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT now();`);
  await pool.query(`ALTER TABLE formula_header ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT now();`);
  await pool.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS formula_header_name_version_idx
    ON formula_header(name, version)
    WHERE name IS NOT NULL AND version IS NOT NULL;
  `);
  await pool.query(
    `
    INSERT INTO ui_table_config (table_name, list_fields, detail_fields)
    VALUES (
      'formula_header',
      $1::jsonb,
      $2::jsonb
    )
    ON CONFLICT (table_name) DO UPDATE
    SET list_fields = EXCLUDED.list_fields,
        detail_fields = EXCLUDED.detail_fields
    `,
    [
      JSON.stringify(["name", "version", "animal_type", "total_weight", "active", "updated_at"]),
      JSON.stringify([
        "name",
        "description",
        "plant_code",
        "version",
        "animal_type",
        "valid_from",
        "total_weight",
        "weight_unit",
        "archive",
        "active",
        "product_price",
        "price_unit",
        "route_index",
        "use_percentage",
        "max_batch_weight",
        "finished_product_id",
        "removed",
        "use_flush",
        "calc_total_weight",
        "require_100_percent",
        "require_product_check",
        "formula_product_type_index",
        "is_new",
        "date_created",
        "species_index",
        "life_stage",
        "flowrate",
        "is_template",
        "disabled_on_job",
        "created_at",
        "updated_at",
      ]),
    ]
  );

  await pool.query(`
    CREATE TABLE IF NOT EXISTS formula_bom (
      id BIGSERIAL PRIMARY KEY,
      name VARCHAR(50) NOT NULL DEFAULT '',
      description VARCHAR(200) NOT NULL DEFAULT '',
      header_index BIGINT,
      ingredient_index BIGINT,
      material_order INTEGER,
      material_type INTEGER,
      material_code VARCHAR(50),
      material_description VARCHAR(250),
      percentage NUMERIC(18,4),
      weight NUMERIC(18,4),
      weight_units VARCHAR(50),
      edit_client_id INTEGER,
      edit_client_name VARCHAR(50),
      edit_user VARCHAR(50),
      removed INTEGER NOT NULL DEFAULT 0,
      edit_datetime TIMESTAMPTZ NOT NULL DEFAULT now(),
      action_type VARCHAR(50),
      flush BOOLEAN,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);
  await pool.query(`ALTER TABLE formula_bom ADD COLUMN IF NOT EXISTS name VARCHAR(50) NOT NULL DEFAULT '';`);
  await pool.query(`ALTER TABLE formula_bom ADD COLUMN IF NOT EXISTS description VARCHAR(200) NOT NULL DEFAULT '';`);
  await pool.query(`ALTER TABLE formula_bom ADD COLUMN IF NOT EXISTS header_index BIGINT;`);
  await pool.query(`ALTER TABLE formula_bom ADD COLUMN IF NOT EXISTS ingredient_index BIGINT;`);
  await pool.query(`ALTER TABLE formula_bom ALTER COLUMN ingredient_index TYPE BIGINT USING ingredient_index::BIGINT;`);
  await pool.query(`ALTER TABLE formula_bom ADD COLUMN IF NOT EXISTS material_order INTEGER;`);
  await pool.query(`ALTER TABLE formula_bom ADD COLUMN IF NOT EXISTS material_type INTEGER;`);
  await pool.query(`ALTER TABLE formula_bom ADD COLUMN IF NOT EXISTS material_code VARCHAR(50);`);
  await pool.query(`ALTER TABLE formula_bom ADD COLUMN IF NOT EXISTS material_description VARCHAR(250);`);
  await pool.query(`ALTER TABLE formula_bom ADD COLUMN IF NOT EXISTS percentage NUMERIC(18,4);`);
  await pool.query(`ALTER TABLE formula_bom ADD COLUMN IF NOT EXISTS weight NUMERIC(18,4);`);
  await pool.query(`ALTER TABLE formula_bom ADD COLUMN IF NOT EXISTS weight_units VARCHAR(50);`);
  await pool.query(`ALTER TABLE formula_bom ADD COLUMN IF NOT EXISTS edit_client_id INTEGER;`);
  await pool.query(`ALTER TABLE formula_bom ADD COLUMN IF NOT EXISTS edit_client_name VARCHAR(50);`);
  await pool.query(`ALTER TABLE formula_bom ADD COLUMN IF NOT EXISTS edit_user VARCHAR(50);`);
  await pool.query(`ALTER TABLE formula_bom ADD COLUMN IF NOT EXISTS removed INTEGER NOT NULL DEFAULT 0;`);
  await pool.query(`ALTER TABLE formula_bom ADD COLUMN IF NOT EXISTS edit_datetime TIMESTAMPTZ NOT NULL DEFAULT now();`);
  await pool.query(`ALTER TABLE formula_bom ADD COLUMN IF NOT EXISTS action_type VARCHAR(50);`);
  await pool.query(`ALTER TABLE formula_bom ADD COLUMN IF NOT EXISTS flush BOOLEAN;`);
  await pool.query(`ALTER TABLE formula_bom ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT now();`);
  await pool.query(`ALTER TABLE formula_bom ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT now();`);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS formula_bom_header_index_idx
    ON formula_bom(header_index);
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS formula_bom_ingredient_index_idx
    ON formula_bom(ingredient_index);
  `);
  await pool.query(`
    DO $$
    BEGIN
      IF EXISTS (
        SELECT 1 FROM information_schema.tables
        WHERE table_schema = 'public' AND table_name = 'formula_bom'
      ) AND EXISTS (
        SELECT 1 FROM information_schema.tables
        WHERE table_schema = 'public' AND table_name = 'formula_header'
      ) THEN
        IF NOT EXISTS (
          SELECT 1 FROM pg_constraint WHERE conname = 'formula_bom_header_index_fkey'
        ) THEN
          ALTER TABLE formula_bom
          ADD CONSTRAINT formula_bom_header_index_fkey
          FOREIGN KEY (header_index) REFERENCES formula_header(id)
          ON DELETE CASCADE;
        END IF;
      END IF;
    END$$;
  `);
  await pool.query(`
    DO $$
    BEGIN
      IF EXISTS (
        SELECT 1 FROM information_schema.tables
        WHERE table_schema = 'public' AND table_name = 'formula_bom'
      ) AND EXISTS (
        SELECT 1 FROM information_schema.tables
        WHERE table_schema = 'public' AND table_name = 'product'
      ) THEN
        IF NOT EXISTS (
          SELECT 1 FROM pg_constraint WHERE conname = 'formula_bom_ingredient_index_fkey'
        ) THEN
          ALTER TABLE formula_bom
          ADD CONSTRAINT formula_bom_ingredient_index_fkey
          FOREIGN KEY (ingredient_index) REFERENCES product(id)
          ON DELETE SET NULL;
        END IF;
      END IF;
    END$$;
  `);
  await pool.query(`
    DO $$
    BEGIN
      IF EXISTS (
        SELECT 1 FROM information_schema.tables
        WHERE table_schema = 'public' AND table_name = 'formula_header'
      ) AND EXISTS (
        SELECT 1 FROM information_schema.tables
        WHERE table_schema = 'public' AND table_name = 'product'
      ) THEN
        IF NOT EXISTS (
          SELECT 1 FROM pg_constraint WHERE conname = 'formula_header_finished_product_id_fkey'
        ) THEN
          ALTER TABLE formula_header
          ADD CONSTRAINT formula_header_finished_product_id_fkey
          FOREIGN KEY (finished_product_id) REFERENCES product(id)
          ON DELETE SET NULL;
        END IF;
      END IF;
    END$$;
  `);
  await pool.query(
    `
    INSERT INTO ui_table_config (table_name, list_fields, detail_fields)
    VALUES (
      'formula_bom',
      $1::jsonb,
      $2::jsonb
    )
    ON CONFLICT (table_name) DO UPDATE
    SET list_fields = EXCLUDED.list_fields,
        detail_fields = EXCLUDED.detail_fields
    `,
    [
      JSON.stringify(["name", "header_index", "ingredient_index", "material_order", "weight", "percentage", "updated_at"]),
      JSON.stringify([
        "name",
        "description",
        "header_index",
        "ingredient_index",
        "material_order",
        "material_type",
        "material_code",
        "material_description",
        "percentage",
        "weight",
        "weight_units",
        "edit_client_id",
        "edit_client_name",
        "edit_user",
        "removed",
        "edit_datetime",
        "action_type",
        "flush",
        "created_at",
        "updated_at",
      ]),
    ]
  );
}


export async function ensureAppSchema({ pool, createPasswordHash, defaultRolePermissionRows, applyPrimaryKeyState }) {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS ui_table_config (
      table_name TEXT PRIMARY KEY,
      list_fields JSONB NOT NULL DEFAULT '[]'::jsonb,
      detail_fields JSONB NOT NULL DEFAULT '[]'::jsonb
    );
  `);
  await pool.query(`
    ALTER TABLE ui_table_config
    ADD COLUMN IF NOT EXISTS detail_fields JSONB NOT NULL DEFAULT '[]'::jsonb;
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id SERIAL PRIMARY KEY,
      username TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      password_salt TEXT NOT NULL,
      disabled BOOLEAN NOT NULL DEFAULT false,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS user_sessions (
      id SERIAL PRIMARY KEY,
      user_id INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      token_hash TEXT UNIQUE NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      expires_at TIMESTAMPTZ NOT NULL
    );
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS support_chat_messages (
      id BIGSERIAL PRIMARY KEY,
      user_id INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      mode TEXT NOT NULL DEFAULT 'design',
      message TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);
  await pool.query(`
    ALTER TABLE support_chat_messages
    ADD COLUMN IF NOT EXISTS mode TEXT NOT NULL DEFAULT 'design';
  `);
  await pool.query(`
    UPDATE support_chat_messages
    SET mode = 'design'
    WHERE mode IS NULL OR TRIM(mode) = '';
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS support_chat_messages_created_idx
    ON support_chat_messages(created_at DESC, id DESC);
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS support_chat_messages_mode_created_idx
    ON support_chat_messages(mode, created_at DESC, id DESC);
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS support_chat_documents (
      id BIGSERIAL PRIMARY KEY,
      mode TEXT NOT NULL DEFAULT 'design',
      source_name TEXT NOT NULL DEFAULT '',
      content_text TEXT NOT NULL DEFAULT '',
      content_summary TEXT NOT NULL DEFAULT '',
      created_by INT REFERENCES users(id) ON DELETE SET NULL,
      is_active BOOLEAN NOT NULL DEFAULT true,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);
  await pool.query(`
    ALTER TABLE support_chat_documents
    ADD COLUMN IF NOT EXISTS mode TEXT NOT NULL DEFAULT 'design';
  `);
  await pool.query(`
    ALTER TABLE support_chat_documents
    ADD COLUMN IF NOT EXISTS source_name TEXT NOT NULL DEFAULT '';
  `);
  await pool.query(`
    ALTER TABLE support_chat_documents
    ADD COLUMN IF NOT EXISTS content_text TEXT NOT NULL DEFAULT '';
  `);
  await pool.query(`
    ALTER TABLE support_chat_documents
    ADD COLUMN IF NOT EXISTS content_summary TEXT NOT NULL DEFAULT '';
  `);
  await pool.query(`
    ALTER TABLE support_chat_documents
    ADD COLUMN IF NOT EXISTS created_by INT REFERENCES users(id) ON DELETE SET NULL;
  `);
  await pool.query(`
    ALTER TABLE support_chat_documents
    ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT true;
  `);
  await pool.query(`
    ALTER TABLE support_chat_documents
    ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT now();
  `);
  await pool.query(`
    ALTER TABLE support_chat_documents
    ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT now();
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS support_chat_documents_mode_active_updated_idx
    ON support_chat_documents(mode, is_active, updated_at DESC, id DESC);
  `);
  await pool.query(`
    ALTER TABLE users
    ADD COLUMN IF NOT EXISTS username TEXT;
  `);
  await pool.query(`
    ALTER TABLE users
    ADD COLUMN IF NOT EXISTS password_hash TEXT;
  `);
  await pool.query(`
    ALTER TABLE users
    ADD COLUMN IF NOT EXISTS password_salt TEXT;
  `);
  await pool.query(`
    ALTER TABLE users
    ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ;
  `);
  await pool.query(`
    ALTER TABLE users
    ADD COLUMN IF NOT EXISTS display_name TEXT;
  `);
  await pool.query(`
    ALTER TABLE users
    ADD COLUMN IF NOT EXISTS avatar_url TEXT;
  `);
  await pool.query(`
    ALTER TABLE users
    ADD COLUMN IF NOT EXISTS email TEXT;
  `);
  await pool.query(`
    ALTER TABLE users
    ADD COLUMN IF NOT EXISTS external_provider TEXT;
  `);
  await pool.query(`
    ALTER TABLE users
    ADD COLUMN IF NOT EXISTS external_subject TEXT;
  `);
  await pool.query(`
    ALTER TABLE users
    ADD COLUMN IF NOT EXISTS disabled BOOLEAN NOT NULL DEFAULT false;
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS roles (
      id SERIAL PRIMARY KEY,
      name TEXT UNIQUE NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      is_system BOOLEAN NOT NULL DEFAULT false,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS user_roles (
      user_id INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      role_id INT NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
      PRIMARY KEY (user_id, role_id)
    );
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS role_area_permissions (
      role_id INT NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
      area_key TEXT NOT NULL,
      can_view BOOLEAN NOT NULL DEFAULT false,
      can_edit BOOLEAN NOT NULL DEFAULT false,
      PRIMARY KEY (role_id, area_key)
    );
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS user_roles_role_id_idx ON user_roles(role_id);
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS role_area_permissions_area_idx ON role_area_permissions(area_key);
  `);
  try {
    const { rows } = await pool.query(
      `
      SELECT column_name
      FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'users'
      `
    );
    const cols = new Set(rows.map((r) => r.column_name));
    if (cols.has("name")) {
      await pool.query(`UPDATE users SET username = name WHERE username IS NULL`);
    }
    await pool.query(`UPDATE users SET display_name = username WHERE display_name IS NULL`);
    if (cols.has("password")) {
      await pool.query(`UPDATE users SET password_hash = password WHERE password_hash IS NULL`);
    }
    await pool.query(`UPDATE users SET created_at = now() WHERE created_at IS NULL`);
  } catch {
    // ignore
  }
  await pool.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS users_username_idx ON users(username);
  `);
  await pool.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS users_external_identity_idx
    ON users(external_provider, external_subject)
    WHERE external_provider IS NOT NULL AND external_subject IS NOT NULL;
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS users_email_lower_idx
    ON users((lower(email)))
    WHERE email IS NOT NULL;
  `);
  const defaultRoles = [
    {
      name: "Administrator",
      description: "Full access to all app areas and security administration.",
      is_system: true,
    },
    {
      name: "Engineer",
      description: "Build and configure projects with design and integration access.",
      is_system: true,
    },
    {
      name: "User",
      description: "Operate and monitor with read-only access to runtime pages.",
      is_system: true,
    },
    {
      name: "Operator",
      description: "Read-only access to runtime and process screens.",
      is_system: true,
    },
  ];
  for (const role of defaultRoles) {
    await pool.query(
      `
      INSERT INTO roles (name, description, is_system)
      VALUES ($1, $2, $3)
      ON CONFLICT (name) DO UPDATE
      SET description = EXCLUDED.description, is_system = EXCLUDED.is_system
      `,
      [role.name, role.description, role.is_system]
    );
  }
  const { rows: roleRows } = await pool.query("SELECT id, name FROM roles");
  const roleMap = new Map(roleRows.map((row) => [String(row.name || "").trim().toLowerCase(), Number(row.id)]));
  for (const [roleName, roleId] of roleMap.entries()) {
    const permissionRows = defaultRolePermissionRows(roleName);
    for (const permission of permissionRows) {
      await pool.query(
        `
        INSERT INTO role_area_permissions (role_id, area_key, can_view, can_edit)
        VALUES ($1, $2, $3, $4)
        ON CONFLICT (role_id, area_key) DO UPDATE
        SET can_view = EXCLUDED.can_view, can_edit = EXCLUDED.can_edit
        `,
        [roleId, permission.area_key, permission.can_view, permission.can_edit]
      );
    }
  }
  async function ensureSeededUserWithRole({ username, password, displayName, roleId }) {
    if (!Number.isFinite(roleId)) return null;
    const seededUsername = String(username || "").trim().toLowerCase();
    if (!seededUsername) return null;
    const seededPassword = String(password || "").trim();
    if (!seededPassword) return null;
    const seededDisplayName = String(displayName || seededUsername).trim() || seededUsername;
    const { salt: seededSalt, hash: seededHash } = await createPasswordHash(seededPassword);
    const { rows } = await pool.query(
      "SELECT id FROM users WHERE lower(username) = lower($1) LIMIT 1",
      [seededUsername]
    );
    let userId = null;
    if (rows.length) {
      userId = Number(rows[0].id);
      await pool.query(
        `
        UPDATE users
        SET username = $1,
            display_name = COALESCE(NULLIF(display_name, ''), $2),
            password_hash = $3,
            password_salt = $4,
            disabled = false
        WHERE id = $5
        `,
        [seededUsername, seededDisplayName, seededHash, seededSalt, userId]
      );
    } else {
      const created = await pool.query(
        `
        INSERT INTO users (username, password_hash, password_salt, display_name, disabled)
        VALUES ($1, $2, $3, $4, false)
        RETURNING id
        `,
        [seededUsername, seededHash, seededSalt, seededDisplayName]
      );
      userId = Number(created.rows[0]?.id || 0);
    }
    if (Number.isFinite(userId) && userId > 0) {
      await pool.query(
        `
        INSERT INTO user_roles (user_id, role_id)
        VALUES ($1, $2)
        ON CONFLICT (user_id, role_id) DO NOTHING
        `,
        [userId, roleId]
      );
      return userId;
    }
    return null;
  }

  const adminRoleId = roleMap.get("administrator");
  await ensureSeededUserWithRole({
    username: "admin",
    password: "admin",
    displayName: "Admin",
    roleId: adminRoleId,
  });

  const engineerRoleId = roleMap.get("engineer");
  await ensureSeededUserWithRole({
    username: "engineer",
    password: "engineer",
    displayName: "Engineer",
    roleId: engineerRoleId,
  });
  const { rows: userRoleCountRows } = await pool.query("SELECT COUNT(*)::int AS count FROM user_roles");
  if (Number(userRoleCountRows?.[0]?.count || 0) === 0) {
    const { rows: firstUserRows } = await pool.query(
      "SELECT id FROM users ORDER BY created_at ASC, id ASC LIMIT 1"
    );
    if (firstUserRows.length && Number.isFinite(adminRoleId)) {
      await pool.query(
        `
        INSERT INTO user_roles (user_id, role_id)
        VALUES ($1, $2)
        ON CONFLICT (user_id, role_id) DO NOTHING
        `,
        [firstUserRows[0].id, adminRoleId]
      );
    }
  }
  const userRoleId = roleMap.get("user");
  if (Number.isFinite(userRoleId)) {
    await pool.query(
      `
      INSERT INTO user_roles (user_id, role_id)
      SELECT u.id, $1
      FROM users u
      WHERE NOT EXISTS (
        SELECT 1 FROM user_roles ur WHERE ur.user_id = u.id
      )
      ON CONFLICT (user_id, role_id) DO NOTHING
      `,
      [userRoleId]
    );
  }
  await pool.query(`
    CREATE TABLE IF NOT EXISTS opc_tag_templates (
      name TEXT PRIMARY KEY,
      fields JSONB NOT NULL DEFAULT '[]'::jsonb,
      parent_name TEXT,
      state_mappings JSONB NOT NULL DEFAULT '[]'::jsonb,
      group_name TEXT
    );
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS opc_tag_state_mappings (
      tag_key TEXT NOT NULL,
      field TEXT,
      state TEXT NOT NULL,
      color TEXT NOT NULL,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      PRIMARY KEY (tag_key, field, state)
    );
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS opc_mapping_sets (
      name TEXT PRIMARY KEY,
      mappings JSONB NOT NULL DEFAULT '[]'::jsonb,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS opc_config (
      id INT PRIMARY KEY,
      config JSONB NOT NULL,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS opc_status (
      id INT PRIMARY KEY,
      status JSONB NOT NULL DEFAULT '{}'::jsonb,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);
  await pool.query(`
    ALTER TABLE opc_status
    ADD COLUMN IF NOT EXISTS status JSONB NOT NULL DEFAULT '{}'::jsonb;
  `);
  await pool.query(`
    ALTER TABLE opc_status
    ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT now();
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS opc_tag_trend_chunks (
      id BIGSERIAL PRIMARY KEY,
      tag_key TEXT NOT NULL,
      from_ts BIGINT NOT NULL,
      to_ts BIGINT NOT NULL,
      sample_count INT NOT NULL DEFAULT 0,
      codec TEXT NOT NULL DEFAULT 'json-gzip-v1',
      payload BYTEA NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS opc_tag_trend_chunks_tag_to_idx
    ON opc_tag_trend_chunks(tag_key, to_ts DESC);
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS opc_tag_trend_chunks_to_idx
    ON opc_tag_trend_chunks(to_ts DESC);
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS opc_alarm_state (
      alarm_key TEXT PRIMARY KEY,
      topic TEXT NOT NULL DEFAULT '',
      group_name TEXT NOT NULL DEFAULT '',
      tag_path TEXT NOT NULL DEFAULT '',
      label TEXT NOT NULL DEFAULT '',
      operator TEXT NOT NULL DEFAULT '==',
      threshold TEXT NOT NULL DEFAULT '',
      last_value TEXT NOT NULL DEFAULT '',
      is_active BOOLEAN NOT NULL DEFAULT false,
      first_triggered_at TIMESTAMPTZ,
      last_seen_at TIMESTAMPTZ,
      cleared_at TIMESTAMPTZ,
      occurrence_count INTEGER NOT NULL DEFAULT 0,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);
  await pool.query(`
    ALTER TABLE opc_alarm_state
    ADD COLUMN IF NOT EXISTS is_acknowledged BOOLEAN NOT NULL DEFAULT false;
  `);
  await pool.query(`
    ALTER TABLE opc_alarm_state
    ADD COLUMN IF NOT EXISTS acknowledged_at TIMESTAMPTZ;
  `);
  await pool.query(`
    ALTER TABLE opc_alarm_state
    ADD COLUMN IF NOT EXISTS acknowledged_by TEXT NOT NULL DEFAULT '';
  `);
  await pool.query(`
    ALTER TABLE opc_alarm_state
    ADD COLUMN IF NOT EXISTS shelved_until TIMESTAMPTZ;
  `);
  await pool.query(`
    ALTER TABLE opc_alarm_state
    ADD COLUMN IF NOT EXISTS shelved_reason TEXT NOT NULL DEFAULT '';
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS opc_alarm_state_active_idx
    ON opc_alarm_state(is_active, updated_at DESC);
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS opc_alarm_state_updated_idx
    ON opc_alarm_state(updated_at DESC);
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS plc_code_gen_profile (
      plc_key TEXT PRIMARY KEY,
      profile JSONB NOT NULL DEFAULT '{}'::jsonb,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);
  await pool.query(`
    ALTER TABLE plc_code_gen_profile
    ADD COLUMN IF NOT EXISTS profile JSONB NOT NULL DEFAULT '{}'::jsonb;
  `);
  await pool.query(`
    ALTER TABLE plc_code_gen_profile
    ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT now();
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS plc_code_gen_profile_updated_idx
    ON plc_code_gen_profile(updated_at DESC);
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS plc_debug_session (
      id TEXT PRIMARY KEY,
      session_data JSONB NOT NULL,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      last_touched_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS plc_debug_session_touched_idx
    ON plc_debug_session(last_touched_at DESC);
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS route_l5x_template (
      template_key TEXT PRIMARY KEY,
      route_name TEXT NOT NULL,
      source_filename TEXT NOT NULL DEFAULT '',
      template_text TEXT NOT NULL,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS route_l5x_template_updated_idx
    ON route_l5x_template(updated_at DESC);
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS plc_l5x_routine_template (
      plc_key TEXT NOT NULL,
      routine_key TEXT NOT NULL,
      routine_name TEXT NOT NULL,
      source_filename TEXT NOT NULL DEFAULT '',
      routine_xml TEXT NOT NULL,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      PRIMARY KEY (plc_key, routine_key)
    );
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS plc_l5x_routine_template_plc_updated_idx
    ON plc_l5x_routine_template(plc_key, updated_at DESC);
  `);
  await pool.query(`
    DO $$
    BEGIN
      IF EXISTS (
        SELECT 1 FROM information_schema.tables
        WHERE table_schema = 'public' AND table_name = 'projects'
      ) AND NOT EXISTS (
        SELECT 1 FROM information_schema.tables
        WHERE table_schema = 'public' AND table_name = 'project'
      ) THEN
        ALTER TABLE projects RENAME TO project;
      END IF;
    END$$;
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS project (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      data JSONB NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);
  await pool.query(`
    ALTER TABLE project
    ADD COLUMN IF NOT EXISTS updated_by INT;
  `);
  await pool.query(`
    DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'project_updated_by_fkey'
      ) THEN
        ALTER TABLE project
        ADD CONSTRAINT project_updated_by_fkey
        FOREIGN KEY (updated_by) REFERENCES users(id)
        ON DELETE SET NULL;
      END IF;
    END$$;
  `);
  await pool.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS project_name_idx ON project(name);
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS project_versions (
      id BIGSERIAL PRIMARY KEY,
      project_id TEXT NOT NULL REFERENCES project(id) ON DELETE CASCADE,
      saved_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      saved_by INT REFERENCES users(id) ON DELETE SET NULL,
      base_updated_at TIMESTAMPTZ,
      previous_data JSONB NOT NULL DEFAULT '{}'::jsonb,
      next_data JSONB NOT NULL DEFAULT '{}'::jsonb,
      previous_data_gz BYTEA,
      next_data_gz BYTEA,
      payload_codec TEXT NOT NULL DEFAULT 'jsonb-legacy',
      next_hash TEXT,
      change_summary JSONB
    );
  `);
  await pool.query(`
    ALTER TABLE project_versions
    ADD COLUMN IF NOT EXISTS previous_data_gz BYTEA;
  `);
  await pool.query(`
    ALTER TABLE project_versions
    ADD COLUMN IF NOT EXISTS next_data_gz BYTEA;
  `);
  await pool.query(`
    ALTER TABLE project_versions
    ADD COLUMN IF NOT EXISTS payload_codec TEXT NOT NULL DEFAULT 'jsonb-legacy';
  `);
  await pool.query(`
    ALTER TABLE project_versions
    ADD COLUMN IF NOT EXISTS next_hash TEXT;
  `);
  await pool.query(`
    ALTER TABLE project_versions
    ADD COLUMN IF NOT EXISTS change_summary JSONB;
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS project_versions_project_saved_idx
    ON project_versions(project_id, saved_at DESC);
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS project_versions_project_hash_idx
    ON project_versions(project_id, next_hash);
  `);
  await pool.query(`
    DO $$
    BEGIN
      IF EXISTS (
        SELECT 1 FROM information_schema.tables
        WHERE table_schema = 'public' AND table_name = 'routes'
      ) AND NOT EXISTS (
        SELECT 1 FROM information_schema.tables
        WHERE table_schema = 'public' AND table_name = 'route'
      ) THEN
        ALTER TABLE routes RENAME TO route;
      END IF;
    END$$;
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS route (
      id BIGSERIAL PRIMARY KEY,
      route_id TEXT,
      route_number TEXT,
      state TEXT,
      route_color TEXT,
      project_id TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);
  await pool.query(`
    ALTER TABLE route
    ADD COLUMN IF NOT EXISTS route_id TEXT;
  `);
  await pool.query(`
    ALTER TABLE route
    ADD COLUMN IF NOT EXISTS route_number TEXT;
  `);
  await pool.query(`
    ALTER TABLE route
    ADD COLUMN IF NOT EXISTS state TEXT;
  `);
  await pool.query(`
    ALTER TABLE route
    ADD COLUMN IF NOT EXISTS route_color TEXT;
  `);
  await pool.query(`
    ALTER TABLE route
    ADD COLUMN IF NOT EXISTS project_id TEXT;
  `);
  await pool.query(`
    ALTER TABLE route
    ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT now();
  `);
  await pool.query(`
    ALTER TABLE route
    ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT now();
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS automation_rule (
      id BIGSERIAL PRIMARY KEY,
      name TEXT NOT NULL DEFAULT '',
      enabled BOOLEAN NOT NULL DEFAULT true,
      project_id TEXT,
      trigger_source TEXT NOT NULL DEFAULT 'tag',
      trigger_tag TEXT NOT NULL DEFAULT '',
      trigger_mode TEXT NOT NULL DEFAULT 'change',
      trigger_table TEXT NOT NULL DEFAULT '',
      trigger_column TEXT NOT NULL DEFAULT '',
      trigger_where_json TEXT NOT NULL DEFAULT '{}',
      trigger_order_by TEXT NOT NULL DEFAULT '',
      trigger_order_dir TEXT NOT NULL DEFAULT 'asc',
      conditions_logic TEXT NOT NULL DEFAULT 'and',
      conditions_json TEXT NOT NULL DEFAULT '[]',
      actions_json TEXT NOT NULL DEFAULT '[]',
      cooldown_ms INTEGER NOT NULL DEFAULT 0,
      last_seen_value TEXT,
      last_fired_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);
  await pool.query(`
    ALTER TABLE automation_rule
    ADD COLUMN IF NOT EXISTS name TEXT NOT NULL DEFAULT '';
  `);
  await pool.query(`
    ALTER TABLE automation_rule
    ADD COLUMN IF NOT EXISTS enabled BOOLEAN NOT NULL DEFAULT true;
  `);
  await pool.query(`
    ALTER TABLE automation_rule
    ADD COLUMN IF NOT EXISTS project_id TEXT;
  `);
  await pool.query(`
    ALTER TABLE automation_rule
    ADD COLUMN IF NOT EXISTS trigger_source TEXT NOT NULL DEFAULT 'tag';
  `);
  await pool.query(`
    ALTER TABLE automation_rule
    ADD COLUMN IF NOT EXISTS scope_project_id TEXT;
  `);
  await pool.query(`
    ALTER TABLE automation_rule
    ADD COLUMN IF NOT EXISTS scope_route_id TEXT;
  `);
  await pool.query(`
    ALTER TABLE automation_rule
    ADD COLUMN IF NOT EXISTS trigger_tag TEXT NOT NULL DEFAULT '';
  `);
  await pool.query(`
    ALTER TABLE automation_rule
    ADD COLUMN IF NOT EXISTS trigger_mode TEXT NOT NULL DEFAULT 'change';
  `);
  await pool.query(`
    ALTER TABLE automation_rule
    ADD COLUMN IF NOT EXISTS trigger_table TEXT NOT NULL DEFAULT '';
  `);
  await pool.query(`
    ALTER TABLE automation_rule
    ADD COLUMN IF NOT EXISTS trigger_column TEXT NOT NULL DEFAULT '';
  `);
  await pool.query(`
    ALTER TABLE automation_rule
    ADD COLUMN IF NOT EXISTS trigger_where_json TEXT NOT NULL DEFAULT '{}';
  `);
  await pool.query(`
    ALTER TABLE automation_rule
    ADD COLUMN IF NOT EXISTS trigger_order_by TEXT NOT NULL DEFAULT '';
  `);
  await pool.query(`
    ALTER TABLE automation_rule
    ADD COLUMN IF NOT EXISTS trigger_order_dir TEXT NOT NULL DEFAULT 'asc';
  `);
  await pool.query(`
    ALTER TABLE automation_rule
    ADD COLUMN IF NOT EXISTS conditions_logic TEXT NOT NULL DEFAULT 'and';
  `);
  await pool.query(`
    ALTER TABLE automation_rule
    ADD COLUMN IF NOT EXISTS conditions_json TEXT NOT NULL DEFAULT '[]';
  `);
  await pool.query(`
    ALTER TABLE automation_rule
    ADD COLUMN IF NOT EXISTS actions_json TEXT NOT NULL DEFAULT '[]';
  `);
  await pool.query(`
    ALTER TABLE automation_rule
    ADD COLUMN IF NOT EXISTS cooldown_ms INTEGER NOT NULL DEFAULT 0;
  `);
  await pool.query(`
    ALTER TABLE automation_rule
    ADD COLUMN IF NOT EXISTS last_seen_value TEXT;
  `);
  await pool.query(`
    ALTER TABLE automation_rule
    ADD COLUMN IF NOT EXISTS last_fired_at TIMESTAMPTZ;
  `);
  await pool.query(`
    ALTER TABLE automation_rule
    ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT now();
  `);
  await pool.query(`
    ALTER TABLE automation_rule
    ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT now();
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS automation_rule_enabled_trigger_idx
    ON automation_rule(enabled, trigger_tag);
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS automation_rule_run (
      id BIGSERIAL PRIMARY KEY,
      rule_id BIGINT,
      rule_name TEXT NOT NULL DEFAULT '',
      trigger_tag TEXT NOT NULL DEFAULT '',
      previous_value TEXT,
      current_value TEXT,
      status TEXT NOT NULL DEFAULT 'ok',
      message TEXT NOT NULL DEFAULT '',
      action_results JSONB NOT NULL DEFAULT '[]'::jsonb,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);
  await pool.query(`
    ALTER TABLE automation_rule_run
    ADD COLUMN IF NOT EXISTS rule_id BIGINT;
  `);
  await pool.query(`
    ALTER TABLE automation_rule_run
    ADD COLUMN IF NOT EXISTS rule_name TEXT NOT NULL DEFAULT '';
  `);
  await pool.query(`
    ALTER TABLE automation_rule_run
    ADD COLUMN IF NOT EXISTS trigger_tag TEXT NOT NULL DEFAULT '';
  `);
  await pool.query(`
    ALTER TABLE automation_rule_run
    ADD COLUMN IF NOT EXISTS previous_value TEXT;
  `);
  await pool.query(`
    ALTER TABLE automation_rule_run
    ADD COLUMN IF NOT EXISTS current_value TEXT;
  `);
  await pool.query(`
    ALTER TABLE automation_rule_run
    ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'ok';
  `);
  await pool.query(`
    ALTER TABLE automation_rule_run
    ADD COLUMN IF NOT EXISTS message TEXT NOT NULL DEFAULT '';
  `);
  await pool.query(`
    ALTER TABLE automation_rule_run
    ADD COLUMN IF NOT EXISTS action_results JSONB NOT NULL DEFAULT '[]'::jsonb;
  `);
  await pool.query(`
    ALTER TABLE automation_rule_run
    ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT now();
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS automation_rule_run_rule_created_idx
    ON automation_rule_run(rule_id, created_at DESC);
  `);
  await pool.query(`
    DO $$
    BEGIN
      IF EXISTS (
        SELECT 1 FROM information_schema.tables
        WHERE table_schema = 'public' AND table_name = 'tbl_routebingroup'
      ) AND NOT EXISTS (
        SELECT 1 FROM information_schema.tables
        WHERE table_schema = 'public' AND table_name = 'route_bin_group'
      ) THEN
        ALTER TABLE tbl_routebingroup RENAME TO route_bin_group;
      END IF;
    END$$;
  `);
  await pool.query(`
    DO $$
    BEGIN
      IF EXISTS (
        SELECT 1 FROM information_schema.tables
        WHERE table_schema = 'public' AND table_name = 'tbl_routebinlist'
      ) AND NOT EXISTS (
        SELECT 1 FROM information_schema.tables
        WHERE table_schema = 'public' AND table_name = 'route_bin_list'
      ) THEN
        ALTER TABLE tbl_routebinlist RENAME TO route_bin_list;
      END IF;
    END$$;
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS route_bin_group (
      id BIGSERIAL PRIMARY KEY,
      tbl_index INTEGER GENERATED BY DEFAULT AS IDENTITY,
      groupid INTEGER,
      groupname VARCHAR(50),
      grouptype VARCHAR(16),
      grouplistnumber INTEGER,
      routenumber BIGINT,
      mixtype INTEGER,
      isblend BOOLEAN DEFAULT false,
      require100percent BOOLEAN DEFAULT true,
      requireproductcheck BOOLEAN DEFAULT false,
      maxtarget INTEGER DEFAULT 100,
      hideinrecipe BOOLEAN DEFAULT false,
      hideinjob BOOLEAN DEFAULT false,
      hasregistration BOOLEAN DEFAULT true,
      usepercentage BOOLEAN,
      useweight BOOLEAN,
      enabled BOOLEAN DEFAULT true,
      maxingredients INTEGER DEFAULT 8,
      unit VARCHAR(50),
      unitsscale DOUBLE PRECISION DEFAULT 1,
      defaultbinindex INTEGER,
      allowsubingrlist BOOLEAN DEFAULT false,
      defaulttarget INTEGER DEFAULT 0,
      sortorder INTEGER
    );
  `);
  await pool.query(`
    ALTER TABLE route_bin_group
    ADD COLUMN IF NOT EXISTS id BIGINT;
  `);
  await pool.query(`
    ALTER TABLE route_bin_group
    ADD COLUMN IF NOT EXISTS tbl_index INTEGER;
  `);
  await pool.query(`
    DO $$
    DECLARE
      seq_name TEXT := 'route_bin_group_id_seed_seq';
      max_id BIGINT := 0;
    BEGIN
      CREATE SEQUENCE IF NOT EXISTS route_bin_group_id_seed_seq;
      UPDATE route_bin_group AS g
      SET id = g.tbl_index
      WHERE g.id IS NULL
        AND g.tbl_index IS NOT NULL
        AND NOT EXISTS (
          SELECT 1
          FROM route_bin_group AS g2
          WHERE g2.id = g.tbl_index
            AND g2.ctid <> g.ctid
        );
      SELECT COALESCE(MAX(id), 0) INTO max_id FROM route_bin_group;
      PERFORM setval(seq_name, GREATEST(max_id, 1), true);
      UPDATE route_bin_group
      SET id = nextval(seq_name)
      WHERE id IS NULL;
    END$$;
  `);
  await applyPrimaryKeyState(pool, "route_bin_group", "id", true);
  await pool.query(`
    ALTER TABLE route_bin_group
    ADD COLUMN IF NOT EXISTS groupid INTEGER;
  `);
  await pool.query(`
    ALTER TABLE route_bin_group
    ADD COLUMN IF NOT EXISTS groupname VARCHAR(50);
  `);
  await pool.query(`
    ALTER TABLE route_bin_group
    ADD COLUMN IF NOT EXISTS grouptype VARCHAR(16);
  `);
  await pool.query(`
    ALTER TABLE route_bin_group
    ADD COLUMN IF NOT EXISTS grouplistnumber INTEGER;
  `);
  await pool.query(`
    ALTER TABLE route_bin_group
    ADD COLUMN IF NOT EXISTS routenumber BIGINT;
  `);
  await pool.query(`
    ALTER TABLE route_bin_group
    ADD COLUMN IF NOT EXISTS mixtype INTEGER;
  `);
  await pool.query(`
    ALTER TABLE route_bin_group
    ADD COLUMN IF NOT EXISTS isblend BOOLEAN DEFAULT false;
  `);
  await pool.query(`
    ALTER TABLE route_bin_group
    ADD COLUMN IF NOT EXISTS require100percent BOOLEAN DEFAULT true;
  `);
  await pool.query(`
    ALTER TABLE route_bin_group
    ADD COLUMN IF NOT EXISTS requireproductcheck BOOLEAN DEFAULT false;
  `);
  await pool.query(`
    ALTER TABLE route_bin_group
    ADD COLUMN IF NOT EXISTS maxtarget INTEGER DEFAULT 100;
  `);
  await pool.query(`
    ALTER TABLE route_bin_group
    ADD COLUMN IF NOT EXISTS hideinrecipe BOOLEAN DEFAULT false;
  `);
  await pool.query(`
    ALTER TABLE route_bin_group
    ADD COLUMN IF NOT EXISTS hideinjob BOOLEAN DEFAULT false;
  `);
  await pool.query(`
    ALTER TABLE route_bin_group
    ADD COLUMN IF NOT EXISTS hasregistration BOOLEAN DEFAULT true;
  `);
  await pool.query(`
    ALTER TABLE route_bin_group
    ADD COLUMN IF NOT EXISTS usepercentage BOOLEAN;
  `);
  await pool.query(`
    ALTER TABLE route_bin_group
    ADD COLUMN IF NOT EXISTS useweight BOOLEAN;
  `);
  await pool.query(`
    ALTER TABLE route_bin_group
    ADD COLUMN IF NOT EXISTS enabled BOOLEAN DEFAULT true;
  `);
  await pool.query(`
    ALTER TABLE route_bin_group
    ADD COLUMN IF NOT EXISTS maxingredients INTEGER DEFAULT 8;
  `);
  await pool.query(`
    ALTER TABLE route_bin_group
    ADD COLUMN IF NOT EXISTS unit VARCHAR(50);
  `);
  await pool.query(`
    ALTER TABLE route_bin_group
    ADD COLUMN IF NOT EXISTS unitsscale DOUBLE PRECISION DEFAULT 1;
  `);
  await pool.query(`
    ALTER TABLE route_bin_group
    ADD COLUMN IF NOT EXISTS defaultbinindex INTEGER;
  `);
  await pool.query(`
    ALTER TABLE route_bin_group
    ADD COLUMN IF NOT EXISTS allowsubingrlist BOOLEAN DEFAULT false;
  `);
  await pool.query(`
    ALTER TABLE route_bin_group
    ADD COLUMN IF NOT EXISTS defaulttarget INTEGER DEFAULT 0;
  `);
  await pool.query(`
    ALTER TABLE route_bin_group
    ADD COLUMN IF NOT EXISTS sortorder INTEGER;
  `);
  await pool.query(`
    DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname IN ('route_bin_group_routenumber_fkey', 'tbl_routebingroup_routenumber_fkey')
      ) THEN
        ALTER TABLE route_bin_group
        ADD CONSTRAINT route_bin_group_routenumber_fkey
        FOREIGN KEY (routenumber) REFERENCES route(id)
        ON DELETE SET NULL;
      END IF;
    END$$;
  `);
  await pool.query(`
    DO $$
    DECLARE
      rec RECORD;
    BEGIN
      FOR rec IN
        SELECT con.conname
        FROM pg_constraint con
        JOIN pg_class child ON child.oid = con.conrelid
        JOIN pg_namespace child_ns ON child_ns.oid = child.relnamespace
        JOIN pg_class parent ON parent.oid = con.confrelid
        JOIN pg_namespace parent_ns ON parent_ns.oid = parent.relnamespace
        JOIN pg_attribute child_att
          ON child_att.attrelid = child.oid
         AND child_att.attnum = con.conkey[1]
        JOIN pg_attribute parent_att
          ON parent_att.attrelid = parent.oid
         AND parent_att.attnum = con.confkey[1]
        WHERE con.contype = 'f'
          AND child_ns.nspname = 'public'
          AND parent_ns.nspname = 'public'
          AND child.relname = 'route_bin_group'
          AND parent.relname = 'route'
          AND array_length(con.conkey, 1) = 1
          AND array_length(con.confkey, 1) = 1
          AND child_att.attname = 'id'
          AND parent_att.attname = 'id'
      LOOP
        EXECUTE format('ALTER TABLE route_bin_group DROP CONSTRAINT IF EXISTS %I', rec.conname);
      END LOOP;
    END$$;
  `);
  await pool.query(`
    DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM pg_indexes
        WHERE schemaname = 'public'
          AND tablename = 'route_bin_group'
          AND indexname IN ('route_bin_group_routenumber_idx', 'tbl_routebingroup_routenumber_idx')
      ) THEN
        CREATE INDEX route_bin_group_routenumber_idx ON route_bin_group(routenumber);
      END IF;
    END$$;
  `);
  await pool.query(`
    DO $$
    BEGIN
      IF EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'route_bin_group_route_id_fkey'
      ) THEN
        ALTER TABLE route_bin_group DROP CONSTRAINT route_bin_group_route_id_fkey;
      END IF;
      IF EXISTS (
        SELECT 1 FROM pg_indexes
        WHERE schemaname = 'public'
          AND tablename = 'route_bin_group'
          AND indexname = 'route_bin_group_route_id_idx'
      ) THEN
        DROP INDEX IF EXISTS route_bin_group_route_id_idx;
      END IF;
      IF EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'route_bin_group' AND column_name = 'route_id'
      ) THEN
        ALTER TABLE route_bin_group DROP COLUMN route_id;
      END IF;
    END$$;
  `);
  await pool.query(`
    DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM pg_indexes
        WHERE schemaname = 'public'
          AND tablename = 'route_bin_group'
          AND indexname IN ('route_bin_group_groupid_idx', 'tbl_routebingroup_groupid_idx')
      ) THEN
        CREATE INDEX route_bin_group_groupid_idx ON route_bin_group(groupid);
      END IF;
    END$$;
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS route_bin_list (
      id BIGSERIAL PRIMARY KEY,
      name TEXT,
      description TEXT,
      bin_number VARCHAR(10),
      hide_job_form BOOLEAN DEFAULT false,
      assigned_bin_group BIGINT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);
  await pool.query(`ALTER TABLE route_bin_list ADD COLUMN IF NOT EXISTS name TEXT;`);
  await pool.query(`ALTER TABLE route_bin_list ADD COLUMN IF NOT EXISTS description TEXT;`);
  await pool.query(`ALTER TABLE route_bin_list ADD COLUMN IF NOT EXISTS bin_number VARCHAR(10);`);
  await pool.query(`ALTER TABLE route_bin_list ADD COLUMN IF NOT EXISTS hide_job_form BOOLEAN DEFAULT false;`);
  await pool.query(`ALTER TABLE route_bin_list ADD COLUMN IF NOT EXISTS assigned_bin_group BIGINT;`);
  await pool.query(
    `ALTER TABLE route_bin_list ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT now();`
  );
  await pool.query(
    `ALTER TABLE route_bin_list ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT now();`
  );
  await pool.query(`
    DO $$
    BEGIN
      IF EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'route_bin_list' AND column_name = 'binnumber'
      ) THEN
        UPDATE route_bin_list
        SET bin_number = COALESCE(bin_number, binnumber)
        WHERE binnumber IS NOT NULL;
      END IF;
      IF EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'route_bin_list' AND column_name = 'hidejobform'
      ) THEN
        UPDATE route_bin_list
        SET hide_job_form = COALESCE(hide_job_form, hidejobform)
        WHERE hidejobform IS NOT NULL;
      END IF;
      IF EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'route_bin_list' AND column_name = 'assignedbingroup'
      ) THEN
        UPDATE route_bin_list
        SET assigned_bin_group = COALESCE(assigned_bin_group, assignedbingroup)
        WHERE assignedbingroup IS NOT NULL;
      END IF;
      UPDATE route_bin_list
      SET name = COALESCE(name, bin_number)
      WHERE name IS NULL AND bin_number IS NOT NULL;
      IF EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'route_bin_list' AND column_name = 'binnumber'
      ) THEN
        ALTER TABLE route_bin_list DROP COLUMN binnumber;
      END IF;
      IF EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'route_bin_list' AND column_name = 'hidejobform'
      ) THEN
        ALTER TABLE route_bin_list DROP COLUMN hidejobform;
      END IF;
      IF EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'route_bin_list' AND column_name = 'assignedbingroup'
      ) THEN
        ALTER TABLE route_bin_list DROP COLUMN assignedbingroup;
      END IF;
    END$$;
  `);
  await pool.query(`
    DO $$
    BEGIN
      IF EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'tbl_routebinlist_assignedbingroup_fkey'
      ) THEN
        ALTER TABLE route_bin_list DROP CONSTRAINT tbl_routebinlist_assignedbingroup_fkey;
      END IF;
      IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'route_bin_list_assigned_bin_group_fkey'
      ) THEN
        ALTER TABLE route_bin_list
        ADD CONSTRAINT route_bin_list_assigned_bin_group_fkey
        FOREIGN KEY (assigned_bin_group) REFERENCES route_bin_group(id)
        ON DELETE SET NULL;
      END IF;
    END$$;
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS route_bin_list_assigned_bin_group_idx
    ON route_bin_list(assigned_bin_group);
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS jobs (
      id BIGSERIAL PRIMARY KEY,
      name TEXT NOT NULL DEFAULT '',
      description TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT '',
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);
  await pool.query(`
    ALTER TABLE jobs
    ADD COLUMN IF NOT EXISTS name TEXT NOT NULL DEFAULT '';
  `);
  await pool.query(`
    ALTER TABLE jobs
    ADD COLUMN IF NOT EXISTS description TEXT NOT NULL DEFAULT '';
  `);
  await pool.query(`
    ALTER TABLE jobs
    ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT '';
  `);
  await pool.query(`
    ALTER TABLE jobs
    ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT now();
  `);
  await pool.query(`
    ALTER TABLE jobs
    ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT now();
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS job_details (
      id BIGSERIAL PRIMARY KEY,
      job_id BIGINT NOT NULL,
      name TEXT NOT NULL DEFAULT '',
      description TEXT NOT NULL DEFAULT '',
      detail_value TEXT NOT NULL DEFAULT '',
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);
  await pool.query(`
    ALTER TABLE job_details
    ADD COLUMN IF NOT EXISTS job_id BIGINT;
  `);
  await pool.query(`
    ALTER TABLE job_details
    ADD COLUMN IF NOT EXISTS name TEXT NOT NULL DEFAULT '';
  `);
  await pool.query(`
    ALTER TABLE job_details
    ADD COLUMN IF NOT EXISTS description TEXT NOT NULL DEFAULT '';
  `);
  await pool.query(`
    ALTER TABLE job_details
    ADD COLUMN IF NOT EXISTS detail_value TEXT NOT NULL DEFAULT '';
  `);
  await pool.query(`
    ALTER TABLE job_details
    ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT now();
  `);
  await pool.query(`
    ALTER TABLE job_details
    ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT now();
  `);
  await pool.query(`
    DO $$
    BEGIN
      IF EXISTS (
        SELECT 1 FROM information_schema.tables
        WHERE table_schema = 'public' AND table_name = 'job_details'
      ) THEN
        IF NOT EXISTS (
          SELECT 1 FROM pg_constraint WHERE conname = 'job_details_job_id_fkey'
        ) THEN
          ALTER TABLE job_details
          ADD CONSTRAINT job_details_job_id_fkey
          FOREIGN KEY (job_id) REFERENCES jobs(id)
          ON DELETE CASCADE;
        END IF;
      END IF;
    END$$;
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS job_details_job_id_idx
    ON job_details(job_id);
  `);
  await pool.query(
    `
    INSERT INTO ui_table_config (table_name, list_fields, detail_fields)
    VALUES (
      'jobs',
      $1::jsonb,
      $2::jsonb
    )
    ON CONFLICT (table_name) DO NOTHING
    `,
    [
      JSON.stringify(["name", "status", "updated_at"]),
      JSON.stringify(["name", "description", "status", "created_at", "updated_at"]),
    ]
  );
  await pool.query(
    `
    INSERT INTO ui_table_config (table_name, list_fields, detail_fields)
    VALUES (
      'job_details',
      $1::jsonb,
      $2::jsonb
    )
    ON CONFLICT (table_name) DO NOTHING
    `,
    [
      JSON.stringify(["job_id", "name", "detail_value", "updated_at"]),
      JSON.stringify(["job_id", "name", "description", "detail_value", "created_at", "updated_at"]),
    ]
  );
  await pool.query(`
    UPDATE ui_table_config
    SET
      list_fields = (
        SELECT COALESCE(jsonb_agg(
          CASE
            WHEN elem = 'route_id' THEN 'routenumber'::text
            ELSE elem
          END
        ), '[]'::jsonb)
        FROM jsonb_array_elements_text(COALESCE(ui_table_config.list_fields, '[]'::jsonb)) AS elem
      ),
      detail_fields = (
        SELECT COALESCE(jsonb_agg(
          CASE
            WHEN elem = 'route_id' THEN 'routenumber'::text
            ELSE elem
          END
        ), '[]'::jsonb)
        FROM jsonb_array_elements_text(COALESCE(ui_table_config.detail_fields, '[]'::jsonb)) AS elem
      )
    WHERE table_name = 'route_bin_group';
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS product (
      id BIGSERIAL PRIMARY KEY,
      name TEXT NOT NULL DEFAULT '',
      description TEXT NOT NULL DEFAULT '',
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);
  await pool.query(`
    ALTER TABLE product
    ADD COLUMN IF NOT EXISTS name TEXT NOT NULL DEFAULT '';
  `);
  await pool.query(`
    ALTER TABLE product
    ADD COLUMN IF NOT EXISTS description TEXT NOT NULL DEFAULT '';
  `);
  await pool.query(`
    ALTER TABLE product
    ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT now();
  `);
  await pool.query(`
    ALTER TABLE product
    ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT now();
  `);
  await pool.query(`CREATE UNIQUE INDEX IF NOT EXISTS product_name_idx ON product(name);`);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS bin (
      id BIGSERIAL PRIMARY KEY,
      name TEXT NOT NULL DEFAULT '',
      description TEXT NOT NULL DEFAULT '',
      product_id BIGINT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);
  await pool.query(`
    ALTER TABLE bin
    ADD COLUMN IF NOT EXISTS name TEXT NOT NULL DEFAULT '';
  `);
  await pool.query(`
    ALTER TABLE bin
    ADD COLUMN IF NOT EXISTS description TEXT NOT NULL DEFAULT '';
  `);
  await pool.query(`
    ALTER TABLE bin
    ADD COLUMN IF NOT EXISTS product_id BIGINT;
  `);
  await pool.query(`
    ALTER TABLE bin
    ALTER COLUMN product_id DROP NOT NULL;
  `);
  await pool.query(`
    ALTER TABLE bin
    ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT now();
  `);
  await pool.query(`
    ALTER TABLE bin
    ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT now();
  `);
  await pool.query(`
    UPDATE bin AS b
    SET product_id = NULL
    WHERE b.product_id IS NOT NULL
      AND NOT EXISTS (
        SELECT 1 FROM product AS p WHERE p.id = b.product_id
      );
  `);
  await pool.query(`
    DO $$
    DECLARE
      rec RECORD;
    BEGIN
      FOR rec IN
        SELECT
          con.conname AS constraint_name,
          nsp.nspname AS table_schema,
          cls.relname AS table_name
        FROM pg_constraint con
        JOIN pg_class cls ON cls.oid = con.conrelid
        JOIN pg_namespace nsp ON nsp.oid = cls.relnamespace
        JOIN pg_class ref ON ref.oid = con.confrelid
        JOIN pg_namespace ref_nsp ON ref_nsp.oid = ref.relnamespace
        WHERE con.contype = 'f'
          AND ref_nsp.nspname = 'public'
          AND ref.relname = 'products'
      LOOP
        EXECUTE format(
          'ALTER TABLE %I.%I DROP CONSTRAINT IF EXISTS %I',
          rec.table_schema,
          rec.table_name,
          rec.constraint_name
        );
      END LOOP;
    END$$;
  `);
  await pool.query(`
    DO $$
    DECLARE
      rec RECORD;
    BEGIN
      FOR rec IN
        SELECT
          con.conname AS constraint_name,
          nsp.nspname AS table_schema,
          cls.relname AS table_name
        FROM pg_constraint con
        JOIN pg_class cls ON cls.oid = con.conrelid
        JOIN pg_namespace nsp ON nsp.oid = cls.relnamespace
        JOIN pg_class ref ON ref.oid = con.confrelid
        JOIN pg_namespace ref_nsp ON ref_nsp.oid = ref.relnamespace
        WHERE con.contype = 'f'
          AND ref_nsp.nspname = 'public'
          AND ref.relname = 'bins'
      LOOP
        EXECUTE format(
          'ALTER TABLE %I.%I DROP CONSTRAINT IF EXISTS %I',
          rec.table_schema,
          rec.table_name,
          rec.constraint_name
        );
      END LOOP;
    END$$;
  `);
  await pool.query(`DROP TABLE IF EXISTS products CASCADE;`);
  await pool.query(`DROP TABLE IF EXISTS bins CASCADE;`);
  await pool.query(`
    DELETE FROM ui_table_config
    WHERE table_name IN ('products', 'bins', 'tbl_product', 'tbl_bin');
  `);
  await pool.query(`
    DELETE FROM ui_table_config
    WHERE table_name IN ('projects', 'routes')
      AND EXISTS (
        SELECT 1
        FROM ui_table_config cfg2
        WHERE cfg2.table_name = CASE
          WHEN ui_table_config.table_name = 'projects' THEN 'project'
          WHEN ui_table_config.table_name = 'routes' THEN 'route'
          ELSE ui_table_config.table_name
        END
      );
  `);
  await pool.query(`
    UPDATE ui_table_config
    SET table_name = CASE
      WHEN table_name = 'projects' THEN 'project'
      WHEN table_name = 'routes' THEN 'route'
      WHEN table_name = 'tbl_routebingroup' THEN 'route_bin_group'
      WHEN table_name = 'tbl_routebinlist' THEN 'route_bin_list'
      ELSE table_name
    END
    WHERE table_name IN ('projects', 'routes', 'tbl_routebingroup', 'tbl_routebinlist');
  `);
  await pool.query(`
    DO $$
    BEGIN
      IF EXISTS (
        SELECT 1 FROM information_schema.tables
        WHERE table_schema = 'public' AND table_name = 'bin'
      ) AND EXISTS (
        SELECT 1 FROM information_schema.tables
        WHERE table_schema = 'public' AND table_name = 'product'
      ) THEN
        IF NOT EXISTS (
          SELECT 1 FROM pg_constraint WHERE conname = 'bin_product_id_fkey'
        ) THEN
          ALTER TABLE bin
          ADD CONSTRAINT bin_product_id_fkey
          FOREIGN KEY (product_id) REFERENCES product(id)
          ON DELETE SET NULL;
        END IF;
      END IF;
    END$$;
  `);
  await pool.query(`CREATE INDEX IF NOT EXISTS bin_product_id_idx ON bin(product_id);`);
  await pool.query(
    `
    INSERT INTO ui_table_config (table_name, list_fields, detail_fields)
    VALUES (
      'product',
      $1::jsonb,
      $2::jsonb
    )
    ON CONFLICT (table_name) DO NOTHING
    `,
    [
      JSON.stringify(["name", "updated_at"]),
      JSON.stringify(["name", "description", "created_at", "updated_at"]),
    ]
  );
  await pool.query(
    `
    INSERT INTO ui_table_config (table_name, list_fields, detail_fields)
    VALUES (
      'route_bin_list',
      $1::jsonb,
      $2::jsonb
    )
    ON CONFLICT (table_name) DO NOTHING
    `,
    [
      JSON.stringify(["name", "bin_number", "assigned_bin_group", "updated_at"]),
      JSON.stringify([
        "name",
        "description",
        "bin_number",
        "hide_job_form",
        "assigned_bin_group",
        "created_at",
        "updated_at",
      ]),
    ]
  );
  await pool.query(
    `
    INSERT INTO ui_table_config (table_name, list_fields, detail_fields)
    VALUES (
      'bin',
      $1::jsonb,
      $2::jsonb
    )
    ON CONFLICT (table_name) DO NOTHING
    `,
    [
      JSON.stringify(["name", "product_id", "updated_at"]),
      JSON.stringify(["name", "description", "product_id", "created_at", "updated_at"]),
    ]
  );
  await ensureFormulaSchema(pool);
  await pool.query(
    `
    INSERT INTO ui_table_config (table_name, list_fields, detail_fields)
    VALUES (
      'route_bin_group',
      $1::jsonb,
      $2::jsonb
    )
    ON CONFLICT (table_name) DO NOTHING
    `,
    [
      JSON.stringify(["groupname", "routenumber", "enabled", "sortorder"]),
      JSON.stringify([
        "routenumber",
        "groupid",
        "groupname",
        "grouptype",
        "grouplistnumber",
        "routenumber",
        "mixtype",
        "isblend",
        "require100percent",
        "requireproductcheck",
        "maxtarget",
        "hideinrecipe",
        "hideinjob",
        "hasregistration",
        "usepercentage",
        "useweight",
        "enabled",
        "maxingredients",
        "unit",
        "unitsscale",
        "defaultbinindex",
        "allowsubingrlist",
        "defaulttarget",
        "sortorder",
      ]),
    ]
  );
  await pool.query(`
    CREATE TABLE IF NOT EXISTS equipment (
      id BIGSERIAL PRIMARY KEY,
      name TEXT NOT NULL DEFAULT '',
      description TEXT NOT NULL DEFAULT '',
      type TEXT NOT NULL DEFAULT '',
      floor TEXT NOT NULL DEFAULT '',
      "groupNumber" INTEGER,
      visible BOOLEAN NOT NULL DEFAULT true,
      "new" BOOLEAN NOT NULL DEFAULT false,
      notes TEXT NOT NULL DEFAULT '',
      tag_path TEXT
    );
  `);
  await pool.query(`
    ALTER TABLE equipment
    ADD COLUMN IF NOT EXISTS name TEXT NOT NULL DEFAULT '';
  `);
  await pool.query(`
    ALTER TABLE equipment
    ADD COLUMN IF NOT EXISTS description TEXT NOT NULL DEFAULT '';
  `);
  await pool.query(`
    ALTER TABLE equipment
    ADD COLUMN IF NOT EXISTS type TEXT NOT NULL DEFAULT '';
  `);
  await pool.query(`
    ALTER TABLE equipment
    ADD COLUMN IF NOT EXISTS floor TEXT NOT NULL DEFAULT '';
  `);
  await pool.query(`
    ALTER TABLE equipment
    ADD COLUMN IF NOT EXISTS "groupNumber" INTEGER;
  `);
  await pool.query(`
    ALTER TABLE equipment
    ADD COLUMN IF NOT EXISTS visible BOOLEAN NOT NULL DEFAULT true;
  `);
  await pool.query(`
    ALTER TABLE equipment
    ADD COLUMN IF NOT EXISTS "new" BOOLEAN NOT NULL DEFAULT false;
  `);
  await pool.query(`
    ALTER TABLE equipment
    ADD COLUMN IF NOT EXISTS notes TEXT NOT NULL DEFAULT '';
  `);
  await pool.query(`
    ALTER TABLE equipment
    ADD COLUMN IF NOT EXISTS tag_path TEXT;
  `);
  await pool.query(`
    ALTER TABLE equipment
    ADD COLUMN IF NOT EXISTS tag_sync_managed BOOLEAN NOT NULL DEFAULT false;
  `);
  await pool.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS equipment_tag_path_unique_idx
    ON equipment(tag_path)
    WHERE tag_path IS NOT NULL AND btrim(tag_path) <> '';
  `);
  await pool.query(
    `
    INSERT INTO ui_table_config (table_name, list_fields, detail_fields)
    VALUES (
      'equipment',
      $1::jsonb,
      $2::jsonb
    )
    ON CONFLICT (table_name) DO NOTHING
    `,
    [
      JSON.stringify(["name", "type", "floor", "groupNumber", "visible", "new", "tag_path"]),
      JSON.stringify(["name", "description", "type", "floor", "groupNumber", "visible", "new", "notes", "tag_path"]),
    ]
  );
  await pool.query(`
    CREATE TABLE IF NOT EXISTS etype (
      id BIGSERIAL PRIMARY KEY,
      name TEXT NOT NULL UNIQUE,
      description TEXT NOT NULL DEFAULT ''
    );
  `);
  await pool.query(`
    ALTER TABLE etype
    ADD COLUMN IF NOT EXISTS name TEXT NOT NULL DEFAULT '';
  `);
  await pool.query(`
    ALTER TABLE etype
    ADD COLUMN IF NOT EXISTS description TEXT NOT NULL DEFAULT '';
  `);
  await pool.query(`
    INSERT INTO etype (name, description)
    VALUES
      ('Motor', 'Motor-driven equipment'),
      ('Conveyor', 'Conveyor equipment'),
      ('Bin', 'Storage bin equipment'),
      ('Valve', 'Valve equipment'),
      ('Fan', 'Fan or blower equipment')
    ON CONFLICT DO NOTHING;
  `);
  await pool.query(`
    INSERT INTO etype (name)
    SELECT DISTINCT TRIM(type)
    FROM equipment
    WHERE COALESCE(TRIM(type), '') <> ''
    ON CONFLICT DO NOTHING;
  `);
  await pool.query(
    `
    INSERT INTO ui_table_config (table_name, list_fields, detail_fields)
    VALUES (
      'etype',
      $1::jsonb,
      $2::jsonb
    )
    ON CONFLICT (table_name) DO NOTHING
    `,
    [
      JSON.stringify(["name", "description"]),
      JSON.stringify(["name", "description"]),
    ]
  );
  await pool.query(`
    CREATE TABLE IF NOT EXISTS ai_reports (
      id TEXT PRIMARY KEY,
      user_id INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      description TEXT,
      sql TEXT NOT NULL,
      layout_json JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);
  await pool.query(`
    ALTER TABLE ai_reports
    ADD COLUMN IF NOT EXISTS layout_json JSONB NOT NULL DEFAULT '{}'::jsonb;
  `);
  await pool.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS ai_reports_user_name_idx ON ai_reports(user_id, name);
  `);
  await pool.query(`
    DO $$
    BEGIN
      IF EXISTS (
        SELECT 1 FROM information_schema.tables
        WHERE table_schema = 'public' AND table_name = 'route'
      ) THEN
        ALTER TABLE route
        ADD COLUMN IF NOT EXISTS project_id TEXT;

        IF NOT EXISTS (
          SELECT 1 FROM pg_constraint WHERE conname = 'route_project_id_fkey'
        ) THEN
          ALTER TABLE route
          ADD CONSTRAINT route_project_id_fkey
          FOREIGN KEY (project_id) REFERENCES project(id)
          ON DELETE SET NULL;
        END IF;

        IF NOT EXISTS (
          SELECT 1 FROM pg_indexes
          WHERE schemaname = 'public' AND tablename = 'route' AND indexname = 'route_project_id_idx'
        ) THEN
          CREATE INDEX route_project_id_idx ON route(project_id);
        END IF;
      END IF;
    END$$;
  `);
  await pool.query(`
    ALTER TABLE opc_tag_templates
    ADD COLUMN IF NOT EXISTS parent_name TEXT;
  `);
  await pool.query(`
    ALTER TABLE opc_tag_templates
    ADD COLUMN IF NOT EXISTS state_mappings JSONB NOT NULL DEFAULT '[]'::jsonb;
  `);
  await pool.query(`
    ALTER TABLE opc_tag_templates
    ADD COLUMN IF NOT EXISTS group_name TEXT;
  `);
  await pool.query(`
    INSERT INTO ui_table_config (table_name, list_fields, detail_fields)
    VALUES (
      'automation_rule',
      '["name","enabled","trigger_source","scope_project_id","scope_route_id","trigger_tag","trigger_table","trigger_column","trigger_mode","cooldown_ms","last_fired_at"]'::jsonb,
      '["id","name","enabled","project_id","trigger_source","scope_project_id","scope_route_id","trigger_tag","trigger_table","trigger_column","trigger_where_json","trigger_order_by","trigger_order_dir","trigger_mode","conditions_logic","conditions_json","actions_json","cooldown_ms","last_seen_value","last_fired_at","created_at","updated_at"]'::jsonb
    )
    ON CONFLICT (table_name) DO UPDATE
    SET list_fields = EXCLUDED.list_fields,
        detail_fields = EXCLUDED.detail_fields;
  `);
  await pool.query(`
    INSERT INTO ui_table_config (table_name, list_fields, detail_fields)
    VALUES (
      'automation_rule_run',
      '["rule_name","trigger_tag","status","created_at"]'::jsonb,
      '["id","rule_id","rule_name","trigger_tag","previous_value","current_value","status","message","action_results","created_at"]'::jsonb
    )
    ON CONFLICT (table_name) DO UPDATE
    SET list_fields = EXCLUDED.list_fields,
        detail_fields = EXCLUDED.detail_fields;
  `);
}
