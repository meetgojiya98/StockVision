import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App.jsx';
import './index.css';

class AppErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  componentDidCatch(error) {
    console.error('StockVision runtime error:', error);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div
          style={{
            minHeight: '100vh',
            display: 'grid',
            placeItems: 'center',
            padding: '24px',
            color: '#f4f7ff',
            background:
              'radial-gradient(1300px 700px at 12% -10%, rgba(83, 163, 255, 0.34), transparent 55%), #060f26',
            fontFamily: 'Space Grotesk, sans-serif',
          }}
        >
          <div
            style={{
              maxWidth: '720px',
              border: '1px solid rgba(134, 173, 255, 0.28)',
              borderRadius: '16px',
              padding: '18px',
              background: 'rgba(10, 24, 57, 0.72)',
            }}
          >
            <h2 style={{ margin: 0 }}>App failed to render</h2>
            <p style={{ marginBottom: 0 }}>
              Refresh once. If it persists, open DevTools Console and share the error so it can be fixed quickly.
            </p>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <AppErrorBoundary>
      <App />
    </AppErrorBoundary>
  </React.StrictMode>
);
