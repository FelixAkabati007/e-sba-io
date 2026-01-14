import React from "react";
import { ArrowLeft, Download, Printer } from "lucide-react";
import { RankingRow, RankingData } from "../lib/apiTypes";

interface RankingReportProps {
  rankingData: RankingData | RankingRow[];
  rankingLoading: boolean;
  rankingError: string | null;
  rankingClassFilter: string;
  setRankingClassFilter: (value: string) => void;
  rankingPage: number;
  setRankingPage: (page: number) => void;
  onBack: () => void;
  onDownload: () => void;
}

export const RankingReport: React.FC<RankingReportProps> = ({
  rankingData,
  rankingLoading,
  rankingError,
  rankingClassFilter,
  setRankingClassFilter,
  rankingPage,
  setRankingPage,
  onBack,
  onDownload,
}) => {
  const raw = rankingData as unknown;
  const rows: RankingRow[] = Array.isArray(raw)
    ? (raw as RankingRow[])
    : Array.isArray((raw as { data?: RankingRow[] }).data)
    ? ((raw as { data?: RankingRow[] }).data as RankingRow[])
    : [];

  void raw;

  return (
    <div className="space-y-6 animate-in fade-in duration-500">
      <div className="bg-white p-6 rounded-lg shadow-sm border border-slate-200">
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-4">
            <button
              onClick={onBack}
              className="p-2 hover:bg-slate-100 rounded-full transition-colors"
              title="Back to Dashboard"
            >
              <ArrowLeft size={24} className="text-slate-600" />
            </button>
            <div>
              <h2 className="text-2xl font-bold text-slate-800">
                Student Ranking Report
              </h2>
              <p className="text-slate-500 text-sm">
                Comprehensive performance analysis across streams
              </p>
            </div>
          </div>

          <div className="flex gap-4">
            <select
              value={rankingClassFilter}
              onChange={(e) => {
                setRankingClassFilter(e.target.value);
                setRankingPage(1);
              }}
              className="p-2 border border-slate-300 rounded-md bg-slate-50"
              title="Filter by Class"
            >
              <option value="JHS 1">JHS 1 (All Streams)</option>
              <option value="JHS 2">JHS 2 (All Streams)</option>
              <option value="JHS 3">JHS 3 (All Streams)</option>
            </select>
            <button
              onClick={onDownload}
              className="flex items-center gap-2 bg-indigo-600 text-white px-4 py-2 rounded-lg hover:bg-indigo-700 transition-colors"
            >
              <Download size={18} /> Download PDF
            </button>
            <button
              onClick={() => window.print()}
              className="flex items-center gap-2 bg-slate-800 text-white px-4 py-2 rounded-lg hover:bg-slate-900 transition-colors"
            >
              <Printer size={18} /> Print Report
            </button>
          </div>
        </div>

        {rankingError && (
          <div className="mb-4 p-3 rounded-md bg-red-50 text-red-700 text-sm border border-red-100">
            {rankingError.includes("Access denied")
              ? "Access denied. Only Head Teacher accounts can view rankings."
              : rankingError}
          </div>
        )}

        <div className="overflow-x-auto">
          <table className="w-full border-collapse">
            <thead>
              <tr className="bg-slate-50 border-b border-slate-200">
                <th className="p-3 text-left font-semibold text-slate-700">
                  Rank
                </th>
                <th className="p-3 text-left font-semibold text-slate-700">
                  Student Name
                </th>
                <th className="p-3 text-left font-semibold text-slate-700">
                  Class
                </th>
                <th className="p-3 text-right font-semibold text-slate-700">
                  Overall Score
                </th>
              </tr>
            </thead>
            <tbody>
              {rankingLoading ? (
                <tr>
                  <td colSpan={4} className="p-8 text-center text-slate-500">
                    Loading rankings...
                  </td>
                </tr>
              ) : rows.length === 0 ? (
                <tr>
                  <td colSpan={4} className="p-8 text-center text-slate-500">
                    No ranking data available for this selection.
                  </td>
                </tr>
              ) : (
                rows.map((s) => (
                  <tr
                    key={s.student_id}
                    className="border-b border-slate-100 hover:bg-slate-50 transition-colors"
                  >
                    <td className="p-3">
                      <span
                        className={`inline-flex items-center justify-center w-8 h-8 rounded-full text-sm font-bold ${
                          s.position <= 3
                            ? "bg-yellow-100 text-yellow-700"
                            : "bg-slate-100 text-slate-600"
                        }`}
                      >
                        {s.position}
                      </span>
                    </td>
                    <td className="p-3 font-medium text-slate-800">
                      {s.surname}, {s.first_name} {s.middle_name}
                    </td>
                    <td className="p-3 text-slate-600">{s.class_name}</td>
                    <td className="p-3 text-right font-mono font-bold text-indigo-600">
                      {s.overall_score.toFixed(2)}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {/* Pagination Controls */}
        <div className="flex items-center justify-between mt-4 pt-4 border-t border-slate-100">
          <div className="text-sm text-slate-500">
            Showing {rows.length} records (Page {rankingPage})
          </div>
          <div className="flex gap-2">
            <button
              disabled={rankingPage === 1 || rankingLoading}
              onClick={() => setRankingPage(Math.max(1, rankingPage - 1))}
              className="px-3 py-1 border border-slate-300 rounded hover:bg-slate-50 disabled:opacity-50"
            >
              Previous
            </button>
            <button
              disabled={rows.length < 50 || rankingLoading}
              onClick={() => setRankingPage(rankingPage + 1)}
              className="px-3 py-1 border border-slate-300 rounded hover:bg-slate-50 disabled:opacity-50"
            >
              Next
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
