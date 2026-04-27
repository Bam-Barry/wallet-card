// Convex arch: edges at y=60, center rises UP to y=0
const ARCH_562 = "path('M 0 60 Q 259 0 518 60 L 518 265 L 0 265 Z')";
// Front pocket arch path (486x249) with 8px rounded bottom corners
const FRONT_POCKET_PATH =
  "M 0 56.29 Q 243 0 486 56.29 L 486 241 A 8 8 0 0 1 478 249 L 8 249 A 8 8 0 0 1 0 241 Z";
const ARCH_563 = `path('${FRONT_POCKET_PATH}')`;
const BASE_CARD_NAME = "Outer Card Shell";
const BACK_POCKET_NAME = "Back Pocket Card";
const FRONT_POCKET_NAME = "Front Pocket Card";

export default function WalletCard() {
  return (
    <div
      className="flex items-center justify-center min-h-screen"
      style={{ background: "#a8a8a8" }}
    >
      {/* Wallet stack: 542 × 412 */}
      <div style={{ position: "relative", width: 542, height: 412 }}>

        {/* Rectangle 34624560 — base: 542×412  radius:36  fill:#13141B */}
        <div
          data-name={BASE_CARD_NAME}
          style={{
            position: "absolute",
            inset: 0,
            background: "#13141B",
            borderRadius: 36,
            boxShadow:
              "0 32px 80px rgba(0,0,0,0.72), 0 12px 32px rgba(0,0,0,0.5)",
          }}
        />

        {/* Inner clipping area: 518×388  radius:24 */}
        <div
          style={{
            position: "absolute",
            top: 12, left: 12, right: 12, bottom: 12,
            borderRadius: 24,
            overflow: "hidden",
          }}
        >
          {/* Rectangle 34624562 — dark pocket base, convex arch top
              filter wrapper so drop-shadow follows the arch (not clipped) */}
          <div
            data-name={BACK_POCKET_NAME}
            style={{
              position: "absolute",
              top: 123,
              left: 0, right: 0,
              height: 265,
              filter: "drop-shadow(0px -4px 24px rgba(0,0,0,0.56))",
              zIndex: 3,
            }}
          >
            <div
              style={{
                width: "100%",
                height: "100%",
                background: "#1A191A",
                clipPath: ARCH_562,
              }}
            />
          </div>

          {/* Rectangle 34624563 — gradient pocket overlay
              486×249  16px inset from sides  same convex arch
              Fill: #0F1015 base (100%) + linear gradient at 14% opacity on top
              Gradient stops × 0.14 layer opacity = effective rgba values */}
          <div
            data-name={FRONT_POCKET_NAME}
            style={{
              position: "absolute",
              top: 123,
              left: 16, right: 16,
              height: 249,
              zIndex: 4,
            }}
          >
            <div
              style={{
                position: "absolute",
                inset: 0,
                background: [
                  "linear-gradient(-60deg,",
                  "  rgba(15,16,21,0.14) 0%,",
                  "  rgba(255,255,255,0.073) 34%,",
                  "  rgba(255,255,255,0.109) 76%,",
                  "  rgba(255,255,255,0.028) 100%",
                  "),",
                  "#0F1015",
                ].join(" "),
                clipPath: ARCH_563,
                boxShadow: "inset 4px 4px 16px 0px rgba(255,255,255,0.07)",
              }}
            />
            {/* Sew — U-shape stitching: left side + bottom + right side
                Starts just below the arch edges (y≈62), runs down both sides
                and across the bottom, inset 8px from pocket edges */}
            <svg
              viewBox="0 0 486 249"
              style={{
                position: "absolute",
                inset: 0,
                width: "100%",
                height: "100%",
                pointerEvents: "none",
                zIndex: 5,
              }}
            >
              <path
                d="M 8 62 L 8 241 L 478 241 L 478 62"
                fill="none"
                stroke="rgba(255,255,255,0.2)"
                strokeWidth="1.5"
                strokeDasharray="4 5"
                strokeLinecap="round"
              />
            </svg>
          </div>
        </div>

        {/* Rectangle 34624561 — overlay frame (FRONTMOST)
            Must have zIndex higher than pocket (z:3) so the white
            inner glow appears over the pocket area too */}
        <div
          style={{
            position: "absolute",
            top: 12, left: 12, right: 12, bottom: 12,
            borderRadius: 24,
            border: "1px solid #000000",
            boxShadow: "inset 0 0 2px 2px rgba(255,255,255,0.25)",
            pointerEvents: "none",
            zIndex: 10,
          }}
        />
      </div>
    </div>
  );
}
