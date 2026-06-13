import React from 'react';
import type { HealthStatus } from '@GhostPR/shared-types';

interface HealthBadgeProps {
  status: HealthStatus;
}

export function HealthBadge({ status }: HealthBadgeProps) {
  const getStatusLabel = (s: HealthStatus) => {
    switch (s) {
      case 'active':
        return 'Active';
      case 'questionable':
        return 'Questionable';
      case 'deprecated':
        return 'Deprecated';
      default:
        return s;
    }
  };

  return (
    <span className={`status-pill status-${status}`}>
      <span className="status-dot"></span>
      {getStatusLabel(status)}
    </span>
  );
}
