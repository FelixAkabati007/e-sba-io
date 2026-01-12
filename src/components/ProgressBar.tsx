import React, { useEffect, useState } from "react";
import { Loader2, AlertCircle, CheckCircle } from "lucide-react";
import { useAuth } from "../context/AuthContext";

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
  const { user } = useAuth();
  const [data, setData] = useState<ProgressData | null>(null);
  const [loading, setLoading] = useState(false);
  const [showDetails, setShowDetails] = useState(false);

  const fetchProgress = async (signal?: AbortSignal) => {
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
        signal,
      });

      if (res.ok) {
        const json = await res.json();
        setData(json);
      }
    } catch (e) {
      if ((e as Error).name === "AbortError") return;
      console.error("Failed to fetch progress", e);
    }
  };

  useEffect(() => {
    const controller = new AbortController();
    fetchProgress(controller.signal);

    // Poll every 30 seconds
    const timer = setInterval(() => {
      // Create new controller for each poll if needed, or just ignore signal for intervals?
      // Actually, interval fetches can also be aborted on unmount.
      // But we can't pass the *same* signal to multiple fetches if one is aborted?
      // Wait, the signal is for the *current* fetch.
      // If we unmount, we want to abort *any* pending fetch.
      // So we should use one controller for the effect lifecycle.
      fetchProgress(controller.signal);
    }, 30000);

    return () => {
      controller.abort();
      clearInterval(timer);
    };
  }, [scope, className, subjectName, academicYear, term]);

  if (!data) return null;

  // Determine color based on percentage
  const getColor = (p: number) => {
    if (p < 30) return "bg-red-500";
    if (p < 70) return "bg-yellow-500";
    return "bg-green-500";
  };

  return (
    <div className="bg-white p-4 rounded-lg shadow-sm mb-4 border border-slate-200">
      <div className="flex items-center justify-between mb-2">
        <h3 className="font-semibold text-slate-700 flex items-center gap-2">
          {scope === "subject"
            ? `${subjectName} Progress`
            : "Class Reports Progress"}
          {loading && (
            <Loader2 className="w-4 h-4 animate-spin text-slate-400" />
          )}
        </h3>
        <span className="text-sm font-medium text-slate-600">
          {data.completed} / {data.total} Students ({data.progress}%)
        </span>
      </div>

      <div className="w-full bg-slate-100 rounded-full h-3 mb-2">
        <div
          className={`h-3 rounded-full transition-all duration-500 ${getColor(
            data.progress
          )}`}
          style={{ width: `${data.progress}%` }}
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
