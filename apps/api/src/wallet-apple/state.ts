import type { PointsCardState, StampCardState } from "@onusclub/shared";

export interface AppleMerchantBranding {
  id: string;
  businessName: string;
  brandColor: string | null;
}

// Discriminated union — the pass-builder pulls the right labels + numbers
// based on programType without needing a second lookup.
export type AppleProgramForWallet =
  | {
      programType: "stamp";
      id: string;
      name: string;
      rewardText: string;
      stampsRequired: number;
    }
  | {
      programType: "points";
      id: string;
      name: string;
      rewardText: string;
      pointsForReward: number;
    };

export type AppleCardForWallet =
  | {
      id: string;
      qrToken: string;
      state: StampCardState;
      customerName: string | null;
    }
  | {
      id: string;
      qrToken: string;
      state: PointsCardState;
      customerName: string | null;
    };
