import React from 'react';
import Link from 'next/link';
import { getDecisionById } from '@/lib/decisions';
import { HealthBadge } from '@/components/HealthBadge';
import { AgentLog } from '@/components/AgentLog';

export const revalidate = 0; // Fresh database query on every detail request

interface DecisionDetailPageProps {
  params: {
    id: string;
  };
}

export default async function DecisionDetailPage({ params }: DecisionDetailPageProps) {
  const { id } = params;

  try {
    const decision = await getDecisionById(id);
    if (!decision) {
      throw new Error(`Decision not found: ${id}`);
    }

    const formattedCreated = new Date(decision.created).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });

    const formattedValidated = decision.lastValidated
      ? new Date(decision.lastValidated).toLocaleDateString('en-US', {
          year: 'numeric',
          month: 'long',
          day: 'numeric',
          hour: '2-digit',
          minute: '2-digit',
        })
      : 'Never';

    const confidencePct = Math.round(decision.confidence * 100);

    return (
      <div className="detail-page fade-in">
        <div className="back-nav">
          <Link href="/" className="btn btn-secondary" id="back-btn">
            <svg
              className="back-icon"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
            >
              <path d="M19 12H5M12 19l-7-7 7-7" />
            </svg>
            Back to Dashboard
          </Link>
        </div>

        <article className="detail-layout">
          <div className="detail-main-content">
            <div className="detail-header-panel glass-panel">
              <div className="detail-meta-top">
                <div className="meta-badge-group">
                  <span className="module-tag">{decision.module}</span>
                  <HealthBadge status={decision.status} />
                </div>
                <span className="detail-confidence mono-text">{confidencePct}% Confidence</span>
              </div>

              <h2 className="detail-title">{decision.summary}</h2>
              <div className="detail-file-path mono-text">{decision.filePath}</div>

              <div className="detail-meta-grid">
                <div className="meta-grid-item">
                  <span className="item-label">Created At</span>
                  <span className="item-value">{formattedCreated}</span>
                </div>
                <div className="meta-grid-item">
                  <span className="item-label">Last Validated</span>
                  <span className="item-value">{formattedValidated}</span>
                </div>
                {decision.source && (
                  <div className="meta-grid-item">
                    <span className="item-label">Origin Link</span>
                    <a
                      href={decision.source.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="item-value source-link-anchor"
                    >
                      {decision.source.type.toUpperCase()} #{decision.source.refNumber} by @{decision.source.author}
                    </a>
                  </div>
                )}
              </div>
            </div>

            <div className="detail-sections">
              <section className="section-panel glass-panel" id="reason-section">
                <div className="section-header">
                  <div className="section-icon-container reason-icon">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <circle cx="12" cy="12" r="10" />
                      <path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3" />
                      <line x1="12" y1="17" x2="12.01" y2="17" />
                    </svg>
                  </div>
                  <h3>The Why (Reason & Context)</h3>
                </div>
                <p className="section-body-text">{decision.reason}</p>
              </section>

              <section className="section-panel glass-panel" id="result-section">
                <div className="section-header">
                  <div className="section-icon-container result-icon">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
                      <polyline points="22 4 12 14.01 9 11.01" />
                    </svg>
                  </div>
                  <h3>The Outcome (Result & Verification)</h3>
                </div>
                <p className="section-body-text">{decision.result}</p>
              </section>

              <section className="section-panel glass-panel" id="lesson-section">
                <div className="section-header">
                  <div className="section-icon-container lesson-icon">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" />
                      <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" />
                    </svg>
                  </div>
                  <h3>The Lesson Learned</h3>
                </div>
                <p className="section-body-text">{decision.lesson}</p>
              </section>
            </div>
          </div>

          <aside className="detail-sidebar">
            <div className="sidebar-panel glass-panel">
              <h3>Agent Access Timeline</h3>
              <p className="sidebar-subtitle">History of match events retrieved in the IDE</p>
              <AgentLog logs={decision.agentLog} />
            </div>
          </aside>
        </article>
      </div>
    );
  } catch (error: any) {
    console.error(`Error fetching decision ${id}:`, error);
    return (
      <div className="error-panel glass-panel fade-in">
        <svg
          className="error-icon"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
        >
          <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
          <line x1="12" y1="9" x2="12" y2="13" />
          <line x1="12" y1="17" x2="12.01" y2="17" />
        </svg>
        <h2>Decision Not Found</h2>
        <p className="error-message">Could not retrieve decision details for ID: {id}</p>
        <Link href="/" className="btn btn-secondary">
          Back to Dashboard
        </Link>
      </div>
    );
  }
}
