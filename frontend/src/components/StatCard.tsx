import type { ReactNode } from "react";
import { Box, Card, CardContent, Typography } from "@mui/material";

export interface StatCardProps {
  label: string;
  value: string;
  icon: ReactNode;
  description?: string;
}

/** Compact live-metric card: the value leads, and semantic context remains readable. */
export function StatCard({ label, value, icon, description }: StatCardProps) {
  return (
    <Card className="stat-card" aria-label={`${label}: ${value}`}>
      <CardContent>
        <Box className="stat-icon" aria-hidden="true">{icon}</Box>
        <Typography variant="body2" color="text.secondary">{label}</Typography>
        <Typography className="stat-value">{value}</Typography>
        {description && <Typography variant="caption" className="trend">{description}</Typography>}
      </CardContent>
    </Card>
  );
}
