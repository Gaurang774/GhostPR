import React from 'react';
import type { AgentAction } from '@GhostPR/shared-types';

interface AgentLogProps {
  logs: AgentAction[];
}

export function AgentLog({ logs }: AgentLogProps) {
  if (!logs || logs.length === 0) {
    return (
      <div className="empty-logs">
        <p>No agent interaction logs recorded for this decision yet.</p>
      </div>
    );
  }

  const formatTime = (isoString: string) => {
    return new Date(isoString).toLocaleString('en-US', {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
  };

  const getActionStyles = (action: string) => {
    switch (action) {
      case 'accepted':
        return { color: 'var(--status-active)', bg: 'var(--status-active-bg)' };
      case 'ignored':
        return { color: 'var(--status-deprecated)', bg: 'var(--status-deprecated-bg)' };
      case 'shown':
        return { color: 'var(--accent-secondary)', bg: 'rgba(168, 85, 247, 0.1)' };
      case 'retrieved':
      default:
        return { color: 'var(--accent-primary)', bg: 'rgba(99, 102, 241, 0.1)' };
    }
  };

  return (
    <div className="agent-timeline">
      {logs.map((log, index) => {
        const styles = getActionStyles(log.action);
        return (
          <div key={index} className="timeline-item fade-in">
            <div className="timeline-badge-container">
              <div
                className="timeline-badge"
                style={{
                  color: styles.color,
                  backgroundColor: styles.bg,
                  borderColor: styles.color,
                }}
              >
                <span className="timeline-dot" style={{ backgroundColor: styles.color }}></span>
              </div>
              {index < logs.length - 1 && <div className="timeline-connector"></div>}
            </div>

            <div className="timeline-content">
              <div className="timeline-header">
                <span
                  className="timeline-action-label"
                  style={{
                    color: styles.color,
                    backgroundColor: styles.bg,
                    borderColor: 'rgba(255, 255, 255, 0.05)',
                  }}
                >
                  {log.action}
                </span>
                <span className="timeline-time mono-text">{formatTime(log.timestamp)}</span>
              </div>
              <p className="timeline-result">{log.result}</p>
            </div>
          </div>
        );
      })}
    </div>
  );
}
