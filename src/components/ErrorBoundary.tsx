import { Component, type ErrorInfo, type ReactNode } from "react";

interface Props {
  children: ReactNode;
}

interface State {
  message: string | null;
}

/**
 * A render throw during a live presentation must not blank the screen. Show the message
 * instead — it is more useful on stage than a white page, and recoverable by reload.
 */
export class ErrorBoundary extends Component<Props, State> {
  public override state: State = { message: null };

  public static getDerivedStateFromError(error: unknown): State {
    return { message: error instanceof Error ? error.message : String(error) };
  }

  public override componentDidCatch(error: Error, info: ErrorInfo): void {
    // Keep the stack reachable for post-demo debugging without a console statement in
    // the happy path.
    this.setState({ message: `${error.message}\n${info.componentStack ?? ""}`.trim() });
  }

  public override render(): ReactNode {
    if (this.state.message === null) return this.props.children;
    return (
      <section className="panel">
        <h2>Something threw while rendering</h2>
        <p className="muted">Reload the page. If it repeats, run `bun run verify`, which names the broken assumption.</p>
        <pre className="mono dim">{this.state.message}</pre>
      </section>
    );
  }
}
