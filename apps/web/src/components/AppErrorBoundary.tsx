import { Component, type ErrorInfo, type ReactNode } from "react";
import { captureAppException } from "../lib/monitoring";

type Props = { children: ReactNode };
type State = { error: Error | null };

export default class AppErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    captureAppException(error, { componentStack: info.componentStack ?? "" });
  }

  render(): ReactNode {
    if (!this.state.error) return this.props.children;
    const isDev = import.meta.env.DEV;
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50 px-4" data-testid="app-error-boundary">
        <div className="max-w-md w-full space-y-4 p-8 bg-white rounded-lg border border-gray-200 shadow-sm text-center">
          <h1 className="text-xl font-semibold text-gray-900">Something went wrong.</h1>
          <p className="text-sm text-gray-700">Your financial data has not been changed.</p>
          {isDev ? (
            <p className="text-xs text-left text-red-700 whitespace-pre-wrap break-words">
              {this.state.error.message}
            </p>
          ) : null}
          <div className="flex flex-col sm:flex-row gap-3 justify-center">
            <button
              type="button"
              className="py-2 px-4 bg-blue-600 text-white text-sm font-medium rounded hover:bg-blue-700"
              onClick={() => window.location.reload()}
            >
              Reload
            </button>
            <button
              type="button"
              className="py-2 px-4 bg-white text-gray-800 text-sm font-medium rounded border border-gray-300 hover:bg-gray-50"
              onClick={() => {
                window.location.href = "/";
              }}
            >
              Return to Dashboard
            </button>
          </div>
        </div>
      </div>
    );
  }
}
