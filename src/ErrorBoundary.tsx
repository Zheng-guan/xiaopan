import { Component, type ErrorInfo, type ReactNode } from "react";

type ErrorBoundaryProps = {
  children: ReactNode;
};

type ErrorBoundaryState = {
  failed: boolean;
};

export default class ErrorBoundary extends Component<
  ErrorBoundaryProps,
  ErrorBoundaryState
> {
  state: ErrorBoundaryState = { failed: false };

  static getDerivedStateFromError(): ErrorBoundaryState {
    return { failed: true };
  }

  componentDidCatch(error: Error, information: ErrorInfo) {
    console.error("Xiaopan render failure", error, information);
  }

  render() {
    if (!this.state.failed) return this.props.children;

    return (
      <main className="fatal-error" role="alert" aria-labelledby="fatal-error-title">
        <div className="fatal-error-card">
          <span className="fatal-error-mark" aria-hidden="true">小</span>
          <h1 id="fatal-error-title">页面暂时无法显示</h1>
          <p>你的文件没有受到影响。请重新加载页面；如果问题持续出现，可通过页面底部邮箱申报。</p>
          <button type="button" onClick={() => window.location.reload()}>
            重新加载
          </button>
        </div>
      </main>
    );
  }
}
