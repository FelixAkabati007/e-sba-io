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
};

const DashboardTile = React.memo(
  ({ title, icon: Icon, color, onClick }: TileProps) => (
    <button
      onClick={onClick}
      className={`p-6 rounded-xl shadow-sm hover:shadow-md transition-all transform hover:-translate-y-1 text-left flex flex-col justify-between h-40 ${color} text-white`}
    >
      <Icon size={32} className="opacity-80" />
      <span className="font-bold text-lg">{title}</span>
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
  const [editingStudent, setEditingStudent] = useState<Student | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [showSuccess, setShowSuccess] = useState(false);

  const [isImportModalOpen, setIsImportModalOpen] = useState(false);
  const [importLogs, setImportLogs] = useState<ImportLog[]>([]);
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

  const [students, setStudents] = useState<Student[]>([
    {
      id: "JHS25001",
      surname: "MENSAH",
      firstName: "Kwame",
      middleName: "",
      gender: "Male",
      dob: "2010-05-12",
      guardianContact: "0244123456",
      class: "JHS 2",
      status: "Active",
    },
    {
      id: "JHS25002",
      surname: "ADDO",
      firstName: "Ama",
      middleName: "Serwaa",
      gender: "Female",
      dob: "2010-08-23",
      guardianContact: "0200987654",
      class: "JHS 2",
      status: "Active",
    },
    {
      id: "JHS25003",
      surname: "OWUSU",
      firstName: "Emmanuel",
      middleName: "",
      gender: "Male",
      dob: "2009-11-30",
      guardianContact: "0555112233",
      class: "JHS 2",
      status: "Active",
    },
    {
      id: "JHS25004",
      surname: "BOATENG",
      firstName: "Grace",
      middleName: "",
      gender: "Female",
      dob: "2011-02-14",
      guardianContact: "0277445566",
      class: "JHS 1",
      status: "Active",
    },
  ]);

  const [marks, setMarks] = useState<Marks>({
    JHS25001: {
      Mathematics: {
        cat1: 8,
        cat2: 9,
        cat3: 10,
        cat4: 8,
        group: 15,
        project: 18,
        exam: 75,
      },
      "English Language": {
        cat1: 7,
        cat2: 8,
        cat3: 8,
        cat4: 7,
        group: 12,
        project: 15,
        exam: 60,
      },
    },
    JHS25002: {
      Mathematics: {
        cat1: 10,
        cat2: 10,
        cat3: 10,
        cat4: 10,
        group: 20,
        project: 20,
        exam: 88,
      },
    },
  });

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

    const reader = new FileReader();
    reader.onload = (evt) => {
      try {
        const data = evt.target?.result as ArrayBuffer;
        const workbook = XLSX.read(data, { type: "array" });
        const firstSheetName = workbook.SheetNames[0];
        const worksheet = workbook.Sheets[firstSheetName];
        const jsonData = XLSX.utils.sheet_to_json(worksheet) as Record<
          string,
          unknown
        >[];
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
        setImportedPreview(normalizedData);
        setImportLogs((prev) => [
          ...prev,
          {
            status: "success",
            message: `Successfully parsed ${jsonData.length} records. Please review below.`,
          },
        ]);
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

  const exportSubjectSheetPDF = () => {
    setIsGeneratingDoc(true);
    setDocStatus("Generating Assessment Sheet...");
    setTimeout(() => {
      try {
        const doc = new jsPDF("l");
        doc.setFontSize(14);
        doc.text(`${schoolConfig.name} - ${activeSubject} Assessment`, 14, 15);
        doc.setFontSize(10);
        doc.text(
          `Class: ${selectedClass} | Term: ${term} | Year: ${academicYear}`,
          14,
          22
        );
        const headers = [
          "ID",
          "Name",
          "T1",
          "T2",
          "T3",
          "T4",
          "Grp",
          "Proj",
          "Raw",
          "SBA(50%)",
          "Exam",
          "Ex(50%)",
          "Tot",
          "Grd",
          "Rem",
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
          const rawSBA =
            m.cat1 + m.cat2 + m.cat3 + m.cat4 + m.group + m.project;
          const scaledSBA = (rawSBA / 80) * schoolConfig.catWeight;
          const scaledExam = (m.exam / 100) * schoolConfig.examWeight;
          const final = Math.round(scaledSBA + scaledExam);
          const g = calculateGrade(final);
          return [
            s.id,
            `${s.surname}, ${s.firstName}`,
            m.cat1,
            m.cat2,
            m.cat3,
            m.cat4,
            m.group,
            m.project,
            rawSBA,
            scaledSBA.toFixed(1),
            m.exam,
            scaledExam.toFixed(1),
            final,
            g.grade,
            g.desc,
          ];
        });
        (doc as jsPDF & { autoTable: (opts: unknown) => void }).autoTable({
          head: [headers],
          body: rows,
          startY: 30,
          theme: "grid",
          styles: { fontSize: 8, cellPadding: 1 },
          headStyles: { fillColor: [44, 62, 80] },
        });
        doc.save(`${activeSubject}_${selectedClass}_Assessment.pdf`);
      } catch (e) {
        logger.error("Subject PDF error", e);
      }
      setIsGeneratingDoc(false);
    }, 500);
  };

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
            headStyles: { fillColor: [41, 128, 185] },
            styles: { fontSize: 9, valign: "middle", halign: "center" },
            columnStyles: { 0: { halign: "left" }, 6: { halign: "left" } },
          });
          const finalY =
            (doc as jsPDF & { lastAutoTable: { finalY: number } }).lastAutoTable
              .finalY + 30;
          doc.setLineWidth(0.2);
          doc.line(20, finalY, 80, finalY);
          doc.text("Class Teacher's Signature", 25, finalY + 5);
          doc.line(130, finalY, 190, finalY);
          doc.text("Head Teacher's Signature", 135, finalY + 5);
          doc.setFontSize(8);
          doc.setTextColor(150);
          doc.text("Generated by E-SBA [JHS] System", 105, 285, {
            align: "center",
          });
          doc.setTextColor(0);
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

  const removeLogo = () => {
    setSchoolConfig((prev) => ({ ...prev, logoUrl: null }));
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

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
        <h2 className="text-2xl font-bold text-slate-800 mb-4">
          Welcome, Admin
        </h2>
        <div className="flex flex-wrap gap-6 items-end">
          <div className="flex flex-col space-y-1">
            <label className="text-sm font-medium text-slate-600">
              Academic Year
            </label>
            <select
              value={academicYear}
              onChange={(e) => setAcademicYear(e.target.value)}
              className="p-2 border border-slate-300 rounded-md bg-slate-50 w-40"
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
            >
              <option>JHS 1</option>
              <option>JHS 2</option>
              <option>JHS 3</option>
            </select>
          </div>
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
        <div className="flex space-x-2 items-center">
          <button
            onClick={exportSubjectSheetPDF}
            disabled={isGeneratingDoc}
            className="flex items-center gap-2 px-3 py-1.5 bg-white border border-blue-200 text-blue-700 hover:bg-blue-50 rounded-lg text-sm font-medium transition-colors"
          >
            {isGeneratingDoc ? (
              <Loader2 size={16} className="animate-spin" />
            ) : (
              <Download size={16} />
            )}
            Download Sheet
          </button>
          <span className="px-3 py-1 bg-yellow-100 text-yellow-800 rounded-full text-xs font-semibold">
            Auto-Save Active
          </span>
        </div>
      </div>
      <div className="overflow-auto flex-1">
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
    );
  };

  const renderMasterDB = () => (
    <div className="space-y-4">
      {isModalOpen && (
        <div className="fixed inset-0 z-[65] flex items-center justify-center p-4 bg-slate-900/50 backdrop-blur-sm animate-in fade-in duration-200">
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-2xl overflow-hidden">
            <div className="px-6 py-4 border-b border-slate-100 flex justify-between items-center bg-blue-50">
              <h3 className="text-lg font-bold text-blue-900 flex items-center gap-2">
                <Users size={20} className="text-blue-700" />{" "}
                {editingStudent ? "Edit Student" : "Add Student"}
              </h3>
              <button
                onClick={closeModal}
                className="text-slate-400 hover:text-slate-600 hover:bg-slate-200 rounded-full p-1"
              >
                <X size={20} />
              </button>
            </div>
            <div className="p-6 space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">
                    Student ID
                  </label>
                  <input
                    name="id"
                    value={formData.id}
                    onChange={handleInputChange}
                    className="w-full p-2 border rounded"
                  />
                  {formErrors.id && (
                    <p className="text-xs text-red-600 mt-1">{formErrors.id}</p>
                  )}
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">
                    Surname
                  </label>
                  <input
                    name="surname"
                    value={formData.surname}
                    onChange={handleInputChange}
                    className="w-full p-2 border rounded"
                  />
                  {formErrors.surname && (
                    <p className="text-xs text-red-600 mt-1">
                      {formErrors.surname}
                    </p>
                  )}
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">
                    First Name
                  </label>
                  <input
                    name="firstName"
                    value={formData.firstName}
                    onChange={handleInputChange}
                    className="w-full p-2 border rounded"
                  />
                  {formErrors.firstName && (
                    <p className="text-xs text-red-600 mt-1">
                      {formErrors.firstName}
                    </p>
                  )}
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">
                    Middle Name
                  </label>
                  <input
                    name="middleName"
                    value={formData.middleName}
                    onChange={handleInputChange}
                    className="w-full p-2 border rounded"
                  />
                  {formErrors.middleName && (
                    <p className="text-xs text-red-600 mt-1">
                      {formErrors.middleName}
                    </p>
                  )}
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">
                    Gender
                  </label>
                  <select
                    name="gender"
                    value={formData.gender}
                    onChange={handleInputChange}
                    className="w-full p-2 border rounded bg-slate-50"
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
                  <label className="block text-sm font-medium text-slate-700 mb-1">
                    Date of Birth
                  </label>
                  <input
                    type="date"
                    name="dob"
                    value={formData.dob}
                    onChange={handleInputChange}
                    className="w-full p-2 border rounded"
                  />
                  {formErrors.dob && (
                    <p className="text-xs text-red-600 mt-1">
                      {formErrors.dob}
                    </p>
                  )}
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">
                    Guardian Contact
                  </label>
                  <input
                    name="guardianContact"
                    value={formData.guardianContact}
                    onChange={handleInputChange}
                    className="w-full p-2 border rounded"
                  />
                  {formErrors.guardianContact && (
                    <p className="text-xs text-red-600 mt-1">
                      {formErrors.guardianContact}
                    </p>
                  )}
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">
                    Class
                  </label>
                  <select
                    name="class"
                    value={formData.class}
                    onChange={handleInputChange}
                    className="w-full p-2 border rounded bg-slate-50"
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
                  <label className="block text-sm font-medium text-slate-700 mb-1">
                    Status
                  </label>
                  <select
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
            <div className="px-6 py-4 border-t bg-slate-50 flex justify-end gap-3">
              <button
                onClick={closeModal}
                className="px-4 py-2 bg-slate-100 text-slate-700 rounded hover:bg-slate-200"
              >
                Cancel
              </button>
              <button
                onClick={handleSaveStudent}
                disabled={isSubmitting}
                className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 flex items-center gap-2"
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
      {isGeneratingDoc && (
        <div className="fixed inset-0 z-[70] flex flex-col items-center justify-center bg-slate-900/50 backdrop-blur-sm text-white">
          <Loader2 size={48} className="animate-spin mb-4" />
          <p className="text-lg font-medium">{docStatus}</p>
        </div>
      )}
      {deleteConfirmation.isOpen && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-slate-900/50 backdrop-blur-sm animate-in fade-in duration-200">
          <div className="bg-white rounded-lg shadow-xl w-full max-w-sm p-6 transform transition-all scale-100">
            <div className="flex flex-col items-center text-center">
              <div className="w-12 h-12 bg-red-100 rounded-full flex items-center justify-center mb-4">
                <AlertTriangle className="text-red-600" size={24} />
              </div>
              <h3 className="text-lg font-bold text-slate-900">
                Confirm Deletion
              </h3>
              <p className="text-sm text-slate-500 mt-2">
                Are you sure you want to delete this student? This action will
                remove all their personal data and assessment records
                permanently.
              </p>
              <div className="flex gap-3 mt-6 w-full">
                <button
                  onClick={cancelDelete}
                  className="flex-1 px-4 py-2 bg-slate-100 text-slate-700 font-medium rounded-lg hover:bg-slate-200 transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={confirmDelete}
                  className="flex-1 px-4 py-2 bg-red-600 text-white font-medium rounded-lg hover:bg-red-700 transition-colors"
                >
                  Delete
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
      {isImportModalOpen && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-slate-900/50 backdrop-blur-sm animate-in fade-in zoom-in-95">
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-2xl overflow-hidden flex flex-col max-h-[80vh]">
            <div className="px-6 py-4 border-b border-slate-100 flex justify-between items-center bg-emerald-50">
              <h3 className="text-lg font-bold text-emerald-900 flex items-center gap-2">
                <FileSpreadsheet size={20} className="text-emerald-600" />
                Import Student Data (Excel)
              </h3>
              <button
                onClick={() => {
                  setIsImportModalOpen(false);
                  setImportLogs([]);
                  setImportedPreview([]);
                }}
                className="text-slate-400 hover:text-slate-600 hover:bg-slate-200 rounded-full p-1"
              >
                <X size={20} />
              </button>
            </div>
            <div className="p-6 overflow-y-auto">
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
                    className="border-2 border-dashed border-emerald-200 bg-emerald-50/50 rounded-xl p-8 flex flex-col items-center justify-center cursor-pointer hover:bg-emerald-50 hover:border-emerald-400 transition-all group"
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
                    <button className="px-4 py-2 bg-emerald-600 text-white rounded-lg text-sm font-medium shadow-sm hover:shadow">
                      Select File
                    </button>
                    <input
                      type="file"
                      ref={importFileInputRef}
                      onChange={handleExcelUpload}
                      accept=".xlsx, .xls"
                      className="hidden"
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
                      className="text-xs text-red-600 hover:text-red-700 hover:underline font-medium"
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
            onClick={openCreateModal}
            className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white hover:bg-blue-700 rounded-lg text-sm font-medium shadow-sm hover:shadow transition-all"
          >
            <Users size={16} /> Add Student
          </button>
        </div>
      </div>
      <div className="bg-white rounded-lg shadow-sm overflow-hidden border border-slate-200">
        <div className="overflow-x-auto">
          <table className="w-full text-sm text-left whitespace-nowrap">
            <thead className="bg-slate-100 text-xs uppercase text-slate-600">
              <tr>
                <th className="p-4 text-left">ID</th>
                <th className="p-4 text-left">Surname</th>
                <th className="p-4 text-left">First Name</th>
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
                      >
                        <Pencil size={16} />
                      </button>
                      <button
                        onClick={() => initiateDelete(s.id)}
                        className="p-1 text-red-500 hover:bg-red-50 rounded"
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
              <label className="block text-sm font-medium text-slate-700 mb-1">
                School Name
              </label>
              <input
                type="text"
                value={schoolConfig.name}
                onChange={(e) =>
                  setSchoolConfig({ ...schoolConfig, name: e.target.value })
                }
                className="w-full p-2 border border-slate-300 rounded focus:ring-2 focus:ring-blue-500 outline-none"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">
                Motto
              </label>
              <input
                type="text"
                value={schoolConfig.motto}
                onChange={(e) =>
                  setSchoolConfig({ ...schoolConfig, motto: e.target.value })
                }
                className="w-full p-2 border border-slate-300 rounded focus:ring-2 focus:ring-blue-500 outline-none"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">
                Head Teacher's Name
              </label>
              <input
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
              <label className="block text-sm font-medium text-slate-700 mb-1">
                School Address
              </label>
              <textarea
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
                <label className="block text-sm font-medium text-slate-700 mb-1">
                  Current Year
                </label>
                <select
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
                <label className="block text-sm font-medium text-slate-700 mb-1">
                  Current Term
                </label>
                <select
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
                  <label className="block text-xs font-bold text-slate-500 mb-1">
                    Class Score (CAT)
                  </label>
                  <div className="relative">
                    <input
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
                  <label className="block text-xs font-bold text-slate-500 mb-1">
                    Exam Score
                  </label>
                  <div className="relative">
                    <input
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
            >
              <ArrowLeft size={20} />
            </button>
          )}
          <Menu size={24} className="opacity-80" />
          <h1 className="text-xl font-bold tracking-wide">E-SBA [JHS]</h1>
        </div>
        <div className="text-xs text-slate-400">v2.5.0 | Excel-Mode</div>
      </div>
      <main className="p-6">
        {currentView === "home" && renderHome()}
        {currentView === "subject" && renderSubjectSheet()}
        {currentView === "report" && renderReportCard()}
        {currentView === "masterdb" && renderMasterDB()}
        {currentView === "setup" && renderSetup()}
      </main>
    </div>
  );
}
