import React, { useState } from "react";
import { LogOut } from "lucide-react";

interface SignOutButtonProps {
  onLogout: () => void;
}

const SignOutButton: React.FC<SignOutButtonProps> = ({ onLogout }) => {
  const [showConfirm, setShowConfirm] = useState(false);

  const handleLogoutClick = () => {
    setShowConfirm(true);
  };

  const confirmLogout = () => {
    setShowConfirm(false);
    onLogout();
  };

  return (
    <>
      <button
        onClick={handleLogoutClick}
        className="flex items-center gap-2 bg-slate-800 hover:bg-slate-700 text-slate-200 hover:text-white px-3 py-2 rounded-lg transition-all duration-200 text-sm font-medium focus:outline-none focus:ring-2 focus:ring-slate-500 focus:ring-offset-2 focus:ring-offset-slate-900 border border-slate-700"
        aria-label="Sign Out"
        title="Sign Out"
      >
        <LogOut size={18} />
        <span className="hidden sm:inline">Sign Out</span>
      </button>

      {showConfirm && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm animate-in fade-in duration-200">
          <div 
            className="bg-white rounded-xl shadow-2xl w-full max-w-sm overflow-hidden transform scale-100 transition-all"
            role="dialog"
            aria-modal="true"
            aria-labelledby="logout-title"
          >
            <div className="p-6 text-center">
              <div className="mx-auto bg-red-100 w-16 h-16 rounded-full flex items-center justify-center mb-4">
                <LogOut className="text-red-600 w-8 h-8" />
              </div>
              <h3 id="logout-title" className="text-xl font-bold text-slate-800 mb-2">
                Sign Out
              </h3>
              <p className="text-slate-600 mb-8 text-sm">
                Are you sure you want to end your current session?
              </p>
              <div className="flex gap-3 justify-center">
                <button
                  onClick={() => setShowConfirm(false)}
                  className="flex-1 px-4 py-2.5 bg-slate-100 text-slate-700 rounded-lg hover:bg-slate-200 font-medium transition-colors focus:ring-2 focus:ring-slate-300 outline-none"
                >
                  Cancel
                </button>
                <button
                  onClick={confirmLogout}
                  className="flex-1 px-4 py-2.5 bg-red-600 text-white rounded-lg hover:bg-red-700 font-medium transition-colors shadow-sm focus:ring-2 focus:ring-red-500 outline-none"
                >
                  Sign Out
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
};

export default SignOutButton;
