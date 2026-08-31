import { Component, type ReactNode } from 'react'

type Props = { children: ReactNode; title: string; message: string; retry: string }
type State = { failed: boolean }

/** Gives lazy-route/chunk failures a recoverable, localized fallback. */
export class RouteErrorBoundary extends Component<Props, State> {
  state: State = { failed: false }

  static getDerivedStateFromError(): State {
    return { failed: true }
  }

  render() {
    if (!this.state.failed) return this.props.children
    return (
      <main className="route-loading" role="alert">
        <h1>{this.props.title}</h1>
        <p>{this.props.message}</p>
        <button className="button button-primary" type="button" onClick={() => window.location.reload()}>{this.props.retry}</button>
      </main>
    )
  }
}
