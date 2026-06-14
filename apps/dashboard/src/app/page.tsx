import React from 'react';
import { getAllDecisions } from '@/lib/decisions';
import { DecisionList } from '@/components/DecisionList';

export const revalidate = 0; // Disable caching to ensure fresh DB reads on every reload

export default async function HomePage() {
  try {
    const decisions = await getAllDecisions();

    return (
      <div className="home-page fade-in">
        <section className="intro-section">
          <h2>Architectural Decision Registry</h2>
          <p>
            GhostPR tracks the context behind key system designs, monitoring code revisions
            to deprecate or query historical contexts. Below are the current active, questionable,
            and deprecated decisions recorded in Hindsight.
          </p>
        </section>

        <DecisionList initialDecisions={decisions} />
      </div>
    );
  } catch (error: any) {
    console.error('Error loading home page decisions:', error);
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
        <h2>Failed to Load Memory Database</h2>
        <p className="error-message">{error.message || 'An unexpected error occurred.'}</p>
        <p className="error-action">Please ensure the SQLite database migrations have run and that data/GhostPR.db exists.</p>
      </div>
    );
  }
}
