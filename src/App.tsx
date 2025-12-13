import React, { useMemo, useEffect, useRef, useState } from "react";
import {
  Calculator,
  Users,
  FileText,
  Save,
  Menu,
  ArrowLeft,
  Search,
  GraduationCap,
  LayoutGrid,
  Database,
  Printer,
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
  Image as ImageIcon,
  RotateCw,
  Eye,
  FileSpreadsheet,
  Download,
  FileIcon,
} from "lucide-react";
import * as XLSX from "xlsx";
import { jsPDF } from "jspdf";
import "jspdf-autotable";
import { logger } from "./lib/logger";
import { apiClient } from "./lib/apiClient";
import type { SubjectSheetRow } from "./lib/apiTypes";
import SignatureUpload from "./components/SignatureUpload";
import {
  saveMarksSession,
  loadMarksSession,
  subscribeAssessments,
} from "./lib/dataPersistence";
import {
  saveUploadedFile,
  saveDownloadedContent,
  list,
  getUsage,
  getData,
  remove,
  cleanup,
} from "./lib/storage";

const MasterDBSyncControls: React.FC = () => null;

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

interface GradeConfig {
  min: number;
  max: number;
  grade: number;
  remark: string;
  desc: string;
}

interface SchoolConfig {
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

const AVAILABLE_CLASSES = ["JHS 1", "JHS 2", "JHS 3"];

type TileProps = {
  title: string;
  icon: React.ElementType;
  color: string;
  onClick: () => void;
  imageSrc?: string;
};

const DashboardTile = React.memo(
  ({ title, icon: Icon, color, onClick, imageSrc }: TileProps) => (
    <button
      onClick={onClick}
      className={`rounded-xl shadow-sm hover:shadow-md transition-all transform hover:-translate-y-1 text-left flex flex-col justify-between h-40 overflow-hidden ${
        imageSrc ? "bg-white border border-slate-200" : `${color} text-white`
      }`}
      aria-label={title}
    >
      {imageSrc ? (
        <img
          src={imageSrc}
          alt={title}
          className="w-full h-full object-cover"
        />
      ) : (
        <>
          <div className="p-6">
            <Icon size={32} className="opacity-80" />
            <span className="font-bold text-lg">{title}</span>
          </div>
        </>
      )}
      <span className="sr-only">{title}</span>
    </button>
  )
);

export default function App() {
  const [currentView, setCurrentView] = useState("home");
  const [activeSubject, setActiveSubject] = useState("");
  const [selectedClass, setSelectedClass] = useState("JHS 2");

  const [academicYear, setAcademicYear] = useState("2025/2026");
  const [term, setTerm] = useState("Term 1");

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

  const [reportId, setReportId] = useState("");

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
        saveMarksSession(
          { subject, class: cls, academicYear: year, term: t },
          rows
        );
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
            next[sid][subject] = {
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
          { status: "success", message: `Loaded ${rows.length} saved marks.` },
        ]);
      } catch (e) {
        logger.error("marks_load_exception", e);
        const cached = loadMarksSession({
          subject,
          class: cls,
          academicYear: year,
          term: t,
        });
        if (cached && Array.isArray(cached.rows) && cached.rows.length) {
          const rows = cached.rows;
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
              next[sid][subject] = {
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
              message: `Loaded ${rows.length} cached marks (offline).`,
            },
          ]);
        } else {
          setImportLogs((prev) => [
            ...prev,
            { status: "error", message: "Error loading saved marks." },
          ]);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [activeSubject, selectedClass, academicYear, term]);

  useEffect(() => {
    const cls = selectedClass;
    const subject = activeSubject;
    const year = academicYear;
    const t = term;
    if (!subject || !cls || !year || !t) return;
    const unsubscribe = subscribeAssessments(
      { subject, class: cls, academicYear: year, term: t },
      (rows: SubjectSheetRow[]) => {
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
            next[sid][subject] = {
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
      }
    );
    return () => unsubscribe();
  }, [activeSubject, selectedClass, academicYear, term]);
  const [isImporting, setIsImporting] = useState(false);
  type ImportedRow = Record<string, unknown>;
  const [importedPreview, setImportedPreview] = useState<ImportedRow[]>([]);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const importFileInputRef = useRef<HTMLInputElement>(null);
  const [logoError, setLogoError] = useState<string | null>(null);
  const [isProcessingLogo, setIsProcessingLogo] = useState(false);

  const [deleteConfirmation, setDeleteConfirmation] = useState({
    isOpen: false,
    studentId: null as string | null,
  });

  const [isWipeModalOpen, setIsWipeModalOpen] = useState(false);
  const [wipeConfirmText, setWipeConfirmText] = useState("");
  const [isWiping, setIsWiping] = useState(false);

  const [isGeneratingDoc, setIsGeneratingDoc] = useState(false);
  const [docStatus, setDocStatus] = useState("");
  const [headSignatureDataUrl, setHeadSignatureDataUrl] = useState<
    string | null
  >(null);

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

  const [marks, setMarks] = useState<Marks>({});

  useEffect(() => {
    setReportId("");
  }, [selectedClass]);

  const filteredStudents = useMemo(
    () =>
      students.filter(
        (s) =>
          s.class === selectedClass &&
          (s.status === "Active" || s.status === "Inactive")
      ),
    [students, selectedClass]
  );

  const academicYearOptions = useMemo(() => {
    const years: string[] = [];
    for (let year = 2025; year <= 2090; year++) {
      years.push(`${year}/${year + 1}`);
    }
    return years;
  }, []);

  const calculateGrade = (score: number) => {
    const found = gradingSystem.find((s) => score >= s.min && score <= s.max);
    return found
      ? { grade: found.grade, remark: found.remark, desc: found.desc }
      : { grade: 9, remark: "Fail", desc: "Fail" };
  };

  const getOrdinal = (n: number) => {
    const s = ["th", "st", "nd", "rd"] as const;
    const v = n % 100;
    return n + (s[(v - 20) % 10] || s[v] || s[0]);
  };

  const clamp = (f: string, n: number) => {
    const v = Number.isFinite(n) ? n : 0;
    if (f === "exam") return Math.max(0, Math.min(100, v));
    if (f === "group" || f === "project") return Math.max(0, Math.min(20, v));
    if (f === "cat1" || f === "cat2" || f === "cat3" || f === "cat4")
      return Math.max(0, Math.min(10, v));
    return Math.max(0, v);
  };

  const updateMark = (studentId: string, field: string, value: string) => {
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
      fileName.endsWith(ext)
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

    (async () => {
      try {
        await saveUploadedFile(
          undefined,
          file,
          ["excel-import", selectedClass || ""],
          undefined
        );
      } catch {
        void 0;
      }
    })();

    const reader = new FileReader();
    reader.onload = async (evt) => {
      try {
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
            const cell = (
              worksheet as unknown as Record<string, XLSX.CellObject>
            )[addr];
            if (!cell) continue;
            const w = cell.w || XLSX.utils.format_cell(cell);
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
            file.name
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
        (a, b) => b.timestamp - a.timestamp
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
        (wb as unknown as Record<string, unknown>)["vbaraw"]
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

  const processImport = () => {
    if (importedPreview.length === 0) return;
    let addedCount = 0;
    let skippedCount = 0;
    const newStudents: Student[] = [];
    const yearSuffix = academicYear.substring(2, 4);
    let currentSeq = students.length + 1;

    importedPreview.forEach((row) => {
      let newId = row["id"] || row["student id"];
      if (!newId) {
        newId = `JHS${yearSuffix}${currentSeq.toString().padStart(3, "0")}`;
        currentSeq++;
      }
      if (
        students.some((s) => s.id === newId) ||
        newStudents.some((s) => s.id === newId)
      ) {
        skippedCount++;
        return;
      }
      let genderVal: Gender = "Male";
      const rawGender = String(row["gender"] || "").toLowerCase();
      if (rawGender.startsWith("f")) genderVal = "Female";
      else if (rawGender.startsWith("m")) genderVal = "Male";
      else if (rawGender) genderVal = "Other";

      const student: Student = {
        id: String(newId),
        surname: String(
          row["surname"] || row["lastname"] || row["last name"] || ""
        ).toUpperCase(),
        firstName: String(row["firstname"] || row["first name"] || ""),
        middleName: String(
          row["middlename"] || row["middle name"] || row["othernames"] || ""
        ),
        gender: genderVal,
        class: String(row["class"] || selectedClass),
        status: "Active",
        dob: String(row["dob"] || row["date of birth"] || ""),
        guardianContact: String(
          row["contact"] || row["guardian contact"] || row["phone"] || ""
        ),
      };

      if (student.surname && student.firstName) {
        newStudents.push(student);
        addedCount++;
      } else {
        skippedCount++;
      }
    });

    if (newStudents.length > 0) {
      setStudents((prev) => [...prev, ...newStudents]);
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
      setImportedPreview([]);
    } else {
      setImportLogs((prev) => [
        ...prev,
        {
          status: "warning",
          message: "No valid students found to import. Check required columns.",
        },
      ]);
    }
  };

  const exportDBToExcel = () => {
    setIsGeneratingDoc(true);
    setDocStatus("Preparing Excel file...");
    setTimeout(() => {
      try {
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
          }))
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
          }.xlsx`
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
        (doc as jsPDF & { autoTable: (opts: unknown) => void }).autoTable({
          head: [tableColumn],
          body: tableRows,
          startY: 35,
          styles: { fontSize: 8 },
          headStyles: { fillColor: [41, 128, 185] },
        });
        doc.save(`MasterDB_${selectedClass}.pdf`);
      } catch (e) {
        logger.error("PDF export error", e);
      }
      setIsGeneratingDoc(false);
    }, 500);
  };

  // Subject PDF export removed in favor of structured template downloads

  const generateReportCardPDF = (studentId: string | null = null) => {
    setIsGeneratingDoc(true);
    const targetStudents = studentId
      ? students.filter((s) => s.id === studentId)
      : filteredStudents;
    const modeText = studentId
      ? "Report Card"
      : `Batch (${targetStudents.length})`;
    setDocStatus(`Generating ${modeText}...`);
    setTimeout(() => {
      try {
        const doc = new jsPDF();
        targetStudents.forEach((student, index) => {
          if (index > 0) doc.addPage();
          if (schoolConfig.logoUrl) {
            doc.addImage(schoolConfig.logoUrl, "PNG", 15, 10, 25, 25);
          } else {
            doc.setDrawColor(200);
            doc.rect(15, 10, 25, 25);
            doc.setFontSize(8);
            doc.text("Logo", 22, 25);
          }
          doc.setFontSize(18);
          doc.setFont("helvetica", "bold");
          doc.text(schoolConfig.name.toUpperCase(), 105, 20, {
            align: "center",
          });
          doc.setFontSize(10);
          doc.setFont("helvetica", "normal");
          doc.text(schoolConfig.address, 105, 26, { align: "center" });
          doc.setFont("helvetica", "italic");
          doc.text(`"${schoolConfig.motto}"`, 105, 32, { align: "center" });
          doc.setDrawColor(0);
          doc.setLineWidth(0.5);
          doc.line(10, 40, 200, 40);
          doc.setFontSize(12);
          doc.setFont("helvetica", "bold");
          doc.text("TERMINAL REPORT", 105, 48, { align: "center" });
          doc.setFontSize(10);
          doc.setFont("helvetica", "normal");
          const startY = 55;
          const leftX = 15;
          const rightX = 110;
          const lineHeight = 7;
          doc.text(
            `Name: ${student.surname}, ${student.firstName} ${student.middleName}`,
            leftX,
            startY
          );
          doc.text(`ID: ${student.id}`, rightX, startY);
          doc.text(`Class: ${student.class}`, leftX, startY + lineHeight);
          doc.text(
            `Term: ${term}, ${academicYear}`,
            rightX,
            startY + lineHeight
          );
          doc.text(
            `No. on Roll: ${filteredStudents.length}`,
            leftX,
            startY + lineHeight * 2
          );
          const subjectRanks: Record<string, string> = {};
          SUBJECTS.forEach((subj) => {
            const allScores = filteredStudents
              .map((s) => {
                const m = marks[s.id]?.[subj] || {
                  cat1: 0,
                  cat2: 0,
                  cat3: 0,
                  cat4: 0,
                  group: 0,
                  project: 0,
                  exam: 0,
                };
                const rawSBA =
                  m.cat1 + m.cat2 + m.cat3 + m.cat4 + m.group + m.project;
                const total =
                  (rawSBA / 80) * schoolConfig.catWeight +
                  (m.exam / 100) * schoolConfig.examWeight;
                return { id: s.id, score: total };
              })
              .sort((a, b) => b.score - a.score);
            const rank = allScores.findIndex((x) => x.id === student.id);
            subjectRanks[subj] = rank !== -1 ? getOrdinal(rank + 1) : "-";
          });
          const tableData = SUBJECTS.map((subj) => {
            const m = marks[student.id]?.[subj] || {
              cat1: 0,
              cat2: 0,
              cat3: 0,
              cat4: 0,
              group: 0,
              project: 0,
              exam: 0,
            };
            const rawSBA =
              m.cat1 + m.cat2 + m.cat3 + m.cat4 + m.group + m.project;
            const scaledSBA = (rawSBA / 80) * schoolConfig.catWeight;
            const scaledExam = (m.exam / 100) * schoolConfig.examWeight;
            const final = Math.round(scaledSBA + scaledExam);
            const g = calculateGrade(final);
            return [
              subj,
              scaledSBA.toFixed(1),
              scaledExam.toFixed(1),
              final,
              g.grade,
              subjectRanks[subj],
              g.desc,
            ];
          });
          const PAGE_MARGIN = 10;
          (doc as jsPDF & { autoTable: (opts: unknown) => void }).autoTable({
            head: [
              [
                "Subject",
                `Class (${schoolConfig.catWeight}%)`,
                `Exam (${schoolConfig.examWeight}%)`,
                "Total",
                "Grade",
                "Pos",
                "Remark",
              ],
            ],
            body: tableData,
            startY: startY + 25,
            theme: "grid",
            margin: { left: PAGE_MARGIN, right: PAGE_MARGIN },
            headStyles: { fillColor: [41, 128, 185] },
            styles: { fontSize: 10, valign: "middle", halign: "center" },
            columnStyles: { 0: { halign: "left" }, 6: { halign: "left" } },
          });
          let y =
            (doc as jsPDF & { lastAutoTable: { finalY: number } }).lastAutoTable
              .finalY + 10;
          doc.setFontSize(8);
          doc.setFont("helvetica", "bold");
          doc.text("GRADING OVERVIEW", 15, y);
          const gradeRows = gradingSystem.map((band) => [
            String(band.grade),
            `${band.min}–${band.max}`,
            band.desc,
          ]);
          (doc as jsPDF & { autoTable: (opts: unknown) => void }).autoTable({
            head: [["Grade", "Range", "Description"]],
            body: gradeRows,
            startY: y + 4,
            theme: "grid",
            margin: { left: PAGE_MARGIN, right: PAGE_MARGIN },
            headStyles: {
              fontSize: 6,
              fillColor: [230, 230, 230],
              textColor: 60,
            },
            styles: {
              fontSize: 6,
              valign: "middle",
              halign: "center",
              cellPadding: 0.5,
              lineWidth: 0.1,
            },
            tableWidth: "wrap",
            columnStyles: {
              0: { cellWidth: 15 },
              1: { cellWidth: 30 },
              2: { halign: "left", cellWidth: 70 },
            },
          });
          y =
            (doc as jsPDF & { lastAutoTable: { finalY: number } }).lastAutoTable
              .finalY + 10;
          doc.setFontSize(10);
          doc.setFont("helvetica", "bold");
          doc.text("Attendance:", 15, y);
          doc.setFont("helvetica", "normal");
          doc.text(` ${"_".repeat(25)} out of ${"_".repeat(25)}`, 45, y);
          y += 10;
          doc.setFont("helvetica", "bold");
          doc.text("Talent and Interest:", 15, y);
          doc.setFont("helvetica", "normal");
          const talentText =
            talentRemark === "Other" && talentRemarkOther
              ? talentRemarkOther
              : talentRemark || "";
          if (talentText) {
            doc.text(talentText, 15, y + 6);
            y += 14;
          } else {
            doc.line(15, y + 6, 200, y + 6);
            y += 14;
          }
          doc.setFont("helvetica", "bold");
          doc.text("Class Teacher's Remarks:", 15, y);
          doc.setFont("helvetica", "normal");
          const teacherText =
            teacherRemark === "Other" && teacherRemarkOther
              ? teacherRemarkOther
              : teacherRemark || "";
          if (teacherText) {
            doc.text(teacherText, 15, y + 6);
            y += 14;
          } else {
            doc.line(15, y + 6, 200, y + 6);
            y += 14;
          }
          doc.setFont("helvetica", "bold");
          doc.text("Headmaster's Remarks:", 15, y);
          doc.setFont("helvetica", "normal");
          doc.line(15, y + 6, 200, y + 6);
          y += 22;
          doc.setLineWidth(0.2);
          doc.line(20, y, 80, y);
          doc.text("Class Teacher's Signature", 25, y + 5);
          doc.line(130, y, 190, y);
          doc.text("Head Teacher's Signature", 135, y + 5);
          doc.setFontSize(8);
          doc.setTextColor(120);
          doc.text("Generated by E-SBA [JHS]", 25, y + 18);
          doc.setTextColor(0);
          if (schoolConfig.signatureEnabled && headSignatureDataUrl) {
            const fmt: "JPEG" | "PNG" = headSignatureDataUrl.startsWith(
              "data:image/jpeg"
            )
              ? "JPEG"
              : "PNG";
            doc.addImage(headSignatureDataUrl, fmt, 130, y - 20, 60, 20);
          }
        });
        const filename = studentId
          ? `Report_${studentId}.pdf`
          : `Batch_Reports_${selectedClass}_${academicYear.replace(
              "/",
              "-"
            )}.pdf`;
        doc.save(filename);
      } catch (e) {
        logger.error("Report PDF error", e);
      }
      setIsGeneratingDoc(false);
    }, 100);
  };

  const handleLogoUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setLogoError(null);
    setIsProcessingLogo(true);
    const validTypes = ["image/jpeg", "image/png", "image/svg+xml"];
    if (!validTypes.includes(file.type)) {
      setLogoError("Invalid file type.");
      setIsProcessingLogo(false);
      return;
    }
    if (file.size > 2 * 1024 * 1024) {
      setLogoError("File too large.");
      setIsProcessingLogo(false);
      return;
    }
    const reader = new FileReader();
    reader.onload = (event) => {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement("canvas");
        const ctx = canvas.getContext("2d");
        const maxDim = 300;
        let width = img.width;
        let height = img.height;
        if (width > height) {
          if (width > maxDim) {
            height *= maxDim / width;
            width = maxDim;
          }
        } else {
          if (height > maxDim) {
            width *= maxDim / height;
            height = maxDim;
          }
        }
        canvas.width = width;
        canvas.height = height;
        ctx?.drawImage(img, 0, 0, width, height);
        setSchoolConfig((prev) => ({
          ...prev,
          logoUrl: canvas.toDataURL(file.type),
        }));
        setIsProcessingLogo(false);
      };
      img.src = event.target?.result as string;
    };
    reader.readAsDataURL(file);
  };

  const rotateLogo = () => {
    if (!schoolConfig.logoUrl) return;
    setIsProcessingLogo(true);
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement("canvas");
      const ctx = canvas.getContext("2d");
      canvas.width = img.height;
      canvas.height = img.width;
      if (ctx) {
        ctx.translate(canvas.width / 2, canvas.height / 2);
        ctx.rotate((90 * Math.PI) / 180);
        ctx.drawImage(img, -img.width / 2, -img.height / 2);
      }
      setSchoolConfig((prev) => ({ ...prev, logoUrl: canvas.toDataURL() }));
      setIsProcessingLogo(false);
    };
    img.src = schoolConfig.logoUrl;
  };

  // Signature removal handled by SignatureUpload component via onChange(null)

  const removeLogo = () => {
    setSchoolConfig((prev) => ({ ...prev, logoUrl: null }));
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  useEffect(() => {
    (async () => {
      try {
        if (schoolConfig.headSignatureUrl) {
          const url = schoolConfig.headSignatureUrl;
          if (url.startsWith("data:image/")) {
            if (url.startsWith("data:image/svg+xml")) {
              const img = new Image();
              img.onload = () => {
                const canvas = document.createElement("canvas");
                const ctx = canvas.getContext("2d");
                const maxW = 600;
                const ratio = img.width > 0 ? Math.min(1, maxW / img.width) : 1;
                const w = Math.round((img.width || maxW) * ratio);
                const h = Math.round((img.height || maxW / 3) * ratio);
                canvas.width = w;
                canvas.height = h;
                ctx?.drawImage(img, 0, 0, w, h);
                setHeadSignatureDataUrl(canvas.toDataURL("image/png"));
              };
              img.src = url;
            } else {
              setHeadSignatureDataUrl(url);
            }
          } else {
            const resp = await fetch(url);
            const blob = await resp.blob();
            const reader = new FileReader();
            reader.onload = () => {
              const data = reader.result as string;
              if (data && data.startsWith("data:image/svg+xml")) {
                const img = new Image();
                img.onload = () => {
                  const canvas = document.createElement("canvas");
                  const ctx = canvas.getContext("2d");
                  const maxW = 600;
                  const ratio =
                    img.width > 0 ? Math.min(1, maxW / img.width) : 1;
                  const w = Math.round((img.width || maxW) * ratio);
                  const h = Math.round((img.height || maxW / 3) * ratio);
                  canvas.width = w;
                  canvas.height = h;
                  ctx?.drawImage(img, 0, 0, w, h);
                  setHeadSignatureDataUrl(canvas.toDataURL("image/png"));
                };
                img.src = data;
              } else {
                setHeadSignatureDataUrl(data);
              }
            };
            reader.readAsDataURL(blob);
          }
        } else {
          setHeadSignatureDataUrl(null);
        }
      } catch {
        setHeadSignatureDataUrl(null);
      }
    })();
  }, [schoolConfig.headSignatureUrl]);

  const handleInputChange = (
    e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>
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

  const handleSaveStudent = () => {
    if (!validateForm()) return;
    setIsSubmitting(true);
    setTimeout(() => {
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
      if (editingStudent) {
        setStudents((prev) =>
          prev.map((s) => (s.id === editingStudent.id ? studentData : s))
        );
        if (editingStudent.id !== formData.id) {
          setMarks((prev) => {
            const newMarks: Marks = { ...prev };
            if (newMarks[editingStudent.id]) {
              newMarks[formData.id] = newMarks[editingStudent.id];
              delete newMarks[editingStudent.id];
            }
            return newMarks;
          });
        }
      } else {
        setStudents((prev) => [...prev, studentData]);
      }
      setIsSubmitting(false);
      setShowSuccess(true);
      setTimeout(() => closeModal(), 1500);
    }, 600);
  };

  const initiateDelete = (studentId: string) =>
    setDeleteConfirmation({ isOpen: true, studentId });
  const confirmDelete = () => {
    const idToDelete = deleteConfirmation.studentId;
    if (!idToDelete) return;
    setStudents((prev) => prev.filter((s) => s.id !== idToDelete));
    setMarks((prev) => {
      const newMarks: Marks = { ...prev };
      delete newMarks[idToDelete];
      return newMarks;
    });
    setDeleteConfirmation({ isOpen: false, studentId: null });
  };
  const cancelDelete = () =>
    setDeleteConfirmation({ isOpen: false, studentId: null });

  const openWipeModal = () => {
    setWipeConfirmText("");
    setIsWipeModalOpen(true);
  };
  const closeWipeModal = () => {
    setIsWipeModalOpen(false);
  };
  const performWipe = async () => {
    if (wipeConfirmText.trim().toUpperCase() !== "CLEAR") return;
    setIsWiping(true);
    try {
      try {
        const resp = await fetch("/api/admin/clean-master-db?confirm=yes", {
          method: "POST",
        });
        if (resp.ok) {
          const data = await resp.json();
          void data;
        }
      } catch {
        void 0;
      }
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

  const renderHome = () => (
    <div className="space-y-6 animate-in fade-in duration-500">
      <div className="bg-white p-6 rounded-lg shadow-sm border border-slate-200">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-2xl font-bold text-slate-800">Welcome, Admin</h2>
          <div className="welcome-loader">
            <div className="bar">
              <div className="ball" />
            </div>
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
              className="p-2 border border-slate-300 rounded-md bg-slate-50 w-40"
              aria-label="Global Class Filter"
            >
              <option>JHS 1</option>
              <option>JHS 2</option>
              <option>JHS 3</option>
            </select>
          </div>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          <div className="md:col-span-3">
            <h3 className="text-lg font-semibold text-slate-700 mb-4">
              Core Subjects
            </h3>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              {SUBJECTS.slice(0, 4).map((subj) => (
                <DashboardTile
                  key={subj}
                  title={subj}
                  icon={Calculator}
                  color="bg-blue-600"
                  imageSrc={
                    subj === "Mathematics"
                      ? "https://encrypted-tbn0.gstatic.com/images?q=tbn:ANd9GcTtBNVtepKT2YtCg7GODExQYE-kE7UBGS-1lA&s"
                      : subj === "English Language"
                      ? "https://edusoftlearning.com/wp-content/uploads/2018/10/Edusoft-the-English-Language-Learning-Experts-1080x540.jpg"
                      : subj === "Integrated Science"
                      ? "https://www.nesdis.noaa.gov/s3/2025-09/science.png"
                      : subj === "Social Studies"
                      ? "https://lh3.googleusercontent.com/proxy/VXEzlU5A1sqCgvGXJrZdQY0Qcv54HUOqCh8gkQEdSN2STzCqsnkZm1KOYGG9F4kadmva6VY9uKaMjQwfLMCZsVyHsV11tK_qA1eqD1XnjYSMeVNXkQ"
                      : undefined
                  }
                  onClick={() => {
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
              {SUBJECTS.slice(4).map((subj) => (
                <DashboardTile
                  key={subj}
                  title={subj}
                  icon={LayoutGrid}
                  color="bg-emerald-600"
                  imageSrc={
                    subj === "Computing"
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
                    setActiveSubject(subj);
                    setCurrentView("subject");
                  }}
                />
              ))}
            </div>
          </div>
          <div className="md:col-span-3">
            <h3 className="text-lg font-semibold text-slate-700 mb-4">
              Administration
            </h3>
            <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
              <DashboardTile
                title="Master Database"
                icon={Database}
                color="bg-slate-600"
                onClick={() => setCurrentView("masterdb")}
              />
              <DashboardTile
                title="Report Cards"
                icon={FileText}
                color="bg-slate-600"
                onClick={() => setCurrentView("report")}
              />
              <DashboardTile
                title="System Setup"
                icon={Settings}
                color="bg-slate-600"
                onClick={() => setCurrentView("setup")}
              />
            </div>
          </div>
        </div>
      </div>
    </div>
  );

  const renderSubjectSheet = () => (
    <div className="bg-white rounded-lg shadow-lg border border-slate-200 overflow-hidden flex flex-col h-[calc(100vh-100px)]">
      <div className="p-4 bg-blue-50 border-b border-blue-100 flex justify-between items-center">
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
            onClick={() => setIsAssessmentUploadOpen(true)}
            className="flex items-center gap-2 px-3 py-2 bg-white border border-blue-200 text-blue-700 hover:bg-blue-50 rounded-lg text-sm font-medium transition-colors w-full sm:w-auto justify-center"
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
          <span className="px-3 py-1 bg-yellow-100 text-yellow-800 rounded-full text-xs font-semibold w-full sm:w-auto text-center sm:text-left mt-1 sm:mt-0">
            Auto-Save Active
          </span>
        </div>
      </div>
      <div className="overflow-auto flex-1">
        {isGeneratingTemplate && (
          <div
            role="status"
            aria-live="polite"
            className="px-4 py-2 text-xs text-blue-700"
          >
            {templateStatus}
          </div>
        )}
        <table className="w-full text-sm text-left">
          <thead className="text-xs text-slate-700 uppercase bg-slate-100 sticky top-0 z-10 shadow-sm">
            <tr>
              <th className="px-4 py-3 w-16">ID</th>
              <th className="px-4 py-3 w-48">Name</th>
              <th className="px-2 py-3 text-center bg-blue-50">T1</th>
              <th className="px-2 py-3 text-center bg-blue-50">T2</th>
              <th className="px-2 py-3 text-center bg-blue-50">T3</th>
              <th className="px-2 py-3 text-center bg-blue-50">T4</th>
              <th className="px-2 py-3 text-center bg-purple-50">Grp</th>
              <th className="px-2 py-3 text-center bg-purple-50">Proj</th>
              <th className="px-2 py-3 text-center font-bold">Tot</th>
              <th className="px-2 py-3 text-center font-bold bg-green-50">
                SBA
              </th>
              <th className="px-2 py-3 text-center bg-red-50">Exam</th>
              <th className="px-2 py-3 text-center font-bold bg-green-50">
                50%
              </th>
              <th className="px-4 py-3 text-center font-black">Fin</th>
              <th className="px-4 py-3 text-center">Grd</th>
              <th className="px-4 py-3 text-center">Rem</th>
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
              const rawSBA =
                m.cat1 + m.cat2 + m.cat3 + m.cat4 + m.group + m.project;
              const scaledSBA = (rawSBA / 80) * schoolConfig.catWeight;
              const scaledExam = (m.exam / 100) * schoolConfig.examWeight;
              const final = Math.round(scaledSBA + scaledExam);
              const g = calculateGrade(final);
              return (
                <tr key={student.id} className="hover:bg-slate-50">
                  <td className="px-4 py-3 font-mono text-xs">{student.id}</td>
                  <td className="px-4 py-3 font-medium">
                    {student.surname}, {student.firstName}
                  </td>
                  {["cat1", "cat2", "cat3", "cat4"].map((f) => (
                    <td key={f} className="p-1">
                      <input
                        type="number"
                        className="w-full text-center border rounded p-1"
                        value={m[f as keyof typeof m]}
                        onChange={(e) =>
                          updateMark(student.id, f, e.target.value)
                        }
                        aria-label={`Enter ${f.toUpperCase()} score for ${
                          student.surname
                        }`}
                      />
                    </td>
                  ))}
                  <td className="p-1">
                    <input
                      type="number"
                      className="w-full text-center border rounded p-1 bg-purple-50"
                      value={m.group}
                      onChange={(e) =>
                        updateMark(student.id, "group", e.target.value)
                      }
                      aria-label={`Enter GROUP score for ${student.surname}`}
                    />
                  </td>
                  <td className="p-1">
                    <input
                      type="number"
                      className="w-full text-center border rounded p-1 bg-purple-50"
                      value={m.project}
                      onChange={(e) =>
                        updateMark(student.id, "project", e.target.value)
                      }
                      aria-label={`Enter PROJECT score for ${student.surname}`}
                    />
                  </td>
                  <td className="px-2 text-center text-slate-500">{rawSBA}</td>
                  <td className="px-2 text-center font-bold text-green-700">
                    {scaledSBA.toFixed(1)}
                  </td>
                  <td className="p-1">
                    <input
                      type="number"
                      className="w-full text-center border rounded p-1 bg-red-50"
                      value={m.exam}
                      onChange={(e) =>
                        updateMark(student.id, "exam", e.target.value)
                      }
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
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );

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
  const [talentRemark, setTalentRemark] = useState("");
  const [talentRemarkOther, setTalentRemarkOther] = useState("");
  const [talentRemarkError, setTalentRemarkError] = useState<string | null>(
    null
  );
  const [talentRemarkOptionsGrouped, setTalentRemarkOptionsGrouped] = useState<
    Array<{ group: string; options: string[] }>
  >([]);
  const [teacherRemarkOptions] = useState<string[]>([
    "Excellent attitude",
    "Consistent effort",
    "Improving steadily",
    "Cooperative",
    "Participative",
    "Needs improvement",
    "Irregular homework",
    "Late submissions",
    "Punctual",
    "Organized",
    "Other",
  ]);
  const [teacherRemark, setTeacherRemark] = useState("");
  const [teacherRemarkOther, setTeacherRemarkOther] = useState("");
  const [teacherRemarkError, setTeacherRemarkError] = useState<string | null>(
    null
  );

  useEffect(() => {
    (async () => {
      try {
        const data = await apiClient.getTalentRemarks();
        const groups = Array.isArray(data.groups) ? data.groups : [];
        if (groups.length > 0) {
          setTalentRemarkOptionsGrouped(groups);
          return;
        }
      } catch (e) {
        logger.warn("talent_remarks_fetch_failed", e);
      }
      logger.info("talent_remarks_fallback_default");
      setTalentRemarkOptionsGrouped([
        {
          group: "Positive",
          options: [
            "Shows exceptional talent in subject activities",
            "Consistently demonstrates creativity",
            "Strong leadership in group tasks",
            "Excellent problem-solving skills",
          ],
        },
        {
          group: "Improvement",
          options: [
            "Could benefit from additional practice",
            "Needs support to build confidence",
            "Should focus more during class activities",
            "Improve time management in assignments",
          ],
        },
        { group: "Other", options: ["Other"] },
      ]);
    })();
  }, []);

  const _generateAttendanceReportPDF = (studentId: string) => {
    const s = students.find((x) => x.id === studentId);
    if (!s) return;
    const doc = new jsPDF({ unit: "pt", format: "a4" });
    const pageW = doc.internal.pageSize.getWidth();
    const margin = 72;
    let y = margin;
    doc.setFont("times", "bold");
    doc.setFontSize(16);
    doc.text(schoolConfig.name || "", pageW / 2, y, { align: "center" });
    y += 20;
    doc.setFontSize(12);
    doc.setFont("times", "normal");
    doc.text(schoolConfig.address || "", pageW / 2, y, { align: "center" });
    y += 40;
    doc.setFont("times", "bold");
    doc.setFontSize(16);
    doc.text("Student Attendance Report", pageW / 2, y, { align: "center" });
    y += 28;
    doc.setFontSize(12);
    doc.setFont("times", "normal");
    doc.text(
      `Student: ${s.surname}, ${s.firstName} ${s.middleName}`,
      margin,
      y
    );
    y += 18;
    doc.text(
      `Class: ${s.class}    Term: ${term}    Year: ${academicYear}`,
      margin,
      y
    );
    y += 28;
    const lineA = "_".repeat(25);
    const lineB = "_".repeat(25);
    doc.setFont("times", "bold");
    doc.text(`Attendance: ${lineA} out of ${lineB}`, margin, y);
    y += 30;
    doc.setDrawColor(60);
    doc.line(margin, y, pageW - margin, y);
    y += 24;
    doc.setFontSize(14);
    doc.text("Talent and Interest:", margin, y);
    y += 22;
    doc.setFontSize(12);
    const talents = [
      "Sports",
      "Arts",
      "Music",
      "Academics",
      "Leadership",
      "Technology",
      "Public Speaking",
      "Community Service",
    ];
    const box = 10;
    let x = margin;
    talents.forEach((t, i) => {
      doc.rect(x, y - box + 2, box, box);
      doc.text(t, x + box + 8, y + 2);
      if ((i + 1) % 2 === 0) {
        x = margin;
        y += 24;
      } else {
        x = pageW / 2;
      }
    });
    y += 28;
    doc.text("Other:", margin, y);
    doc.text("_".repeat(20), margin + 50, y);
    y += 32;
    doc.setFontSize(14);
    doc.text("Class Teacher's Remarks:", margin, y);
    y += 22;
    doc.setFontSize(12);
    const teacherOpts = [
      "Calm",
      "Respectful",
      "Diligent",
      "Cooperative",
      "Needs Improvement",
      "Participative",
      "Punctual",
      "Organized",
    ];
    x = margin;
    teacherOpts.forEach((t, i) => {
      doc.rect(x, y - box + 2, box, box);
      doc.text(t, x + box + 8, y + 2);
      if ((i + 1) % 2 === 0) {
        x = margin;
        y += 24;
      } else {
        x = pageW / 2;
      }
    });
    y += 30;
    doc.rect(margin, y, pageW - margin * 2, 90);
    y += 110;
    doc.setFontSize(14);
    doc.text("Headmaster's Remarks:", margin, y);
    y += 22;
    doc.setFontSize(12);
    const headOpts = [
      "Must backup",
      "Has Improved",
      "Can do better",
      "Exemplary",
      "Needs Monitoring",
      "Shows Potential",
      "Consistent Performer",
    ];
    x = margin;
    headOpts.forEach((t, i) => {
      doc.rect(x, y - box + 2, box, box);
      doc.text(t, x + box + 8, y + 2);
      if ((i + 1) % 2 === 0) {
        x = margin;
        y += 24;
      } else {
        x = pageW / 2;
      }
    });
    y += 30;
    doc.text("Signature:", margin, y);
    doc.line(margin + 70, y, margin + 250, y);
    doc.text("Date:", pageW - margin - 180, y);
    doc.line(pageW - margin - 130, y, pageW - margin - 20, y);
    doc.save(`Attendance_Report_${s.id}.pdf`);
  };
  const [isGeneratingTemplate, setIsGeneratingTemplate] = useState(false);
  const [templateStatus, setTemplateStatus] = useState("");
  const downloadSubjectTemplate = () => {
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
      const ws = XLSX.utils.aoa_to_sheet(data);
      const wb = XLSX.utils.book_new();
      const sheetName = `${activeSubject || "Subject"} Template`;
      XLSX.utils.book_append_sheet(wb, ws, sheetName);
      const safe = (v: string) => v.replace(/[^A-Za-z0-9_-]+/g, "_");
      const filename = `Assessment_Template_${safe(
        activeSubject || "Subject"
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
                    undefined
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
                reader.onload = () => {
                  try {
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
              Drag & Drop .xlsx here or use file picker
            </div>
            <input
              type="file"
              accept=".xlsx,.xls,.csv,.pdf,.docx"
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
                if (
                  !ext ||
                  !["xlsx", "xls", "csv", "pdf", "docx"].includes(ext)
                ) {
                  setAssessmentErrors(["Invalid file type."]);
                  return;
                }
                const reader = new FileReader();
                reader.onload = () => {
                  try {
                    if (["xlsx", "xls", "csv"].includes(ext)) {
                      const data = new Uint8Array(reader.result as ArrayBuffer);
                      const wb = XLSX.read(data, { type: "array" });
                      const ws = wb.Sheets[wb.SheetNames[0]];
                      const json = XLSX.utils.sheet_to_json(ws) as Record<
                        string,
                        string | number | null
                      >[];
                      const keys = json[0]
                        ? Object.keys(json[0]).map((k) =>
                            k.toLowerCase().trim()
                          )
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
                        "This file will be stored as an attachment. To apply marks, upload an XLSX or CSV template.",
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
                                ] ?? ""
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
                    assessmentProgress
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
                try {
                  const resp = await apiClient.uploadAssessments(
                    assessmentFile,
                    {
                      subject: activeSubject,
                      academicYear,
                      term,
                    }
                  );
                  setAssessmentProgress(70);
                  const json: unknown = resp as unknown;
                  if (!json) {
                    try {
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
                      setMarks((prev) => {
                        const nm: Marks = { ...prev };
                        for (const r of arr) {
                          const lower: Record<string, unknown> = {};
                          Object.keys(r).forEach((k) => {
                            lower[k.toLowerCase().trim()] = (
                              r as Record<string, unknown>
                            )[k];
                          });
                          const sid = String(
                            lower["student_id"] || lower["id"] || ""
                          ).trim();
                          if (!sid) continue;
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
                      setAssessmentProgress(100);
                      setIsAssessmentUploadOpen(false);
                      return;
                    } catch {
                      throw new Error("Upload failed");
                    }
                  }
                  if (
                    json &&
                    Array.isArray((json as Record<string, unknown>).errors) &&
                    ((json as Record<string, unknown>).errors as unknown[])
                      .length
                  ) {
                    setAssessmentErrors(
                      ((json as Record<string, unknown>).errors as string[]) ||
                        []
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
                          undefined
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
                  const msg = err instanceof Error ? err.message : String(err);
                  setAssessmentErrors([msg || "Upload failed"]);
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

  const renderReportCard = () => {
    const effectiveReportId = reportId || filteredStudents[0]?.id || "";
    const student = students.find((s) => s.id === effectiveReportId);
    const subjectRanks: Record<string, string> = {};
    SUBJECTS.forEach((subj) => {
      const allMarks = filteredStudents
        .map((s) => {
          const m = marks[s.id]?.[subj];
          if (!m) return { id: s.id, score: 0 };
          const rawSBA =
            ((m.cat1 + m.cat2 + m.cat3 + m.cat4 + m.group + m.project) / 80) *
            schoolConfig.catWeight;
          const rawExam = (m.exam / 100) * schoolConfig.examWeight;
          return { id: s.id, score: Math.round(rawSBA + rawExam) };
        })
        .sort((a, b) => b.score - a.score);
      const rankIndex = allMarks.findIndex((x) => x.id === effectiveReportId);
      subjectRanks[subj] = rankIndex !== -1 ? getOrdinal(rankIndex + 1) : "-";
    });
    if (!student)
      return (
        <div className="p-8 text-center">No Active Students to Report</div>
      );
    return (
      <div className="max-w-4xl mx-auto space-y-6">
        <div className="bg-white p-4 rounded-lg shadow-sm border border-slate-200 flex items-center space-x-4">
          <Search className="text-slate-400" />
          <select
            className="flex-1 p-2 bg-transparent outline-none"
            value={effectiveReportId}
            onChange={(e) => setReportId(e.target.value)}
            aria-label="Select student for report"
          >
            {filteredStudents.map((s) => (
              <option key={s.id} value={s.id}>
                {s.id} - {s.surname}, {s.firstName}
              </option>
            ))}
          </select>
          <button
            onClick={() => generateReportCardPDF(student.id)}
            disabled={isGeneratingDoc}
            className="flex items-center space-x-2 bg-white border border-blue-200 text-blue-700 px-4 py-2 rounded hover:bg-blue-50"
          >
            {isGeneratingDoc ? (
              <Loader2 size={16} className="animate-spin" />
            ) : (
              <Printer size={16} />
            )}
            <span>Print Single</span>
          </button>
          <button
            onClick={() => generateReportCardPDF(null)}
            disabled={isGeneratingDoc}
            className="flex items-center space-x-2 bg-blue-600 text-white px-4 py-2 rounded hover:bg-blue-700"
          >
            {isGeneratingDoc ? (
              <Loader2 size={16} className="animate-spin" />
            ) : (
              <Database size={16} />
            )}
            <span>Batch Print ({filteredStudents.length})</span>
          </button>
        </div>
        <div className="bg-white p-8 shadow-lg border border-slate-200 min-h-[800px]">
          <div className="text-center border-b-2 border-slate-800 pb-4 mb-6 relative">
            <div className="flex justify-center mb-2">
              {schoolConfig.logoUrl ? (
                <img
                  src={schoolConfig.logoUrl}
                  alt="School Logo"
                  className="h-24 w-24 object-contain"
                />
              ) : (
                <GraduationCap size={48} className="text-blue-900" />
              )}
            </div>
            <h1 className="text-2xl font-black text-slate-900 uppercase tracking-widest">
              {schoolConfig.name}
            </h1>
            <p className="text-sm font-semibold text-slate-600">
              MOTTO: {schoolConfig.motto}
            </p>
            <div className="mt-4 bg-slate-800 text-white py-1 px-4 inline-block rounded-full text-sm font-bold">
              STUDENT PERFORMANCE REPORT
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4 text-sm mb-6 border border-slate-300 p-4 rounded bg-slate-50">
            <div>
              <span className="font-bold text-slate-500">Name:</span>{" "}
              {student.surname}, {student.firstName} {student.middleName}
            </div>
            <div>
              <span className="font-bold text-slate-500">ID:</span> {student.id}
            </div>
            <div>
              <span className="font-bold text-slate-500">Class:</span>{" "}
              {student.class}
            </div>
            <div>
              <span className="font-bold text-slate-500">Term:</span> {term},{" "}
              {academicYear}
            </div>
            <div>
              <span className="font-bold text-slate-500">DOB:</span>{" "}
              {student.dob}
            </div>
            <div>
              <span className="font-bold text-slate-500">Contact:</span>{" "}
              {student.guardianContact}
            </div>
          </div>
          <table className="w-full text-sm border-collapse border border-slate-300">
            <thead>
              <tr className="bg-slate-100 text-slate-800">
                <th className="border border-slate-300 p-2 text-left">
                  Subject
                </th>
                <th className="border border-slate-300 p-2 text-center">
                  Class ({schoolConfig.catWeight}%)
                </th>
                <th className="border border-slate-300 p-2 text-center">
                  Exam ({schoolConfig.examWeight}%)
                </th>
                <th className="border border-slate-300 p-2 text-center">
                  Total
                </th>
                <th className="border border-slate-300 p-2 text-center">
                  Grade
                </th>
                <th className="border border-slate-300 p-2 text-center">
                  Pos.
                </th>
                <th className="border border-slate-300 p-2 text-left">
                  Remark
                </th>
              </tr>
            </thead>
            <tbody>
              {SUBJECTS.map((subj) => {
                const m = marks[student.id]?.[subj];
                if (!m)
                  return (
                    <tr key={subj}>
                      <td className="border border-slate-300 p-2 font-medium">
                        {subj}
                      </td>
                      <td
                        colSpan={6}
                        className="border border-slate-300 p-2 text-center text-slate-400"
                      >
                        Not Graded
                      </td>
                    </tr>
                  );
                const rawSBA =
                  ((m.cat1 + m.cat2 + m.cat3 + m.cat4 + m.group + m.project) /
                    80) *
                  schoolConfig.catWeight;
                const rawExam = (m.exam / 100) * schoolConfig.examWeight;
                const final = Math.round(rawSBA + rawExam);
                const g = calculateGrade(final);
                return (
                  <tr key={subj}>
                    <td className="border border-slate-300 p-2 font-medium">
                      {subj}
                    </td>
                    <td className="border border-slate-300 p-2 text-center">
                      {rawSBA.toFixed(1)}
                    </td>
                    <td className="border border-slate-300 p-2 text-center">
                      {rawExam.toFixed(1)}
                    </td>
                    <td className="border border-slate-300 p-2 text-center font-bold">
                      {final}
                    </td>
                    <td className="border border-slate-300 p-2 text-center font-bold text-blue-700">
                      {g.grade}
                    </td>
                    <td className="border border-slate-300 p-2 text-center text-xs">
                      {subjectRanks[subj]}
                    </td>
                    <td className="border border-slate-300 p-2 text-xs">
                      {g.desc}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <div className="mt-6 bg-white p-6 rounded-lg border border-slate-200">
            <h3 className="text-lg font-bold text-slate-800 mb-4">
              Grading Overview
            </h3>

            <div className="mt-4 text-xs text-slate-600">
              <div className="font-semibold mb-2">Grading Scale</div>
              <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
                {gradingSystem.map((band) => (
                  <div
                    key={`${band.grade}-${band.min}`}
                    className="border border-slate-200 rounded p-2"
                    title={`${band.min}–${band.max}: ${band.desc}`}
                  >
                    <div className="font-bold">Grade {band.grade}</div>
                    <div>
                      {band.min}–{band.max}
                    </div>
                    <div className="text-slate-500">{band.desc}</div>
                  </div>
                ))}
              </div>
            </div>
          </div>
          <div className="mt-8 bg-white p-6 rounded-lg border border-slate-200">
            <div className="mb-4 text-lg font-bold text-slate-800">
              <div className="text-center font-bold text-lg text-slate-800 mb-2">
                Student Attendance Report
              </div>
              <div className="text-sm text-slate-700 mb-4 text-center">
                {schoolConfig.name} • {student.surname}, {student.firstName} —{" "}
                {student.class}
                {[student.firstName, student.middleName, student.surname]
                  .filter(Boolean)
                  .join(" ")}{" "}
                — {student.class}
              </div>
              <div className="text-base font-semibold mb-4">
                Attendance: {"_".repeat(25)} out of {"_".repeat(25)}
              </div>
              <div className="my-4"></div>
              <div className="mb-4 text-lg font-bold text-slate-800">
                Talent and Interest:
              </div>
              <label htmlFor="talent-remark" className="text-slate-700">
                Select template
              </label>
              <select
                id="talent-remark"
                value={talentRemark}
                onChange={(e) => {
                  setTalentRemark(e.target.value);
                  const err = e.target.value ? null : "Required";
                  setTalentRemarkError(err);
                  logger.info("talent_remark_changed", {
                    value: e.target.value,
                  });
                }}
                className={`w-full border rounded p-2 bg-white mb-3 ${
                  talentRemarkError ? "border-red-500" : "border-slate-300"
                }`}
                aria-label="Talent and interest remark"
                aria-invalid={talentRemarkError ? "true" : "false"}
                required
              >
                <option value="" title="Required">
                  Select a template
                </option>
                {talentRemarkOptionsGrouped.map((g) => (
                  <optgroup key={g.group} label={g.group}>
                    {g.options.map((opt) => (
                      <option key={`${g.group}-${opt}`} value={opt} title={opt}>
                        {opt}
                      </option>
                    ))}
                  </optgroup>
                ))}
              </select>
              {talentRemark === "Other" && (
                <input
                  id="talent-remark-other"
                  value={talentRemarkOther}
                  onChange={(e) => {
                    setTalentRemarkOther(e.target.value);
                    const err =
                      e.target.value.length >= 20
                        ? null
                        : "Minimum 20 characters";
                    setTalentRemarkError(err);
                  }}
                  className={`w-full border rounded p-2 ${
                    talentRemarkError ? "border-red-500" : "border-slate-300"
                  }`}
                  aria-label="Custom talent remark"
                  placeholder="Specify other (min 20 characters)"
                />
              )}
              {!talentRemarkError && talentRemark && (
                <p className="text-xs text-green-700">Valid</p>
              )}
              Class Teacher's Remarks:
            </div>
            <label htmlFor="teacher-remark" className="text-slate-700">
              Select remark
            </label>
            <select
              id="teacher-remark"
              data-testid="teacher-remark-select"
              value={teacherRemark}
              onChange={(e) => {
                setTeacherRemark(e.target.value);
                setTeacherRemarkError(e.target.value ? null : "Required");
                logger.info("teacher_remark_changed", {
                  value: e.target.value,
                });
              }}
              className="w-full border border-slate-300 rounded p-2 bg-white mb-3"
              aria-label="Teacher remark"
              required
            >
              <option value="" title="Required">
                Select a remark
              </option>
              {teacherRemarkOptions.map((opt) => (
                <option key={opt} value={opt} title={opt}>
                  {opt}
                </option>
              ))}
            </select>
            {teacherRemark === "Other" && (
              <input
                id="teacher-remark-other"
                value={teacherRemarkOther}
                onChange={(e) => setTeacherRemarkOther(e.target.value)}
                className="w-full border border-slate-300 rounded p-2"
                aria-label="Custom teacher remark"
                placeholder="Specify other remark"
              />
            )}
            {teacherRemarkError && (
              <p className="text-xs text-red-600 mt-1">{teacherRemarkError}</p>
            )}
            <div className="mt-8 mb-2 text-lg font-bold text-slate-800">
              Headmaster's Remarks:
            </div>
            <div className="text-base font-semibold">{"_".repeat(100)}</div>
            <div className="mt-8 grid grid-cols-2 gap-8 text-sm">
              <div className="border-t border-slate-400 pt-2 text-center">
                <p className="font-bold">Class Teacher's Signature</p>
                <p className="text-xs text-slate-500 mt-4">
                  Generated by E-SBA [JHS]
                </p>
              </div>
              <div className="border-t border-slate-400 pt-2 text-center">
                <p className="font-bold">Head Teacher's Signature</p>
              </div>
            </div>
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
                          2
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
                            )
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
                                      (row as Record<string, unknown>)[h] ?? ""
                                    )}
                                  </td>
                                )
                              )}
                            </tr>
                          )
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
              <div className="mt-4 w-full">
                <label
                  htmlFor="wipe-confirm"
                  className="block text-sm font-medium text-slate-700 mb-1"
                >
                  Type CLEAR to confirm
                </label>
                <input
                  id="wipe-confirm"
                  value={wipeConfirmText}
                  onChange={(e) => setWipeConfirmText(e.target.value)}
                  className="w-full p-2 border rounded bg-slate-50"
                  placeholder="CLEAR"
                />
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
                  disabled={
                    isWiping || wipeConfirmText.trim().toUpperCase() !== "CLEAR"
                  }
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
            <div className="px-4 sm:px-6 py-3 sm:py-4 border-b border-slate-100 flex justify-between items-center bg-emerald-50">
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
                                  ""
                              )}
                            </td>
                            <td className="p-2">
                              {String(
                                (row as Record<string, unknown>)["firstname"] ||
                                  (row as Record<string, unknown>)[
                                    "first name"
                                  ] ||
                                  ""
                              )}
                            </td>
                            <td className="p-2">
                              {String(
                                (row as Record<string, unknown>)["gender"] || ""
                              )}
                            </td>
                            <td className="p-2">
                              {String(
                                (row as Record<string, unknown>)["class"] || ""
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
                  className="px-6 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg font-medium shadow-sm flex items-center gap-2 transition-all hover:shadow-md"
                >
                  <Download size={18} /> Confirm Import
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
                  <th className="py-2 px-2">Kind</th>
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
                    <td className="py-2 px-2">{m.kind}</td>
                    <td className="py-2 px-2">{m.type}</td>
                    <td className="py-2 px-2">{`${(
                      m.size /
                      (1024 * 1024)
                    ).toFixed(2)} MB`}</td>
                    <td className="py-2 px-2">
                      <div className="flex gap-2">
                        {(() => {
                          const t = m.type || "";
                          const n = m.name || "";
                          const isExcelMime = /spreadsheetml|ms-excel/i.test(t);
                          const isExcelName =
                            /\.(xlsx|xlsm|xls)$/i.test(n) &&
                            m.kind === "upload";
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
        <div className="overflow-x-auto">
          <table className="w-full text-sm text-left whitespace-nowrap">
            <thead className="bg-slate-100 text-xs uppercase text-slate-600">
              <tr>
                <th className="p-4 text-left">ID</th>
                <th className="p-4 text-left">Surname</th>
                <th className="p-4 text-left">First Name</th>
                <th className="p-4 text-left">Middle Name</th>
                <th className="p-4 text-left">Gender</th>
                <th className="p-4 text-left">Class</th>
                <th className="p-4 text-left">Status</th>
                <th className="p-4 text-center">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {students.map((s) => (
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

  const renderSetup = () => (
    <div className="space-y-6 max-w-5xl mx-auto">
      <div className="flex items-center justify-between mb-2">
        <h2 className="text-2xl font-bold text-slate-800">
          System Setup & Configuration
        </h2>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div className="bg-white p-6 rounded-lg shadow-sm border border-slate-200">
          <div className="flex items-center gap-2 mb-4 text-blue-800 border-b border-blue-50 pb-2">
            <ImageIcon size={20} />
            <h3 className="text-lg font-bold">School Profile</h3>
          </div>
          <div className="space-y-4">
            <div className="mb-6 p-4 bg-slate-50 rounded-lg border border-slate-100">
              <label className="block text-sm font-medium text-slate-700 mb-2">
                School Logo (Terminal Reports)
              </label>
              <div className="flex flex-col items-center justify-center gap-4">
                <div className="relative group w-32 h-32 bg-white rounded-lg shadow-sm border border-slate-200 flex items-center justify-center overflow-hidden">
                  {schoolConfig.logoUrl ? (
                    <img
                      src={schoolConfig.logoUrl}
                      alt="School Logo"
                      className="w-full h-full object-contain p-2"
                    />
                  ) : (
                    <ImageIcon className="text-slate-300" size={48} />
                  )}
                  {isProcessingLogo && (
                    <div className="absolute inset-0 bg-white/80 flex items-center justify-center">
                      <Loader2
                        className="animate-spin text-blue-600"
                        size={24}
                      />
                    </div>
                  )}
                </div>
                <div className="flex flex-wrap items-center justify-center gap-2 w-full">
                  <input
                    type="file"
                    ref={fileInputRef}
                    onChange={handleLogoUpload}
                    accept=".png,.jpg,.jpeg,.svg"
                    className="hidden"
                    aria-label="Upload logo"
                    title="Upload logo"
                  />
                  <button
                    onClick={() => fileInputRef.current?.click()}
                    className="flex items-center gap-1.5 px-3 py-1.5 bg-blue-100 text-blue-700 text-sm font-medium rounded hover:bg-blue-200 transition-colors"
                  >
                    <Upload size={14} /> Upload
                  </button>
                  {schoolConfig.logoUrl && (
                    <>
                      <button
                        onClick={rotateLogo}
                        className="flex items-center gap-1.5 px-3 py-1.5 bg-slate-100 text-slate-700 text-sm font-medium rounded hover:bg-slate-200 transition-colors"
                      >
                        <RotateCw size={14} /> Rotate
                      </button>
                      <button
                        onClick={removeLogo}
                        className="flex items-center gap-1.5 px-3 py-1.5 bg-red-50 text-red-600 text-sm font-medium rounded hover:bg-red-100 transition-colors"
                      >
                        <Trash2 size={14} /> Remove
                      </button>
                    </>
                  )}
                </div>
                <div className="text-center">
                  {logoError ? (
                    <p className="text-xs text-red-600 flex items-center gap-1 justify-center">
                      <AlertCircle size={12} /> {logoError}
                    </p>
                  ) : (
                    <p className="text-xs text-slate-500">
                      Rec: 300x300px (Max 2MB)
                    </p>
                  )}
                </div>
                {schoolConfig.logoUrl && (
                  <button
                    onClick={() => setCurrentView("report")}
                    className="w-full mt-2 flex items-center justify-center gap-2 text-xs text-blue-600 hover:underline"
                  >
                    <Eye size={12} /> Test on Report
                  </button>
                )}
              </div>
            </div>
            <div>
              <label
                htmlFor="school-name"
                className="block text-sm font-medium text-slate-700 mb-1"
              >
                School Name
              </label>
              <input
                id="school-name"
                type="text"
                value={schoolConfig.name}
                onChange={(e) =>
                  setSchoolConfig({ ...schoolConfig, name: e.target.value })
                }
                className="w-full p-2 border border-slate-300 rounded focus:ring-2 focus:ring-blue-500 outline-none"
              />
            </div>
            <div>
              <label
                htmlFor="motto"
                className="block text-sm font-medium text-slate-700 mb-1"
              >
                Motto
              </label>
              <input
                id="motto"
                type="text"
                value={schoolConfig.motto}
                onChange={(e) =>
                  setSchoolConfig({ ...schoolConfig, motto: e.target.value })
                }
                className="w-full p-2 border border-slate-300 rounded focus:ring-2 focus:ring-blue-500 outline-none"
              />
            </div>
            <div>
              <label
                htmlFor="head-teacher"
                className="block text-sm font-medium text-slate-700 mb-1"
              >
                Head Teacher's Name
              </label>
              <input
                id="head-teacher"
                type="text"
                value={schoolConfig.headTeacher}
                onChange={(e) =>
                  setSchoolConfig({
                    ...schoolConfig,
                    headTeacher: e.target.value,
                  })
                }
                className="w-full p-2 border border-slate-300 rounded focus:ring-2 focus:ring-blue-500 outline-none"
              />
            </div>
            <div>
              <label
                htmlFor="school-address"
                className="block text-sm font-medium text-slate-700 mb-1"
              >
                School Address
              </label>
              <textarea
                id="school-address"
                value={schoolConfig.address}
                onChange={(e) =>
                  setSchoolConfig({ ...schoolConfig, address: e.target.value })
                }
                className="w-full p-2 border border-slate-300 rounded focus:ring-2 focus:ring-blue-500 outline-none h-20 resize-none"
              />
            </div>
          </div>
        </div>
        <div className="bg-white p-6 rounded-lg shadow-sm border border-slate-200 h-fit">
          <div className="flex items-center gap-2 mb-4 text-emerald-800 border-b border-emerald-50 pb-2">
            <Calendar size={20} />
            <h3 className="text-lg font-bold">Academic Configuration</h3>
          </div>
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label
                  htmlFor="academic-year"
                  className="block text-sm font-medium text-slate-700 mb-1"
                >
                  Current Year
                </label>
                <select
                  id="academic-year"
                  value={academicYear}
                  onChange={(e) => setAcademicYear(e.target.value)}
                  className="w-full p-2 border border-slate-300 rounded bg-slate-50"
                >
                  {academicYearOptions.map((y) => (
                    <option key={y} value={y}>
                      {y}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label
                  htmlFor="current-term"
                  className="block text-sm font-medium text-slate-700 mb-1"
                >
                  Current Term
                </label>
                <select
                  id="current-term"
                  value={term}
                  onChange={(e) => setTerm(e.target.value)}
                  className="w-full p-2 border border-slate-300 rounded bg-slate-50"
                >
                  <option>Term 1</option>
                  <option>Term 2</option>
                  <option>Term 3</option>
                </select>
              </div>
            </div>
            <div className="pt-4 border-t border-slate-100 mt-4">
              <h4 className="text-sm font-bold text-slate-800 mb-3">
                Assessment Weighting
              </h4>
              <div className="flex items-center gap-4">
                <div className="flex-1">
                  <label
                    htmlFor="cat-weight"
                    className="block text-xs font-bold text-slate-500 mb-1"
                  >
                    Class Score (CAT)
                  </label>
                  <div className="relative">
                    <input
                      id="cat-weight"
                      type="number"
                      value={schoolConfig.catWeight}
                      onChange={(e) =>
                        setSchoolConfig({
                          ...schoolConfig,
                          catWeight: parseInt(e.target.value),
                          examWeight: 100 - parseInt(e.target.value),
                        })
                      }
                      className="w-full p-2 border border-slate-300 rounded pr-8"
                    />
                    <span className="absolute right-3 top-2 text-slate-400 text-sm">
                      %
                    </span>
                  </div>
                </div>
                <div className="font-bold text-slate-400 pt-5">:</div>
                <div className="flex-1">
                  <label
                    htmlFor="exam-weight"
                    className="block text-xs font-bold text-slate-500 mb-1"
                  >
                    Exam Score
                  </label>
                  <div className="relative">
                    <input
                      id="exam-weight"
                      type="number"
                      value={schoolConfig.examWeight}
                      readOnly
                      className="w-full p-2 border border-slate-300 rounded bg-slate-50 pr-8"
                    />
                    <span className="absolute right-3 top-2 text-slate-400 text-sm">
                      %
                    </span>
                  </div>
                </div>
              </div>
              <p className="text-xs text-slate-500 mt-2 italic">
                Note: Changing weighting requires system recalculation.
              </p>
            </div>
          </div>
        </div>
        <div className="bg-white p-6 rounded-lg shadow-sm border border-slate-200">
          <div className="flex items-center gap-2 mb-4 text-slate-800 border-b border-slate-50 pb-2">
            <ImageIcon size={20} />
            <h3 className="text-lg font-bold">Headmaster's Signature</h3>
          </div>
          <SignatureUpload
            value={schoolConfig.headSignatureUrl ?? null}
            onChange={(url) =>
              setSchoolConfig((prev) => ({ ...prev, headSignatureUrl: url }))
            }
            academicYear={academicYear}
            term={term}
            enabled={!!schoolConfig.signatureEnabled}
            onToggleEnabled={(enabled) =>
              setSchoolConfig((prev) => ({
                ...prev,
                signatureEnabled: enabled,
              }))
            }
          />
        </div>
      </div>
    </div>
  );

  return (
    <div className="min-h-screen bg-slate-100 text-slate-900 font-sans">
      <div className="bg-slate-900 text-white p-4 shadow-md flex items-center justify-between">
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
          <h1 className="text-xl font-bold tracking-wide">E-SBA [JHS]</h1>
        </div>
        <div className="text-xs text-slate-400">v2.5.0 | Excel-Mode</div>
      </div>
      <main className="p-4">
        {currentView === "home" && renderHome()}
        {currentView === "subject" && renderSubjectSheet()}
        {currentView === "report" && renderReportCard()}
        {currentView === "masterdb" && renderMasterDB()}
        {currentView === "setup" && renderSetup()}
        {renderAssessmentUploadModal()}
      </main>
    </div>
  );
}
