import React, { useMemo, useEffect, useRef, useState, Suspense } from "react";
import { useAuth } from "./context/AuthContext";
import {
  Calculator,
  LogOut,
  BarChart,
  Users,
  FileText,
  Save,
  Menu,
  ArrowLeft,
  LayoutGrid,
  Database,
  X,
  CheckCircle,
  AlertCircle,
  Loader2,
  Calendar,
  Pencil,
  Trash2,
  AlertTriangle,
  Settings,
  Upload,
  FileSpreadsheet,
  Download,
  FileIcon,
  Lock,
  Trophy,
} from "lucide-react";
import { AttendanceRegister } from "./components/AttendanceRegister";
import { RankingReport } from "./components/RankingReport";

const SystemSetup = React.lazy(() =>
  import("./components/SystemSetup").then((module) => ({
    default: module.SystemSetup,
  })),
);
const ReportCards = React.lazy(() => import("./components/ReportCards"));

import { logger } from "./lib/logger";
import { apiClient } from "./lib/apiClient";
import { calculateGrade } from "./lib/grading";
import { AssessmentMarkRow, RankingData, RankingRow } from "./lib/apiTypes";
import { SyncClient } from "./lib/syncClient";
import { offlineDb, type OfflineStudent } from "./lib/offlineDb";
import {
  kvGet,
  kvSet,
  list,
  getUsage,
  getData,
  remove,
  cleanup,
  saveUploadedFile,
  saveDownloadedContent,
} from "./lib/storage";

// Unused imports removed: saveMarksSession, loadMarksSession, subscribeAssessments, saveUploadedFile, saveDownloadedContent, list, getUsage, getData, remove, cleanup, kvGet, kvSet, kvRemove
import { SystemConfigStorage, type SchoolConfig } from "./lib/configStorage";
import { buildImportedStudents } from "./lib/masterdbImport";
import ProgressBar from "./components/ProgressBar";
import SignOutButton from "./components/SignOutButton";

const MasterDBSyncControls: React.FC = () => null;

// --- Chunked Upload Helper ---
async function uploadFileChunked(
  file: File,
  onProgress: (pct: number) => void,
): Promise<number> {
  const token =
    localStorage.getItem("token") || localStorage.getItem("API_AUTH_TOKEN");
  const headers = { Authorization: `Bearer ${token}` };

  // 1. Init
  const initRes = await fetch("/api/students/upload/init", {
    method: "POST",
    headers,
  });
  if (!initRes.ok) throw new Error("Failed to init upload");
  const { uploadId } = await initRes.json();

  const CHUNK_SIZE = 5 * 1024 * 1024; // 5MB
  const totalChunks = Math.ceil(file.size / CHUNK_SIZE);
  let uploadedChunks = 0;

  const chunks = Array.from({ length: totalChunks }, (_, i) => i);
  const CONCURRENCY = 3; // Parallel processing

  const uploadChunk = async (i: number) => {
    const start = i * CHUNK_SIZE;
    const end = Math.min(start + CHUNK_SIZE, file.size);
    const blob = file.slice(start, end);
    const formData = new FormData();
    formData.append("uploadId", uploadId);
    formData.append("chunkIndex", String(i));
    formData.append("chunk", blob);

    let retries = 3;
    while (retries > 0) {
      try {
        const res = await fetch("/api/students/upload/chunk", {
          method: "POST",
          headers, // Content-Type is auto-set for FormData
          body: formData,
        });
        if (!res.ok) throw new Error(`Chunk ${i} failed`);
        uploadedChunks++;
        onProgress(Math.round((uploadedChunks / totalChunks) * 90));
        return;
      } catch (e) {
        retries--;
        if (retries === 0) throw e;
        await new Promise((r) => setTimeout(r, 1000));
      }
    }
  };

  // Run pool
  const executing: Promise<void>[] = [];
  for (const i of chunks) {
    const p = uploadChunk(i);
    executing.push(p);
    if (executing.length >= CONCURRENCY) {
      await Promise.race(executing);
      // Remove finished
      // Note: Promise.race returns the value of the first resolved, but doesn't mutate array.
      // We need to manage `executing` array.
      // Simpler: Just wait for one to finish.
      // Actually, standard pool pattern:
    }
    // Clean up finished promises
    // This simple loop doesn't perfectly cap at CONCURRENCY but keeps adding.
    // Correct pool implementation:
    p.then(() => executing.splice(executing.indexOf(p), 1));
    if (executing.length >= CONCURRENCY) {
      await Promise.race(executing);
    }
  }
  await Promise.all(executing);

  // 2. Complete
  onProgress(95);
  const completeRes = await fetch("/api/students/upload/complete", {
    method: "POST",
    headers: { ...headers, "Content-Type": "application/json" },
    body: JSON.stringify({ uploadId, fileName: file.name }),
  });
  if (!completeRes.ok) {
    const err = await completeRes.json();
    throw new Error(err.error || "Upload processing failed");
  }
  const data = await completeRes.json();
  onProgress(100);
  return data.count;
}

type Gender = "Male" | "Female" | "Other";

interface Student {
  id: string;
  surname: string;
  firstName: string;
  middleName: string;
  gender: Gender;
  dob: string;
  guardianContact: string;
  class: string;
  status: "Active" | "Withdrawn" | "Inactive";
}

interface Marks {
  [studentId: string]: {
    [subject: string]: {
      cat1: number;
      cat2: number;
      cat3: number;
      cat4: number;
      group: number;
      project: number;
      exam: number;
    };
  };
}

type SaveMarksRow = {
  student_id: string;
  cat1: number;
  cat2: number;
  cat3: number;
  cat4: number;
  group: number;
  project: number;
  exam: number;
};

interface GradeConfig {
  min: number;
  max: number;
  grade: number;
  remark: string;
  desc: string;
}

interface ImportLog {
  status: "success" | "error" | "warning";
  message: string;
}

const SUBJECTS = [
  "Mathematics",
  "English Language",
  "Integrated Science",
  "Social Studies",
  "Computing",
  "Career Technology",
  "Creative Arts",
  "French",
  "Ghanaian Language",
  "RME",
];

const AVAILABLE_CLASSES = [
  "JHS 1(A)",
  "JHS 1(B)",
  "JHS 1(C)",
  "JHS 2(A)",
  "JHS 2(B)",
  "JHS 2(C)",
  "JHS 3(A)",
  "JHS 3(B)",
  "JHS 3(C)",
];

const SUBJECT_DISPLAY_NAMES: Record<string, string> = {
  Mathematics: "Mathematics",
  "English Language": "English Language",
  "Integrated Science": "Integrated Science",
  "Social Studies": "Social Studies",
  Computing: "Computing",
  "Career Technology": "Career Technology",
  "Creative Arts": "Creative Arts",
  French: "French",
  "Ghanaian Language": "Ghanaian Language",
  RME: "RME",
};

const verKey = (cls: string, subj: string, ay: string, tm: string): string =>
  `ASSESSREPO::VER:${cls}:${subj}:${ay}:${tm}`;
const lastProcessedKey = (
  cls: string,
  subj: string,
  ay: string,
  tm: string,
): string => `ASSESSREPO::LAST_PROCESSED:${cls}:${subj}:${ay}:${tm}`;

// Removed unused LS keys and helper functions

type TileProps = {
  title: string;
  icon: React.ElementType;
  color: string;
  onClick: () => void;
  imageSrc?: string;
};

const DashboardTile = React.memo(
  ({ title, icon: Icon, color, onClick, imageSrc }: TileProps) => (
    <div className="flex flex-col gap-2">
      <button
        onClick={onClick}
        className={`w-full rounded-xl shadow-sm hover:shadow-md transition-all transform hover:-translate-y-1 text-left flex flex-col justify-between h-40 overflow-hidden ${
          imageSrc ? "bg-white border border-slate-200" : `${color} text-white`
        }`}
        aria-label={title}
      >
        {imageSrc ? (
          <img
            src={imageSrc}
            alt={title}
            className="w-full h-full object-cover"
            loading="lazy"
            decoding="async"
            referrerPolicy="no-referrer"
          />
        ) : (
          <div className="p-6">
            <Icon size={32} className="opacity-80" />
          </div>
        )}
      </button>
      <span className="text-center font-bold text-sm text-slate-700 leading-tight">
        {title}
      </span>
    </div>
  ),
);

