import { Component, type ReactNode } from "react";
import { reportError } from "../lib/report";

/** If a screen crashes, show a calm message with a way out instead of a blank screen, and send a report. */
export class ErrorBoundary extends Component<{ children: ReactNode; resetKey?: string; onHome?: () => void }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  componentDidCatch(error: Error, info: { componentStack?: string | null }) {
    const e = new Error(error.message);
    e.stack = `${error.stack ?? ""}\n${info.componentStack ?? ""}`;
    reportError(e, "screen");
  }
  // Going to another screen clears the error.
  componentDidUpdate(prev: { resetKey?: string }) {
    if (this.state.failed && prev.resetKey !== this.props.resetKey) this.setState({ failed: false });
  }
  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <div className="screen" role="alert" style={{ display: "flex", flexDirection: "column", justifyContent: "center", minHeight: "70%" }}>
        <div className="empty-card stack" style={{ alignItems: "center", textAlign: "center" }}>
          <b style={{ fontSize: 17 }}>Something went wrong on this screen</b>
          <span className="muted">We've been told about it. Your orders and money are safe.</span>
          <div className="row" style={{ gap: 8, marginTop: 6 }}>
            <button className="btn" onClick={() => this.setState({ failed: false })}>Try again</button>
            <button className="btn green" onClick={() => { this.setState({ failed: false }); this.props.onHome ? this.props.onHome() : window.location.assign("/"); }}>Go home</button>
          </div>
        </div>
      </div>
    );
  }
}
