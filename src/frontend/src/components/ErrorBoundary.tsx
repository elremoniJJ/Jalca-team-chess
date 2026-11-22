import { Component, type ErrorInfo, type ReactNode } from "react";

interface ErrorBoundaryProps {
  children: ReactNode;
}

interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
  componentStack: string | null;
}

export class ErrorBoundary extends Component<
  ErrorBoundaryProps,
  ErrorBoundaryState
> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false, error: null, componentStack: null };
  }

  static getDerivedStateFromError(error: Error): Partial<ErrorBoundaryState> {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    this.setState({ componentStack: info.componentStack ?? null });
    // eslint-disable-next-line no-console
    console.error("ErrorBoundary caught:", error, info);
  }

  handleReload = (): void => {
    window.location.reload();
  };

  render(): ReactNode {
    if (!this.state.hasError) {
      return this.props.children;
    }

    const { error, componentStack } = this.state;

    return (
      <div
        style={{
          minHeight: "100vh",
          backgroundColor: "#1a1a1a",
          color: "#f5f5f5",
          fontFamily:
            "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
          padding: "2rem",
          display: "flex",
          justifyContent: "center",
          alignItems: "flex-start",
        }}
      >
        <div style={{ maxWidth: "900px", width: "100%" }}>
          <h1
            style={{
              fontSize: "1.75rem",
              fontWeight: 700,
              color: "#ff6b6b",
              marginBottom: "1rem",
            }}
          >
            Something went wrong
          </h1>

          <p style={{ fontSize: "1rem", marginBottom: "1.5rem" }}>
            The application encountered an unexpected error while rendering.
          </p>

          {error?.message && (
            <div style={{ marginBottom: "1.5rem" }}>
              <h2
                style={{
                  fontSize: "0.875rem",
                  textTransform: "uppercase",
                  letterSpacing: "0.05em",
                  color: "#a0a0a0",
                  marginBottom: "0.5rem",
                }}
              >
                Error message
              </h2>
              <pre
                style={{
                  backgroundColor: "#0d0d0d",
                  border: "1px solid #333",
                  borderRadius: "6px",
                  padding: "1rem",
                  whiteSpace: "pre-wrap",
                  wordBreak: "break-word",
                  margin: 0,
                  fontSize: "0.875rem",
                  lineHeight: 1.5,
                }}
              >
                {error.message}
              </pre>
            </div>
          )}

          {error?.stack && (
            <div style={{ marginBottom: "1.5rem" }}>
              <h2
                style={{
                  fontSize: "0.875rem",
                  textTransform: "uppercase",
                  letterSpacing: "0.05em",
                  color: "#a0a0a0",
                  marginBottom: "0.5rem",
                }}
              >
                Stack trace
              </h2>
              <pre
                style={{
                  backgroundColor: "#0d0d0d",
                  border: "1px solid #333",
                  borderRadius: "6px",
                  padding: "1rem",
                  whiteSpace: "pre-wrap",
                  wordBreak: "break-word",
                  margin: 0,
                  fontSize: "0.8125rem",
                  lineHeight: 1.5,
                  maxHeight: "300px",
                  overflow: "auto",
                }}
              >
                {error.stack}
              </pre>
            </div>
          )}

          {componentStack && (
            <div style={{ marginBottom: "1.5rem" }}>
              <h2
                style={{
                  fontSize: "0.875rem",
                  textTransform: "uppercase",
                  letterSpacing: "0.05em",
                  color: "#a0a0a0",
                  marginBottom: "0.5rem",
                }}
              >
                Component stack
              </h2>
              <pre
                style={{
                  backgroundColor: "#0d0d0d",
                  border: "1px solid #333",
                  borderRadius: "6px",
                  padding: "1rem",
                  whiteSpace: "pre-wrap",
                  wordBreak: "break-word",
                  margin: 0,
                  fontSize: "0.8125rem",
                  lineHeight: 1.5,
                  maxHeight: "300px",
                  overflow: "auto",
                }}
              >
                {componentStack}
              </pre>
            </div>
          )}

          <button
            type="button"
            onClick={this.handleReload}
            data-ocid="error_boundary.reload_button"
            style={{
              backgroundColor: "#3b82f6",
              color: "#ffffff",
              border: "none",
              borderRadius: "6px",
              padding: "0.625rem 1.25rem",
              fontSize: "0.9375rem",
              fontWeight: 600,
              cursor: "pointer",
              fontFamily: "inherit",
            }}
          >
            Reload
          </button>
        </div>
      </div>
    );
  }
}

export default ErrorBoundary;
