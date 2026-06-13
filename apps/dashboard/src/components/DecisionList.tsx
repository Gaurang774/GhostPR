'use client';

import React, { useState } from 'react';
import type { Decision, HealthStatus } from '@GhostPR/shared-types';
import { DecisionCard } from './DecisionCard';

interface DecisionListProps {
  initialDecisions: Decision[];
}

export function DecisionList({ initialDecisions }: DecisionListProps) {
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState<HealthStatus | 'all'>('all');

  const filteredDecisions = initialDecisions.filter((decision) => {
    const matchesSearch =
      decision.filePath.toLowerCase().includes(searchTerm.toLowerCase()) ||
      decision.module.toLowerCase().includes(searchTerm.toLowerCase()) ||
      decision.summary.toLowerCase().includes(searchTerm.toLowerCase()) ||
      decision.reason.toLowerCase().includes(searchTerm.toLowerCase());

    const matchesStatus = statusFilter === 'all' || decision.status === statusFilter;

    return matchesSearch && matchesStatus;
  });

  return (
    <div className="decision-list-section">
      {initialDecisions.length > 0 && <div className="controls-panel glass-panel">
        <div className="search-wrapper">
          <svg
            className="search-icon"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
          >
            <circle cx="11" cy="11" r="8" />
            <path d="M21 21l-4.3-4.3" />
          </svg>
          <input
            type="text"
            placeholder="Search by file, module, summary, or reason..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="search-input"
          />
        </div>

        <div className="filter-wrapper">
          <label htmlFor="status-select" className="filter-label">
            Status:
          </label>
          <select
            id="status-select"
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value as any)}
            className="filter-select"
          >
            <option value="all">All Health States</option>
            <option value="active">Active</option>
            <option value="questionable">Questionable</option>
            <option value="deprecated">Deprecated</option>
          </select>
        </div>
      </div>}

      {initialDecisions.length > 0 && (
        <div className="results-stats">
          Showing {filteredDecisions.length} of {initialDecisions.length} decision{initialDecisions.length !== 1 ? 's' : ''}
        </div>
      )}

      {filteredDecisions.length === 0 ? (
        <div className="empty-results glass-panel fade-in">
          {initialDecisions.length === 0 ? (
            <>
              <svg
                className="empty-icon"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
              >
                <ellipse cx="12" cy="5" rx="9" ry="3" />
                <path d="M21 12c0 1.66-4 3-9 3s-9-1.34-9-3" />
                <path d="M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5" />
              </svg>
              <h3>No decisions recorded yet</h3>
              <p>Run the ingestion pipeline to populate the registry from merged GitHub PRs.</p>
            </>
          ) : (
            <>
              <svg
                className="empty-icon"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
              >
                <circle cx="12" cy="12" r="10" />
                <line x1="12" y1="8" x2="12" y2="12" />
                <line x1="12" y1="16" x2="12.01" y2="16" />
              </svg>
              <h3>No decisions match your criteria</h3>
              <p>Try adjusting your search terms or status filter.</p>
            </>
          )}
        </div>
      ) : (
        <div className="decision-grid">
          {filteredDecisions.map((decision) => (
            <DecisionCard key={decision.id} decision={decision} />
          ))}
        </div>
      )}
    </div>
  );
}
