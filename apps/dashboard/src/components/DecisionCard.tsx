import React from 'react';
import Link from 'next/link';
import type { Decision } from '@GhostPR/shared-types';
import { HealthBadge } from './HealthBadge';

interface DecisionCardProps {
  decision: Decision;
}

export function DecisionCard({ decision }: DecisionCardProps) {
  const {
    id,
    filePath,
    module,
    summary,
    confidence,
    status,
    created,
    source,
  } = decision;

  const formattedDate = new Date(created).toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });

  const confidencePct = Math.round(confidence * 100);

  return (
    <div className="glass-panel decision-card fade-in">
      <div className="card-header">
        <div className="header-left">
          <span className="module-tag">{module}</span>
          <span className="file-path mono-text">{filePath}</span>
        </div>
        <div className="header-right">
          <HealthBadge status={status} />
        </div>
      </div>

      <h3 className="card-summary">{summary}</h3>

      <div className="card-confidence-bar">
        <div className="confidence-label">
          <span>Confidence</span>
          <span className="confidence-value">{confidencePct}%</span>
        </div>
        <div className="progress-track">
          <div
            className="progress-fill"
            style={{
              width: `${confidencePct}%`,
              background: `linear-gradient(to right, var(--accent-primary), ${
                confidencePct > 75
                  ? 'var(--status-active)'
                  : confidencePct > 50
                  ? 'var(--status-questionable)'
                  : 'var(--status-deprecated)'
              })`,
            }}
          ></div>
        </div>
      </div>

      <div className="card-footer">
        <div className="meta-left">
          <span className="date-label">{formattedDate}</span>
          <span className="meta-separator">•</span>
          {source && (
            <a
              href={source.url}
              target="_blank"
              rel="noopener noreferrer"
              className="source-link"
              onClick={(e) => e.stopPropagation()}
            >
              {source.type.toUpperCase()} #{source.refNumber} by @{source.author}
            </a>
          )}
        </div>
        <Link href={`/decision/${id}`} className="view-details-link">
          Details
          <svg
            className="arrow-icon"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
          >
            <path d="M5 12h14M12 5l7 7-7 7" />
          </svg>
        </Link>
      </div>
    </div>
  );
}
