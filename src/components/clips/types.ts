import type { CaptionStyle, Clip, ClipLayout } from "@/lib/mock-data";

export type ReviewStatus = "new" | "kept" | "removed";

/** A clip plus the choices the user made while reviewing it. */
export type ReviewClip = Clip & {
  status: ReviewStatus;
  layout: ClipLayout;
  caption: CaptionStyle;
};

export type ClipPatch = Partial<Pick<ReviewClip, "status" | "layout" | "caption" | "hook">>;

export function scoreTier(score: number) {
  if (score >= 90) return { label: "Top pick", top: true };
  if (score >= 80) return { label: "Great", top: false };
  if (score >= 70) return { label: "Good", top: false };
  return { label: "Maybe", top: false };
}
