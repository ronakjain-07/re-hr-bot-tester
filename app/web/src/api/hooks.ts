import { useQuery } from "@tanstack/react-query";
import type { Journey, RunSummary, ScenarioResult } from "@hr/shared";
import { getJSON } from "./client";

export function useJourneys() {
  return useQuery({ queryKey: ["journeys"], queryFn: () => getJSON<Journey[]>("/api/journeys") });
}

export interface ReportItem {
  file: string;
  date: string;
  summary: RunSummary;
}

export function useReports() {
  return useQuery({ queryKey: ["reports"], queryFn: () => getJSON<ReportItem[]>("/api/reports"), refetchOnWindowFocus: false });
}

export interface ReportDetail {
  file: string;
  date: string;
  summary: RunSummary;
  scenarios: ScenarioResult[];
}

export function useReport(file: string | null) {
  return useQuery({
    enabled: !!file,
    queryKey: ["report", file],
    queryFn: () => getJSON<ReportDetail>(`/api/reports/${file}`),
  });
}