export default function App() {
  const { user, logout } = useAuth();
  const [academicYear, setAcademicYear] = useState("2025/2026");
  const [term, setTerm] = useState("Term 1");
  const [currentView, setCurrentView] = useState("home");
  const [isOffline, setIsOffline] = useState(!navigator.onLine);
  const [isSyncing, setIsSyncing] = useState(false);

  const syncClientRef = useRef<SyncClient | null>(null);

  useEffect(() => {
    syncClientRef.current = new SyncClient({
      baseUrl: "/api",
      clientId: "esba-web",
    });

    const handleOnline = () => {
      setIsOffline(false);
      void syncClientRef.current?.syncNow().then(() => {
        setIsSyncing(false);
      });
    };
    const handleOffline = () => {
      setIsOffline(true);
    };

    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);

    if (navigator.onLine) {
      setIsOffline(false);
      setIsSyncing(true);
      void syncClientRef.current
        .syncNow()
        .catch((e) => logger.warn("initial_sync_failed", { error: String(e) }))
        .finally(() => setIsSyncing(false));
    } else {
      setIsOffline(true);
    }

    return () => {
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
    };
  }, []);

  // Ranking Report State
  const [rankingData, setRankingData] = useState<RankingData | RankingRow[]>({
    data: [],
    total: 0,
  });
  const [rankingPage, setRankingPage] = useState(1);
  const [rankingLoading, setRankingLoading] = useState(false);
  const [rankingClassFilter, setRankingClassFilter] = useState("JHS 1");
  const [rankingError, setRankingError] = useState<string | null>(null);
  const [isImporting, setIsImporting] = useState(false);

  const fetchRankings = async () => {
    setRankingLoading(true);
    try {
      setRankingError(null);
      const res = await apiClient.getRankings(
        rankingClassFilter,
        academicYear,
        term,
        rankingPage,
        50,
      );
      setRankingData(res);
    } catch (e) {
      const msg = (e as Error).message || "Failed to load rankings";
      setRankingError(msg);
    } finally {
      setRankingLoading(false);
    }
  };

  const downloadRankingReport = async () => {
    try {
      const allData = await apiClient.getRankings(
        rankingClassFilter,
        academicYear,
        term,
        1,
        1000, // Fetch all for report
      );

      const { jsPDF } = await import("jspdf");
      const { default: autoTable } = await import("jspdf-autotable");
      const doc = new jsPDF();

      // Header
      doc.setFontSize(18);
      doc.text("Student Ranking Report", 14, 20);

      doc.setFontSize(11);
      doc.setTextColor(100);
      doc.text(`Class Level: ${rankingClassFilter}`, 14, 30);
      doc.text(`Academic Year: ${academicYear} - ${term}`, 14, 36);
      doc.text(
        `Date: ${new Date().toLocaleDateString()} ${new Date().toLocaleTimeString()}`,
        14,
        42,
      );

      // Table
      autoTable(doc, {
        startY: 50,
        head: [["Rank", "Student Name", "Class", "Overall Score"]],
        body: allData.data.map((s: RankingRow) => [
          s.position,
          `${s.surname}, ${s.first_name} ${s.middle_name}`,
          s.class_name,
          s.overall_score.toFixed(2),
        ]),
        theme: "grid",
        headStyles: { fillColor: [30, 41, 59] }, // slate-800
        styles: { fontSize: 10 },
      });

      doc.save(`Ranking_Report_${rankingClassFilter.replace(/ /g, "_")}.pdf`);
    } catch (e) {
      const msg = (e as Error).message || "Failed to generate PDF report.";
      alert(
        msg.includes("Access denied")
          ? "Access denied. Please sign in as Head Teacher."
          : "Failed to generate PDF report.",
      );
    }
  };

  useEffect(() => {
    if (currentView === "ranking") {
      fetchRankings();
    }
  }, [currentView, rankingClassFilter, academicYear, term, rankingPage]);
  const [activeSubject, setActiveSubject] = useState("");
  const [selectedClass, setSelectedClass] = useState("JHS 2(A)");

  // Sync Global Class Selector to Ranking Class Filter
  useEffect(() => {
    if (selectedClass) {
      const level = selectedClass.split("(")[0].trim();
      if (["JHS 1", "JHS 2", "JHS 3"].includes(level)) {
        setRankingClassFilter(level);
      }
    }
  }, [selectedClass]);

  const [schoolConfig, setSchoolConfig] = useState<SchoolConfig>({
    name: "Accra Excellence JHS",
    motto: "Discipline and Hard Work",
    headTeacher: "Mr. Emmanuel Ofori",
    address: "P.O. Box 123, Accra, Ghana",
    catWeight: 50,
    examWeight: 50,
    logoUrl: null,
    signatureEnabled: true,
    headSignatureUrl: null,
  });

  useEffect(() => {
    if (user?.role === "CLASS" && user.assignedClassName) {
      setSelectedClass(user.assignedClassName);
    }
    if (user?.role === "SUBJECT" && user.assignedSubjectName) {
      setActiveSubject(user.assignedSubjectName);
    }
  }, [user, currentView]);

  const [gradingSystem] = useState<GradeConfig[]>([
    { min: 80, max: 100, grade: 1, remark: "Highest", desc: "Distinction" },
    { min: 70, max: 79, grade: 2, remark: "High", desc: "Very Good" },
    { min: 60, max: 69, grade: 3, remark: "High Average", desc: "Good" },
    { min: 55, max: 59, grade: 4, remark: "Average", desc: "Credit" },
    { min: 50, max: 54, grade: 5, remark: "Low Average", desc: "Pass" },
    { min: 45, max: 49, grade: 6, remark: "Low", desc: "Weak" },
    { min: 40, max: 44, grade: 7, remark: "Lower", desc: "Very Weak" },
    { min: 35, max: 39, grade: 8, remark: "Lowest", desc: "Fail" },
    { min: 0, max: 34, grade: 9, remark: "Fail", desc: "Fail" },
  ]);

  const [isModalOpen, setIsModalOpen] = useState(false);
  const addStudentFirstFieldRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (isModalOpen) {
      setTimeout(() => addStudentFirstFieldRef.current?.focus(), 0);
    }
  }, [isModalOpen]);
  const [editingStudent, setEditingStudent] = useState<Student | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [showSuccess, setShowSuccess] = useState(false);

  const [isImportModalOpen, setIsImportModalOpen] = useState(false);
  const [importLogs, setImportLogs] = useState<ImportLog[]>([]);
  const [isStorageOpen, setIsStorageOpen] = useState(false);
  const [storageItems, setStorageItems] = useState<
    Awaited<ReturnType<typeof list>>
  >([]);
  const [storageUsage, setStorageUsage] = useState<{
    quota?: number;
    usage?: number;
    lsBytes: number;
  }>({ lsBytes: 0 });
  const [isExcelViewerOpen, setIsExcelViewerOpen] = useState(false);
  const [excelViewerLoading, setExcelViewerLoading] = useState(false);
  const [excelViewerError, setExcelViewerError] = useState<string | null>(null);
  const [excelViewerSheets, setExcelViewerSheets] = useState<
    Array<{
      name: string;
      headers: string[];
      rows: Array<Record<string, unknown>>;
    }>
  >([]);
  const [excelViewerMeta, setExcelViewerMeta] = useState<{
    name?: string;
    size?: number;
    type?: string;
    macro?: boolean;
  } | null>(null);
  const [excelViewerActive, setExcelViewerActive] = useState(0);

  const [attendanceMap, setAttendanceMap] = useState<
    Record<string, { present: number; total: number }>
  >({});

  // Fetch Subject Sheet Marks
  useEffect(() => {
    let cancelled = false;
    const subject = activeSubject;
    const cls = selectedClass;
    const year = academicYear;
    const t = term;
    if (!subject || !cls || !year || !t) return;
    (async () => {
      try {
        const data = await apiClient.getSubjectSheet({
          subject,
          class: cls,
          academicYear: year,
          term: t,
        });

        const rows = Array.isArray(data.rows) ? data.rows : [];

        if (cancelled) return;
        // saveMarksSession removed (no redundant save)
        if (rows.length === 0) {
          setImportLogs((prev) => [
            ...prev,
            {
              status: "warning",
              message: "No saved marks found for selection.",
            },
          ]);
          return;
        }
        setMarks((prev) => {
          const next: Marks = { ...prev };
          for (const r of rows) {
            const sid = String(r.student_id || "");
            if (!sid) continue;
            next[sid] =
              next[sid] ||
              ({} as Record<
                string,
                {
                  cat1: number;
                  cat2: number;
                  cat3: number;
                  cat4: number;
                  group: number;
                  project: number;
                  exam: number;
                }
              >);
            const row = r as unknown as AssessmentMarkRow;
            next[sid][subject] = {
              cat1: Number(row.cat1 ?? row.cat1_score ?? 0),
              cat2: Number(row.cat2 ?? row.cat2_score ?? 0),
              cat3: Number(row.cat3 ?? row.cat3_score ?? 0),
              cat4: Number(row.cat4 ?? row.cat4_score ?? 0),
              group: Number(row.group ?? row.group_work_score ?? 0),
              project: Number(row.project ?? row.project_work_score ?? 0),
              exam: Number(row.exam ?? row.exam_score ?? 0),
            };
          }
          return next;
        });
        setImportLogs((prev) => [
          ...prev,
          { status: "success", message: `Loaded ${rows.length} saved marks.` },
        ]);
      } catch (e) {
        logger.error("marks_load_exception", e);
        setImportLogs((prev) => [
          ...prev,
          { status: "error", message: "Error loading saved marks." },
        ]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [activeSubject, selectedClass, academicYear, term]);

  // Fetch Class Attendance (Independent of Active Subject)
  useEffect(() => {
    let cancelled = false;
    const cls = selectedClass;
    const year = academicYear;
    const t = term;
    if (!cls || !year || !t) return;

    (async () => {
      try {
        const attendanceData = await apiClient.getClassAttendance({
          className: cls,
          academicYear: year,
          term: t,
        });

        if (cancelled) return;

        if (Array.isArray(attendanceData)) {
          setAttendanceMap((prev) => {
            const next = { ...prev };
            attendanceData.forEach((a) => {
              if (a.student_id) {
                next[a.student_id] = {
                  present: Number(a.days_present || 0),
                  total: Number(a.days_total || 0),
                };
              }
            });
            return next;
          });
        }
      } catch (e) {
        logger.error("attendance_load_failed", e);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [selectedClass, academicYear, term]);

  // Fetch All Class Marks for Report Card Aggregation
  useEffect(() => {
    if (currentView !== "report") return;
    const cls = selectedClass;
    const year = academicYear;
    const t = term;
    if (!cls || !year || !t) return;

    (async () => {
      try {
        const allMarks = await apiClient.getAllClassMarks({
          class: cls,
          academicYear: year,
          term: t,
        });

        setMarks((prev) => {
          const next: Marks = { ...prev };

          Object.entries(allMarks).forEach(([subject, rows]) => {
            rows.forEach((r: AssessmentMarkRow) => {
              const sid = String(r.student_id);
              if (!next[sid]) {
                next[sid] = {};
              }
              next[sid][subject] = {
                cat1: Number(r.cat1 || 0),
                cat2: Number(r.cat2 || 0),
                cat3: Number(r.cat3 || 0),
                cat4: Number(r.cat4 || 0),
                group: Number(r.group || 0),
                project: Number(r.project || 0),
                exam: Number(r.exam || 0),
              };
            });
          });
          return next;
        });
      } catch (e) {
        logger.error("Failed to fetch all class marks for report", e);
      }
    })();
  }, [currentView, selectedClass, academicYear, term]);

  // removed legacy subscribeAssessments
  type ImportedRow = Record<string, unknown>;
  const [importedPreview, setImportedPreview] = useState<ImportedRow[]>([]);
  const [selectedImportFile, setSelectedImportFile] = useState<File | null>(
    null,
  );
  const [importProgress, setImportProgress] = useState(0);

  const importFileInputRef = useRef<HTMLInputElement>(null);

  const [deleteConfirmation, setDeleteConfirmation] = useState({
    isOpen: false,
    studentId: null as string | null,
  });

  const [isWipeModalOpen, setIsWipeModalOpen] = useState(false);
  const [isWiping, setIsWiping] = useState(false);

  const [isGeneratingDoc, setIsGeneratingDoc] = useState(false);
  const [docStatus, setDocStatus] = useState("");

  const [formData, setFormData] = useState({
    id: "",
    surname: "",
    firstName: "",
    middleName: "",
    gender: "Male" as Gender,
    dob: "",
    guardianContact: "",
    class: "JHS 1",
    status: "Active" as "Active" | "Withdrawn" | "Inactive",
  });
  const [formErrors, setFormErrors] = useState<{ [key: string]: string }>({});

  const [students, setStudents] = useState<Student[]>([]);
  const existingStudentIds = useMemo(
    () => new Set((students || []).map((s) => s.id)),
    [students],
  );
  const filteredStudents = useMemo(() => {
    const level = (selectedClass || "").split("(")[0].trim();
    return (students || []).filter((s) => {
      const sLevel = (s.class || "").split("(")[0].trim();
      const classMatch = s.class === selectedClass || sLevel === level;
      const statusOk = s.status === "Active" || s.status === "Inactive";
      return classMatch && statusOk;
    });
  }, [students, selectedClass]);

  const [marks, setMarks] = useState<Marks>({});
  const [subjectRevealStep, setSubjectRevealStep] = useState(0);

  const classStats = useMemo(() => {
    if (!activeSubject) return null;

    const stats = {
      cat1: [] as number[],
      cat2: [] as number[],
      group: [] as number[],
      project: [] as number[],
      rawSBA: [] as number[],
      scaledSBA: [] as number[],
      exam: [] as number[],
      scaledExam: [] as number[],
      final: [] as number[],
      attendance: [] as number[],
    };

    filteredStudents.forEach((s) => {
      const m = marks[s.id]?.[activeSubject];
      const att = attendanceMap[s.id];
      if (att && att.total > 0) {
        stats.attendance.push((att.present / att.total) * 100);
      }

      if (m) {
        if (m.cat1 !== undefined) stats.cat1.push(m.cat1);
        if (m.cat2 !== undefined) stats.cat2.push(m.cat2);
        if (m.group !== undefined) stats.group.push(m.group);
        if (m.project !== undefined) stats.project.push(m.project);

        const rawSBA =
          (m.cat1 || 0) + (m.cat2 || 0) + (m.group || 0) + (m.project || 0);
        stats.rawSBA.push(rawSBA);

        const scaledSBA = (rawSBA / 60) * schoolConfig.catWeight;
        stats.scaledSBA.push(scaledSBA);

        if (m.exam !== undefined) stats.exam.push(m.exam);
        const scaledExam = ((m.exam || 0) / 100) * schoolConfig.examWeight;
        stats.scaledExam.push(scaledExam);

        stats.final.push(Math.round(scaledSBA + scaledExam));
      }
    });

    const calc = (arr: number[]) => ({
      avg:
        arr.length > 0
          ? (arr.reduce((a, b) => a + b, 0) / arr.length).toFixed(1)
          : "-",
      max: arr.length > 0 ? Math.max(...arr).toFixed(1) : "-",
      min: arr.length > 0 ? Math.min(...arr).toFixed(1) : "-",
      cnt: arr.length,
    });

    return {
      cat1: calc(stats.cat1),
      cat2: calc(stats.cat2),
      group: calc(stats.group),
      project: calc(stats.project),
      rawSBA: calc(stats.rawSBA),
      scaledSBA: calc(stats.scaledSBA),
      exam: calc(stats.exam),
      scaledExam: calc(stats.scaledExam),
      final: calc(stats.final),
      attendance: calc(stats.attendance),
    };
  }, [filteredStudents, marks, activeSubject, schoolConfig, attendanceMap]);

  // Load students from SQL API (replaces LS)
  useEffect(() => {
    const loadStudents = async () => {
      try {
        if (navigator.onLine) {
          const data = await apiClient.getStudents();
          setStudents(data);
          logger.info("students_loaded_api", { count: data.length });
          const docs: OfflineStudent[] = data.map((s) => ({
            id: s.id,
            surname: s.surname,
            firstName: s.firstName,
            middleName: s.middleName,
            gender: s.gender,
            dob: s.dob,
            guardianContact: s.guardianContact,
            class: s.class,
            status: s.status,
            version: 1,
          }));
          for (const d of docs) await offlineDb.putStudent(d);
        } else {
          const cached = await offlineDb.getStudentsByClass();
          const mapped: Student[] = cached.map((c) => ({
            id: c.id,
            surname: c.surname,
            firstName: c.firstName,
            middleName: c.middleName || "",
            gender: c.gender as Gender,
            dob: c.dob,
            guardianContact: c.guardianContact || "",
            class: c.class,
            status:
              (c.status as "Active" | "Withdrawn" | "Inactive") || "Active",
          }));
          setStudents(mapped);
          logger.info("students_loaded_offline", { count: mapped.length });
        }
      } catch (e) {
        logger.error("students_load_failed", e);
      }
    };
    if (localStorage.getItem("token")) {
      loadStudents();
    }
  }, []);

  // Removed old LS effects for students/marks loading/saving

  // Auto-save marks to SQL DB
  useEffect(() => {
    if (currentView !== "subject" || !activeSubject || !selectedClass) return;

    const timer = setTimeout(() => {
      const classStudents = students.filter(
        (s) => s.class === selectedClass && s.status === "Active",
      );
      const rows: SaveMarksRow[] = [];
      for (const s of classStudents) {
        const m = marks[s.id]?.[activeSubject];
        if (m) {
          rows.push({
            student_id: s.id,
            cat1: m.cat1,
            cat2: m.cat2,
            cat3: m.cat3,
            cat4: m.cat4,
            group: m.group,
            project: m.project,
            exam: m.exam,
          });
        }
      }

      if (rows.length > 0) {
        apiClient
          .request("/assessments/save", "POST", {
            class: selectedClass,
            subject: activeSubject,
            year: academicYear,
            term: term,
            rows: rows,
          })
          .catch((e) => console.error("Auto-save failed", e));
      }
    }, 1000);

    return () => clearTimeout(timer);
  }, [marks, activeSubject, selectedClass, academicYear, term, currentView]);

  // Load System Config
  useEffect(() => {
    const loadConfig = async () => {
      try {
        const { school, academic } = await SystemConfigStorage.loadAll();
        if (school) {
          setSchoolConfig(school);
          logger.info("system_config_loaded", { type: "school" });
        }
        if (academic) {
          setAcademicYear(academic.academicYear);
          setTerm(academic.term);
          logger.info("system_config_loaded", { type: "academic" });
        }
      } catch (e) {
        logger.error("system_config_load_failed", e);
      }
    };
    loadConfig();
  }, []);

  // Duplicate auto-save logic removed.
  // Use manual save for Talent (handleSaveTalent) and filtered auto-save for Attendance (below).

  // Save System Config
  useEffect(() => {
    if (!user || user.role !== "HEAD") return;

    const timer = setTimeout(async () => {
      try {
        await SystemConfigStorage.saveAll(schoolConfig, { academicYear, term });
      } catch (e) {
        // Suppress auth errors if they somehow slip through
        if ((e as Error).message.includes("Authentication required")) return;
        logger.error("system_config_save_failed", e);
      }
    }, 1000); // Debounce save
    return () => clearTimeout(timer);
  }, [schoolConfig, academicYear, term, user]);

  const academicYearOptions = useMemo(() => {
    const years: string[] = [];
    for (let year = 2025; year <= 2090; year++) {
      years.push(`${year}/${year + 1}`);
    }
    return years;
  }, []);

  const clamp = (f: string, n: number) => {
    const v = Number.isFinite(n) ? n : 0;
    if (f === "exam") return Math.max(0, Math.min(100, v));
    if (["cat1", "cat2", "group", "project"].includes(f))
      return Math.max(0, Math.min(15, v));
    return Math.max(0, v);
  };

  const updateMark = (studentId: string, field: string, value: string) => {
    if (user?.role === "CLASS") {
      alert("Access Denied: You do not have permission to edit Subject Marks.");
      return;
    }
    const val = clamp(field, parseInt(value) || 0);
    setMarks((prev) => ({
      ...prev,
      [studentId]: {
        ...prev[studentId],
        [activeSubject]: {
          ...(prev[studentId]?.[activeSubject] || {
            cat1: 0,
            cat2: 0,
            cat3: 0,
            cat4: 0,
            group: 0,
            project: 0,
            exam: 0,
          }),
          [field]: val,
        },
      },
    }));
  };

  const handleExcelUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const validExtensions = [".xlsx", ".xls"];
    const fileName = file.name.toLowerCase();
    const isValidExtension = validExtensions.some((ext) =>
      fileName.endsWith(ext),
    );
    if (!isValidExtension) {
      setImportLogs((prev) => [
        ...prev,
        {
          status: "error",
          message: "Invalid file type. Please upload .xlsx or .xls files only.",
        },
      ]);
      return;
    }

    setIsImporting(true);
    setImportLogs([]);
    setImportedPreview([]);
    setSelectedImportFile(file);
    setImportProgress(0);

    (async () => {
      try {
        await saveUploadedFile(
          undefined,
          file,
          ["excel-import", selectedClass || ""],
          undefined,
        );
      } catch {
        void 0;
      }
    })();

    const reader = new FileReader();
    reader.onload = async (evt) => {
      try {
        const XLSX = await import("xlsx");
        const data = evt.target?.result as ArrayBuffer;
        const workbook = XLSX.read(data, {
          type: "array",
          cellDates: true,
          cellNF: true,
          cellText: true,
        });
        const firstSheetName = workbook.SheetNames[0];
        const worksheet = workbook.Sheets[firstSheetName];
        const jsonData = XLSX.utils.sheet_to_json(worksheet, {
          raw: false,
          defval: "",
        }) as Record<string, unknown>[];
        if (jsonData.length === 0) throw new Error("File appears to be empty.");
        const normalizedData = jsonData.map((row) => {
          const newRow: ImportedRow = {};
          Object.keys(row).forEach((key) => {
            newRow[key.toLowerCase().trim()] = (row as Record<string, unknown>)[
              key
            ];
          });
          return newRow;
        });
        const ref = worksheet["!ref"] || "";
        const range = XLSX.utils.decode_range(ref);
        type Cell = {
          w?: string;
          t?: string;
          v?: unknown;
          f?: string;
          z?: string | number;
        };
        const cells: Array<{
          addr: string;
          r: number;
          c: number;
          t?: string;
          v?: unknown;
          w?: string;
          f?: string;
          z?: string;
        }> = [];
        for (let R = range.s.r; R <= range.e.r; R++) {
          for (let C = range.s.c; C <= range.e.c; C++) {
            const addr = XLSX.utils.encode_cell({ r: R, c: C });
            const cell = (worksheet as unknown as Record<string, Cell>)[addr];
            if (!cell) continue;
            const w =
              cell.w ||
              (cell.v !== undefined && cell.v !== null ? String(cell.v) : "");
            cells.push({
              addr,
              r: R,
              c: C,
              t: cell.t,
              v: cell.v,
              w,
              f: cell.f,
              z: typeof cell.z === "string" ? cell.z : undefined,
            });
          }
        }
        const rich = {
          sheet: firstSheetName,
          ref,
          rows: normalizedData,
          cells,
        };
        setImportedPreview(normalizedData);
        setImportLogs((prev) => [
          ...prev,
          {
            status: "success",
            message: `Successfully parsed ${jsonData.length} records. Please review below.`,
          },
        ]);
        try {
          await saveDownloadedContent(
            undefined,
            JSON.stringify(rich),
            "application/json",
            ["excel-import-json", selectedClass || ""],
            undefined,
            true,
            file.name,
          );
        } catch {
          void 0;
        }
      } catch (err) {
        logger.error("Excel parse error", err);
        setImportLogs((prev) => [
          ...prev,
          {
            status: "error",
            message:
              "Failed to parse file. Ensure it is a valid, non-corrupted Excel file.",
          },
        ]);
      } finally {
        setIsImporting(false);
      }
    };
    reader.onerror = () => {
      setImportLogs((prev) => [
        ...prev,
        { status: "error", message: "Error reading file from disk." },
      ]);
      setIsImporting(false);
    };
    reader.readAsArrayBuffer(file);
  };

  const refreshStorage = async () => {
    try {
      const items = await list({ tag: "excel-import" });
      const jsonItems = await list({ tag: "excel-import-json" });
      const merged = [...items, ...jsonItems].sort(
        (a, b) => b.timestamp - a.timestamp,
      );
      setStorageItems(merged);
      const usage = await getUsage();
      setStorageUsage(usage);
    } catch {
      void 0;
    }
  };

  useEffect(() => {
    if (isStorageOpen) refreshStorage();
  }, [isStorageOpen]);

  const downloadStoredItem = async (id: string) => {
    try {
      const v = await getData(id);
      if (!v) return;
      const payload =
        typeof v.data === "string"
          ? new Blob([v.data], { type: v.meta.type })
          : new Blob([v.data as ArrayBuffer], { type: v.meta.type });
      const a = document.createElement("a");
      a.href = URL.createObjectURL(payload);
      a.download = v.meta.name || v.meta.id;
      a.click();
      URL.revokeObjectURL(a.href);
    } catch {
      void 0;
    }
  };

  const deleteStoredItem = async (id: string) => {
    try {
      await remove(id);
      await refreshStorage();
    } catch {
      void 0;
    }
  };

  const clearExcelStorage = async () => {
    try {
      await cleanup({
        predicate: (m) =>
          (m.tags || []).includes("excel-import") ||
          (m.tags || []).includes("excel-import-json"),
      });
      await refreshStorage();
    } catch {
      void 0;
    }
  };

  const openStoredExcel = async (id: string) => {
    setExcelViewerLoading(true);
    setExcelViewerError(null);
    setIsExcelViewerOpen(true);
    setExcelViewerSheets([]);
    setExcelViewerMeta(null);
    try {
      const v = await getData(id);
      if (!v || typeof v.data === "string")
        throw new Error("Invalid file payload");
      const bytes = new Uint8Array(v.data as ArrayBuffer);
      if (!(bytes[0] === 0x50 && bytes[1] === 0x4b))
        throw new Error("File integrity check failed");
      await new Promise((r) => setTimeout(r, 0));
      const macroMode = /\.xlsm$/i.test(v.meta.name || "");
      const t0 = performance.now();
      const XLSX = await import("xlsx");
      const wb = XLSX.read(v.data as ArrayBuffer, {
        type: "array",
        cellDates: true,
        cellNF: true,
        cellText: true,
        raw: false,
        bookVBA: true,
        bookFiles: true,
        bookProps: true,
      });
      const hasVBA = Boolean(
        (wb as unknown as Record<string, unknown>)["vbaraw"],
      );
      const sheets: Array<{
        name: string;
        headers: string[];
        rows: Array<Record<string, unknown>>;
      }> = [];
      for (const sheetName of wb.SheetNames) {
        const ws = wb.Sheets[sheetName];
        const data = XLSX.utils.sheet_to_json(ws, {
          raw: false,
          defval: "",
        }) as Array<Record<string, unknown>>;
        const headers: string[] = [];
        if (data.length) headers.push(...Object.keys(data[0]));
        sheets.push({ name: sheetName, headers, rows: data });
      }
      setExcelViewerSheets(sheets);
      setExcelViewerMeta({
        name: v.meta.name,
        size: v.meta.size,
        type: v.meta.type,
        macro: macroMode || hasVBA,
      });
      setExcelViewerActive(0);
      const t1 = performance.now();
      logger.info("excel_open_ok", {
        id,
        sheets: sheets.length,
        size: v.meta.size,
        ms: Math.round(t1 - t0),
      });
    } catch (e) {
      const msg = (e as Error)?.message || "Failed to open Excel file";
      setExcelViewerError(msg);
      logger.error("excel_open_failed", msg);
    } finally {
      setExcelViewerLoading(false);
    }
  };

  const processImport = async () => {
    if (!selectedImportFile && importedPreview.length === 0) return;
    setIsImporting(true);
    setImportProgress(0);
    // Yield to allow UI update
    await new Promise((resolve) => setTimeout(resolve, 0));

    try {
      if (selectedImportFile) {
        // Client-side Validation
        if (selectedImportFile.size === 0) throw new Error("File is empty");

        const count = await uploadFileChunked(selectedImportFile, (pct) =>
          setImportProgress(pct),
        );

        setImportLogs((prev) => [
          ...prev,
          {
            status: "success",
            message: `Import Successful! Processed ${count} records via fast upload.`,
          },
        ]);

        // Refresh list
        try {
          const fresh = await apiClient.getStudents();
          setStudents(fresh);
          const currentLevel = (selectedClass || "").split("(")[0].trim();
          const hasCurrent =
            fresh.filter((s) => {
              const sLevel = (s.class || "").split("(")[0].trim();
              return s.class === selectedClass || sLevel === currentLevel;
            }).length > 0;
          if (!hasCurrent && fresh.length > 0) {
            const counts: Record<string, number> = {};
            fresh.forEach((s) => {
              const lvl = (s.class || "").split("(")[0].trim();
              counts[lvl] = (counts[lvl] || 0) + 1;
            });
            const bestLevel = Object.entries(counts).sort(
              (a, b) => b[1] - a[1],
            )[0]?.[0];
            if (bestLevel) {
              const pick =
                AVAILABLE_CLASSES.find((c) => c.startsWith(bestLevel)) ||
                selectedClass;
              setSelectedClass(pick);
            }
          }
        } catch {
          // ignore
        }
      } else {
        // Fallback to legacy client-side processing
        const { newStudents, addedCount, skippedCount } = buildImportedStudents(
          importedPreview,
          existingStudentIds,
          selectedClass,
          academicYear,
        );
        if (newStudents.length > 0) {
          const CHUNK_SIZE = 50;
          const total = newStudents.length;
          let processed = 0;
          for (let i = 0; i < total; i += CHUNK_SIZE) {
            const chunk = newStudents.slice(i, i + CHUNK_SIZE);
            await apiClient.request("/students/batch", "POST", {
              students: chunk,
            });
            processed += chunk.length;
            setImportProgress(Math.round((processed / total) * 100));
          }

          // Refresh list
          try {
            const fresh = await apiClient.getStudents();
            setStudents(fresh);
            const currentLevel = (selectedClass || "").split("(")[0].trim();
            const hasCurrent =
              fresh.filter((s) => {
                const sLevel = (s.class || "").split("(")[0].trim();
                return s.class === selectedClass || sLevel === currentLevel;
              }).length > 0;
            if (!hasCurrent && fresh.length > 0) {
              const counts: Record<string, number> = {};
              fresh.forEach((s) => {
                const lvl = (s.class || "").split("(")[0].trim();
                counts[lvl] = (counts[lvl] || 0) + 1;
              });
              const bestLevel = Object.entries(counts).sort(
                (a, b) => b[1] - a[1],
              )[0]?.[0];
              if (bestLevel) {
                const pick =
                  AVAILABLE_CLASSES.find((c) => c.startsWith(bestLevel)) ||
                  selectedClass;
                setSelectedClass(pick);
              }
            }
          } catch {
            // ignore
          }

          setImportLogs((prev) => [
            ...prev,
            {
              status: "success",
              message: `Import Successful! Added ${addedCount} students.`,
            },
          ]);
          if (skippedCount > 0) {
            setImportLogs((prev) => [
              ...prev,
              {
                status: "warning",
                message: `Skipped ${skippedCount} duplicates or incomplete records.`,
              },
            ]);
          }
        } else {
          setImportLogs((prev) => [
            ...prev,
            {
              status: "warning",
              message:
                "No valid students found to import. Check required columns.",
            },
          ]);
        }
      }
      setImportedPreview([]);
      setSelectedImportFile(null);
    } catch (e) {
      setImportLogs((prev) => [
        ...prev,
        {
          status: "error",
          message: e instanceof Error ? e.message : "unsucessful",
        },
      ]);
      console.error("Import processing error:", e);
    } finally {
      setIsImporting(false);
      setImportProgress(0);
    }
  };

  const exportDBToExcel = () => {
    setIsGeneratingDoc(true);
    setDocStatus("Preparing Excel file...");
    setTimeout(async () => {
      try {
        const XLSX = await import("xlsx");
        const ws = XLSX.utils.json_to_sheet(
          students.map((s) => ({
            ID: s.id,
            Surname: s.surname,
            "First Name": s.firstName,
            "Middle Name": s.middleName,
            Gender: s.gender,
            Class: s.class,
            Status: s.status,
            DOB: s.dob,
            Contact: s.guardianContact,
          })),
        );
        const wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, ws, "MasterDB");
        const wbx = wb as unknown as {
          Workbook?: {
            Sheets?: Array<{ Hidden?: number }>;
            Views?: Array<Record<string, unknown>>;
          };
          SheetNames?: string[];
        };
        if (!wbx.Workbook) wbx.Workbook = { Sheets: [], Views: [] };
        const names = Array.isArray(wbx.SheetNames)
          ? wbx.SheetNames
          : ["MasterDB"];
        wbx.Workbook.Sheets = names.map(() => ({ Hidden: 0 }));
        wbx.Workbook.Views = [{ activeTab: 0 }];
        XLSX.writeFile(
          wb,
          `MasterDB_${selectedClass}_${
            new Date().toISOString().split("T")[0]
          }.xlsx`,
        );
        setDocStatus("Download Started");
      } catch (e) {
        logger.error("Excel export error", e);
      }
      setIsGeneratingDoc(false);
    }, 500);
  };

  const exportDBToPDF = () => {
    setIsGeneratingDoc(true);
    setDocStatus("Generating PDF...");
    setTimeout(() => {
      try {
        const run = async () => {
          const { jsPDF } = await import("jspdf");
          const { default: autoTable } = await import("jspdf-autotable");
          const doc = new jsPDF();
          doc.setFontSize(16);
          doc.text(schoolConfig.name, 14, 15);
          doc.setFontSize(10);
          doc.text(`Master Student Database - ${selectedClass}`, 14, 22);
          doc.text(`Generated: ${new Date().toLocaleString()}`, 14, 27);
          const tableColumn = [
            "ID",
            "Name",
            "Gender",
            "DOB",
            "Contact",
            "Status",
          ];
          const tableRows = students
            .filter((s) => s.class === selectedClass)
            .map((s) => [
              s.id,
              `${s.surname}, ${s.firstName} ${s.middleName}`,
              s.gender,
              s.dob,
              s.guardianContact,
              s.status,
            ]);
          (
            autoTable as unknown as (
              doc: InstanceType<typeof jsPDF>,
              opts: unknown,
            ) => void
          )(doc, {
            head: [tableColumn],
            body: tableRows,
            startY: 35,
            styles: { fontSize: 8 },
            headStyles: { fillColor: [41, 128, 185] },
          });
          doc.save(`MasterDB_${selectedClass}.pdf`);
        };
        void run();
      } catch (e) {
        logger.error("PDF export error", e);
      }
      setIsGeneratingDoc(false);
    }, 500);
  };

  // Subject PDF export removed in favor of structured template downloads

  useEffect(() => {
    void schoolConfig.headSignatureUrl;
  }, [schoolConfig.headSignatureUrl]);

  const handleInputChange = (
    e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>,
  ) => {
    const { name, value } = e.target;
    setFormData((prev) => ({ ...prev, [name]: value }));
    if (formErrors[name]) setFormErrors((prev) => ({ ...prev, [name]: "" }));
  };

  const validateForm = () => {
    const errors: { [key: string]: string } = {};
    const nameRegex = /^[a-zA-Z\s-]+$/;
    const idRegex = /^[a-zA-Z0-9]+$/;
    const phoneRegex = /^[0-9]{10,13}$/;
    if (!formData.id.trim()) errors.id = "Student ID is required";
    else if (!idRegex.test(formData.id)) errors.id = "ID must be alphanumeric";
    else {
      const duplicate = students.find((s) => s.id === formData.id);
      if (duplicate && (!editingStudent || duplicate.id !== editingStudent.id))
        errors.id = "Student ID already exists";
    }
    if (!formData.surname.trim()) errors.surname = "Surname is required";
    else if (!nameRegex.test(formData.surname))
      errors.surname = "Invalid characters in Surname";
    if (!formData.firstName.trim()) errors.firstName = "First Name is required";
    else if (!nameRegex.test(formData.firstName))
      errors.firstName = "Invalid characters";
    if (formData.middleName && !nameRegex.test(formData.middleName))
      errors.middleName = "Invalid characters";
    if (!formData.dob) errors.dob = "Date of Birth is required";
    if (!formData.guardianContact.trim())
      errors.guardianContact = "Contact is required";
    else if (!phoneRegex.test(formData.guardianContact))
      errors.guardianContact = "Invalid phone number";
    if (!formData.class) errors.class = "Class is required";
    if (!formData.gender) errors.gender = "Gender is required";
    setFormErrors(errors);
    return Object.keys(errors).length === 0;
  };

  const handleSaveStudent = async () => {
    if (!validateForm()) return;
    setIsSubmitting(true);
    try {
      const studentData: Student = {
        id: formData.id,
        surname: formData.surname.toUpperCase(),
        firstName: formData.firstName,
        middleName: formData.middleName,
        gender: formData.gender,
        dob: formData.dob,
        guardianContact: formData.guardianContact,
        class: formData.class,
        status: formData.status,
      };

      const offlineDoc: OfflineStudent = {
        id: studentData.id,
        surname: studentData.surname,
        firstName: studentData.firstName,
        middleName: studentData.middleName,
        gender: studentData.gender,
        dob: studentData.dob,
        guardianContact: studentData.guardianContact,
        class: studentData.class,
        status: studentData.status,
        version: 1,
      };
      if (navigator.onLine) {
        await apiClient.upsertStudent(studentData);
        await offlineDb.putStudent(offlineDoc);
      } else {
        await syncClientRef.current?.queueUpsertStudent(offlineDoc);
      }

      // Update local state
      if (editingStudent) {
        setStudents((prev) =>
          prev.map((s) => (s.id === editingStudent.id ? studentData : s)),
        );
      } else {
        setStudents((prev) => [...prev, studentData]);
      }

      setIsSubmitting(false);
      setShowSuccess(true);
      setTimeout(() => closeModal(), 1500);
    } catch (e) {
      console.error("Failed to save student", e);
      setIsSubmitting(false);
      alert("Failed to save student. Please try again.");
    }
  };

  const initiateDelete = (studentId: string) =>
    setDeleteConfirmation({ isOpen: true, studentId });

  const confirmDelete = async () => {
    const idToDelete = deleteConfirmation.studentId;
    if (!idToDelete) return;
    try {
      if (navigator.onLine) {
        await apiClient.deleteStudent(idToDelete);
      } else {
        await syncClientRef.current?.queueDeleteStudent(idToDelete);
      }
      setStudents((prev) => prev.filter((s) => s.id !== idToDelete));
      setMarks((prev) => {
        const newMarks: Marks = { ...prev };
        delete newMarks[idToDelete];
        return newMarks;
      });
      setDeleteConfirmation({ isOpen: false, studentId: null });
    } catch (e) {
      console.error("Failed to delete student", e);
      alert("Failed to delete student.");
    }
  };
  const cancelDelete = () =>
    setDeleteConfirmation({ isOpen: false, studentId: null });

  const openWipeModal = () => {
    setIsWipeModalOpen(true);
  };
  const closeWipeModal = () => {
    setIsWipeModalOpen(false);
  };
  const performWipe = async () => {
    // Second thought confirmation
    if (
      !window.confirm(
        "CRITICAL WARNING: You are about to wipe the entire Neon Database.\n\nThis action cannot be undone. All students, assessments, and records will be permanently deleted.\n\nAre you absolutely sure you want to proceed?",
      )
    ) {
      return;
    }

    setIsWiping(true);
    try {
      try {
        await apiClient.adminClean("yes");
      } catch {
        void 0;
      }
      // Clear local state
      setStudents([]);
      setMarks({} as Marks);
      setFormData({
        id: "",
        surname: "",
        firstName: "",
        middleName: "",
        gender: "Male",
        dob: "",
        guardianContact: "",
        class: "JHS 1",
        status: "Active",
      });
      setFormErrors({});
      setIsModalOpen(false);
      setIsImportModalOpen(false);
      setDeleteConfirmation({ isOpen: false, studentId: null });
      setIsWiping(false);
      setIsWipeModalOpen(false);
    } catch {
      void 0;
      setIsWiping(false);
    }
  };

  const openCreateModal = () => {
    setEditingStudent(null);
    setFormData({
      id: "",
      surname: "",
      firstName: "",
      middleName: "",
      gender: "Male",
      dob: "",
      guardianContact: "",
      class: "JHS 1",
      status: "Active",
    });
    setFormErrors({});
    setShowSuccess(false);
    setIsModalOpen(true);
  };

  const openEditModal = (student: Student) => {
    setEditingStudent(student);
    setFormData({
      id: student.id,
      surname: student.surname,
      firstName: student.firstName,
      middleName: student.middleName,
      gender: student.gender,
      dob: student.dob,
      guardianContact: student.guardianContact,
      class: student.class,
      status: student.status,
    });
    setFormErrors({});
    setShowSuccess(false);
    setIsModalOpen(true);
  };

  const closeModal = () => {
    setIsModalOpen(false);
    setShowSuccess(false);
    setEditingStudent(null);
  };

  const ProgressStats = () => {
    if (!user) return null;

    const calculateSubjectProgress = (subj: string, cls: string) => {
      const studentsInClass = (students || []).filter(
        (s) => s.class === cls && s.status === "Active",
      );
      if (studentsInClass.length === 0) return 0;

      let filled = 0;
      const total = studentsInClass.length * 7; // 7 fields: cat1-4, group, project, exam

      studentsInClass.forEach((s) => {
        const m = marks[s.id]?.[subj];
        if (m) {
          if (m.cat1) filled++;
          if (m.cat2) filled++;
          if (m.cat3) filled++;
          if (m.cat4) filled++;
          if (m.group) filled++;
          if (m.project) filled++;
          if (m.exam) filled++;
        }
      });

      return Math.round((filled / total) * 100);
    };

    return (
      <div className="bg-white p-6 rounded-lg shadow-sm border border-slate-200 mb-6">
        <h3 className="text-lg font-bold text-slate-800 mb-4 flex items-center gap-2">
          <BarChart size={20} /> Assessment Progress ({selectedClass})
        </h3>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {SUBJECTS.filter((s) => {
            if (user.role === "SUBJECT") {
              return s === user.assignedSubjectName;
            }
            return true;
          }).map((subj) => {
            const progress = calculateSubjectProgress(subj, selectedClass);
            return (
              <div
                key={subj}
                className="bg-slate-50 p-3 rounded-md border border-slate-100"
              >
                <div className="flex justify-between text-sm mb-1">
                  <span className="font-medium">
                    {SUBJECT_DISPLAY_NAMES[subj] || subj}
                  </span>
                  <span
                    className={`font-bold ${
                      progress === 100 ? "text-green-600" : "text-blue-600"
                    }`}
                  >
                    {progress}%
                  </span>
                </div>
                <progress
                  value={progress}
                  max={100}
                  className={`w-full h-2 rounded-full overflow-hidden ${
                    progress === 100 ? "accent-green-500" : "accent-blue-500"
                  }`}
                />
              </div>
            );
          })}
        </div>
      </div>
    );
  };

  const renderHome = () => (
    <div className="space-y-6 animate-in fade-in duration-500">
      <div className="bg-white p-6 rounded-lg shadow-sm border border-slate-200">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h2 className="text-2xl font-bold text-slate-800">
              Welcome, {user?.fullName || user?.username || "User"}
            </h2>
            <p className="text-slate-500 text-sm">
              {user?.role === "HEAD"
                ? "Head Teacher (Administrator)"
                : user?.role === "CLASS"
                  ? `Class Teacher - ${user.assignedClassName}`
                  : `Subject Teacher - ${user?.assignedSubjectName || ""}`}
            </p>
          </div>
          <div className="flex items-center gap-4">
            <button
              onClick={logout}
              className="flex items-center gap-2 text-red-600 hover:bg-red-50 px-3 py-1 rounded-md transition-colors"
            >
              <LogOut size={18} /> Sign Out
            </button>
          </div>
        </div>
        <div className="flex flex-wrap gap-6 items-end">
          <div className="flex flex-col space-y-1">
            <label className="text-sm font-medium text-slate-600">
              Academic Year
            </label>
            <select
              value={academicYear}
              onChange={(e) => setAcademicYear(e.target.value)}
              className="p-2 border border-slate-300 rounded-md bg-slate-50 w-40"
              aria-label="Academic Year"
            >
              {academicYearOptions.map((year) => (
                <option key={year} value={year}>
                  {year}
                </option>
              ))}
            </select>
          </div>
          <div className="flex flex-col space-y-1">
            <label className="text-sm font-medium text-slate-600">Term</label>
            <select
              value={term}
              onChange={(e) => setTerm(e.target.value)}
              className="p-2 border border-slate-300 rounded-md bg-slate-50 w-32"
              aria-label="Term"
            >
              <option value="Term 1">Term 1</option>
              <option value="Term 2">Term 2</option>
              <option value="Term 3">Term 3</option>
            </select>
          </div>
          <div className="flex flex-col space-y-1">
            <label className="text-sm font-medium text-slate-600">
              Global Class Filter
            </label>
            <select
              value={selectedClass}
              onChange={(e) => setSelectedClass(e.target.value)}
              className="p-2 border border-slate-300 rounded-md bg-slate-50 w-40 disabled:opacity-50 disabled:cursor-not-allowed"
              aria-label="Global Class Filter"
              disabled={user?.role === "CLASS"}
            >
              <option>JHS 1(A)</option>
              <option>JHS 1(B)</option>
              <option>JHS 1(C)</option>
              <option>JHS 2(A)</option>
              <option>JHS 2(B)</option>
              <option>JHS 2(C)</option>
              <option>JHS 3(A)</option>
              <option>JHS 3(B)</option>
              <option>JHS 3(C)</option>
            </select>
          </div>
        </div>

        {/* Progress Bar for Headmaster */}
        {user?.role === "HEAD" && (
          <div className="mt-6 flex flex-col md:flex-row md:items-end justify-between gap-4">
            <div className="flex-1 w-full">
              <h3 className="text-lg font-semibold text-slate-700 mb-2">
                Overall Progress
              </h3>
              <ProgressBar
                scope="class"
                className={selectedClass}
                academicYear={academicYear}
                term={term}
              />
            </div>
            <div>
              <button
                onClick={() => setCurrentView("ranking")}
                className="flex items-center gap-2 bg-indigo-600 text-white px-4 py-2 rounded-lg hover:bg-indigo-700 transition-colors shadow-sm whitespace-nowrap"
              >
                <Trophy size={18} />
                View Rankings
              </button>
            </div>
          </div>
        )}

        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          {/* Attendance Module */}
          {(user?.role === "HEAD" || user?.role === "CLASS") && (
            <div className="md:col-span-3">
              <h3 className="text-lg font-semibold text-slate-700 mb-4">
                Attendance
              </h3>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <DashboardTile
                  title="Daily Register"
                  icon={Calendar}
                  color="bg-indigo-600"
                  onClick={() => setCurrentView("register")}
                />
              </div>
            </div>
          )}

          <div className="md:col-span-3">
            <h3 className="text-lg font-semibold text-slate-700 mb-4">
              Core Subjects
            </h3>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              {SUBJECTS.slice(0, 4)
                .filter(
                  (subj) =>
                    !user?.assignedSubjectName ||
                    subj === user.assignedSubjectName,
                )
                .map((subj) => (
                  <DashboardTile
                    key={subj}
                    title={SUBJECT_DISPLAY_NAMES[subj] || subj}
                    icon={user?.role === "CLASS" ? Lock : Calculator}
                    color={
                      user?.role === "CLASS"
                        ? "bg-slate-400 cursor-not-allowed"
                        : "bg-blue-600"
                    }
                    imageSrc={
                      user?.role === "CLASS"
                        ? undefined
                        : subj === "Mathematics"
                          ? "https://encrypted-tbn0.gstatic.com/images?q=tbn:ANd9GcTtBNVtepKT2YtCg7GODExQYE-kE7UBGS-1lA&s"
                          : subj === "English Language"
                            ? "https://edusoftlearning.com/wp-content/uploads/2018/10/Edusoft-the-English-Language-Learning-Experts-1080x540.jpg"
                            : subj === "Integrated Science"
                              ? "https://www.nesdis.noaa.gov/s3/2025-09/science.png"
                              : subj === "Social Studies"
                                ? "https://www.championtutor.com/blog/wp-content/uploads/2023/04/Picture31.jpg"
                                : undefined
                    }
                    onClick={() => {
                      if (user?.role === "CLASS") {
                        alert(
                          "Access Denied: Subject modules are restricted for Class Teachers.",
                        );
                        return;
                      }
                      setActiveSubject(subj);
                      setCurrentView("subject");
                    }}
                  />
                ))}
            </div>
          </div>
          <div className="md:col-span-3">
            <h3 className="text-lg font-semibold text-slate-700 mb-4">
              Electives & Others
            </h3>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              {SUBJECTS.slice(4)
                .filter(
                  (subj) =>
                    !user?.assignedSubjectName ||
                    subj === user.assignedSubjectName,
                )
                .map((subj) => (
                  <DashboardTile
                    key={subj}
                    title={SUBJECT_DISPLAY_NAMES[subj] || subj}
                    icon={user?.role === "CLASS" ? Lock : LayoutGrid}
                    color={
                      user?.role === "CLASS"
                        ? "bg-slate-400 cursor-not-allowed"
                        : "bg-emerald-600"
                    }
                    imageSrc={
                      user?.role === "CLASS"
                        ? undefined
                        : subj === "Computing"
                          ? "https://findvectorlogo.com/wp-content/uploads/2019/11/computing-vector-logo.png"
                          : subj === "Career Technology"
                            ? "https://media.licdn.com/dms/image/v2/D4E12AQE5tslHqALWLw/article-cover_image-shrink_720_1280/article-cover_image-shrink_720_1280/0/1673452653564?e=2147483647&v=beta&t=Mv4FYS9k5cJIfRg1JyH1ZmnLkNhlbxAT7ca3j_HaUoM"
                            : subj === "Creative Arts"
                              ? "https://www.purpleoaksacademy.org/_site/data/files/images/auto_upload/page/90/D09D84D10AAC9F784E9BADB7AB3A1F93.jpeg"
                              : subj === "French"
                                ? "https://lilata.com/wp-content/uploads/francais-translation-french-french-language.jpg"
                                : subj === "Ghanaian Language"
                                  ? "https://encrypted-tbn0.gstatic.com/images?q=tbn:ANd9GcTYLygQ4IcqArqcZdObLbj1Zv0nukkTgEqaWw&s"
                                  : subj === "RME"
                                    ? "https://curriculumresources.edu.gh/wp-content/uploads/2024/11/RELIGIOUS-AND-MORAL-EDUCATION-Curriculum-pdf-1024x724.jpg"
                                    : undefined
                    }
                    onClick={() => {
                      if (user?.role === "CLASS") {
                        alert(
                          "Access Denied: Subject modules are restricted for Class Teachers.",
                        );
                        return;
                      }
                      setActiveSubject(subj);
                      setCurrentView("subject");
                    }}
                  />
                ))}
            </div>
          </div>
          {(user?.role === "HEAD" || user?.role === "CLASS") && (
            <div className="md:col-span-3">
              <h3 className="text-lg font-semibold text-slate-700 mb-4">
                Administration
              </h3>
              <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
                {user?.role === "HEAD" && (
                  <DashboardTile
                    title="Master Database"
                    icon={Database}
                    color="bg-slate-600"
                    onClick={() => setCurrentView("masterdb")}
                  />
                )}
                <DashboardTile
                  title="Report Cards"
                  icon={FileText}
                  color="bg-slate-600"
                  onClick={() => setCurrentView("report")}
                />
                {user?.role === "HEAD" && (
                  <DashboardTile
                    title="System Setup"
                    icon={Settings}
                    color="bg-slate-600"
                    onClick={() => setCurrentView("setup")}
                  />
                )}
              </div>
            </div>
          )}
        </div>
      </div>
      <ProgressStats />
    </div>
  );

  const renderSubjectSheet = () => {
    return (
      <div className="bg-white border border-slate-200 overflow-hidden flex flex-col assessment-container">
        <div className="bg-blue-50 border-b border-blue-100 flex justify-between items-center">
          <div>
            <h2 className="text-xl font-bold text-blue-900">
              {activeSubject} Assessment Sheet
            </h2>
            <p className="text-sm text-blue-600">
              Class: {selectedClass} | {academicYear} - {term} | Weighting:{" "}
              {schoolConfig.catWeight}% Class / {schoolConfig.examWeight}% Exam
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2 sm:gap-3">
            <button
              onClick={() =>
                setSubjectRevealStep((prev) => (prev >= 2 ? 0 : prev + 1))
              }
              className="flex items-center gap-2 px-3 py-2 bg-white border border-blue-200 text-blue-700 hover:bg-blue-50 rounded-lg text-sm font-medium transition-colors"
              aria-label={
                subjectRevealStep === 0
                  ? "Reveal progress section"
                  : subjectRevealStep === 1
                    ? "Reveal summary section"
                    : "Hide progress and summary sections"
              }
              title="Reveal sections"
            >
              <ArrowLeft
                size={16}
                className={`transform transition-transform ${
                  subjectRevealStep > 0 ? "rotate-180" : "rotate-0"
                }`}
              />
              <span>
                {subjectRevealStep === 0
                  ? "Show Progress"
                  : subjectRevealStep === 1
                    ? "Show Summary"
                    : "Hide Sections"}
              </span>
            </button>
            <button
              onClick={() => {
                if (user?.role === "CLASS") {
                  alert("Access Denied: Uploading assessments is restricted.");
                  return;
                }
                setIsAssessmentUploadOpen(true);
              }}
              className={`flex items-center gap-2 px-3 py-2 bg-white border border-blue-200 text-blue-700 hover:bg-blue-50 rounded-lg text-sm font-medium transition-colors w-full sm:w-auto justify-center ${
                user?.role === "CLASS" ? "opacity-50 cursor-not-allowed" : ""
              }`}
              aria-label="Upload assessment sheet"
            >
              <Upload size={16} /> Upload Sheet
            </button>
            <span className="px-2 py-1 text-blue-700 text-sm w-full sm:w-auto text-center sm:text-left">
              Format: Excel (.xlsx)
            </span>
            <button
              onClick={downloadSubjectTemplate}
              disabled={isGeneratingTemplate}
              className="flex items-center gap-2 px-3 py-2 bg-white border border-blue-200 text-blue-700 hover:bg-blue-50 rounded-lg text-sm font-medium transition-colors w-full sm:w-auto justify-center"
              aria-label="Download assessment template"
            >
              {isGeneratingTemplate ? (
                <Loader2 size={16} className="animate-spin" />
              ) : (
                <Download size={16} />
              )}
              Download Template
            </button>
            <button
              onClick={exportSubjectSheetToExcel}
              disabled={isGeneratingDoc}
              className="flex items-center gap-2 px-3 py-2 bg-white border border-blue-200 text-blue-700 hover:bg-blue-50 rounded-lg text-sm font-medium transition-colors w-full sm:w-auto justify-center"
              aria-label="Export to Excel"
              title="Export to Excel"
            >
              {isGeneratingDoc ? (
                <Loader2 size={16} className="animate-spin" />
              ) : (
                <FileSpreadsheet size={16} />
              )}
              Export to Excel
            </button>
            <span className="px-3 py-1 bg-yellow-100 text-yellow-800 rounded-full text-xs font-semibold w-full sm:w-auto text-center sm:text-left mt-1 sm:mt-0">
              Auto-Save Active
            </span>
          </div>
        </div>
        {/* Subject Progress Bar */}
        <div className="px-4 pt-4 space-y-4">
          <div
            className={`transition-all duration-500 ${
              subjectRevealStep >= 1
                ? "opacity-100 translate-y-0 block"
                : "opacity-0 -translate-y-2 hidden"
            }`}
          >
            <ProgressBar
              scope="subject"
              className={selectedClass}
              subjectName={activeSubject}
              academicYear={academicYear}
              term={term}
            />
          </div>
          {/* Aggregate Summary Cards */}
          {(() => {
            let totalFinal = 0;
            let count = 0;
            let passCount = 0;
            const scores: number[] = [];
            const gradeDistribution: Record<string, number> = {};

            // Initialize counts
            gradingSystem.forEach((g) => (gradeDistribution[g.grade] = 0));

            filteredStudents.forEach((s) => {
              const m = marks[s.id]?.[activeSubject];
              if (m) {
                const rawSBA = m.cat1 + m.cat2 + m.group + m.project;
                const scaledSBA = (rawSBA / 60) * schoolConfig.catWeight;
                const scaledExam = (m.exam / 100) * schoolConfig.examWeight;
                const final = Math.round(scaledSBA + scaledExam);
                totalFinal += final;
                scores.push(final);
                if (final >= 50) passCount++;
                count++;

                const g = calculateGrade(final);
                gradeDistribution[g.grade] =
                  (gradeDistribution[g.grade] || 0) + 1;
              }
            });

            const avg = count > 0 ? (totalFinal / count).toFixed(1) : "-";
            const max = scores.length > 0 ? Math.max(...scores) : "-";
            const min = scores.length > 0 ? Math.min(...scores) : "-";
            const passRate =
              count > 0 ? ((passCount / count) * 100).toFixed(1) + "%" : "-";

            const attendanceValues = Object.values(attendanceMap);
            const avgAttendance =
              attendanceValues.length > 0
                ? (
                    (attendanceValues.reduce(
                      (acc, curr) =>
                        acc + (curr.total > 0 ? curr.present / curr.total : 0),
                      0,
                    ) /
                      attendanceValues.length) *
                    100
                  ).toFixed(1) + "%"
                : "-";

            return (
              <div
                className={`space-y-6 transition-all duration-500 ${
                  subjectRevealStep >= 2
                    ? "opacity-100 translate-y-0 block"
                    : "opacity-0 -translate-y-2 hidden"
                }`}
              >
                <section
                  className="grid grid-cols-2 md:grid-cols-5 gap-4"
                  aria-label="Class Performance Summary"
                >
                  <div className="bg-blue-50 p-3 rounded-lg border border-blue-100 shadow-sm">
                    <h3 className="text-xs text-blue-600 font-bold uppercase tracking-wider">
                      Class Average
                    </h3>
                    <p className="text-2xl font-black text-blue-900 mt-1">
                      {avg}
                    </p>
                  </div>
                  <div className="bg-green-50 p-3 rounded-lg border border-green-100 shadow-sm">
                    <h3 className="text-xs text-green-600 font-bold uppercase tracking-wider">
                      Highest Score
                    </h3>
                    <p className="text-2xl font-black text-green-900 mt-1">
                      {max}
                    </p>
                  </div>
                  <div className="bg-red-50 p-3 rounded-lg border border-red-100 shadow-sm">
                    <h3 className="text-xs text-red-600 font-bold uppercase tracking-wider">
                      Lowest Score
                    </h3>
                    <p className="text-2xl font-black text-red-900 mt-1">
                      {min}
                    </p>
                  </div>
                  <div className="bg-purple-50 p-3 rounded-lg border border-purple-100 shadow-sm">
                    <h3 className="text-xs text-purple-600 font-bold uppercase tracking-wider">
                      Pass Rate
                    </h3>
                    <p className="text-2xl font-black text-purple-900 mt-1">
                      {passRate}
                    </p>
                  </div>
                  <div className="bg-amber-50 p-3 rounded-lg border border-amber-100 shadow-sm">
                    <h3 className="text-xs text-amber-600 font-bold uppercase tracking-wider">
                      Avg Attendance
                    </h3>
                    <p className="text-2xl font-black text-amber-900 mt-1">
                      {avgAttendance}
                    </p>
                  </div>
                </section>
              </div>
            );
          })()}
        </div>
        <div className="flex-1">
          {isGeneratingTemplate && (
            <div
              role="status"
              aria-live="polite"
              className="px-4 py-2 text-xs text-blue-700"
            >
              {templateStatus}
            </div>
          )}
          <table className="w-full text-xs md:text-sm text-left table-fixed">
            <thead className="text-xs text-slate-700 uppercase bg-slate-100 sticky top-0 z-10 shadow-sm">
              <tr>
                <th className="px-4 py-3 w-16">ID</th>
                <th className="px-4 py-3 w-48">Name</th>
                <th className="px-2 py-3 text-center bg-blue-50">Task 1</th>
                <th className="px-2 py-3 text-center bg-blue-50">Task 2</th>
                <th className="px-2 py-3 text-center bg-purple-50">
                  <span className="hidden md:inline">Group Work</span>
                  <span className="md:hidden">Grp</span>
                </th>
                <th className="px-2 py-3 text-center bg-purple-50">
                  <span className="hidden md:inline">Project</span>
                  <span className="md:hidden">Proj</span>
                </th>
                <th className="px-2 py-3 text-center font-bold">
                  <span className="hidden md:inline">Total</span>
                  <span className="md:hidden">Tot</span>
                </th>
                <th className="px-2 py-3 text-center font-bold bg-green-50">
                  SBA
                </th>
                <th className="px-2 py-3 text-center bg-red-50">Exam</th>
                <th className="px-2 py-3 text-center font-bold bg-green-50">
                  50%
                </th>
                <th className="px-4 py-3 text-center font-black">
                  <span className="hidden md:inline">Final</span>
                  <span className="md:hidden">Fin</span>
                </th>
                <th className="px-4 py-3 text-center">
                  <span className="hidden md:inline">Grade</span>
                  <span className="md:hidden">Grd</span>
                </th>
                <th className="px-4 py-3 text-center">
                  <span className="hidden md:inline">Remark</span>
                  <span className="md:hidden">Rem</span>
                </th>
                <th className="px-2 py-3 text-center bg-amber-50">Att.</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200">
              {filteredStudents.map((student) => {
                const m = marks[student.id]?.[activeSubject] || {
                  cat1: 0,
                  cat2: 0,
                  cat3: 0,
                  cat4: 0,
                  group: 0,
                  project: 0,
                  exam: 0,
                };
                const rawSBA = m.cat1 + m.cat2 + m.group + m.project;
                const scaledSBA = (rawSBA / 60) * schoolConfig.catWeight;
                const scaledExam = (m.exam / 100) * schoolConfig.examWeight;
                const final = Math.round(scaledSBA + scaledExam);
                const g = calculateGrade(final);
                return (
                  <tr key={student.id} className="hover:bg-slate-50">
                    <td className="px-4 py-3 font-mono text-xs">
                      {student.id}
                    </td>
                    <td className="px-4 py-3 font-medium">
                      {student.surname}, {student.firstName}
                    </td>
                    {["cat1", "cat2"].map((f) => (
                      <td key={f} className="p-1">
                        <input
                          type="number"
                          className={`w-full text-center border rounded p-1 ${
                            user?.role === "CLASS"
                              ? "bg-slate-100 text-slate-500 cursor-not-allowed"
                              : ""
                          }`}
                          value={m[f as keyof typeof m]}
                          onChange={(e) =>
                            updateMark(student.id, f, e.target.value)
                          }
                          readOnly={user?.role === "CLASS"}
                          onClick={(e) => {
                            if (user?.role === "CLASS") {
                              e.preventDefault();
                              alert(
                                "Access Denied: Subject Marks are managed by Subject Teachers.",
                              );
                            }
                          }}
                          aria-label={`Enter ${f.toUpperCase()} score for ${
                            student.surname
                          }`}
                        />
                      </td>
                    ))}
                    <td className="p-1">
                      <input
                        type="number"
                        className={`w-full text-center border rounded p-1 bg-purple-50 ${
                          user?.role === "CLASS"
                            ? "opacity-60 cursor-not-allowed"
                            : ""
                        }`}
                        value={m.group}
                        onChange={(e) =>
                          updateMark(student.id, "group", e.target.value)
                        }
                        readOnly={user?.role === "CLASS"}
                        onClick={(e) => {
                          if (user?.role === "CLASS") {
                            e.preventDefault();
                            alert(
                              "Access Denied: Subject Marks are managed by Subject Teachers.",
                            );
                          }
                        }}
                        aria-label={`Enter GROUP score for ${student.surname}`}
                      />
                    </td>
                    <td className="p-1">
                      <input
                        type="number"
                        className={`w-full text-center border rounded p-1 bg-purple-50 ${
                          user?.role === "CLASS"
                            ? "opacity-60 cursor-not-allowed"
                            : ""
                        }`}
                        value={m.project}
                        onChange={(e) =>
                          updateMark(student.id, "project", e.target.value)
                        }
                        readOnly={user?.role === "CLASS"}
                        onClick={(e) => {
                          if (user?.role === "CLASS") {
                            e.preventDefault();
                            alert(
                              "Access Denied: Subject Marks are managed by Subject Teachers.",
                            );
                          }
                        }}
                        aria-label={`Enter PROJECT score for ${student.surname}`}
                      />
                    </td>
                    <td className="px-2 text-center text-slate-500">
                      {rawSBA}
                    </td>
                    <td className="px-2 text-center font-bold text-green-700">
                      {scaledSBA.toFixed(1)}
                    </td>
                    <td className="p-1">
                      <input
                        type="number"
                        className={`w-full text-center border rounded p-1 bg-red-50 ${
                          user?.role === "CLASS"
                            ? "opacity-60 cursor-not-allowed"
                            : ""
                        }`}
                        value={m.exam}
                        onChange={(e) =>
                          updateMark(student.id, "exam", e.target.value)
                        }
                        readOnly={user?.role === "CLASS"}
                        onClick={(e) => {
                          if (user?.role === "CLASS") {
                            e.preventDefault();
                            alert(
                              "Access Denied: Subject Marks are managed by Subject Teachers.",
                            );
                          }
                        }}
                        aria-label={`Enter EXAM score for ${student.surname}`}
                      />
                    </td>
                    <td className="px-2 text-center font-bold text-green-700">
                      {scaledExam.toFixed(1)}
                    </td>
                    <td className="px-4 text-center font-black">{final}</td>
                    <td className="px-4 text-center font-bold text-blue-600">
                      {g.grade}
                    </td>
                    <td className="px-4 text-center text-xs">{g.desc}</td>
                    <td className="px-2 text-center text-xs bg-amber-50 border-l border-slate-200">
                      {attendanceMap[student.id]
                        ? `${attendanceMap[student.id].present}/${
                            attendanceMap[student.id].total
                          }`
                        : "-"}
                    </td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot className="bg-slate-100 font-bold text-slate-700 border-t-2 border-slate-200">
              {classStats && (
                <>
                  {[
                    { label: "Class Average:", type: "avg", bg: "bg-slate-50" },
                    { label: "Highest Score:", type: "max" },
                    { label: "Lowest Score:", type: "min" },
                    {
                      label: "Student Count:",
                      type: "cnt",
                      bg: "bg-slate-50 text-slate-500",
                    },
                  ].map((row) => (
                    <tr key={row.label} className={row.bg || ""}>
                      <td
                        colSpan={2}
                        className="px-4 py-2 text-right uppercase text-xs tracking-wider border-b border-slate-200"
                      >
                        {row.label}
                      </td>
                      <td className="px-2 py-2 text-center text-xs border-b border-slate-200">
                        {
                          classStats.cat1[
                            row.type as keyof typeof classStats.cat1
                          ]
                        }
                      </td>
                      <td className="px-2 py-2 text-center text-xs border-b border-slate-200">
                        {
                          classStats.cat2[
                            row.type as keyof typeof classStats.cat2
                          ]
                        }
                      </td>
                      <td className="px-2 py-2 text-center text-xs bg-purple-50 border-b border-slate-200">
                        {
                          classStats.group[
                            row.type as keyof typeof classStats.group
                          ]
                        }
                      </td>
                      <td className="px-2 py-2 text-center text-xs bg-purple-50 border-b border-slate-200">
                        {
                          classStats.project[
                            row.type as keyof typeof classStats.project
                          ]
                        }
                      </td>
                      <td className="px-2 py-2 text-center text-xs text-slate-500 border-b border-slate-200">
                        {
                          classStats.rawSBA[
                            row.type as keyof typeof classStats.rawSBA
                          ]
                        }
                      </td>
                      <td className="px-2 py-2 text-center text-xs text-green-700 bg-green-50 border-b border-slate-200">
                        {
                          classStats.scaledSBA[
                            row.type as keyof typeof classStats.scaledSBA
                          ]
                        }
                      </td>
                      <td className="px-2 py-2 text-center text-xs bg-red-50 border-b border-slate-200">
                        {
                          classStats.exam[
                            row.type as keyof typeof classStats.exam
                          ]
                        }
                      </td>
                      <td className="px-2 py-2 text-center text-xs text-green-700 bg-green-50 border-b border-slate-200">
                        {
                          classStats.scaledExam[
                            row.type as keyof typeof classStats.scaledExam
                          ]
                        }
                      </td>
                      <td className="px-4 py-2 text-center font-black text-sm border-b border-slate-200">
                        {
                          classStats.final[
                            row.type as keyof typeof classStats.final
                          ]
                        }
                      </td>
                      <td
                        colSpan={2}
                        className="border-b border-slate-200"
                      ></td>
                      <td className="px-2 py-2 text-center text-xs bg-amber-50 border-b border-slate-200 border-l">
                        {row.type === "cnt"
                          ? classStats.attendance.cnt
                          : classStats.attendance[
                                row.type as keyof typeof classStats.attendance
                              ] === "-"
                            ? "-"
                            : `${
                                classStats.attendance[
                                  row.type as keyof typeof classStats.attendance
                                ]
                              }%`}
                      </td>
                    </tr>
                  ))}
                </>
              )}
            </tfoot>
          </table>
        </div>
      </div>
    );
  };

  const [isAssessmentUploadOpen, setIsAssessmentUploadOpen] = useState(false);
  const [assessmentFile, setAssessmentFile] = useState<File | null>(null);
  const [assessmentPreview, setAssessmentPreview] = useState<
    Record<string, unknown>[]
  >([]);
  const [assessmentErrors, setAssessmentErrors] = useState<string[]>([]);
  const [assessmentProgress, setAssessmentProgress] = useState<number>(0);
  const [isUploadingAssessment, setIsUploadingAssessment] = useState(false);
  const progressWidthClass = (p: number) => {
    const val = Math.max(0, Math.min(100, Math.round(p)));
    if (val === 0) return "w-0";
    if (val <= 25) return "w-1/4";
    if (val <= 50) return "w-1/2";
    if (val <= 75) return "w-3/4";
    return "w-full";
  };
  // Class remarks and attendance data intentionally removed per data purge request

  const [isGeneratingTemplate, setIsGeneratingTemplate] = useState(false);
  const [templateStatus, setTemplateStatus] = useState("");
  const downloadSubjectTemplate = async () => {
    try {
      setIsGeneratingTemplate(true);
      setTemplateStatus("Generating template...");
      const headers = [
        "student_id",
        "student_name",
        "cat1",
        "cat2",
        "cat3",
        "cat4",
        "group",
        "project",
        "exam",
      ];
      const rows = filteredStudents.map((s) => [
        s.id,
        `${s.surname}, ${s.firstName} ${s.middleName}`.trim(),
        "",
        "",
        "",
        "",
        "",
        "",
        "",
      ]);
      const data = [headers, ...rows];
      const XLSX = await import("xlsx");
      const ws = XLSX.utils.aoa_to_sheet(data);
      const wb = XLSX.utils.book_new();
      const sheetName = `${activeSubject || "Subject"} Template`;
      XLSX.utils.book_append_sheet(wb, ws, sheetName);
      const safe = (v: string) => v.replace(/[^A-Za-z0-9_-]+/g, "_");
      const filename = `Assessment_Template_${safe(
        activeSubject || "Subject",
      )}_${safe(selectedClass)}_${safe(academicYear)}_${safe(term)}.xlsx`;
      XLSX.writeFile(wb, filename);
      setTemplateStatus("Template downloaded");
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setTemplateStatus(`Failed: ${msg}`);
      logger.error("template_download_error", e);
    } finally {
      setIsGeneratingTemplate(false);
    }
  };
  const exportSubjectSheetToExcel = () => {
    setIsGeneratingDoc(true);
    setDocStatus("Preparing Excel file...");
    setTimeout(async () => {
      try {
        const headers = [
          "student_id",
          "student_name",
          "cat1_score",
          "cat2_score",
          "cat3_score",
          "cat4_score",
          "group_work_score",
          "project_work_score",
          "raw_sba_total",
          "scaled_sba",
          "exam_score",
          "scaled_exam",
          "final_total",
          "grade",
          "remark",
        ];
        const rows = filteredStudents.map((s) => {
          const m = marks[s.id]?.[activeSubject] || {
            cat1: 0,
            cat2: 0,
            cat3: 0,
            cat4: 0,
            group: 0,
            project: 0,
            exam: 0,
          };
          const rawSBA = m.cat1 + m.cat2 + m.group + m.project;
          const scaledSBA = (rawSBA / 60) * schoolConfig.catWeight;
          const scaledExam = (m.exam / 100) * schoolConfig.examWeight;
          const final = Math.round(scaledSBA + scaledExam);
          const g = calculateGrade(final);
          return [
            s.id,
            `${s.surname}, ${s.firstName} ${s.middleName}`.trim(),
            m.cat1,
            m.cat2,
            m.cat3,
            m.cat4,
            m.group,
            m.project,
            rawSBA,
            Number(scaledSBA.toFixed(1)),
            m.exam,
            Number(scaledExam.toFixed(1)),
            final,
            g.grade,
            g.desc,
          ];
        });

        // Calculate Aggregates for Export
        let tCat1 = 0,
          tCat2 = 0,
          tCat3 = 0,
          tCat4 = 0,
          tGroup = 0,
          tProj = 0,
          tRawSBA = 0,
          tScaledSBA = 0,
          tExam = 0,
          tScaledExam = 0,
          tFinal = 0;
        let count = 0;
        let passCount = 0;
        const finalScores: number[] = [];

        filteredStudents.forEach((s) => {
          const m = marks[s.id]?.[activeSubject];
          if (m) {
            count++;
            tCat1 += m.cat1 || 0;
            tCat2 += m.cat2 || 0;
            tCat3 += m.cat3 || 0;
            tCat4 += m.cat4 || 0;
            tGroup += m.group || 0;
            tProj += m.project || 0;

            const rawSBA = m.cat1 + m.cat2 + m.group + m.project;
            tRawSBA += rawSBA;

            const scaledSBA = (rawSBA / 60) * schoolConfig.catWeight;
            tScaledSBA += scaledSBA;

            tExam += m.exam || 0;
            const scaledExam = (m.exam / 100) * schoolConfig.examWeight;
            tScaledExam += scaledExam;

            const final = Math.round(scaledSBA + scaledExam);
            tFinal += final;
            finalScores.push(final);
            if (final >= 50) passCount++;
          }
        });

        const avg = (val: number) =>
          count > 0 ? Number((val / count).toFixed(1)) : 0;

        const classAverage = avg(tFinal);
        const maxScore = finalScores.length > 0 ? Math.max(...finalScores) : 0;
        const minScore = finalScores.length > 0 ? Math.min(...finalScores) : 0;
        const passRate =
          count > 0 ? ((passCount / count) * 100).toFixed(1) + "%" : "0%";

        // Append Aggregates to Rows
        // Empty row separator
        rows.push(["", "", "", "", "", "", "", "", "", "", "", "", "", "", ""]);

        // Column Averages
        rows.push([
          "Class Averages",
          "",
          avg(tCat1),
          avg(tCat2),
          avg(tCat3),
          avg(tCat4),
          avg(tGroup),
          avg(tProj),
          avg(tRawSBA),
          avg(tScaledSBA),
          avg(tExam),
          avg(tScaledExam),
          classAverage,
          "",
          "",
        ]);

        // Summary Block
        rows.push(["", "", "", "", "", "", "", "", "", "", "", "", "", "", ""]);
        rows.push([
          "Summary Statistics",
          "",
          "",
          "",
          "",
          "",
          "",
          "",
          "",
          "",
          "",
          "",
          "",
          "",
          "",
        ]);
        rows.push([
          "Class Average",
          classAverage,
          "",
          "",
          "",
          "",
          "",
          "",
          "",
          "",
          "",
          "",
          "",
          "",
          "",
        ]);
        rows.push([
          "Highest Score",
          maxScore,
          "",
          "",
          "",
          "",
          "",
          "",
          "",
          "",
          "",
          "",
          "",
          "",
          "",
        ]);
        rows.push([
          "Lowest Score",
          minScore,
          "",
          "",
          "",
          "",
          "",
          "",
          "",
          "",
          "",
          "",
          "",
          "",
          "",
        ]);
        rows.push([
          "Pass Rate",
          passRate,
          "",
          "",
          "",
          "",
          "",
          "",
          "",
          "",
          "",
          "",
          "",
          "",
          "",
        ]);

        const data = [headers, ...rows];
        const XLSX = await import("xlsx");
        const ws = XLSX.utils.aoa_to_sheet(data);
        for (let r = 1; r <= rows.length; r++) {
          const sbaCell = XLSX.utils.encode_cell({ r, c: 9 });
          const examScaledCell = XLSX.utils.encode_cell({ r, c: 11 });
          if (ws[sbaCell]) ws[sbaCell].z = "0.0";
          if (ws[examScaledCell]) ws[examScaledCell].z = "0.0";
        }
        const wb = XLSX.utils.book_new();
        const sheetName = `${activeSubject || "Subject"}_${selectedClass}`;
        XLSX.utils.book_append_sheet(wb, ws, sheetName);
        const wbx = wb as unknown as {
          Workbook?: {
            Sheets?: Array<{ Hidden?: number }>;
            Views?: Array<Record<string, unknown>>;
          };
          SheetNames?: string[];
        };
        if (!wbx.Workbook) wbx.Workbook = { Sheets: [], Views: [] };
        const names = Array.isArray(wbx.SheetNames)
          ? wbx.SheetNames
          : [sheetName];
        wbx.Workbook.Sheets = names.map(() => ({ Hidden: 0 }));
        wbx.Workbook.Views = [{ activeTab: 0 }];
        const safe = (v: string) => v.replace(/[^A-Za-z0-9_-]+/g, "_");
        const filename = `Assessment_${safe(activeSubject || "Subject")}_${safe(
          selectedClass,
        )}_${safe(academicYear)}_${safe(term)}_${
          new Date().toISOString().split("T")[0]
        }.xlsx`;
        XLSX.writeFile(wb, filename);
        setDocStatus("Download Started");
      } catch (e) {
        logger.error("subject_excel_export_error", e);
      }
      setIsGeneratingDoc(false);
    }, 300);
  };

  const renderAssessmentUploadModal = () => {
    if (!isAssessmentUploadOpen) return null;
    return (
      <div className="fixed inset-0 z-[65] flex items-center justify-center p-4 bg-slate-900/50 backdrop-blur-sm">
        <div className="bg-white rounded-xl shadow-2xl w-full max-w-3xl overflow-hidden">
          <div className="px-6 py-4 border-b border-slate-100 flex justify-between items-center bg-blue-50">
            <h3 className="text-lg font-bold text-blue-900 flex items-center gap-2">
              <FileSpreadsheet size={20} className="text-blue-700" /> Upload
              Assessment Sheet ({activeSubject})
            </h3>
            <button
              onClick={() => setIsAssessmentUploadOpen(false)}
              className="text-slate-400 hover:text-slate-600 hover:bg-slate-200 rounded-full p-1"
              aria-label="Close"
              title="Close"
            >
              <X size={20} />
            </button>
          </div>
          <div className="p-6 space-y-4">
            <div
              onDragOver={(ev) => {
                ev.preventDefault();
              }}
              onDrop={(ev) => {
                ev.preventDefault();
                const f = ev.dataTransfer.files?.[0] || null;
                setAssessmentFile(f);
                try {
                  void saveUploadedFile(
                    undefined,
                    f,
                    ["assessment", activeSubject || "", selectedClass || ""],
                    undefined,
                  );
                } catch {
                  void 0;
                }
                setAssessmentErrors([]);
                setAssessmentPreview([]);
                if (!f) return;
                if (f.size > 10 * 1024 * 1024) {
                  setAssessmentErrors(["File too large. Max 10MB."]);
                  return;
                }
                const ext = f.name.split(".").pop()?.toLowerCase();
                if (!ext || !["xlsx", "xls"].includes(ext)) {
                  setAssessmentErrors([
                    "Invalid file type. Please upload .xlsx or .xls.",
                  ]);
                  return;
                }
                const reader = new FileReader();
                reader.onload = async () => {
                  try {
                    const XLSX = await import("xlsx");
                    const data = new Uint8Array(reader.result as ArrayBuffer);
                    const wb = XLSX.read(data, { type: "array" });
                    const ws = wb.Sheets[wb.SheetNames[0]];
                    const json = XLSX.utils.sheet_to_json(ws) as Record<
                      string,
                      string | number | null
                    >[];
                    setAssessmentPreview(json.slice(0, 10));
                  } catch (err: unknown) {
                    const msg =
                      err instanceof Error ? err.message : String(err);
                    setAssessmentErrors([msg || "Failed to parse file."]);
                  }
                };
                reader.readAsArrayBuffer(f);
              }}
              className="w-full p-6 border-2 border-dashed rounded mb-2 text-center text-slate-500"
              aria-label="Drag and drop assessment sheet here"
            >
              Drag & Drop .xlsx/.xls here or use file picker
            </div>
            <input
              type="file"
              accept=".xlsx,.xls"
              onChange={(e) => {
                const f = e.target.files?.[0] || null;
                setAssessmentFile(f);
                setAssessmentErrors([]);
                setAssessmentPreview([]);
                if (!f) return;
                if (f.size > 10 * 1024 * 1024) {
                  setAssessmentErrors(["File too large. Max 10MB."]);
                  return;
                }
                const ext = f.name.split(".").pop()?.toLowerCase();
                if (!ext || !["xlsx", "xls"].includes(ext)) {
                  setAssessmentErrors([
                    "Invalid file type. Please upload .xlsx or .xls.",
                  ]);
                  return;
                }
                const reader = new FileReader();
                reader.onload = async () => {
                  try {
                    const XLSX = await import("xlsx");
                    if (["xlsx", "xls"].includes(ext)) {
                      const data = new Uint8Array(reader.result as ArrayBuffer);
                      const wb = XLSX.read(data, { type: "array" });
                      const ws = wb.Sheets[wb.SheetNames[0]];
                      const json = XLSX.utils.sheet_to_json(ws) as Record<
                        string,
                        string | number | null
                      >[];
                      const normalizeKey = (k: string): string =>
                        k
                          .toLowerCase()
                          .trim()
                          .replace(/[\s-]+/g, "_")
                          .replace(/__+/g, "_")
                          .replace(/^_+|_+$/g, "");
                      const alias: Record<string, string> = {
                        studentid: "student_id",
                        student_id: "student_id",
                        id: "student_id",
                        cat1_score: "cat1",
                        cat2_score: "cat2",
                        cat3_score: "cat3",
                        cat4_score: "cat4",
                        group_work: "group",
                        group_work_score: "group",
                        project_work: "project",
                        project_work_score: "project",
                        exam_score: "exam",
                      };
                      const mapKey = (raw: string): string => {
                        const n = normalizeKey(raw);
                        return alias[n] || n;
                      };
                      const keys = json[0]
                        ? Object.keys(json[0]).map((k) => mapKey(k))
                        : [];
                      const required = [
                        "student_id",
                        "cat1",
                        "cat2",
                        "cat3",
                        "cat4",
                        "group",
                        "project",
                        "exam",
                      ];
                      const missing = required.filter((k) => !keys.includes(k));
                      if (missing.length) {
                        setAssessmentErrors([
                          `Missing columns: ${missing.join(", ")}`,
                        ]);
                        setAssessmentPreview([]);
                        return;
                      }
                      setAssessmentPreview(json.slice(0, 10));
                    } else {
                      setAssessmentPreview([]);
                      setAssessmentErrors([
                        "This file will be stored as an attachment. To apply marks, upload an XLSX template.",
                      ]);
                    }
                  } catch (err: unknown) {
                    const msg =
                      err instanceof Error ? err.message : String(err);
                    setAssessmentErrors([msg || "Failed to parse file."]);
                  }
                };
                reader.readAsArrayBuffer(f);
              }}
              className="w-full p-2 border rounded"
              aria-label="Select assessment sheet file"
              title="Select assessment sheet file"
            />
            {assessmentPreview.length > 0 && (
              <div className="border rounded">
                <div className="p-2 text-xs text-slate-500">
                  Preview (first 10 rows) — expected columns: student_id, cat1,
                  cat2, cat3, cat4, group, project, exam
                </div>
                <div className="max-h-48 overflow-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="bg-slate-50">
                        {Object.keys(assessmentPreview[0]).map((k) => (
                          <th key={k} className="p-2 text-left border-b">
                            {k}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {assessmentPreview.map((row, i) => (
                        <tr key={i} className="hover:bg-slate-50">
                          {Object.keys(row).map((k) => (
                            <td key={k} className="p-2 border-b">
                              {String(
                                (row as Record<string, string | number | null>)[
                                  k
                                ] ?? "",
                              )}
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
            {assessmentErrors.length > 0 && (
              <div className="p-3 bg-red-50 border border-red-100 text-red-700 rounded text-sm">
                {assessmentErrors.join("; ")}
              </div>
            )}
            {isUploadingAssessment && (
              <div className="w-full bg-slate-100 rounded h-2">
                <div
                  className={`bg-blue-600 h-2 rounded ${progressWidthClass(
                    assessmentProgress,
                  )}`}
                />
                <progress
                  value={Math.max(0, Math.min(100, assessmentProgress))}
                  max={100}
                  aria-label="Upload progress"
                  className="sr-only"
                />
              </div>
            )}
          </div>
          <div className="px-6 py-4 border-t bg-slate-50 flex justify-end gap-3">
            <button
              onClick={() => setIsAssessmentUploadOpen(false)}
              className="px-4 py-2 bg-slate-100 text-slate-700 rounded hover:bg-slate-200"
            >
              Cancel
            </button>
            <button
              disabled={!assessmentFile || isUploadingAssessment}
              className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 flex items-center gap-2"
              onClick={async () => {
                if (!assessmentFile) return;
                setIsUploadingAssessment(true);
                setAssessmentProgress(10);
                const runLocal = async () => {
                  const readBuf = () =>
                    new Promise<ArrayBuffer>((resolve, reject) => {
                      const r = new FileReader();
                      r.onload = () => resolve(r.result as ArrayBuffer);
                      r.onerror = () =>
                        reject(new Error("Failed to read file"));
                      r.readAsArrayBuffer(assessmentFile);
                    });
                  const buf = await readBuf();
                  const data = new Uint8Array(buf);
                  const XLSX = await import("xlsx");
                  const wb = XLSX.read(data, { type: "array" });
                  const ws = wb.Sheets[wb.SheetNames[0]];
                  const arr = XLSX.utils.sheet_to_json(ws) as Record<
                    string,
                    unknown
                  >[];
                  const req = [
                    "student_id",
                    "cat1",
                    "cat2",
                    "cat3",
                    "cat4",
                    "group",
                    "project",
                    "exam",
                  ];
                  const keys = arr[0]
                    ? Object.keys(arr[0]).map((k) => k.toLowerCase().trim())
                    : [];
                  const missing = req.filter((k) => !keys.includes(k));
                  if (missing.length) {
                    setAssessmentErrors([
                      `Missing columns: ${missing.join(", ")}`,
                    ]);
                    throw new Error("Invalid template");
                  }
                  const clamp = (f: string, n: number) => {
                    const v = Number.isFinite(n) ? n : 0;
                    if (f === "exam") return Math.max(0, Math.min(100, v));
                    if (f === "group" || f === "project")
                      return Math.max(0, Math.min(20, v));
                    if (["cat1", "cat2", "cat3", "cat4"].includes(f))
                      return Math.max(0, Math.min(10, v));
                    return Math.max(0, v);
                  };
                  const normalizeKey = (k: string): string =>
                    k
                      .toLowerCase()
                      .trim()
                      .replace(/[\s-]+/g, "_")
                      .replace(/__+/g, "_")
                      .replace(/^_+|_+$/g, "");
                  const alias: Record<string, string> = {
                    studentid: "student_id",
                    student_id: "student_id",
                    id: "student_id",
                    cat1_score: "cat1",
                    cat2_score: "cat2",
                    cat3_score: "cat3",
                    cat4_score: "cat4",
                    group_work: "group",
                    group_work_score: "group",
                    project_work: "project",
                    project_work_score: "project",
                    exam_score: "exam",
                  };
                  const mapKey = (raw: string): string => {
                    const n = normalizeKey(raw);
                    return alias[n] || n;
                  };
                  const unmatched: string[] = [];
                  setMarks((prev) => {
                    const nm: Marks = { ...prev };
                    for (const r of arr) {
                      const lower: Record<string, unknown> = {};
                      Object.keys(r).forEach(
                        (k) =>
                          (lower[mapKey(k)] = (r as Record<string, unknown>)[
                            k
                          ]),
                      );
                      const sid = String(lower["student_id"] || "").trim();
                      if (!sid) continue;
                      if (!students.some((s) => s.id === sid))
                        unmatched.push(sid);
                      const fields = [
                        "cat1",
                        "cat2",
                        "cat3",
                        "cat4",
                        "group",
                        "project",
                        "exam",
                      ] as const;
                      const val: Record<string, number> = {};
                      fields.forEach((f) => {
                        const raw = parseFloat(String(lower[f] ?? ""));
                        const n = clamp(f, Number.isFinite(raw) ? raw : 0);
                        val[f] = n;
                      });
                      nm[sid] = nm[sid] || {};
                      nm[sid][activeSubject] = {
                        cat1: val["cat1"],
                        cat2: val["cat2"],
                        cat3: val["cat3"],
                        cat4: val["cat4"],
                        group: val["group"],
                        project: val["project"],
                        exam: val["exam"],
                      };
                    }
                    return nm;
                  });
                  const uploadedAt = Date.now();
                  const vk = verKey(
                    selectedClass,
                    activeSubject,
                    academicYear,
                    term,
                  );
                  const currentVer = kvGet<number>("local", vk) || 0;
                  const nextVer = currentVer + 1;
                  const processed = arr
                    .map((r) => {
                      const lower: Record<string, unknown> = {};
                      Object.keys(r).forEach(
                        (k) =>
                          (lower[mapKey(k)] = (r as Record<string, unknown>)[
                            k
                          ]),
                      );
                      const sid = String(lower["student_id"] || "").trim();
                      if (!sid) return null;
                      return {
                        student_id: sid,
                        metrics: {
                          cat1: Number(lower["cat1"] ?? 0),
                          cat2: Number(lower["cat2"] ?? 0),
                          cat3: Number(lower["cat3"] ?? 0),
                          cat4: Number(lower["cat4"] ?? 0),
                          group: Number(lower["group"] ?? 0),
                          project: Number(lower["project"] ?? 0),
                          exam: Number(lower["exam"] ?? 0),
                        },
                        uploadedAt,
                        version: nextVer,
                      };
                    })
                    .filter(Boolean) as Array<{
                    student_id: string;
                    metrics: Record<string, number>;
                    uploadedAt: number;
                    version: number;
                  }>;
                  const payload = JSON.stringify({
                    subject: activeSubject,
                    class: selectedClass,
                    academicYear,
                    term,
                    uploadedAt,
                    version: nextVer,
                    count: processed.length,
                    unmatched,
                    rows: processed,
                  });
                  try {
                    const { id } = await saveDownloadedContent(
                      undefined,
                      payload,
                      "application/json",
                      [
                        "assessments",
                        "processed",
                        activeSubject || "",
                        selectedClass || "",
                      ],
                      undefined,
                      true,
                      `Processed_${(activeSubject || "")
                        .replace(/[^A-Za-z0-9_-]+/g, "_")
                        .slice(
                          0,
                          40,
                        )}_${selectedClass}_${academicYear}_${term}_v${nextVer}.json`,
                    );
                    kvSet("local", vk, nextVer);
                    kvSet(
                      "local",
                      lastProcessedKey(
                        selectedClass,
                        activeSubject,
                        academicYear,
                        term,
                      ),
                      id,
                    );
                  } catch {
                    logger.warn("processed_save_failed");
                  }
                  setImportLogs((prev) => [
                    ...prev,
                    {
                      status: "success",
                      message: `Mapped ${processed.length} records. Unmatched: ${unmatched.length}.`,
                    },
                  ]);
                  setAssessmentProgress(100);
                  setIsAssessmentUploadOpen(false);
                };
                try {
                  const resp = await apiClient.uploadAssessments(
                    assessmentFile,
                    {
                      subject: activeSubject,
                      academicYear,
                      term,
                    },
                  );
                  setAssessmentProgress(70);
                  const json: unknown = resp as unknown;
                  if (!json) {
                    await runLocal();
                    return;
                  }
                  if (
                    json &&
                    Array.isArray((json as Record<string, unknown>).errors) &&
                    ((json as Record<string, unknown>).errors as unknown[])
                      .length
                  ) {
                    setAssessmentErrors(
                      ((json as Record<string, unknown>).errors as string[]) ||
                        [],
                    );
                  } else {
                    setAssessmentProgress(100);
                    setIsAssessmentUploadOpen(false);
                    try {
                      const data2 = await apiClient.getSubjectSheet({
                        subject: activeSubject,
                        class: selectedClass,
                        academicYear,
                        term,
                      });
                      try {
                        await saveDownloadedContent(
                          undefined,
                          JSON.stringify(data2.rows || []),
                          "application/json",
                          [
                            "subject-sheet",
                            activeSubject || "",
                            selectedClass || "",
                          ],
                          undefined,
                        );
                      } catch {
                        void 0;
                      }
                      const rows2 = Array.isArray(data2.rows) ? data2.rows : [];
                      setMarks((prev) => {
                        const next: Marks = { ...prev };
                        for (const r of rows2) {
                          const sid = String(r.student_id || "");
                          if (!sid) continue;
                          next[sid] =
                            next[sid] ||
                            ({} as Record<
                              string,
                              {
                                cat1: number;
                                cat2: number;
                                cat3: number;
                                cat4: number;
                                group: number;
                                project: number;
                                exam: number;
                              }
                            >);
                          next[sid][activeSubject] = {
                            cat1: Number(r.cat1_score || 0),
                            cat2: Number(r.cat2_score || 0),
                            cat3: Number(r.cat3_score || 0),
                            cat4: Number(r.cat4_score || 0),
                            group: Number(r.group_work_score || 0),
                            project: Number(r.project_work_score || 0),
                            exam: Number(r.exam_score || 0),
                          };
                        }
                        return next;
                      });
                      setImportLogs((prev) => [
                        ...prev,
                        {
                          status: "success",
                          message: `Refreshed ${rows2.length} marks from server.`,
                        },
                      ]);
                    } catch {
                      logger.warn("marks_refresh_failed_after_upload");
                    }
                  }
                } catch (err: unknown) {
                  try {
                    await runLocal();
                    return;
                  } catch {
                    const msg =
                      err instanceof Error ? err.message : String(err);
                    setAssessmentErrors([msg || "Upload failed"]);
                  }
                } finally {
                  setIsUploadingAssessment(false);
                  setAssessmentProgress(0);
                }
              }}
            >
              {isUploadingAssessment ? (
                <Loader2 size={16} className="animate-spin" />
              ) : (
                <Upload size={16} />
              )}
              Upload & Map
            </button>
          </div>
        </div>
      </div>
    );
  };

  const renderMasterDB = () => (
    <div className="space-y-4">
      {isModalOpen && (
        <div className="fixed inset-0 z-[65] flex items-center justify-center p-3 sm:p-4 bg-slate-900/50 backdrop-blur-sm animate-in fade-in duration-200">
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="add-student-title"
            className="bg-white rounded-xl shadow-2xl w-full max-w-[95vw] sm:max-w-lg md:max-w-2xl overflow-hidden flex flex-col max-h-[85vh]"
          >
            <div className="px-4 sm:px-6 py-3 sm:py-4 border-b border-slate-100 flex justify-between items-center bg-blue-50">
              <h3
                id="add-student-title"
                className="text-base sm:text-lg font-bold text-blue-900 flex items-center gap-2"
              >
                <Users size={20} className="text-blue-700" />{" "}
                {editingStudent ? "Edit Student" : "Add Student"}
              </h3>
              <button
                onClick={closeModal}
                className="text-slate-400 hover:text-slate-600 hover:bg-slate-200 rounded-full p-2"
                aria-label="Close dialog"
                title="Close"
              >
                <X size={20} />
              </button>
            </div>
            <div className="p-4 sm:p-6 space-y-4 overflow-y-auto">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3 sm:gap-4">
                <div>
                  <label
                    htmlFor="student-id"
                    className="block text-xs sm:text-sm font-medium text-slate-700 mb-1"
                  >
                    Student ID
                  </label>
                  <input
                    id="student-id"
                    name="id"
                    value={formData.id}
                    onChange={handleInputChange}
                    ref={addStudentFirstFieldRef}
                    className="w-full p-3 border rounded text-sm sm:text-base"
                  />
                  {formErrors.id && (
                    <p className="text-xs text-red-600 mt-1">{formErrors.id}</p>
                  )}
                </div>
                <div>
                  <label
                    htmlFor="surname"
                    className="block text-xs sm:text-sm font-medium text-slate-700 mb-1"
                  >
                    Surname
                  </label>
                  <input
                    id="surname"
                    name="surname"
                    value={formData.surname}
                    onChange={handleInputChange}
                    className="w-full p-3 border rounded text-sm sm:text-base"
                  />
                  {formErrors.surname && (
                    <p className="text-xs text-red-600 mt-1">
                      {formErrors.surname}
                    </p>
                  )}
                </div>
                <div>
                  <label
                    htmlFor="first-name"
                    className="block text-xs sm:text-sm font-medium text-slate-700 mb-1"
                  >
                    First Name
                  </label>
                  <input
                    id="first-name"
                    name="firstName"
                    value={formData.firstName}
                    onChange={handleInputChange}
                    className="w-full p-3 border rounded text-sm sm:text-base"
                  />
                  {formErrors.firstName && (
                    <p className="text-xs text-red-600 mt-1">
                      {formErrors.firstName}
                    </p>
                  )}
                </div>
                <div>
                  <label
                    htmlFor="middle-name"
                    className="block text-xs sm:text-sm font-medium text-slate-700 mb-1"
                  >
                    Middle Name
                  </label>
                  <input
                    id="middle-name"
                    onChange={handleInputChange}
                    className="w-full p-3 border rounded text-sm sm:text-base"
                    placeholder="Enter middle name"
                    maxLength={50}
                  />
                  {formErrors.middleName && (
                    <p className="text-xs text-red-600 mt-1">
                      {formErrors.middleName}
                    </p>
                  )}
                </div>
                <div>
                  <label
                    htmlFor="gender"
                    className="block text-xs sm:text-sm font-medium text-slate-700 mb-1"
                  >
                    Gender
                  </label>
                  <select
                    id="gender"
                    name="gender"
                    value={formData.gender}
                    onChange={handleInputChange}
                    className="w-full p-3 border rounded bg-slate-50 text-sm sm:text-base"
                  >
                    <option>Male</option>
                    <option>Female</option>
                    <option>Other</option>
                  </select>
                  {formErrors.gender && (
                    <p className="text-xs text-red-600 mt-1">
                      {formErrors.gender}
                    </p>
                  )}
                </div>
                <div>
                  <label
                    htmlFor="dob"
                    className="block text-xs sm:text-sm font-medium text-slate-700 mb-1"
                  >
                    Date of Birth
                  </label>
                  <input
                    id="dob"
                    type="date"
                    name="dob"
                    value={formData.dob}
                    onChange={handleInputChange}
                    className="w-full p-3 border rounded text-sm sm:text-base"
                  />
                  {formErrors.dob && (
                    <p className="text-xs text-red-600 mt-1">
                      {formErrors.dob}
                    </p>
                  )}
                </div>
                <div>
                  <label
                    htmlFor="guardian-contact"
                    className="block text-xs sm:text-sm font-medium text-slate-700 mb-1"
                  >
                    Guardian Contact
                  </label>
                  <input
                    id="guardian-contact"
                    name="guardianContact"
                    value={formData.guardianContact}
                    onChange={handleInputChange}
                    className="w-full p-3 border rounded text-sm sm:text-base"
                  />
                  {formErrors.guardianContact && (
                    <p className="text-xs text-red-600 mt-1">
                      {formErrors.guardianContact}
                    </p>
                  )}
                </div>
                <div>
                  <label
                    htmlFor="class-name"
                    className="block text-xs sm:text-sm font-medium text-slate-700 mb-1"
                  >
                    Class
                  </label>
                  <select
                    id="class-name"
                    name="class"
                    value={formData.class}
                    onChange={handleInputChange}
                    className="w-full p-3 border rounded bg-slate-50 text-sm sm:text-base"
                  >
                    {AVAILABLE_CLASSES.map((c) => (
                      <option key={c}>{c}</option>
                    ))}
                  </select>
                  {formErrors.class && (
                    <p className="text-xs text-red-600 mt-1">
                      {formErrors.class}
                    </p>
                  )}
                </div>
                <div>
                  <label
                    htmlFor="status"
                    className="block text-sm font-medium text-slate-700 mb-1"
                  >
                    Status
                  </label>
                  <select
                    id="status"
                    name="status"
                    value={formData.status}
                    onChange={handleInputChange}
                    className="w-full p-2 border rounded bg-slate-50"
                  >
                    <option>Active</option>
                    <option>Inactive</option>
                    <option>Withdrawn</option>
                  </select>
                </div>
              </div>
              {showSuccess && (
                <div className="p-3 bg-green-50 border border-green-100 text-green-700 rounded flex items-center gap-2 text-sm">
                  <CheckCircle size={16} /> Saved successfully
                </div>
              )}
            </div>
            <div className="px-4 sm:px-6 py-3 sm:py-4 border-t bg-slate-50 flex flex-wrap justify-end gap-2 sm:gap-3">
              <button
                onClick={closeModal}
                className="px-4 py-3 bg-slate-100 text-slate-700 rounded hover:bg-slate-200 text-sm sm:text-base"
              >
                Cancel
              </button>
              <button
                onClick={handleSaveStudent}
                disabled={isSubmitting}
                className="px-4 py-3 bg-blue-600 text-white rounded hover:bg-blue-700 flex items-center gap-2 text-sm sm:text-base"
              >
                {isSubmitting ? (
                  <Loader2 size={16} className="animate-spin" />
                ) : (
                  <Save size={16} />
                )}
                Save
              </button>
            </div>
          </div>
        </div>
      )}
      {isExcelViewerOpen && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg shadow-lg w-[95vw] max-w-6xl max-h-[90vh] overflow-hidden border border-slate-200">
            <div className="px-4 py-3 border-b flex items-center justify-between">
              <div className="flex items-center gap-3">
                <FileSpreadsheet size={18} className="text-emerald-600" />
                <div className="text-sm text-slate-700">
                  <div className="font-semibold">
                    {excelViewerMeta?.name || "Excel File"}
                  </div>
                  <div className="text-xs text-slate-500">
                    {excelViewerMeta?.type} ·{" "}
                    {excelViewerMeta?.size
                      ? `${(excelViewerMeta.size / (1024 * 1024)).toFixed(
                          2,
                        )} MB`
                      : ""}{" "}
                    {excelViewerMeta?.macro ? "· Macros detected" : ""}
                  </div>
                </div>
              </div>
              <button
                onClick={() => {
                  setIsExcelViewerOpen(false);
                  setExcelViewerSheets([]);
                  setExcelViewerError(null);
                }}
                className="p-2 rounded hover:bg-slate-100"
                aria-label="Close Excel viewer"
                title="Close"
              >
                <X size={18} />
              </button>
            </div>
            {excelViewerLoading ? (
              <div className="flex items-center justify-center h-64">
                <Loader2 size={32} className="animate-spin text-emerald-600" />
                <span className="ml-3 text-slate-600 text-sm">
                  Loading workbook…
                </span>
              </div>
            ) : excelViewerError ? (
              <div className="p-6 text-red-700 bg-red-50 text-sm">
                {excelViewerError}
              </div>
            ) : (
              <div className="flex flex-col h-[70vh]">
                <div className="flex gap-2 p-2 border-b bg-slate-50 overflow-x-auto">
                  {excelViewerSheets.map((s, i) => (
                    <button
                      key={s.name}
                      onClick={() => setExcelViewerActive(i)}
                      className={`px-3 py-1 rounded ${
                        excelViewerActive === i
                          ? "bg-white border border-slate-200"
                          : "bg-slate-100"
                      }`}
                    >
                      {s.name}
                    </button>
                  ))}
                </div>
                <div className="flex-1 overflow-auto p-2">
                  {excelViewerSheets[excelViewerActive] && (
                    <table className="min-w-full text-xs">
                      <thead>
                        <tr>
                          {excelViewerSheets[excelViewerActive].headers.map(
                            (h) => (
                              <th
                                key={h}
                                className="px-2 py-1 bg-slate-100 text-slate-600 border-b"
                              >
                                {h}
                              </th>
                            ),
                          )}
                        </tr>
                      </thead>
                      <tbody>
                        {excelViewerSheets[excelViewerActive].rows.map(
                          (row, ri) => (
                            <tr key={ri} className="border-b">
                              {excelViewerSheets[excelViewerActive].headers.map(
                                (h) => (
                                  <td key={h} className="px-2 py-1">
                                    {String(
                                      (row as Record<string, unknown>)[h] ?? "",
                                    )}
                                  </td>
                                ),
                              )}
                            </tr>
                          ),
                        )}
                      </tbody>
                    </table>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>
      )}
      {isGeneratingDoc && (
        <div className="fixed inset-0 z-[70] flex flex-col items-center justify-center bg-slate-900/50 backdrop-blur-sm text-white">
          <Loader2 size={48} className="animate-spin mb-4" />
          <p className="text-lg font-medium">{docStatus}</p>
        </div>
      )}
      {deleteConfirmation.isOpen && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center p-3 sm:p-4 bg-slate-900/50 backdrop-blur-sm animate-in fade-in duration-200">
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="confirm-delete-title"
            className="bg-white rounded-lg shadow-xl w-full max-w-[95vw] sm:max-w-sm p-5 sm:p-6 transform transition-all scale-100"
          >
            <div className="flex flex-col items-center text-center">
              <div className="w-12 h-12 bg-red-100 rounded-full flex items-center justify-center mb-4">
                <AlertTriangle className="text-red-600" size={24} />
              </div>
              <h3
                id="confirm-delete-title"
                className="text-base sm:text-lg font-bold text-slate-900"
              >
                Confirm Deletion
              </h3>
              <p className="text-sm text-slate-500 mt-2">
                Are you sure you want to delete this student? This action will
                remove all their personal data and assessment records
                permanently.
              </p>
              <div className="flex gap-2 sm:gap-3 mt-6 w-full">
                <button
                  onClick={cancelDelete}
                  className="flex-1 px-4 py-3 bg-slate-100 text-slate-700 font-medium rounded-lg hover:bg-slate-200 transition-colors text-sm sm:text-base"
                >
                  Cancel
                </button>
                <button
                  onClick={confirmDelete}
                  className="flex-1 px-4 py-3 bg-red-600 text-white font-medium rounded-lg hover:bg-red-700 transition-colors text-sm sm:text-base"
                >
                  Delete
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
      {isWipeModalOpen && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center p-3 sm:p-4 bg-slate-900/50 backdrop-blur-sm animate-in fade-in duration-200">
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="wipe-db-title"
            className="bg-white rounded-lg shadow-xl w-full max-w-[95vw] sm:max-w-md p-5 sm:p-6"
          >
            <div className="flex flex-col items-center text-center">
              <div className="w-12 h-12 bg-red-100 rounded-full flex items-center justify-center mb-4">
                <AlertTriangle className="text-red-600" size={24} />
              </div>
              <h3
                id="wipe-db-title"
                className="text-base sm:text-lg font-bold text-slate-900"
              >
                Clear Master Student Database
              </h3>
              <p className="text-sm text-slate-500 mt-2">
                This will permanently remove all student records and reset
                counters.
              </p>
              <div className="mt-4 w-full bg-red-50 p-3 rounded-md border border-red-100">
                <p className="text-sm text-red-700 font-medium text-center">
                  Clicking "Clear" will trigger a final confirmation.
                </p>
              </div>
              <div className="flex gap-2 sm:gap-3 mt-6 w-full">
                <button
                  onClick={closeWipeModal}
                  disabled={isWiping}
                  className="flex-1 px-4 py-3 bg-slate-100 text-slate-700 font-medium rounded-lg hover:bg-slate-200 transition-colors text-sm sm:text-base"
                >
                  Cancel
                </button>
                <button
                  onClick={performWipe}
                  disabled={isWiping}
                  className="flex-1 px-4 py-3 bg-red-600 text-white font-medium rounded-lg hover:bg-red-700 transition-colors text-sm sm:text-base"
                >
                  {isWiping ? (
                    <Loader2 size={16} className="animate-spin" />
                  ) : (
                    <Trash2 size={16} />
                  )}
                  {isWiping ? " Clearing..." : " Clear"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
      {isImportModalOpen && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center p-3 sm:p-4 bg-slate-900/50 backdrop-blur-sm animate-in fade-in zoom-in-95">
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="import-dialog-title"
            className="bg-white rounded-xl shadow-2xl w-full max-w-[95vw] sm:max-w-lg md:max-w-2xl overflow-hidden flex flex-col max-h-[85vh]"
          >
            <div className="px-4 sm:px-6 py-3 sm:py-4 border-b border-slate-100 flex flex-col gap-2 bg-emerald-50">
              <div className="flex justify-between items-center gap-3">
                <h3
                  id="import-dialog-title"
                  className="text-base sm:text-lg font-bold text-emerald-900 flex items-center gap-2"
                >
                  <FileSpreadsheet size={20} className="text-emerald-600" />
                  Import Student Data (Excel)
                </h3>
                <button
                  onClick={() => {
                    setIsImportModalOpen(false);
                    setImportLogs([]);
                    setImportedPreview([]);
                  }}
                  className="text-slate-400 hover:text-slate-600 hover:bg-slate-200 rounded-full p-2"
                  aria-label="Close import dialog"
                  title="Close"
                >
                  <X size={20} />
                </button>
              </div>
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="text-xs sm:text-sm text-emerald-900 font-medium">
                  Target Class for Import
                </div>
                <div className="flex items-center gap-2">
                  <label
                    htmlFor="import-class-select"
                    className="text-xs text-slate-600"
                  >
                    Class
                  </label>
                  <select
                    id="import-class-select"
                    value={selectedClass}
                    onChange={(e) => setSelectedClass(e.target.value)}
                    className="p-1.5 sm:p-2 border border-emerald-200 rounded-md bg-white text-xs sm:text-sm min-w-[8rem] sm:min-w-[10rem] disabled:opacity-50 disabled:cursor-not-allowed"
                    aria-label="Select class for import"
                    disabled={user?.role === "CLASS"}
                  >
                    <option>JHS 1(A)</option>
                    <option>JHS 1(B)</option>
                    <option>JHS 1(C)</option>
                    <option>JHS 2(A)</option>
                    <option>JHS 2(B)</option>
                    <option>JHS 2(C)</option>
                    <option>JHS 3(A)</option>
                    <option>JHS 3(B)</option>
                    <option>JHS 3(C)</option>
                  </select>
                </div>
              </div>
            </div>
            <div className="p-4 sm:p-6 overflow-y-auto">
              {isImporting && (
                <div className="flex flex-col items-center justify-center h-64">
                  <Loader2
                    size={48}
                    className="text-emerald-500 animate-spin mb-4"
                  />
                  <p className="text-lg font-medium text-slate-700">
                    Processing Excel File...
                  </p>
                  <p className="text-sm text-slate-500">
                    Parsing rows and validating data structure.
                  </p>
                </div>
              )}
              {!isImporting && !importedPreview.length && (
                <div className="mb-6">
                  <div
                    onClick={() => importFileInputRef.current?.click()}
                    className="border-2 border-dashed border-emerald-200 bg-emerald-50/50 rounded-xl p-6 sm:p-8 flex flex-col items-center justify-center cursor-pointer hover:bg-emerald-50 hover:border-emerald-400 transition-all group"
                  >
                    <div className="p-4 bg-white rounded-full shadow-sm mb-4 group-hover:scale-110 transition-transform">
                      <Upload size={32} className="text-emerald-500" />
                    </div>
                    <p className="text-lg font-medium text-emerald-900">
                      Click to Upload Excel File
                    </p>
                    <p className="text-sm text-emerald-600 mb-4">
                      Supported formats: .xlsx, .xls
                    </p>
                    <button className="px-4 py-3 bg-emerald-600 text-white rounded-lg text-sm font-medium shadow-sm hover:shadow">
                      Select File
                    </button>
                    <input
                      type="file"
                      ref={importFileInputRef}
                      onChange={handleExcelUpload}
                      accept=".xlsx, .xls"
                      className="hidden"
                      aria-label="Import Excel file"
                      title="Import Excel file"
                    />
                  </div>
                  <div className="mt-4 p-4 bg-slate-50 rounded-lg text-sm text-slate-600 border border-slate-100">
                    <p className="font-bold mb-2 flex items-center gap-2">
                      <AlertCircle size={14} className="text-blue-500" />
                      Required Columns:
                    </p>
                    <div className="flex flex-wrap gap-2">
                      <code className="bg-white px-2 py-1 rounded border text-xs font-mono text-slate-700">
                        Surname
                      </code>
                      <code className="bg-white px-2 py-1 rounded border text-xs font-mono text-slate-700">
                        First Name
                      </code>
                      <code className="bg-white px-2 py-1 rounded border text-xs font-mono text-slate-700">
                        Gender
                      </code>
                      <code className="bg-white px-2 py-1 rounded border text-xs font-mono text-slate-700">
                        Class
                      </code>
                    </div>
                  </div>
                </div>
              )}
              {!isImporting && importedPreview.length > 0 && (
                <div className="mb-6">
                  <div className="flex justify-between items-center mb-2">
                    <h4 className="font-bold text-slate-700 flex items-center gap-2">
                      <CheckCircle size={16} className="text-emerald-500" />
                      Preview ({importedPreview.length} records)
                    </h4>
                    <button
                      onClick={() => {
                        setImportedPreview([]);
                        setImportLogs([]);
                        setSelectedImportFile(null);
                      }}
                      className="text-xs sm:text-sm text-red-600 hover:text-red-700 hover:underline font-medium"
                    >
                      Clear & Upload New
                    </button>
                  </div>
                  <div className="overflow-x-auto border rounded-lg max-h-60 shadow-sm">
                    <table className="w-full text-xs text-left">
                      <thead className="bg-slate-100 font-bold sticky top-0 text-slate-700">
                        <tr>
                          <th className="p-2 border-b">ID (Auto)</th>
                          <th className="p-2 border-b">Surname</th>
                          <th className="p-2 border-b">First Name</th>
                          <th className="p-2 border-b">Gender</th>
                          <th className="p-2 border-b">Class</th>
                        </tr>
                      </thead>
                      <tbody className="bg-white">
                        {importedPreview.slice(0, 10).map((row, i) => (
                          <tr
                            key={i}
                            className="border-b hover:bg-slate-50 last:border-0"
                          >
                            <td className="p-2 text-slate-400 italic">
                              Auto-Gen
                            </td>
                            <td className="p-2 font-medium">
                              {String(
                                (row as Record<string, unknown>)["surname"] ||
                                  (row as Record<string, unknown>)[
                                    "lastname"
                                  ] ||
                                  "",
                              )}
                            </td>
                            <td className="p-2">
                              {String(
                                (row as Record<string, unknown>)["firstname"] ||
                                  (row as Record<string, unknown>)[
                                    "first name"
                                  ] ||
                                  "",
                              )}
                            </td>
                            <td className="p-2">
                              {String(
                                (row as Record<string, unknown>)["gender"] ||
                                  "",
                              )}
                            </td>
                            <td className="p-2">
                              {String(
                                (row as Record<string, unknown>)["class"] || "",
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    {importedPreview.length > 10 && (
                      <div className="p-2 text-center text-xs text-slate-500 bg-slate-50 border-t font-medium">
                        ...and {importedPreview.length - 10} more rows
                      </div>
                    )}
                  </div>
                </div>
              )}
              {importLogs.length > 0 && (
                <div className="space-y-2 mb-4 animate-in slide-in-from-bottom-2">
                  {importLogs.map((log, idx) => (
                    <div
                      key={idx}
                      className={`p-3 rounded-lg text-sm flex items-start gap-2 border ${
                        log.status === "error"
                          ? "bg-red-50 text-red-700 border-red-100"
                          : log.status === "success"
                            ? "bg-green-50 text-green-700 border-green-100"
                            : "bg-yellow-50 text-yellow-700 border-yellow-100"
                      }`}
                    >
                      {log.status === "error" ? (
                        <AlertCircle size={16} className="mt-0.5 shrink-0" />
                      ) : (
                        <CheckCircle size={16} className="mt-0.5 shrink-0" />
                      )}
                      <span>{log.message}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
            <div className="p-4 border-t bg-slate-50 flex justify-end gap-3">
              <button
                onClick={() => {
                  setIsImportModalOpen(false);
                  setImportLogs([]);
                  setImportedPreview([]);
                }}
                className="px-4 py-2 text-slate-600 hover:bg-slate-200 rounded-lg font-medium transition-colors"
              >
                Close
              </button>
              {importedPreview.length > 0 && (
                <button
                  onClick={processImport}
                  disabled={isImporting}
                  className={`px-6 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg font-medium shadow-sm flex items-center gap-2 transition-all hover:shadow-md ${
                    isImporting
                      ? "cursor-not-allowed min-w-[200px] justify-center"
                      : ""
                  }`}
                >
                  {isImporting ? (
                    <div className="flex flex-col items-center w-full">
                      <div className="flex items-center gap-2 text-sm mb-1">
                        <Loader2 size={14} className="animate-spin" />
                        <span>
                          {importProgress < 100
                            ? `Uploading ${importProgress}%`
                            : "Processing..."}
                        </span>
                      </div>
                      <div className="w-full bg-emerald-800/30 rounded-full h-1">
                        <div
                          className={`bg-white h-1 rounded-full transition-all duration-300 ${(() => {
                            const value = Math.max(
                              0,
                              Math.min(100, Math.round(importProgress)),
                            );
                            const steps = [
                              "w-[0%]",
                              "w-[5%]",
                              "w-[10%]",
                              "w-[15%]",
                              "w-[20%]",
                              "w-[25%]",
                              "w-[30%]",
                              "w-[35%]",
                              "w-[40%]",
                              "w-[45%]",
                              "w-[50%]",
                              "w-[55%]",
                              "w-[60%]",
                              "w-[65%]",
                              "w-[70%]",
                              "w-[75%]",
                              "w-[80%]",
                              "w-[85%]",
                              "w-[90%]",
                              "w-[95%]",
                              "w-[100%]",
                            ];
                            const idx = Math.min(
                              steps.length - 1,
                              Math.round(value / 5),
                            );
                            return steps[idx];
                          })()}`}
                        />
                      </div>
                    </div>
                  ) : (
                    <>
                      <Download size={18} /> Confirm Import
                    </>
                  )}
                </button>
              )}
            </div>
          </div>
        </div>
      )}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center bg-white p-4 rounded-lg shadow-sm gap-4 border border-slate-200">
        <h2 className="text-xl font-bold text-slate-800">
          Master Student Database
        </h2>
        <div className="flex gap-3 w-full sm:w-auto flex-wrap">
          <button
            onClick={exportDBToExcel}
            className="flex items-center gap-2 px-3 py-2 bg-white border border-emerald-200 text-emerald-700 hover:bg-emerald-50 rounded-lg text-sm font-medium"
          >
            <FileSpreadsheet size={16} /> Export Excel
          </button>
          <button
            onClick={exportDBToPDF}
            className="flex items-center gap-2 px-3 py-2 bg-white border border-red-200 text-red-700 hover:bg-red-50 rounded-lg text-sm font-medium"
          >
            <FileIcon size={16} /> Export PDF
          </button>
          <button
            onClick={() => setIsImportModalOpen(true)}
            className="flex items-center gap-2 px-3 py-2 bg-white border border-blue-200 text-blue-700 hover:bg-blue-50 rounded-lg text-sm font-medium shadow-sm hover:shadow transition-all"
          >
            <Upload size={16} /> Import Excel
          </button>
          <button
            onClick={() => setIsStorageOpen((p) => !p)}
            className="flex items-center gap-2 px-3 py-2 bg-white border border-slate-200 text-slate-700 hover:bg-slate-50 rounded-lg text-sm font-medium"
          >
            <Database size={16} /> Storage
          </button>
          <button
            onClick={openCreateModal}
            className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white hover:bg-blue-700 rounded-lg text-sm font-medium shadow-sm hover:shadow transition-all"
          >
            <Users size={16} /> Add Student
          </button>
          <button
            onClick={openWipeModal}
            className="flex items-center gap-2 px-4 py-2 bg-red-600 text-white hover:bg-red-700 rounded-lg text-sm font-medium shadow-sm hover:shadow transition-all"
          >
            <Trash2 size={16} /> Clear Database
          </button>
          <MasterDBSyncControls />
        </div>
      </div>
      {isStorageOpen && (
        <div className="mt-4 bg-white rounded-lg border border-slate-200 shadow-sm p-4">
          <div className="flex items-center justify-between mb-3">
            <div className="text-sm text-slate-600">
              {`Local: ${(storageUsage.lsBytes / (1024 * 1024)).toFixed(2)} MB`}
              {storageUsage.usage && storageUsage.quota
                ? ` | IndexedDB: ${(
                    (storageUsage.usage || 0) /
                    (1024 * 1024)
                  ).toFixed(2)} MB / ${(
                    (storageUsage.quota || 0) /
                    (1024 * 1024)
                  ).toFixed(2)} MB`
                : ""}
            </div>
            <div className="flex gap-2">
              <button
                onClick={refreshStorage}
                className="px-3 py-1 bg-white border border-slate-200 text-slate-700 rounded"
              >
                Refresh
              </button>
              <button
                onClick={clearExcelStorage}
                className="px-3 py-1 bg-red-600 text-white rounded"
              >
                Clear Excel Data
              </button>
            </div>
          </div>
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead>
                <tr className="text-left text-slate-500">
                  <th className="py-2 px-2">Name</th>
                  <th className="py-2 px-2">Tags</th>
                  <th className="py-2 px-2">Type</th>
                  <th className="py-2 px-2">Size</th>
                  <th className="py-2 px-2">Imported</th>
                  <th className="py-2 px-2">Actions</th>
                </tr>
              </thead>
              <tbody>
                {storageItems.map((m) => (
                  <tr key={m.id} className="border-t border-slate-100">
                    <td className="py-2 px-2">{m.name || m.id}</td>
                    <td className="py-2 px-2">{(m.tags || []).join(", ")}</td>
                    <td className="py-2 px-2">{m.type}</td>
                    <td className="py-2 px-2">{`${(
                      (m.size ?? 0) /
                      (1024 * 1024)
                    ).toFixed(2)} MB`}</td>
                    <td className="py-2 px-2">
                      <div className="flex gap-2">
                        {(() => {
                          const t = m.type || "";
                          const n = m.name || "";
                          const isExcelMime = /spreadsheetml|ms-excel/i.test(t);
                          const isExcelName = /\.(xlsx|xlsm|xls)$/i.test(n);
                          return isExcelMime || isExcelName;
                        })() && (
                          <button
                            onClick={() => openStoredExcel(m.id)}
                            className="px-3 py-1 bg-white border border-slate-200 text-slate-700 rounded"
                          >
                            Open
                          </button>
                        )}
                        <button
                          onClick={() => downloadStoredItem(m.id)}
                          className="px-3 py-1 bg-white border border-slate-200 text-slate-700 rounded"
                        >
                          Download
                        </button>
                        <button
                          onClick={() => deleteStoredItem(m.id)}
                          className="px-3 py-1 bg-red-600 text-white rounded"
                        >
                          Delete
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
      <div className="bg-white rounded-lg shadow-sm overflow-hidden border border-slate-200">
        {filteredStudents.length === 0 && (
          <div className="p-6 text-center text-slate-600">
            <div className="text-lg font-semibold text-slate-800 mb-2">
              No student records
            </div>
            <p className="text-sm">
              Use <span className="font-medium">Import Excel</span> to load data
              or
              <span className="font-medium"> Add Student</span> to create a
              record.
            </p>
          </div>
        )}
        <div className="overflow-x-auto">
          <table className="w-full text-sm text-left whitespace-nowrap">
            <thead className="bg-slate-100 text-xs uppercase text-slate-600">
              <tr>
                <th className="p-4 text-left">ID</th>
                <th className="p-4 text-left">Surname</th>
                <th className="p-4 text-left">First Name</th>
                <th className="p-4 text-left">Middle Name</th>
                <th className="p-4 text-left">Gender</th>
                <th className="p-4 text-left">
                  <div className="flex items-center gap-2">
                    Class
                    <select
                      value={selectedClass}
                      onChange={(e) => setSelectedClass(e.target.value)}
                      className="ml-2 p-1 text-xs border border-slate-300 rounded bg-white text-slate-700 font-normal"
                      onClick={(e) => e.stopPropagation()}
                      aria-label="Filter by Class"
                    >
                      {AVAILABLE_CLASSES.map((cls) => (
                        <option key={cls} value={cls}>
                          {cls}
                        </option>
                      ))}
                    </select>
                  </div>
                </th>
                <th className="p-4 text-left">Status</th>
                <th className="p-4 text-center">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {filteredStudents.map((s) => (
                <tr key={s.id} className="hover:bg-slate-50">
                  <td className="p-4 font-mono">{s.id}</td>
                  <td className="p-4 font-bold">{s.surname}</td>
                  <td className="p-4">{s.firstName}</td>
                  <td className="p-4">{s.middleName}</td>
                  <td className="p-4">{s.gender}</td>
                  <td className="p-4">
                    <span className="px-2 py-1 bg-blue-100 text-blue-800 rounded text-xs">
                      {s.class}
                    </span>
                  </td>
                  <td className="p-4">
                    <span className="px-2 py-1 bg-green-100 text-green-800 rounded text-xs">
                      {s.status}
                    </span>
                  </td>
                  <td className="p-4 text-center">
                    <div className="flex items-center justify-center space-x-2">
                      <button
                        onClick={() => openEditModal(s)}
                        className="p-1 text-blue-600 hover:bg-blue-50 rounded"
                        aria-label={`Edit ${s.id}`}
                        title="Edit"
                      >
                        <Pencil size={16} />
                      </button>
                      <button
                        onClick={() => initiateDelete(s.id)}
                        className="p-1 text-red-500 hover:bg-red-50 rounded"
                        aria-label={`Delete ${s.id}`}
                        title="Delete"
                      >
                        <Trash2 size={16} />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );

  return (
    <div className="h-[100dvh] bg-slate-100 text-slate-900 font-sans flex flex-col overflow-hidden">
      <div className="w-full shrink-0 bg-slate-900 text-white p-4 shadow-md flex items-center justify-between z-50">
        <div className="flex items-center space-x-3">
          {currentView !== "home" && (
            <button
              onClick={() => setCurrentView("home")}
              className="hover:bg-slate-700 p-2 rounded-full transition-colors"
              aria-label="Back to home"
              title="Back"
            >
              <ArrowLeft size={20} />
            </button>
          )}
          <Menu size={24} className="opacity-80" />
          <div className="flex items-center gap-2">
            <img
              src="/logo.png"
              alt="E-SBA"
              className="object-contain w-10 h-10 sm:w-12 sm:h-12 md:w-14 md:h-14 lg:w-16 lg:h-16 xl:w-20 xl:h-20"
            />
            <h1 className="text-xl font-bold tracking-wide">E-SBA [JHS]</h1>
          </div>
        </div>
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2 text-xs">
            <span
              className={`inline-flex items-center gap-1 px-2 py-1 rounded-full border ${
                isOffline
                  ? "border-amber-400 text-amber-300 bg-amber-500/10"
                  : "border-emerald-400 text-emerald-300 bg-emerald-500/10"
              }`}
              title={
                isOffline ? "Offline mode: changes will sync later" : "Online"
              }
            >
              <span
                className={`w-2 h-2 rounded-full ${
                  isOffline ? "bg-amber-400" : "bg-emerald-400"
                }`}
              />
              <span>{isOffline ? "Offline" : "Online"}</span>
            </span>
            {isSyncing && (
              <span className="inline-flex items-center gap-1 text-slate-300">
                <Loader2 className="w-3 h-3 animate-spin" />
                <span>Syncing…</span>
              </span>
            )}
          </div>
          <div className="text-xs text-slate-400 hidden md:block">
            v2.5.0 | Excel-Mode
          </div>
          <SignOutButton onLogout={logout} />
        </div>
      </div>
      <main className="flex-1 w-full p-4 overflow-y-auto overscroll-y-contain scroll-smooth main-scroll">
        {currentView === "home" && renderHome()}
        {currentView === "register" && (
          <div className="space-y-6 animate-in fade-in duration-500">
            <button
              onClick={() => setCurrentView("home")}
              className="flex items-center gap-2 text-slate-600 hover:text-slate-900 mb-4"
            >
              <ArrowLeft size={20} /> Back to Dashboard
            </button>
            <AttendanceRegister
              className={selectedClass}
              academicYear={academicYear}
              term={term}
            />
          </div>
        )}
        {currentView === "subject" && renderSubjectSheet()}
        {currentView === "report" && (
          <Suspense
            fallback={
              <div className="flex items-center justify-center h-64">
                <Loader2 className="w-8 h-8 animate-spin text-blue-600" />
              </div>
            }
          >
            <ReportCards
              students={students}
              filteredStudents={filteredStudents}
              marks={marks}
              setMarks={setMarks}
              schoolConfig={schoolConfig}
              academicYear={academicYear}
              term={term}
              selectedClass={selectedClass}
              user={user}
              gradingSystem={gradingSystem}
            />
          </Suspense>
        )}
        {currentView === "masterdb" && renderMasterDB()}
        {currentView === "setup" && (
          <Suspense
            fallback={
              <div className="flex items-center justify-center h-64">
                <Loader2 className="w-8 h-8 animate-spin text-blue-600" />
              </div>
            }
          >
            <SystemSetup
              schoolConfig={schoolConfig}
              setSchoolConfig={setSchoolConfig}
              academicYear={academicYear}
              setAcademicYear={setAcademicYear}
              academicYearOptions={academicYearOptions}
              term={term}
              setTerm={setTerm}
              onNavigate={setCurrentView}
            />
          </Suspense>
        )}
        {currentView === "ranking" && (
          <RankingReport
            rankingData={rankingData}
            rankingLoading={rankingLoading}
            rankingError={rankingError}
            rankingClassFilter={rankingClassFilter}
            setRankingClassFilter={setRankingClassFilter}
            rankingPage={rankingPage}
            setRankingPage={setRankingPage}
            onBack={() => setCurrentView("home")}
            onDownload={downloadRankingReport}
          />
        )}
        {renderAssessmentUploadModal()}
      </main>
      <footer
        role="contentinfo"
        className="w-full shrink-0 bg-slate-900 text-slate-300 border-t border-slate-800"
      >
        <div className="max-w-7xl mx-auto px-4">
          <div className="flex flex-col sm:flex-row items-center justify-center h-12 text-xs tracking-wide">
            <span className="font-medium">Mr. Felix Akabati</span>
            <span className="hidden sm:inline mx-3 opacity-50">|</span>
            <a
              href="mailto:felixakabati007@gmail.com"
              className="text-slate-200 hover:text-white underline-offset-2 hover:underline"
              title="Email Mr. Felix Akabati"
            >
              felixakabati007@gmail.com
            </a>
            <span className="hidden sm:inline mx-3 opacity-50">|</span>
            <span className="font-medium">
              © {new Date().getFullYear()} All Rights Reserved
            </span>
          </div>
        </div>
      </footer>
    </div>
  );
}
