import React, { useEffect, useState } from "react";
import { AlertCircle, CheckCircle } from "lucide-react";

interface ProgressProps {
  scope: "subject" | "class";
  className: string;
  subjectName?: string;
  academicYear: string;
  term: string;
}

interface ProgressData {
  progress: number;
  total: number;
  completed: number;
  incomplete: { id: string; name: string }[];
}

const ProgressBar: React.FC<ProgressProps> = ({
  scope,
  className,
  subjectName,
  academicYear,
  term,
}) => {
  const [data, setData] = useState<ProgressData | null>(null);
  const [showDetails, setShowDetails] = useState(false);

  const fetchProgress = async () => {
    if (!academicYear || !term || !className) return;
    if (scope === "subject" && !subjectName) return;

    // Don't show loading spinner for background polls to avoid flickering
    // setLoading(true);

    try {
      const params = new URLSearchParams({
        scope,
        className,
        academicYear,
        term,
      });
      if (subjectName) params.append("subjectName", subjectName);

      const res = await fetch(`/api/progress?${params}`, {
        headers: {
          Authorization: `Bearer ${localStorage.getItem("token")}`,
        },
      });

      if (res.ok) {
        const json = await res.json();
        setData(json);
      }
    } catch (e) {
      console.error("Failed to fetch progress", e);
    }
  };

  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      await fetchProgress();
    };

    load();

    const timer = setInterval(() => {
      if (!cancelled) {
        void fetchProgress();
      }
    }, 30000);

    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [scope, className, subjectName, academicYear, term]);

  if (!data) return null;

  const getColor = (p: number) => {
    if (p < 30) return "bg-red-500";
    if (p < 70) return "bg-yellow-500";
    return "bg-green-500";
  };

  const widthClasses = [
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

  const getWidthClass = (p: number) => {
    const clamped = Math.max(0, Math.min(100, Math.round(p)));
    const index = Math.min(widthClasses.length - 1, Math.round(clamped / 5));
    return widthClasses[index];
  };

  return (
    <div className="bg-white p-4 rounded-lg shadow-sm mb-4 border border-slate-200">
      <div className="flex items-center justify-between mb-2">
        <h3 className="font-semibold text-slate-700 flex items-center gap-2">
          {scope === "subject"
            ? `${subjectName} Progress`
            : "Class Reports Progress"}
        </h3>
        <span className="text-sm font-medium text-slate-600">
          {data.completed} / {data.total} Students ({data.progress}%)
        </span>
      </div>

      <div className="w-full bg-slate-100 rounded-full h-3 mb-2 overflow-hidden">
        <div
          className={`h-3 rounded-full transition-all duration-500 ${getColor(
            data.progress
          )} ${getWidthClass(data.progress)}`}
        />
      </div>

      <div className="flex justify-between items-center">
        <div className="text-xs text-slate-500">
          Last updated: {new Date().toLocaleTimeString()}
        </div>
        <button
          onClick={() => setShowDetails(!showDetails)}
          className="text-xs text-blue-600 hover:text-blue-800 font-medium"
        >
          {showDetails ? "Hide Details" : "Show Incomplete Students"}
        </button>
      </div>

      {showDetails && data.incomplete.length > 0 && (
        <div className="mt-3 p-3 bg-slate-50 rounded border border-slate-200">
          <h4 className="text-xs font-semibold text-slate-700 mb-2">
            Pending Students ({data.incomplete.length})
          </h4>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
            {data.incomplete.map((s) => (
              <div
                key={s.id}
                className="text-xs text-slate-600 flex items-center gap-1"
              >
                <AlertCircle className="w-3 h-3 text-amber-500" />
                {s.name}
              </div>
            ))}
          </div>
        </div>
      )}

      {showDetails && data.incomplete.length === 0 && (
        <div className="mt-3 p-3 bg-green-50 rounded border border-green-200 text-xs text-green-700 flex items-center gap-2">
          <CheckCircle className="w-4 h-4" />
          All students completed!
        </div>
      )}
    </div>
  );
};

export default ProgressBar;
