import { Component, type ReactNode } from "react";

interface State {
  error: Error | null;
}

/** Shows a message instead of a blank window if rendering ever crashes. */
export class ErrorBoundary extends Component<{ children: ReactNode }, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <main className="state" style={{ height: "100%" }}>
        <h2>Something went wrong</h2>
        <p>{this.state.error.message}</p>
        <div>
          <button
            type="button"
            className="btn"
            onClick={() => window.location.reload()}
          >
            Reload Fogtrail
          </button>
        </div>
      </main>
    );
  }
}
