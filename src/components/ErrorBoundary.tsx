import React from "react";

type Props = { children: React.ReactNode };
type State = { hasError: boolean };

export class ErrorBoundary extends React.Component<Props, State> {
  state: State = { hasError: false };

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen grid place-items-center bg-slate-100">
          <div className="bg-white p-6 rounded shadow border">
            <h1 className="text-xl font-bold">Something went wrong</h1>
            <p className="text-slate-600">Please refresh the page.</p>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
