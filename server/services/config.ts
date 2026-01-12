import { pool } from "../lib/db";

export type SchoolConfig = {
  name: string;
  motto: string;
  headTeacher: string;
  address: string;
  catWeight: number;
  examWeight: number;
  logoUrl: string | null;
  signatureEnabled: boolean;
  headSignatureUrl: string | null;
};

export type AcademicConfig = {
  academicYear: string;
  term: string;
};

export async function getSchoolConfig(): Promise<SchoolConfig> {
  const client = await pool.connect();
  try {
    const { rows } = await client.query(
      `SELECT school_name, motto, head_teacher_name, school_address, 
              cat_weight_percent, exam_weight_percent, logo_url, 
              head_signature_url, signature_enabled 
       FROM school_settings LIMIT 1`
    );
    if (rows.length === 0) {
      return {
        name: "My School",
        motto: "Excellence",
        headTeacher: "",
        address: "",
        catWeight: 50,
        examWeight: 50,
        logoUrl: null,
        signatureEnabled: true,
        headSignatureUrl: null,
      };
    }
    const r = rows[0];
    return {
      name: r.school_name,
      motto: r.motto,
      headTeacher: r.head_teacher_name || "",
      address: r.school_address || "",
      catWeight: Number(r.cat_weight_percent),
      examWeight: Number(r.exam_weight_percent),
      logoUrl: r.logo_url || null,
      signatureEnabled: r.signature_enabled !== false,
      headSignatureUrl: r.head_signature_url || null,
    };
  } finally {
    client.release();
  }
}

export async function updateSchoolConfig(config: Partial<SchoolConfig>) {
  const client = await pool.connect();
  try {
    // Ensure a record exists
    const { rowCount } = await client.query("SELECT 1 FROM school_settings");
    if (rowCount === 0) {
      await client.query(
        "INSERT INTO school_settings (school_name) VALUES ('Default School')"
      );
    }

    const updates: string[] = [];
    const values: unknown[] = [];
    let i = 1;

    if (config.name !== undefined) {
      updates.push(`school_name=$${i++}`);
      values.push(config.name);
    }
    if (config.motto !== undefined) {
      updates.push(`motto=$${i++}`);
      values.push(config.motto);
    }
    if (config.headTeacher !== undefined) {
      updates.push(`head_teacher_name=$${i++}`);
      values.push(config.headTeacher);
    }
    if (config.address !== undefined) {
      updates.push(`school_address=$${i++}`);
      values.push(config.address);
    }
    if (config.catWeight !== undefined) {
      updates.push(`cat_weight_percent=$${i++}`);
      values.push(config.catWeight);
    }
    if (config.examWeight !== undefined) {
      updates.push(`exam_weight_percent=$${i++}`);
      values.push(config.examWeight);
    }
    if (config.logoUrl !== undefined) {
      updates.push(`logo_url=$${i++}`);
      values.push(config.logoUrl);
    }
    if (config.headSignatureUrl !== undefined) {
      updates.push(`head_signature_url=$${i++}`);
      values.push(config.headSignatureUrl);
    }
    if (config.signatureEnabled !== undefined) {
      updates.push(`signature_enabled=$${i++}`);
      values.push(config.signatureEnabled);
    }

    if (updates.length > 0) {
      await client.query(
        `UPDATE school_settings SET ${updates.join(", ")}, updated_at=NOW()`,
        values
      );
    }
  } finally {
    client.release();
  }
}

export async function getAcademicConfig(): Promise<AcademicConfig> {
  const client = await pool.connect();
  try {
    const { rows } = await client.query(
      "SELECT academic_year, term FROM academic_sessions WHERE is_active = TRUE LIMIT 1"
    );
    if (rows.length === 0) {
      return { academicYear: "2025/2026", term: "Term 1" };
    }
    return {
      academicYear: rows[0].academic_year,
      term: rows[0].term,
    };
  } finally {
    client.release();
  }
}

export async function updateAcademicConfig(year: string, term: string) {
  const client = await pool.connect();
  try {
    await client.query("SELECT sp_set_active_session($1, $2)", [year, term]);
  } finally {
    client.release();
  }
}
