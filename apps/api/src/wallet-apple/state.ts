import type { CardDesign, PointsCardState, StampCardState } from "@onusclub/shared";
import type { GeoPoint } from "../merchants/locations.js";

export interface AppleMerchantBranding {
  id: string;
  businessName: string;
  brandColor: string | null;
  /**
   * Shops to geofence on, from `loadMerchantLocations`. Optional so the two
   * `buildPkPass` call sites can be updated independently and a missing list
   * means "no geofencing" rather than a crash — but both should pass it.
   */
  locations?: GeoPoint[];
}

// Discriminated union — the pass-builder pulls the right labels + numbers
// based on programType without needing a second lookup. `design` rides along
// on both variants (it lives in the same config_json the rules come from) so
// the pass builder can paint the strip without a second query.
export type AppleProgramForWallet = { design?: Partial<CardDesign> | null } & (
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
    }
);

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
