import { Component, type ErrorInfo, type ReactNode } from "react";

type Props = { children: ReactNode; inline?: boolean };
type State = { error: Error | null };

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("app crash", error, info.componentStack);
  }

  render() {
    if (!this.state.error) return this.props.children;
    if (this.props.inline) {
      return (
        <div className="space-y-4 rounded-xl border bg-card p-6">
          <h1 className="font-display text-xl font-semibold">This page could not load</h1>
          <p className="text-sm text-muted-foreground">Try again, or pick another page from the menu.</p>
          <pre className="max-h-40 overflow-auto rounded-md bg-muted p-3 text-xs">{this.state.error.message}</pre>
          <button
            type="button"
            className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground"
            onClick={() => window.location.reload()}
          >
            Reload
          </button>
        </div>
      );
    }
    return (
      <div className="flex min-h-screen items-center justify-center bg-background px-6">
        <div className="w-full max-w-lg space-y-4 rounded-xl border bg-card p-6">
          <h1 className="font-display text-xl font-semibold">Something went wrong</h1>
          <p className="text-sm text-muted-foreground">
            The portal hit an unexpected error. Reload to try again.
          </p>
          <pre className="max-h-40 overflow-auto rounded-md bg-muted p-3 text-xs">{this.state.error.message}</pre>
          <button
            type="button"
            className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground"
            onClick={() => window.location.reload()}
          >
            Reload
          </button>
        </div>
      </div>
    );
  }
}
