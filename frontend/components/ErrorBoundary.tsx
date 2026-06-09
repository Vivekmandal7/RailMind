"use client";
import { Component, type ReactNode } from "react";
import { isBenignMapNetworkError } from "@/lib/mapNetworkErrors";

interface Props {
  children: ReactNode;
  fallback?: ReactNode;
  onReset?: () => void;
}

interface State {
  error: Error | null;
}

/** Catches transient map/render failures so the control room stays usable. */
export default class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    if (
      error.name === "AbortError" ||
      /aborted/i.test(error.message ?? "") ||
      isBenignMapNetworkError(error)
    ) {
      return { error: null };
    }
    return { error };
  }

  componentDidCatch(error: Error) {
    if (error.name !== "AbortError" && !isBenignMapNetworkError(error)) {
      console.warn("[ErrorBoundary]", error);
    }
  }

  render() {
    if (this.state.error) {
      if (this.props.fallback) return this.props.fallback;
      return (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-base/95 text-muted text-sm">
          <span>Map view encountered an error.</span>
          <button
            type="button"
            className="px-3 py-1.5 rounded-lg border border-cyan/50 text-cyan text-xs hover:bg-cyan/10"
            onClick={() => {
              this.setState({ error: null });
              this.props.onReset?.();
            }}
          >
            Retry map
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
