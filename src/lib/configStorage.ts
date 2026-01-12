import { logger } from "./logger";

export interface SchoolConfig {
  name: string;
  motto: string;
  headTeacher: string;
  address: string;
  catWeight: number;
  examWeight: number;
  logoUrl: string | null;
  signatureEnabled?: boolean;
  headSignatureUrl?: string | null;
}

export interface AcademicConfig {
  academicYear: string;
  term: string;
}

export const SchoolProfileStorage = {
  async save(config: SchoolConfig) {
    const token = localStorage.getItem("token");
    if (!token) {
      logger.warn("school_profile_save_skipped_no_token");
      throw new Error("Authentication required to save configuration");
    }

    try {
      const res = await fetch("/api/config/school", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(config),
      });
      if (!res.ok) {
        const errorText = await res.text();
        throw new Error(
          `Failed to save school config: ${res.status} ${errorText}`
        );
      }
      logger.info("school_profile_saved");
    } catch (e) {
      logger.error("school_profile_save_error", e);
      throw e;
    }
  },

  async load(): Promise<SchoolConfig | null> {
    try {
      const res = await fetch("/api/config/school");
      if (!res.ok) return null;
      return await res.json();
    } catch (e) {
      logger.error("school_profile_load_error", e);
      return null;
    }
  },
};

export const AcademicConfigStorage = {
  async save(config: AcademicConfig) {
    const token = localStorage.getItem("token");
    if (!token) {
      logger.warn("academic_config_save_skipped_no_token");
      throw new Error("Authentication required to save configuration");
    }

    try {
      const res = await fetch("/api/config/academic", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(config),
      });
      if (!res.ok) {
        const errorText = await res.text();
        throw new Error(
          `Failed to save academic config: ${res.status} ${errorText}`
        );
      }
      logger.info("academic_config_saved");
    } catch (e) {
      logger.error("academic_config_save_error", e);
      throw e;
    }
  },

  async load(): Promise<AcademicConfig | null> {
    try {
      const res = await fetch("/api/config/academic");
      if (!res.ok) return null;
      return await res.json();
    } catch (e) {
      logger.error("academic_config_load_error", e);
      return null;
    }
  },
};

export const SystemConfigStorage = {
  async saveAll(school: SchoolConfig, academic: AcademicConfig) {
    await SchoolProfileStorage.save(school);
    await AcademicConfigStorage.save(academic);
  },

  async loadAll() {
    const school = await SchoolProfileStorage.load();
    const academic = await AcademicConfigStorage.load();
    return { school, academic };
  },

  async clearAll() {
    // No-op for server-side
  },
};
