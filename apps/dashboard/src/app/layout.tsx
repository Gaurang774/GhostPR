import React from 'react';
import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'GhostPR — Decision Health Dashboard',
  description:
    'Gives agentic IDEs decision memory that knows when it can still be trusted. View, trace, and monitor system architectural decisions.',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>
        <div className="app-container">
          <header className="app-header" id="main-header">
            <div className="brand-section">
              <div className="brand-logo">
                <svg
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5" />
                </svg>
              </div>
              <div>
                <h1 className="brand-name">GhostPR</h1>
                <p className="brand-tagline">Decision Memory & Health Dashboard</p>
              </div>
            </div>
          </header>
          <main id="main-content">{children}</main>
        </div>
      </body>
    </html>
  );
}
