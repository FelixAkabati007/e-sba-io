import React, { useState, useEffect, useMemo } from "react";
import {
  Search,
  Printer,
  Database,
  Loader2,
  GraduationCap,
} from "lucide-react";
import { apiClient } from "../lib/apiClient";
import { logger } from "../lib/logger";
import { Student, Marks } from "../lib/sharedTypes";
import type { User } from "../context/AuthContext";
import type { AssessmentMarkRow } from "../lib/apiTypes";
import { SchoolConfig } from "../lib/configStorage";
import { GradeConfig, calculateGrade, getOrdinal } from "../lib/grading";
import { SUBJECTS } from "../lib/constants";
import ProgressBar from "./ProgressBar";

interface ReportCardsProps {
  students: Student[];
  filteredStudents: Student[];
  marks: Marks;
  setMarks: React.Dispatch<React.SetStateAction<Marks>>;
  schoolConfig: SchoolConfig;
  academicYear: string;
  term: string;
  selectedClass: string;
  user: User | null;
  gradingSystem: GradeConfig[];
}

const ReportCards: React.FC<ReportCardsProps> = ({
  students,
  filteredStudents,
  marks,
  setMarks,
  schoolConfig,
  academicYear,
  term,
  selectedClass,
  user,
  gradingSystem,
}) => {
  const [reportId, setReportId] = useState("");
  const [attendancePresent, setAttendancePresent] = useState("");
  const [attendanceTotal, setAttendanceTotal] = useState("");
  const [talentRemark, setTalentRemark] = useState("");
  const [talentRemarkOther, setTalentRemarkOther] = useState("");
  const [teacherRemark, setTeacherRemark] = useState("");
  const [teacherRemarkOther, setTeacherRemarkOther] = useState("");
  const [talentRemarkError, setTalentRemarkError] = useState<string | null>(
    null,
  );
  const [, setTeacherRemarkError] = useState<string | null>(null);
  const [isGeneratingDoc, setIsGeneratingDoc] = useState(false);
  const [docStatus, setDocStatus] = useState("");
  const [headSignatureDataUrl, setHeadSignatureDataUrl] = useState<
    string | null
  >(null);
  const [reportDataLoaded, setReportDataLoaded] = useState(false);
  const [isTalentSaving, setIsTalentSaving] = useState(false);

  const [talentRemarkOptionsGrouped, setTalentRemarkOptionsGrouped] = useState<
    Array<{ group: string; options: string[] }>
  >([
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

  // Track original values for Cancel functionality
  const [originalTalent, setOriginalTalent] = useState({
    talent: "",
    teacher: "",
  });

  const effectiveReportId = reportId || filteredStudents[0]?.id || "";
  const student = students.find((s) => s.id === effectiveReportId);

  // Reset reportId when class changes
  useEffect(() => {
    setReportId("");
  }, [selectedClass]);

  // Fetch Talent Remarks Options
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
      // Fallback defaults already set in state
    })();
  }, []);

  // Fetch Signature
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

  // Fetch All Class Marks
  useEffect(() => {
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
  }, [selectedClass, academicYear, term, setMarks]);

  // Fetch Student Data (Attendance, Remarks)
  useEffect(() => {
    const sid = effectiveReportId;
    if (!sid) return;

    const fetchData = async () => {
      setReportDataLoaded(false);
      setTalentRemark("");
      setTeacherRemark("");
      setAttendancePresent("");
      setAttendanceTotal("");

      try {
        const tRes = await fetch(
          `/api/reporting/talent?studentId=${sid}&academicYear=${academicYear}&term=${term}`,
          {
            headers: {
              Authorization: `Bearer ${localStorage.getItem("token")}`,
            },
          },
        );
        if (tRes.ok) {
          const tData = await tRes.json();
          setTalentRemark(tData.talent_remark || "");
          setTeacherRemark(tData.class_teacher_remark || "");
        }

        const aRes = await fetch(
          `/api/reporting/attendance?studentId=${sid}&academicYear=${academicYear}&term=${term}`,
          {
            headers: {
              Authorization: `Bearer ${localStorage.getItem("token")}`,
            },
          },
        );
        if (aRes.ok) {
          const aData = await aRes.json();
          setAttendancePresent(String(aData.days_present || ""));
          setAttendanceTotal(String(aData.days_total || ""));
        }
      } catch (e) {
        console.error("Failed to load report data", e);
      } finally {
        setReportDataLoaded(true);
      }
    };
    fetchData();
  }, [effectiveReportId, academicYear, term]);

  // Update original values when data loads
  useEffect(() => {
    if (reportDataLoaded) {
      setOriginalTalent({
        talent: talentRemark,
        teacher: teacherRemark,
      });
    }
  }, [reportDataLoaded, talentRemark, teacherRemark]);

  // Auto-save Attendance
  useEffect(() => {
    const sid = effectiveReportId;
    if (!sid || !reportDataLoaded) return;
    if (user?.role === "CLASS") return;

    const timer = setTimeout(async () => {
      try {
        await apiClient.request("/reporting/attendance", "POST", {
          studentId: sid,
          academicYear,
          term,
          present: attendancePresent,
          total: attendanceTotal,
        });
      } catch (e) {
        console.error("Auto-save attendance failed", e);
      }
    }, 1000);
    return () => clearTimeout(timer);
  }, [
    attendancePresent,
    attendanceTotal,
    effectiveReportId,
    academicYear,
    term,
    reportDataLoaded,
    user,
  ]);

  const handleSaveTalent = async () => {
    const sid = effectiveReportId;
    if (!sid) return;

    setIsTalentSaving(true);
    try {
      await apiClient.request("/reporting/talent", "POST", {
        studentId: sid,
        academicYear,
        term,
        talent: talentRemark === "Other" ? talentRemarkOther : talentRemark,
        teacher: teacherRemark === "Other" ? teacherRemarkOther : teacherRemark,
        head: "",
      });

      setOriginalTalent({
        talent: talentRemark,
        teacher: teacherRemark,
      });
      // Optional: Show success indicator
      const btn = document.getElementById("save-talent-btn");
      if (btn) {
        const originalText = btn.innerText;
        btn.innerText = "Saved!";
        setTimeout(() => (btn.innerText = originalText), 2000);
      }
    } catch (e) {
      logger.error("save_talent_failed", e);
      alert("Failed to save changes. Please try again.");
    } finally {
      setIsTalentSaving(false);
    }
  };

  const hasTalentChanges = useMemo(() => {
    return (
      talentRemark !== originalTalent.talent ||
      teacherRemark !== originalTalent.teacher ||
      (talentRemark === "Other" && talentRemarkOther !== "") ||
      (teacherRemark === "Other" && teacherRemarkOther !== "")
    );
  }, [
    talentRemark,
    talentRemarkOther,
    teacherRemark,
    teacherRemarkOther,
    originalTalent,
  ]);

  const handleCancelTalent = () => {
    setTalentRemark(originalTalent.talent);
    setTeacherRemark(originalTalent.teacher);
    setTalentRemarkOther("");
    setTeacherRemarkOther("");
  };

  const subjectStats: Record<string, { rank: string; avg: string }> = {};
  SUBJECTS.forEach((subj) => {
    let totalScore = 0;
    let count = 0;
    const allMarks = filteredStudents
      .map((s) => {
        const m = marks[s.id]?.[subj];
        if (!m) return { id: s.id, score: 0, hasMark: false };
        const rawSBA =
          ((m.cat1 + m.cat2 + m.group + m.project) / 60) *
          schoolConfig.catWeight;
        const rawExam = (m.exam / 100) * schoolConfig.examWeight;
        const score = Math.round(rawSBA + rawExam);
        if (m) {
          totalScore += score;
          count++;
        }
        return { id: s.id, score, hasMark: !!m };
      })
      .sort((a, b) => b.score - a.score);

    const rankIndex = allMarks.findIndex((x) => x.id === effectiveReportId);
    subjectStats[subj] = {
      rank: rankIndex !== -1 ? getOrdinal(rankIndex + 1) : "-",
      avg: count > 0 ? (totalScore / count).toFixed(1) : "-",
    };
  });

  const generateReportCardPDF = (studentId: string | null = null) => {
    setIsGeneratingDoc(true);
    const targetStudents = studentId
      ? students.filter((s) => s.id === studentId)
      : filteredStudents;
    const modeText = studentId
      ? "Report Card"
      : `Batch (${targetStudents.length})`;
    setDocStatus(`Generating ${modeText}...`);
    setTimeout(async () => {
      try {
        const { jsPDF } = await import("jspdf");
        const { default: autoTable } = await import("jspdf-autotable");

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
          let currentY = 20;
          const centerX = 105;
          const maxWidth = 180;

          // School Name
          doc.setFontSize(20);
          doc.setFont("helvetica", "bold");
          const nameLines = doc.splitTextToSize(
            schoolConfig.name.toUpperCase(),
            160,
          );
          doc.text(nameLines, centerX, currentY, {
            align: "center",
            charSpace: 1,
          });
          currentY += nameLines.length * 8;

          // Address
          doc.setFontSize(10);
          doc.setFont("helvetica", "normal");
          const addressLines = doc.splitTextToSize(
            schoolConfig.address,
            maxWidth,
          );
          doc.text(addressLines, centerX, currentY, { align: "center" });
          currentY += addressLines.length * 5 + 2;

          // Motto
          doc.setFontSize(10);
          doc.setFont("helvetica", "italic");
          const mottoText = `"${schoolConfig.motto.trim().toUpperCase()}"`;
          const mottoLines = doc.splitTextToSize(mottoText, 160);
          doc.text(mottoLines, centerX, currentY, {
            align: "center",
          });
          currentY += mottoLines.length * 5 + 4;

          // Decorative Divider
          doc.setDrawColor(0);
          doc.setLineWidth(0.5);
          doc.line(15, currentY, 195, currentY);
          currentY += 10;

          // Report Title
          doc.setFontSize(18);
          doc.setFont("helvetica", "bold");
          doc.text("TERMINAL REPORT", centerX, currentY, { align: "center" });
          currentY += 4;

          // Bottom Divider
          doc.setLineWidth(0.5);
          doc.line(15, currentY, 195, currentY);

          // Update startY for content
          doc.setFontSize(10);
          doc.setFont("helvetica", "normal");
          const startY = currentY + 10;
          const leftX = 15;
          const rightX = 110;
          const lineHeight = 7;
          const drawField = (
            label: string,
            value: string,
            x: number,
            y: number,
            maxWidth?: number,
          ) => {
            doc.setFont("helvetica", "bold");
            doc.text(label, x, y);
            const labelWidth = doc.getTextWidth(label);
            doc.setFont("helvetica", "normal");
            const val = value || "";
            if (maxWidth) {
              const availableWidth = maxWidth - labelWidth - 2;
              const lines = doc.splitTextToSize(val, availableWidth);
              doc.text(lines, x + labelWidth + 2, y);
            } else {
              doc.text(val, x + labelWidth + 2, y);
            }
          };

          drawField(
            "Name:",
            `${student.surname}, ${student.firstName} ${student.middleName}`,
            leftX,
            startY,
          );
          drawField("ID:", student.id, rightX, startY);
          drawField("Class:", student.class, leftX, startY + lineHeight);
          drawField(
            "Term:",
            `${term}, ${academicYear}`,
            rightX,
            startY + lineHeight,
          );
          drawField("DOB:", student.dob, leftX, startY + lineHeight * 2);
          drawField(
            "Contact:",
            student.guardianContact,
            rightX,
            startY + lineHeight * 2,
            85,
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
            const rawSBA = m.cat1 + m.cat2 + m.group + m.project;
            const scaledSBA = (rawSBA / 60) * schoolConfig.catWeight;
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

          (autoTable as unknown as (doc: unknown, opts: unknown) => void)(doc, {
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
          const y =
            (doc as unknown as { lastAutoTable: { finalY: number } })
              .lastAutoTable.finalY + 10;
          const baseY = y;
          const col1X = 15;
          const col2X = 77.5;
          const colWidth = 55;
          const col3X = col2X + colWidth + 10;

          // --- Column 1: Grading System ---
          doc.setFontSize(8);
          doc.setFont("helvetica", "bold");
          doc.text("GRADING SYSTEM", col1X, baseY);

          const gradeRows = gradingSystem.map((band) => [
            String(band.grade),
            `${band.min}–${band.max}`,
            band.desc,
          ]);

          (autoTable as unknown as (doc: unknown, opts: unknown) => void)(doc, {
            head: [["Grade", "Range", "Remark"]],
            body: gradeRows,
            startY: baseY + 4,
            theme: "grid",
            margin: { left: col1X },
            tableWidth: colWidth,
            headStyles: {
              fontSize: 6,
              fillColor: [230, 230, 230],
              textColor: 60,
              halign: "left",
            },
            styles: {
              fontSize: 6,
              valign: "middle",
              halign: "left",
              cellPadding: 1,
              lineWidth: 0.1,
            },
            columnStyles: {
              0: { cellWidth: 10 },
              1: { cellWidth: 20 },
              2: { cellWidth: "auto" },
            },
          });

          // --- Column 2: Student Report ---
          let y2 = baseY;
          doc.setFontSize(8);
          doc.setFont("helvetica", "bold");
          doc.text("STUDENT REPORT", col2X, y2);
          y2 += 8;

          // Attendance
          doc.setFontSize(7);
          doc.setFont("helvetica", "bold");
          doc.text("ATTENDANCE", col2X, y2);
          y2 += 4;

          const outOfText = " out of ";
          doc.setFont("helvetica", "normal");
          const outOfWidth = doc.getTextWidth(outOfText);
          const lineLength = (colWidth - outOfWidth - 2) / 2;

          doc.setLineWidth(0.1);
          doc.setLineDashPattern([], 0);

          // Field 1
          doc.line(col2X, y2, col2X + lineLength, y2);
          if (attendancePresent) {
            doc.text(attendancePresent, col2X + lineLength / 2, y2 - 1, {
              align: "center",
            });
          }

          // Separator
          doc.text(outOfText, col2X + lineLength + 1, y2);

          // Field 2
          const startX2 = col2X + lineLength + 1 + outOfWidth + 1;
          doc.line(startX2, y2, startX2 + lineLength, y2);
          if (attendanceTotal) {
            doc.text(attendanceTotal, startX2 + lineLength / 2, y2 - 1, {
              align: "center",
            });
          }

          y2 += 8;

          // Talent
          doc.setFont("helvetica", "bold");
          doc.text("TALENT & INTEREST", col2X, y2);
          y2 += 4;
          doc.setFont("helvetica", "normal");
          const talentText =
            talentRemark === "Other" && talentRemarkOther
              ? talentRemarkOther
              : talentRemark || "";

          if (talentText) {
            const splitTalent = doc.splitTextToSize(talentText, colWidth);
            doc.text(splitTalent, col2X, y2);
            doc.line(col2X, y2 + 1, col2X + colWidth, y2 + 1);
            y2 += Math.max(splitTalent.length * 5, 8);
            doc.line(col2X, y2, col2X + colWidth, y2);
            y2 += 5;
          } else {
            for (let i = 0; i < 3; i++) {
              doc.line(col2X, y2 + i * 6, col2X + colWidth, y2 + i * 6);
            }
            y2 += 18;
          }
          y2 += 4;

          // Class Teacher Remark
          doc.setFont("helvetica", "bold");
          doc.text("CLASS TEACHER'S REMARK", col2X, y2);
          y2 += 4;
          doc.setFont("helvetica", "normal");
          const teacherText =
            teacherRemark === "Other" && teacherRemarkOther
              ? teacherRemarkOther
              : teacherRemark || "";

          if (teacherText) {
            const splitTeacher = doc.splitTextToSize(teacherText, colWidth);
            doc.text(splitTeacher, col2X, y2);
            doc.line(col2X, y2 + 1, col2X + colWidth, y2 + 1);
            y2 += Math.max(splitTeacher.length * 5, 8);
            doc.line(col2X, y2, col2X + colWidth, y2);
            y2 += 5;
            doc.line(col2X, y2, col2X + colWidth, y2);
            y2 += 5;
          } else {
            for (let i = 0; i < 4; i++) {
              doc.line(col2X, y2 + i * 6, col2X + colWidth, y2 + i * 6);
            }
            y2 += 24;
          }

          // --- Column 3: Head Teacher ---
          let y3 = baseY;
          doc.setFont("helvetica", "bold");
          doc.text("HEAD TEACHER", col3X, y3);
          y3 += 8;

          // Signature
          if (schoolConfig.signatureEnabled && headSignatureDataUrl) {
            const fmt: "JPEG" | "PNG" = headSignatureDataUrl.startsWith(
              "data:image/jpeg",
            )
              ? "JPEG"
              : "PNG";
            doc.addImage(headSignatureDataUrl, fmt, col3X + 10, y3, 30, 15);
          }
          y3 += 20;

          // Name
          doc.setFontSize(8);
          doc.text(schoolConfig.headTeacher, col3X, y3);
          doc.line(col3X, y3 + 1, col3X + colWidth, y3 + 1);
          y3 += 8;

          // Date
          doc.text(`Date: ${new Date().toLocaleDateString()}`, col3X, y3);
          doc.line(col3X + 8, y3 + 1, col3X + colWidth, y3 + 1);
        });

        if (studentId) {
          doc.autoPrint();
          window.open(doc.output("bloburl"), "_blank");
        } else {
          doc.save(`Reports_${selectedClass}_${term}.pdf`);
        }
      } catch (e) {
        logger.error("PDF generation failed", e);
      } finally {
        setIsGeneratingDoc(false);
        setDocStatus("");
      }
    }, 500);
  };

  if (!student)
    return (
      <div className="p-8 text-center">
        No Active Students to Report
        <div
          data-testid="headmaster-underscores"
          className="text-base font-semibold mt-4"
        >
          {"_".repeat(100)}
        </div>
        <div className="mt-6 bg-white p-6 rounded-lg border border-slate-200 max-w-4xl mx-auto text-left">
          <h3 className="text-lg font-bold text-slate-800 mb-4">
            Grading Overview
          </h3>
          <div className="mt-4 text-xs text-slate-600">
            <div className="font-semibold mb-2">Grading Scale</div>
          </div>
        </div>
      </div>
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
          className="flex items-center gap-2 px-3 py-2 bg-white border border-blue-200 text-blue-700 hover:bg-blue-50 rounded-lg text-sm font-medium transition-colors"
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
          className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white hover:bg-blue-700 rounded-lg text-sm font-medium shadow-sm hover:shadow transition-all"
        >
          {isGeneratingDoc ? (
            <Loader2 size={16} className="animate-spin" />
          ) : (
            <Database size={16} />
          )}
          <span>Batch Print ({filteredStudents.length})</span>
        </button>
      </div>

      {docStatus && (
        <div className="bg-blue-50 text-blue-700 px-4 py-2 rounded-lg text-sm text-center animate-pulse">
          {docStatus}
        </div>
      )}

      <div className="bg-white p-8 shadow-lg border border-slate-200 min-h-[800px]">
        <div className="text-center mb-6 relative">
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
          <h1 className="text-3xl font-black text-slate-900 uppercase tracking-widest px-4">
            {schoolConfig.name}
          </h1>
          <p className="text-sm text-slate-600 mt-1 px-4">
            {schoolConfig.address}
          </p>
          <p className="text-base italic font-serif text-slate-700 mt-2 px-4 uppercase tracking-widest">
            "{schoolConfig.motto}"
          </p>
          <div className="border-b border-slate-800 my-4"></div>
          <h2 className="text-2xl font-bold text-slate-900 uppercase tracking-widest py-2">
            TERMINAL REPORT
          </h2>
          <div className="border-b border-slate-800 mb-6"></div>
        </div>

        <div className="mb-6 print:hidden">
          <ProgressBar
            scope="class"
            className={selectedClass}
            academicYear={academicYear}
            term={term}
          />
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
            <span className="font-bold text-slate-500">DOB:</span> {student.dob}
          </div>
          <div>
            <span className="font-bold text-slate-500">Contact:</span>{" "}
            {student.guardianContact}
          </div>
        </div>
        <div className="overflow-x-auto">
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
                <th className="border border-slate-300 p-2 text-center bg-blue-50">
                  Class Avg
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
                        colSpan={7}
                        className="border border-slate-300 p-2 text-center text-slate-400"
                      >
                        Not Graded
                      </td>
                    </tr>
                  );
                const rawSBA =
                  ((m.cat1 + m.cat2 + m.group + m.project) / 60) *
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
                    <td className="border border-slate-300 p-2 text-center text-xs bg-blue-50 font-semibold text-slate-600">
                      {subjectStats[subj]?.avg || "-"}
                    </td>
                    <td className="border border-slate-300 p-2 text-center text-xs">
                      {subjectStats[subj]?.rank || "-"}
                    </td>
                    <td className="border border-slate-300 p-2 text-xs">
                      {g.desc}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <div className="mt-6 bg-white p-6 rounded-lg border border-slate-200">
          <h3 className="text-lg font-bold text-slate-800 mb-6 border-b border-slate-100 pb-4">
            Report Overview
          </h3>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
            {/* Column 1: Grading System */}
            <div className="flex flex-col space-y-4">
              <div className="font-bold text-slate-700 text-sm uppercase tracking-wider border-b-2 border-slate-100 pb-2">
                Grading System
              </div>
              <div className="flex-1">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="text-left text-slate-500 border-b border-slate-100">
                      <th className="pb-2 font-semibold">Grade</th>
                      <th className="pb-2 font-semibold">Range</th>
                      <th className="pb-2 font-semibold">Remark</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-50">
                    {gradingSystem.map((band) => (
                      <tr key={`${band.grade}-${band.min}`}>
                        <td className="py-2 font-bold text-slate-700">
                          {band.grade}
                        </td>
                        <td className="py-2 text-slate-600">
                          {band.min} – {band.max}
                        </td>
                        <td className="py-2 text-slate-600">{band.desc}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Column 2: Student Report */}
            <div className="flex flex-col space-y-4">
              <div className="font-bold text-slate-700 text-sm uppercase tracking-wider border-b-2 border-slate-100 pb-2">
                Student Report
              </div>

              <div className="space-y-4 flex-1">
                {/* Attendance */}
                <div
                  className={`bg-slate-50 p-3 rounded border border-slate-100 relative ${
                    user?.role === "CLASS"
                      ? "cursor-not-allowed opacity-80"
                      : ""
                  }`}
                  onClickCapture={(e) => {
                    if (user?.role === "CLASS") {
                      e.stopPropagation();
                      alert(
                        "Access Denied: You do not have permission to edit Attendance.",
                      );
                    }
                  }}
                  title={
                    user?.role === "CLASS"
                      ? "View Only: Attendance is managed by Administration"
                      : "Attendance"
                  }
                >
                  <div className="text-xs font-semibold text-slate-600 mb-2">
                    ATTENDANCE
                  </div>
                  <div className="flex items-end gap-2 text-xs text-slate-600 justify-center">
                    <input
                      type="number"
                      min="0"
                      className={`w-16 border-b border-slate-400 bg-transparent text-center focus:outline-none focus:border-blue-500 px-1 ${
                        user?.role === "CLASS" ? "pointer-events-none" : ""
                      }`}
                      placeholder="0"
                      value={attendancePresent}
                      onChange={(e) => setAttendancePresent(e.target.value)}
                      aria-label="Days present"
                      readOnly={user?.role === "CLASS"}
                      tabIndex={user?.role === "CLASS" ? -1 : 0}
                    />
                    <span className="mb-1 font-medium">out of</span>
                    <input
                      type="number"
                      min="0"
                      className={`w-16 border-b border-slate-400 bg-transparent text-center focus:outline-none focus:border-blue-500 px-1 ${
                        user?.role === "CLASS" ? "pointer-events-none" : ""
                      }`}
                      placeholder="0"
                      value={attendanceTotal}
                      onChange={(e) => setAttendanceTotal(e.target.value)}
                      aria-label="Total days"
                      readOnly={user?.role === "CLASS"}
                      tabIndex={user?.role === "CLASS" ? -1 : 0}
                    />
                  </div>
                  {Number(attendancePresent) && Number(attendanceTotal) ? (
                    <div className="text-center mt-1">
                      <span className="text-[10px] font-bold text-slate-500 bg-slate-100 px-2 py-0.5 rounded-full">
                        {(
                          (Number(attendancePresent) /
                            Number(attendanceTotal)) *
                          100
                        ).toFixed(0)}
                        %
                      </span>
                    </div>
                  ) : null}
                </div>

                {/* Talent & Interest */}
                <div className="bg-slate-50 p-3 rounded border border-slate-100">
                  <div className="text-xs font-semibold text-slate-600 mb-2">
                    TALENT & INTEREST
                  </div>
                  <div className="space-y-2">
                    <label htmlFor="talent-remark" className="sr-only">
                      Talent and interest remark
                    </label>
                    <select
                      id="talent-remark"
                      value={talentRemark}
                      onChange={(e) => {
                        setTalentRemark(e.target.value);
                        setTalentRemarkError(
                          e.target.value ? null : "Required",
                        );
                      }}
                      className={`w-full text-xs border rounded p-1.5 bg-white ${
                        talentRemarkError
                          ? "border-red-500"
                          : "border-slate-300"
                      }`}
                    >
                      <option value="">Select a remark...</option>
                      {talentRemarkOptionsGrouped.map((g) => (
                        <optgroup key={g.group} label={g.group}>
                          {g.options.map((opt) => (
                            <option
                              key={`${g.group}-${opt}`}
                              value={opt}
                              title={opt}
                            >
                              {opt}
                            </option>
                          ))}
                        </optgroup>
                      ))}
                    </select>
                    {talentRemark === "Other" && (
                      <input
                        value={talentRemarkOther}
                        onChange={(e) => {
                          setTalentRemarkOther(e.target.value);
                          setTalentRemarkError(
                            e.target.value.length >= 20
                              ? null
                              : "Minimum 20 characters",
                          );
                        }}
                        className={`w-full text-xs border rounded p-1.5 ${
                          talentRemarkError
                            ? "border-red-500"
                            : "border-slate-300"
                        }`}
                        placeholder="Specify (min 20 chars)..."
                        aria-label="Custom talent remark"
                      />
                    )}
                  </div>
                </div>

                {/* Teacher's Remark */}
                <div className="bg-slate-50 p-3 rounded border border-slate-100">
                  <div className="text-xs font-semibold text-slate-600 mb-2">
                    TEACHER'S REMARK
                  </div>
                  <div className="space-y-2">
                    <label htmlFor="teacher-remark" className="sr-only">
                      Teacher remark
                    </label>
                    <select
                      id="teacher-remark"
                      value={teacherRemark}
                      onChange={(e) => {
                        setTeacherRemark(e.target.value);
                        setTeacherRemarkError(
                          e.target.value ? null : "Required",
                        );
                      }}
                      className="w-full text-xs border border-slate-300 rounded p-1.5 bg-white"
                    >
                      <option value="">Select a remark...</option>
                      {teacherRemarkOptions.map((opt) => (
                        <option key={opt} value={opt} title={opt}>
                          {opt}
                        </option>
                      ))}
                    </select>
                    {teacherRemark === "Other" && (
                      <input
                        value={teacherRemarkOther}
                        onChange={(e) => setTeacherRemarkOther(e.target.value)}
                        className="w-full text-xs border border-slate-300 rounded p-1.5"
                        placeholder="Specify other..."
                        aria-label="Custom teacher remark"
                      />
                    )}
                  </div>
                </div>

                {/* Save Button */}
                {hasTalentChanges && (
                  <div className="flex justify-end gap-2 pt-2 animate-in fade-in slide-in-from-top-2">
                    <button
                      onClick={handleCancelTalent}
                      disabled={isTalentSaving}
                      className="text-xs px-3 py-1.5 text-slate-600 hover:text-slate-800 font-medium"
                    >
                      Cancel
                    </button>
                    <button
                      id="save-talent-btn"
                      onClick={handleSaveTalent}
                      disabled={isTalentSaving}
                      className="text-xs px-3 py-1.5 bg-blue-600 text-white rounded hover:bg-blue-700 font-medium flex items-center gap-1 disabled:opacity-50"
                    >
                      {isTalentSaving ? (
                        <Loader2 size={12} className="animate-spin" />
                      ) : null}
                      Save Changes
                    </button>
                  </div>
                )}
              </div>
            </div>

            {/* Column 3: Head Teacher */}
            <div className="flex flex-col space-y-4">
              <div className="font-bold text-slate-700 text-sm uppercase tracking-wider border-b-2 border-slate-100 pb-2">
                Head Teacher
              </div>
              <div className="flex-1 flex flex-col justify-between">
                <div className="space-y-6">
                  <div className="text-center p-4 border-2 border-dashed border-slate-200 rounded-lg bg-slate-50">
                    {schoolConfig.signatureEnabled && headSignatureDataUrl ? (
                      <img
                        src={headSignatureDataUrl}
                        alt="Head Signature"
                        className="max-h-16 mx-auto object-contain"
                      />
                    ) : (
                      <div className="h-16 flex items-center justify-center text-slate-400 italic text-xs">
                        {schoolConfig.signatureEnabled
                          ? "No signature uploaded"
                          : "Digital signature disabled"}
                      </div>
                    )}
                  </div>
                  <div>
                    <div className="text-xs font-bold text-slate-700 uppercase">
                      {schoolConfig.headTeacher}
                    </div>
                    <div className="text-[10px] text-slate-500 uppercase">
                      Head Teacher
                    </div>
                  </div>
                  <div>
                    <div className="text-xs font-bold text-slate-700">
                      {new Date().toLocaleDateString()}
                    </div>
                    <div className="text-[10px] text-slate-500 uppercase">
                      Date
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default ReportCards;
