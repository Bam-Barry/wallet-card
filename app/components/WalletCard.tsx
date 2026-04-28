"use client";

import { CSSProperties, memo, MouseEvent, useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";

const FRONT_POCKET_PATH =
  "M 0 56.29 Q 243 0 486 56.29 L 486 241 A 8 8 0 0 1 478 249 L 8 249 A 8 8 0 0 1 0 241 Z";
const ARCH_562 = "path('M 0 60 Q 259 0 518 60 L 518 265 L 0 265 Z')";
const ARCH_563 = `path('${FRONT_POCKET_PATH}')`;
const BASE_CARD_NAME = "Outer Card Shell";
const BACK_POCKET_NAME = "Back Pocket Card";
const FRONT_POCKET_NAME = "Front Pocket Card";

const CARD_W = 482;
const CARD_H = 292;
const CARD_STAGE_HEADROOM = 40;
const MAX_TILT = 8;
const MAX_ROLL = 0.6;
const TAP_MS = 96;
const REST_POINTER = { x: 0.5, y: 0.2 } as const;

// Brand wordmark engraved on the leather pocket. The SVG ships its own
// inner-shadow + drop-shadow filters baked in to match the Figma exactly,
// so we render it as-is via <img>. Swap this path to rebrand.
const BRAND_LOGO_SRC = "/ACME.svg";
const BRAND_LOGO_WIDTH = 156;

const LIFT_MS = 420;
const CLEAR_MS = 380;
const PRESENT_MS = 420;
// Return path mirrors extraction \u2014 unyaw uses PRESENT_MS, the two descend
// sub-steps use CLEAR_MS and LIFT_MS respectively. UNYAW_MS / DESCEND_MS are
// no longer needed; close timings derive from the extraction constants so the
// two paths stay symmetric automatically.
const SEAT_MS = 260;

// Motion arc \u2014 lift starts the rise from the pocket; clear puts the card
// visibly ABOVE the pocket lip (lip sits at wallet y \u2248 191, so a clear top
// of -210 puts the card bottom at \u2248 94 \u2014 ~97px above the lip). Then PRESENT
// brings the card DOWN to sit centered on the wallet face (target top 48
// resolves to wallet y 60, equal padding above and below the 292px-tall
// card on a 412px-tall wallet). OPEN settles a touch lower than present so
// the card "lands" with a 2px micro-settle. The return path then naturally
// reads as: rise UP off the wallet face (unyaw \u2192 clear height) \u2192 tuck DOWN
// into the pocket (descend \u2192 stack).
const LIFT_TARGET_TOP = -56;
const CLEAR_TARGET_TOP = -210;
const PRESENT_TARGET_TOP = 48;
const OPEN_TARGET_TOP = 50;

type CardId = "investing" | "trading";
type FocusPhase =
  | "idle"
  | "lift"
  | "clear"
  | "present"
  | "open"
  | "unyaw"
  | "descend"
  | "seat";
type ActorLayer = "hidden" | "below-top" | "pocket" | "front";

type CardConfig = {
  id: CardId;
  label: string;
  top: number;
  left: number;
  zIndex: number;
  dark?: boolean;
  background: string;
  shadow: string;
  titleColor: string;
  sheen: string;
  highlight: string;
  border: string;
  cardNumber: string;
  cardHolder: string;
  expiry: string;
  network: "visa" | "mastercard";
};

type PointerState = { x: number; y: number };
type TiltState = { x: number; y: number };
type Pose = { x: number; y: number; z: number; rotate: number; rotateY: number; scale: number };
type SpringSpec = { stiffness: number; damping: number; mass?: number };
type MotionProfile = {
  stack: Pose;
  hover: Pose;
  dormant: Pose;
  lift: Pose;
  clear: Pose;
  present: Pose;
  open: Pose;
  returnBiasX: number;
  springs?: Partial<Record<FocusPhase, SpringSpec>>;
};
type ActorStep = {
  phase: FocusPhase;
  spring: SpringSpec;
  pose: Pose;
  layer: ActorLayer;
  announcement: string;
};

const CARD_CONFIG: CardConfig[] = [
  {
    id: "investing",
    label: "Investing",
    top: 16,
    left: 18,
    zIndex: 1,
    background: "linear-gradient(175deg, #7B32D4 0%, #6826BE 55%, #5420A8 100%)",
    shadow: "0 8px 32px rgba(90,24,168,0.5), 0 2px 8px rgba(0,0,0,0.3)",
    titleColor: "#ffffff",
    sheen: "linear-gradient(135deg, rgba(255,255,255,0.12) 0%, rgba(255,255,255,0) 52%)",
    highlight: "rgba(255,255,255,0.24)",
    border: "rgba(255,255,255,0.11)",
    cardNumber: "4821 •••• •••• 3074",
    cardHolder: "Alex Johnson",
    expiry: "09/28",
    network: "visa",
  },
  {
    id: "trading",
    label: "Trading",
    top: 80,
    left: 18,
    zIndex: 2,
    dark: true,
    background: "linear-gradient(to right, #EAE4F5 0%, #F8F4FD 38%, #FFFFFF 100%)",
    shadow: "0 -2px 12px rgba(0,0,0,0.14), 0 6px 24px rgba(0,0,0,0.18)",
    titleColor: "#2C1F52",
    sheen: "linear-gradient(to left, rgba(255,255,255,0.72) 0%, rgba(255,255,255,0) 60%)",
    highlight: "rgba(255,255,255,0.52)",
    border: "rgba(255,255,255,0.42)",
    cardNumber: "5362 •••• •••• 8819",
    cardHolder: "Alex Johnson",
    expiry: "03/27",
    network: "mastercard",
  },
];

const CARD_MOTION_PROFILE: Record<CardId, MotionProfile> = {
  // BOTTOM card. Sits deeper, leans left, lower lift, softer/slower springs.
  investing: {
    // Hover-flash fix \u2014 Card Stage uses transform-style: preserve-3d, which
    // paints children by their actual translateZ depth (zIndex is ignored).
    // When mouse-out springs investing back from z:-14 \u2192 0, an underdamped
    // overshoot can briefly push z slightly positive and paint investing
    // ABOVE trading. Pinning investing's stack/hover z to a small negative
    // value guarantees it can never cross trading's stack z (0).
    stack: { x: 0, y: 0, z: -2, rotate: 0, rotateY: 0, scale: 1 },
    hover: { x: -1, y: -6, z: -14, rotate: -0.4, rotateY: -0.6, scale: 0.995 },
    dormant: { x: -4, y: 0, z: -46, rotate: -0.4, rotateY: -2.0, scale: 0.985 },
    lift: { x: -3, y: targetOffsetY(CARD_CONFIG[0], LIFT_TARGET_TOP + 6), z: 10, rotate: -0.7, rotateY: -5.8, scale: 0.984 },
    // clear.z bumped 22 \u2192 52 so the depth change between clear and present
    // is a smooth continuation (52 \u2192 102) instead of a 4\u00d7 pop.
    clear: { x: -8, y: targetOffsetY(CARD_CONFIG[0], CLEAR_TARGET_TOP), z: 52, rotate: -0.55, rotateY: -3.6, scale: 1.012 },
    // Present + open x:0 unifies the landing position so investing and trading
    // both come down to the SAME spot on the wallet face (no left/right bias
    // depending on which card was extracted).
    present: { x: 0, y: targetOffsetY(CARD_CONFIG[0], PRESENT_TARGET_TOP), z: 102, rotate: 0, rotateY: -1.0, scale: 1.042 },
    open: { x: 0, y: targetOffsetY(CARD_CONFIG[0], OPEN_TARGET_TOP), z: 74, rotate: 0, rotateY: 0, scale: 1.034 },
    returnBiasX: -16,
    springs: {
      lift: { stiffness: 235, damping: 22 },
      clear: { stiffness: 295, damping: 28 },
      present: { stiffness: 192, damping: 28 },
      open: { stiffness: 180, damping: 30 },
      unyaw: { stiffness: 210, damping: 24 },
      descend: { stiffness: 200, damping: 26 },
      seat: { stiffness: 232, damping: 24 },
    },
  },
  // TOP card. Sits forward, leans right, higher lift, snappier/overshoot springs.
  trading: {
    stack: { x: 0, y: 0, z: 0, rotate: 0, rotateY: 0, scale: 1 },
    hover: { x: 1, y: -22, z: 12, rotate: 0.9, rotateY: 0.8, scale: 1.004 },
    dormant: { x: 6, y: 0, z: -38, rotate: 0.5, rotateY: 2.0, scale: 0.985 },
    lift: { x: 5, y: targetOffsetY(CARD_CONFIG[1], LIFT_TARGET_TOP - 8), z: 16, rotate: 0.85, rotateY: 7.4, scale: 0.984 },
    // clear.z bumped 26 \u2192 58 so the depth change between clear and present
    // is a smooth continuation (58 \u2192 110) instead of a 4\u00d7 pop.
    clear: { x: 9, y: targetOffsetY(CARD_CONFIG[1], CLEAR_TARGET_TOP), z: 58, rotate: 0.75, rotateY: 5.0, scale: 1.014 },
    // Unified landing position with investing \u2014 see investing.present comment.
    present: { x: 0, y: targetOffsetY(CARD_CONFIG[1], PRESENT_TARGET_TOP), z: 110, rotate: 0, rotateY: 1.4, scale: 1.048 },
    open: { x: 0, y: targetOffsetY(CARD_CONFIG[1], OPEN_TARGET_TOP), z: 80, rotate: 0, rotateY: 0, scale: 1.036 },
    returnBiasX: 18,
    springs: {
      lift: { stiffness: 290, damping: 22 },
      clear: { stiffness: 320, damping: 26 },
      present: { stiffness: 205, damping: 27 },
      open: { stiffness: 188, damping: 30 },
      unyaw: { stiffness: 232, damping: 23 },
      descend: { stiffness: 220, damping: 25 },
      seat: { stiffness: 248, damping: 23 },
    },
  },
};

const PHASE_SPRING: Record<FocusPhase, SpringSpec> = {
  // Critically damped (\u03b6 \u2248 1.10) so hover \u2192 stack settles cleanly with no
  // oscillation. Keeps stack-rest visually quiet and reinforces the z-bias
  // fix on investing.stack so the cards cannot trade paint order under
  // preserve-3d during hover-out.
  idle: { stiffness: 210, damping: 32 },
  lift: { stiffness: 250, damping: 20 },
  clear: { stiffness: 236, damping: 22 },
  present: { stiffness: 198, damping: 28 },
  open: { stiffness: 184, damping: 30 },
  unyaw: { stiffness: 222, damping: 24 },
  descend: { stiffness: 210, damping: 26 },
  seat: { stiffness: 240, damping: 23 },
};

function springFor(card: CardConfig, phase: FocusPhase): SpringSpec {
  return CARD_MOTION_PROFILE[card.id].springs?.[phase] ?? PHASE_SPRING[phase];
}

function transformFromPose(pose: Pose) {
  return `translate3d(${pose.x}px, ${pose.y}px, ${pose.z}px) rotateY(${pose.rotateY}deg) rotate(${pose.rotate}deg) scale(${pose.scale})`;
}

function targetOffsetY(card: CardConfig, top: number) {
  return top - card.top;
}

function getStackPose(card: CardConfig, hovered: boolean): Pose {
  const profile = CARD_MOTION_PROFILE[card.id];
  return hovered ? profile.hover : profile.stack;
}

function getStackTransform(card: CardConfig, hovered: boolean) {
  return transformFromPose(getStackPose(card, hovered));
}

function actorLayerZIndex(layer: ActorLayer) {
  switch (layer) {
    case "front":
      return 30;
    case "pocket":
      return 2;
    case "below-top":
      // BEHIND Card Stage (z:1) so the bottom card visibly emerges from behind the top card.
      return 0;
    default:
      return 0;
  }
}

function phaseAnnouncement(label: string, phase: FocusPhase) {
  switch (phase) {
    case "lift":
    case "clear":
    case "present":
      return `${label} card is being presented.`;
    case "open":
      return `${label} card is focused.`;
    case "unyaw":
    case "descend":
    case "seat":
      return `${label} card is returning to the wallet.`;
    default:
      return "Cards are stacked in the wallet.";
  }
}

function ContactlessIcon({ dark = false }: { dark?: boolean }) {
  const stroke = dark ? "rgba(40,28,70,0.45)" : "rgba(255,255,255,0.92)";
  const fill = dark ? "rgba(40,28,70,0.45)" : "rgba(255,255,255,0.92)";
  return (
    <svg width="28" height="22" viewBox="0 0 38 30" fill="none">
      <circle cx="3.5" cy="15" r="2.5" fill={fill} />
      <path d="M10 8 Q17 15 10 22" stroke={stroke} strokeWidth="2.4" strokeLinecap="round" fill="none" />
      <path d="M18 4 Q29 15 18 26" stroke={stroke} strokeWidth="2.4" strokeLinecap="round" fill="none" />
      <path d="M26 1 Q38 15 26 29" stroke={stroke} strokeWidth="2.4" strokeLinecap="round" fill="none" />
    </svg>
  );
}

function ChipIcon({ dark = false }: { dark?: boolean }) {
  const base = dark ? "rgba(44,31,82,0.18)" : "rgba(255,255,255,0.22)";
  const line = dark ? "rgba(44,31,82,0.28)" : "rgba(255,255,255,0.36)";
  const body = dark ? "rgba(180,160,80,0.82)" : "rgba(210,185,100,0.9)";
  return (
    <svg width="42" height="32" viewBox="0 0 42 32" fill="none">
      <rect x="1" y="1" width="40" height="30" rx="5" fill={body} stroke={line} strokeWidth="0.8" />
      <rect x="14" y="1" width="14" height="30" fill={base} />
      <rect x="1" y="10" width="40" height="12" fill={base} />
      <rect x="14" y="10" width="14" height="12" rx="2" fill="none" stroke={line} strokeWidth="0.8" />
      <line x1="21" y1="1" x2="21" y2="10" stroke={line} strokeWidth="0.7" />
      <line x1="21" y1="22" x2="21" y2="31" stroke={line} strokeWidth="0.7" />
      <line x1="1" y1="16" x2="14" y2="16" stroke={line} strokeWidth="0.7" />
      <line x1="28" y1="16" x2="41" y2="16" stroke={line} strokeWidth="0.7" />
    </svg>
  );
}

function VisaLogo({ dark = false }: { dark?: boolean }) {
  const color = dark ? "#1A1F71" : "#ffffff";
  return (
    <svg width="54" height="18" viewBox="0 0 54 18" fill="none">
      <text x="0" y="15" fontFamily="Arial, sans-serif" fontWeight="700" fontSize="18" letterSpacing="-0.5" fill={color} opacity={dark ? 0.7 : 0.92}>
        VISA
      </text>
    </svg>
  );
}

function MastercardLogo({ dark = false }: { dark?: boolean }) {
  const leftColor = dark ? "#EB001B" : "rgba(235,0,27,0.85)";
  const rightColor = dark ? "#F79E1B" : "rgba(247,158,27,0.85)";
  const overlapColor = dark ? "#FF5F00" : "rgba(255,95,0,0.85)";
  return (
    <svg width="44" height="28" viewBox="0 0 44 28" fill="none">
      <circle cx="16" cy="14" r="13" fill={leftColor} />
      <circle cx="28" cy="14" r="13" fill={rightColor} />
      <path d="M22 4.3a13 13 0 0 1 0 19.4A13 13 0 0 1 22 4.3z" fill={overlapColor} />
    </svg>
  );
}

const WalletSurfaceCard = memo(function WalletSurfaceCard({
  card,
  pointer,
  pointerActive = false,
  onClick,
  transform,
  opacity = 1,
  opacityDuration = 480,
  filter = "none",
  zIndex,
  pointerEvents = "auto",
  boxShadow,
  delay = 0,
  ariaLabel,
  positionAbsolute = true,
  active = false,
  spring,
  elementRef,
}: {
  card: CardConfig;
  pointer: PointerState;
  pointerActive?: boolean;
  onClick?: () => void;
  transform: string;
  opacity?: number;
  opacityDuration?: number;
  filter?: string;
  zIndex: number;
  pointerEvents?: CSSProperties["pointerEvents"];
  boxShadow?: string;
  delay?: number;
  ariaLabel?: string;
  positionAbsolute?: boolean;
  active?: boolean;
  spring: SpringSpec;
  elementRef?: (el: HTMLButtonElement | null) => void;
}) {
  const isTrading = card.id === "trading";
  const dx = pointerActive ? pointer.x - 0.5 : 0;
  const dy = pointerActive ? pointer.y - 0.5 : 0;
  const contentShiftX = dx * 9;
  const contentShiftY = dy * 6;
  const noiseShiftX = dx * 5;
  const noiseShiftY = dy * 4;
  const sheenShiftX = dx * 18;
  const sheenShiftY = dy * 12;
  const edgeShiftX = dx * 3;
  const edgeShiftY = dy * 2.5;
  const pointerPercentX = `${(pointer.x * 100).toFixed(1)}%`;
  const pointerPercentY = `${(pointer.y * 100).toFixed(1)}%`;
  const pointerDistance = Math.min(Math.hypot(dx, dy) * 2.05, 1);
  const reflectionAngle = Math.atan2(dy, dx) * (180 / Math.PI) + 90;
  const hotspotOpacity = pointerActive ? 0.22 + (1 - pointerDistance) * 0.16 : 0;
  const shimmerOpacity = pointerActive ? 0.12 + (1 - pointerDistance) * 0.18 : 0;

  const positionStyles: CSSProperties = positionAbsolute
    ? {
        position: "absolute",
        top: card.top + CARD_STAGE_HEADROOM,
        left: card.left,
        width: CARD_W,
        height: CARD_H,
      }
    : {
        position: "relative",
        width: "100%",
        height: "100%",
      };

  return (
    <motion.button
      ref={elementRef}
      type="button"
      onClick={onClick}
      className={active ? "is-active" : undefined}
      initial={false}
      animate={{ transform, opacity, filter }}
      transition={{
        transform: { type: "spring", ...spring },
        opacity: { duration: opacityDuration / 1000, ease: [0.22, 1, 0.36, 1] },
        filter: { duration: 0.36, ease: [0.22, 1, 0.36, 1] },
      }}
      style={{
        ...positionStyles,
        zIndex,
        background: [
          "linear-gradient(180deg, rgba(255,255,255,0.10) 0%, rgba(255,255,255,0.03) 14%, rgba(255,255,255,0) 38%)",
          card.background,
        ].join(", "),
        boxShadow: boxShadow ?? card.shadow,
        border: `1px solid ${card.border}`,
        transition: ["box-shadow 160ms cubic-bezier(0.22, 1, 0.36, 1)"].join(", "),
        transitionDelay: `${delay}ms`,
        cursor: onClick ? "pointer" : "default",
        pointerEvents,
        willChange: "transform, box-shadow, filter",
        backfaceVisibility: "hidden",
        transformOrigin: "center 85%",
        borderRadius: 16,
        overflow: "hidden",
      }}
      aria-label={ariaLabel ?? card.label}
    >
      <div
        aria-hidden
        style={{
          position: "absolute",
          inset: 0,
          background:
            "linear-gradient(180deg, rgba(255,255,255,0.12) 0%, rgba(255,255,255,0.03) 18%, rgba(255,255,255,0) 42%)",
          transform: `translate3d(${edgeShiftX}px, ${edgeShiftY}px, 1px)`,
          transition: "transform 140ms linear",
          pointerEvents: "none",
        }}
      />
      <div
        aria-hidden
        style={{
          position: "absolute",
          inset: 0,
          backgroundImage:
            "radial-gradient(rgba(255,255,255,0.14) 0.75px, transparent 0.95px), radial-gradient(rgba(0,0,0,0.08) 0.75px, transparent 1px)",
          backgroundSize: "10px 10px, 12px 12px",
          backgroundPosition: "0 0, 3px 4px",
          mixBlendMode: "soft-light",
          opacity: 0.1,
          transform: `translate3d(${noiseShiftX}px, ${noiseShiftY}px, 2px)`,
          transition: "transform 140ms linear",
          pointerEvents: "none",
        }}
      />
      <div
        aria-hidden
        style={{
          position: "absolute",
          inset: 0,
          background: card.sheen,
          opacity: pointerActive ? 0.26 : 0.42,
          mixBlendMode: "screen",
          transform: `translate3d(${sheenShiftX}px, ${sheenShiftY}px, 4px)`,
          transition: "transform 140ms linear",
          pointerEvents: "none",
        }}
      />
      <div
        aria-hidden
        style={{
          position: "absolute",
          inset: 0,
          borderRadius: 16,
          background: `radial-gradient(circle at ${pointerPercentX} ${pointerPercentY}, rgba(255,255,255,0.3) 0%, rgba(255,255,255,0.12) 18%, rgba(255,255,255,0) 58%)`,
          opacity: hotspotOpacity,
          mixBlendMode: "overlay",
          transition: "opacity 180ms ease, background 120ms linear",
          pointerEvents: "none",
        }}
      />
      <div
        aria-hidden
        style={{
          position: "absolute",
          inset: 0,
          borderRadius: 16,
          background: `linear-gradient(${reflectionAngle.toFixed(2)}deg, transparent 15%, rgba(255,255,255,0.22) 50%, transparent 85%)`,
          opacity: shimmerOpacity,
          mixBlendMode: "screen",
          transition: "opacity 180ms ease, background 120ms linear",
          pointerEvents: "none",
        }}
      />
      <div
        aria-hidden
        style={{
          position: "absolute",
          inset: 0,
          borderRadius: 16,
          boxShadow:
            "inset 0 1px 0 rgba(255,255,255,0.2), inset 0 -1px 0 rgba(255,255,255,0.04)",
          transform: `translate3d(${edgeShiftX * 0.9}px, ${edgeShiftY * 0.9}px, 5px)`,
          transition: "transform 140ms linear",
          pointerEvents: "none",
        }}
      />
      {/* Card content — debit card layout */}
      <div
        style={{
          position: "absolute",
          inset: 0,
          zIndex: 2,
          padding: "20px 24px 18px",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          transform: `translate3d(${contentShiftX}px, ${contentShiftY}px, 8px)`,
          transition: "transform 140ms linear",
          pointerEvents: "none",
        }}
      >
        {/* Row 1 — bank name + contactless */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <span
            style={{
              fontSize: 15,
              fontWeight: 700,
              color: card.titleColor,
              fontFamily: "system-ui, -apple-system, sans-serif",
              letterSpacing: "0.04em",
              textTransform: "uppercase",
              opacity: 0.92,
            }}
          >
            {card.label}
          </span>
          <ContactlessIcon dark={card.dark} />
        </div>

        {/* Row 2 — chip */}
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <ChipIcon dark={card.dark} />
        </div>

        {/* Row 3 — card number */}
        <div>
          <span
            style={{
              fontSize: 18,
              fontWeight: 500,
              color: card.titleColor,
              fontFamily: "'Courier New', monospace",
              letterSpacing: "0.18em",
              opacity: 0.88,
            }}
          >
            {card.cardNumber}
          </span>
        </div>

        {/* Row 4 — holder, expiry, network */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end" }}>
          <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
            <span
              style={{
                fontSize: 9,
                fontWeight: 500,
                color: card.titleColor,
                fontFamily: "system-ui, -apple-system, sans-serif",
                letterSpacing: "0.10em",
                textTransform: "uppercase",
                opacity: 0.55,
              }}
            >
              Card Holder
            </span>
            <span
              style={{
                fontSize: 13,
                fontWeight: 600,
                color: card.titleColor,
                fontFamily: "system-ui, -apple-system, sans-serif",
                letterSpacing: "0.04em",
                opacity: 0.9,
              }}
            >
              {card.cardHolder}
            </span>
          </div>
          <div style={{ display: "flex", alignItems: "flex-end", gap: 20 }}>
            <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
              <span
                style={{
                  fontSize: 9,
                  fontWeight: 500,
                  color: card.titleColor,
                  fontFamily: "system-ui, -apple-system, sans-serif",
                  letterSpacing: "0.10em",
                  textTransform: "uppercase",
                  opacity: 0.55,
                }}
              >
                Expires
              </span>
              <span
                style={{
                  fontSize: 13,
                  fontWeight: 600,
                  color: card.titleColor,
                  fontFamily: "'Courier New', monospace",
                  letterSpacing: "0.08em",
                  opacity: 0.9,
                }}
              >
                {card.expiry}
              </span>
            </div>
            {card.network === "visa"
              ? <VisaLogo dark={card.dark} />
              : <MastercardLogo dark={card.dark} />
            }
          </div>
        </div>
      </div>
    </motion.button>
  );
});

export default function WalletCard() {
  const [hovered, setHovered] = useState(false);
  const [activeCardId, setActiveCardId] = useState<CardId | null>(null);
  const [focusPhase, setFocusPhase] = useState<FocusPhase>("idle");
  const [pointer, setPointer] = useState<PointerState>({ ...REST_POINTER });
  const [actorPose, setActorPose] = useState<Pose>({ x: 0, y: 0, z: 0, rotate: 0, rotateY: 0, scale: 1 });
  const [actorSpring, setActorSpring] = useState<SpringSpec>(PHASE_SPRING.idle);
  const [actorLayer, setActorLayer] = useState<ActorLayer>("hidden");
  const [tilt, setTilt] = useState<TiltState>({ x: 0, y: 0 });
  const [pulse, setPulse] = useState(0);
  const [idleDuration, setIdleDuration] = useState(4.8);
  const [announcement, setAnnouncement] = useState("Cards are stacked in the wallet.");

  const stackRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const actorWrapperRef = useRef<HTMLDivElement>(null);
  const stackCardElsRef = useRef<Map<CardId, HTMLButtonElement>>(new Map());
  const phaseJobsRef = useRef<number[]>([]);
  const idleCycleRef = useRef(0);
  const tiltRafRef = useRef<number | null>(null);
  const tiltTargetRef = useRef({ x: 0, y: 0 });
  const tiltPhysicsRef = useRef({ x: 0, y: 0, vx: 0, vy: 0 });
  const tiltRenderRef = useRef({ x: 0, y: 0 });
  const pointerRafRef = useRef<number | null>(null);
  const pointerPendingRef = useRef<PointerState>({ ...REST_POINTER });

  const activeCard = activeCardId
    ? CARD_CONFIG.find((card) => card.id === activeCardId) ?? null
    : null;
  const tiltActive = focusPhase === "open" && !!activeCard;
  // Fix 4 — Visual focus state should only engage when the card has actually
  // come forward (present/open). cardActive controls hit-testing and a11y; it
  // is true the entire time a card is being animated. cardFocused controls the
  // backdrop blur, the wallet-stack recede, and the base-shell desaturation —
  // it only flips on once the card is in front, and back off at unyaw.
  const cardActive = activeCardId !== null;
  const cardFocused = focusPhase === "present" || focusPhase === "open";
  const stackPointer = activeCardId ? REST_POINTER : pointer;

  function clearPhaseJobs() {
    phaseJobsRef.current.forEach((job) => window.cancelAnimationFrame(job));
    phaseJobsRef.current = [];
  }

  function scheduleNextFrame(fn: () => void, frames = 1) {
    let remainingFrames = frames;
    let rafId = 0;

    const step = () => {
      if (remainingFrames === 0) {
        fn();
        return;
      }

      remainingFrames -= 1;
      rafId = window.requestAnimationFrame(step);
      phaseJobsRef.current.push(rafId);
    };

    rafId = window.requestAnimationFrame(step);
    phaseJobsRef.current.push(rafId);
  }

  function scheduleAfter(ms: number, fn: () => void) {
    let startedAt: number | null = null;
    let rafId = 0;

    const step = (now: number) => {
      if (startedAt === null) {
        startedAt = now;
      }

      if (now - startedAt >= ms) {
        fn();
        return;
      }

      rafId = window.requestAnimationFrame(step);
      phaseJobsRef.current.push(rafId);
    };

    rafId = window.requestAnimationFrame(step);
    phaseJobsRef.current.push(rafId);
  }

  useEffect(() => {
    return () => {
      clearPhaseJobs();
      if (tiltRafRef.current !== null) {
        window.cancelAnimationFrame(tiltRafRef.current);
      }
      if (pointerRafRef.current !== null) {
        window.cancelAnimationFrame(pointerRafRef.current);
      }
    };
  }, []);

  useEffect(() => {
    if (!tiltActive) {
      tiltTargetRef.current = { x: 0, y: 0 };
      tiltPhysicsRef.current = { x: 0, y: 0, vx: 0, vy: 0 };
      tiltRenderRef.current = { x: 0, y: 0 };
      scheduleNextFrame(() => {
        setTilt({ x: 0, y: 0 });
      });
      return;
    }

    let stopped = false;
    const tick = () => {
      if (stopped) return;

      const current = tiltPhysicsRef.current;
      const target = tiltTargetRef.current;
      current.vx += (target.x - current.x) * 0.11;
      current.vy += (target.y - current.y) * 0.11;
      current.vx *= 0.78;
      current.vy *= 0.78;
      current.x += current.vx;
      current.y += current.vy;

      const nextTilt = {
        x: current.x + current.vx * 0.08,
        y: current.y + current.vy * 0.08,
      };
      const previousTilt = tiltRenderRef.current;
      if (
        Math.abs(nextTilt.x - previousTilt.x) > 0.03 ||
        Math.abs(nextTilt.y - previousTilt.y) > 0.03
      ) {
        tiltRenderRef.current = nextTilt;
        setTilt(nextTilt);
      }

      tiltRafRef.current = window.requestAnimationFrame(tick);
    };

    tiltRafRef.current = window.requestAnimationFrame(tick);

    return () => {
      stopped = true;
      if (tiltRafRef.current !== null) {
        window.cancelAnimationFrame(tiltRafRef.current);
      }
    };
  }, [tiltActive]);

  function pulseOnce() {
    setPulse(1);
    scheduleAfter(120, () => setPulse(0));
  }

  function captureOriginPose(card: CardConfig): Pose {
    const fallback = getStackPose(card, hovered);
    const cardEl = stackCardElsRef.current.get(card.id);
    if (!cardEl) return fallback;

    // Fix 3 — Origin handoff jump from rotated stack card.
    // A rotated element's getBoundingClientRect() returns an inflated, shifted
    // axis-aligned box. Using its center as the actor's mount point puts the
    // actor a couple of pixels off from where the user clicked. Instead, we
    // derive position analytically from the live stack pose (which is exactly
    // the transform the rendered stack card has applied), and only read the DOM
    // rect to detect a meaningful scale divergence (e.g. mid-animation reads).
    const cardRect = cardEl.getBoundingClientRect();
    const measuredScale = cardRect.width / CARD_W;

    return {
      ...fallback,
      // Position is taken straight from the stack pose — pixel-aligned with the
      // currently-rendered card regardless of any rotateY/rotate it has applied.
      // Scale falls back to the analytic value unless the rect read says the
      // card is rendering at a meaningfully different scale.
      scale: Math.abs(measuredScale - fallback.scale) < 0.04 ? fallback.scale : measuredScale,
    };
  }

  function applyActorStep(step: ActorStep) {
    setFocusPhase(step.phase);
    setActorLayer(step.layer);
    setActorSpring(step.spring);
    setAnnouncement(step.announcement);
    scheduleNextFrame(() => {
      setActorPose(step.pose);
    });
  }

  function finishAnimation(card: CardConfig) {
    setActiveCardId(null);
    setFocusPhase("idle");
    setActorLayer("hidden");
    setActorSpring(PHASE_SPRING.idle);
    setActorPose(getStackPose(card, false));
    setAnnouncement("Cards are stacked in the wallet.");
  }

  function closeActiveCard() {
    if (!activeCard) return;
    const profile = CARD_MOTION_PROFILE[activeCard.id];
    const isBottom = activeCard.id === "investing";

    // === Time-reversed extraction ============================================
    //
    // The extraction arc is a four-pose sequence:
    //
    //   stack ─lift─▶ lift ─clear─▶ clear ─present─▶ present ─open─▶ open
    //          below-top      below-top         front              front
    //          (LIFT_MS)      (CLEAR_MS*1.05)   (PRESENT_MS*0.9)
    //
    // For the close to "completely reverse" the extraction (per user spec),
    // the return must retrace the SAME four poses in reverse, with mirrored
    // layers, mirrored per-leg springs, and matching durations. Doing this
    // properly requires splitting the old single-shot `descend` (clear→stack)
    // into two sub-steps so the lift pose isn't skipped:
    //
    //   open ─unyaw──▶ clear ─descend(lift)─▶ lift ─descend(stack)─▶ stack
    //   front          front                  below-top              below-top
    //   (PRESENT_MS*0.9)  (CLEAR_MS*1.05)        (LIFT_MS*0.88)
    //
    // The layer flip from "front" to tuckLayer happens at the descend(lift)
    // step, while the card is geometrically high above the wallet (clear
    // pose) — exactly mirroring extraction's flip at `present`. This makes
    // the flip visually invisible and the card's tuck behind the top sibling
    // / into the pocket happens during the actual descend, just like the
    // extraction's emerge happened during lift+clear.
    //
    // For investing specifically: prior code held the actor at "below-top"
    // for the entire return, which hid it behind trading during the unyaw
    // rise (only the very top of the rise was visible above trading). Now
    // unyaw uses "front" — the card visibly springs UP off the wallet face,
    // then flips behind for the descent, then tucks into the pocket. Mirror
    // of extraction.
    const aboveLayer: ActorLayer = "front";
    const tuckLayer: ActorLayer = isBottom ? "below-top" : "pocket";

    // Mirrored timings derived from extraction constants so the two paths
    // stay symmetric automatically.
    const descendLiftDelay = Math.round(PRESENT_MS * 0.9);
    const descendStackDelay = descendLiftDelay + Math.round(CLEAR_MS * 1.05);
    const seatDelay = descendStackDelay + Math.round(LIFT_MS * 0.88);
    const finishDelay = descendStackDelay + Math.round(LIFT_MS) + SEAT_MS;

    clearPhaseJobs();
    setHovered(false);
    setPointer({ ...REST_POINTER });
    tiltTargetRef.current = { x: 0, y: 0 };

    // 1. unyaw — mirror of `present`. Card rises off the wallet face up to
    // the clear pose, with the same spring personality as extraction's
    // present leg. Stays at "front" (above everything) — same layer the
    // extraction's present step ended at.
    applyActorStep({
      phase: "unyaw",
      spring: springFor(activeCard, "present"),
      pose: {
        ...profile.clear,
        x: profile.clear.x + profile.returnBiasX,
        rotateY: profile.clear.rotateY * 0.35,
      },
      layer: aboveLayer,
      announcement: phaseAnnouncement(activeCard.label, "unyaw"),
    });

    // 2. descend → lift pose — mirror of `clear`. Card drops from clear
    // pose DOWN to lift pose (still partially above the pocket lip). Layer
    // flips to tuckLayer here, in the geometrically-safe high zone — same
    // way extraction flipped layer at the present step.
    scheduleAfter(descendLiftDelay, () => {
      applyActorStep({
        phase: "descend",
        spring: springFor(activeCard, "clear"),
        pose: profile.lift,
        layer: tuckLayer,
        announcement: phaseAnnouncement(activeCard.label, "descend"),
      });
    });

    // 3. descend → stack pose — mirror of `lift`. Card slides from lift
    // pose back into the pocket / behind the top sibling, ending at stack.
    // Reuses the lift spring so the slide-in tempo matches the slide-out.
    scheduleAfter(descendStackDelay, () => {
      applyActorStep({
        phase: "descend",
        spring: springFor(activeCard, "lift"),
        pose: profile.stack,
        layer: tuckLayer,
        announcement: phaseAnnouncement(activeCard.label, "descend"),
      });
    });

    // 4. seat — mirror of `idle`. Confirmation tick + handoff back to the
    // static stack render.
    scheduleAfter(seatDelay, () => {
      pulseOnce();
      setFocusPhase("seat");
      setActorLayer(tuckLayer);
      setAnnouncement(phaseAnnouncement(activeCard.label, "seat"));
    });

    scheduleAfter(finishDelay, () => finishAnimation(activeCard));
  }

  function handleMove(event: MouseEvent<HTMLDivElement>) {
    const rect = (stackRef.current ?? event.currentTarget).getBoundingClientRect();
    const nextPointer = {
      x: Math.min(Math.max((event.clientX - rect.left) / rect.width, 0), 1),
      y: Math.min(Math.max((event.clientY - rect.top) / rect.height, 0), 1),
    };

    // Update tilt target immediately — it's a ref, no re-render cost.
    if (tiltActive) {
      const ndx = (nextPointer.x - 0.5) * 2;
      const ndy = (nextPointer.y - 0.5) * 2;
      tiltTargetRef.current = {
        x: -ndy * MAX_TILT,
        y: ndx * MAX_TILT,
      };
    }

    // Throttle pointer state to one React re-render per animation frame.
    // mousemove fires 2-3× per frame; batching here prevents those extra
    // re-renders from competing with framer-motion's spring animation.
    pointerPendingRef.current = nextPointer;
    if (pointerRafRef.current === null) {
      pointerRafRef.current = window.requestAnimationFrame(() => {
        setPointer(pointerPendingRef.current);
        pointerRafRef.current = null;
      });
    }
  }

  function handleCardClick(cardId: CardId) {
    const clickedCard = CARD_CONFIG.find((card) => card.id === cardId);
    if (!clickedCard) return;

    if (activeCardId && activeCardId !== cardId) return;
    if (activeCardId === cardId && (focusPhase === "open" || focusPhase === "present")) {
      closeActiveCard();
      return;
    }

    // CRITICAL: capture exact DOM origin BEFORE state change so the actor mounts
    // pixel-aligned with where the user just clicked. Pure manual origin correction.
    const originPose = captureOriginPose(clickedCard);
    const isBottom = clickedCard.id === "investing";
    // BOTTOM card: stay BEHIND the top card during lift + clear, so it visibly
    // emerges from BEHIND trading rather than punching through it.
    // TOP card: stay behind the pocket lip during lift + clear so the lip clips
    // its bottom edge as it rises.
    const initialExtractLayer: ActorLayer = isBottom ? "below-top" : "pocket";

    clearPhaseJobs();
    setActiveCardId(cardId);
    setFocusPhase("idle");
    setActorLayer(initialExtractLayer);
    // Snap-tight spring for the very first paint — there is no animation here,
    // motion's `initial={false}` will apply this transform immediately.
    setActorSpring({ stiffness: 1000, damping: 100 });
    setActorPose(originPose);
    setAnnouncement(`${clickedCard.label} card selected.`);
    tiltTargetRef.current = { x: 0, y: 0 };
    tiltPhysicsRef.current = { x: 0, y: 0, vx: 0, vy: 0 };
    tiltRenderRef.current = { x: 0, y: 0 };
    setTilt({ x: 0, y: 0 });
    pulseOnce();

    idleCycleRef.current = (idleCycleRef.current + 1) % 4;
    setIdleDuration([4.64, 4.88, 5.06, 5.18][idleCycleRef.current]);

    // Fix 1 — Extraction stutter at lift-start.
    // Previously we committed an intermediate "near-origin" pose (originPose with
    // scale * 0.992) on the first rAF and only swapped to the real lift target
    // after TAP_MS, which made the actor crawl ~96ms toward a near-identical
    // position. Now we commit the real profile.lift target on the rAF after
    // mount in a single render — motion springs from origin straight to lift
    // with no intermediate, eliminating the hesitation.
    scheduleNextFrame(() => {
      setFocusPhase("lift");
      setActorLayer(initialExtractLayer);
      setActorSpring(springFor(clickedCard, "lift"));
      setAnnouncement(phaseAnnouncement(clickedCard.label, "lift"));
      setActorPose(CARD_MOTION_PROFILE[clickedCard.id].lift);
    });

    scheduleAfter(TAP_MS + Math.round(LIFT_MS * 0.88), () => {
      // Fix 1 + 3 + 5a — Cards must FULLY exit the wallet before promoting.
      // We hold the actor in its extract layer (pocket / below-top) for the
      // entire clear phase. The pocket lip (z:3) keeps clipping the bottom
      // edge while the card rises, so the card visibly emerges through the
      // slot rather than popping out from behind it mid-flight. Promotion to
      // the front-most layer happens only at `present` — by which point the
      // card has cleared the wallet completely.
      applyActorStep({
        phase: "clear",
        spring: springFor(clickedCard, "clear"),
        pose: CARD_MOTION_PROFILE[clickedCard.id].clear,
        layer: initialExtractLayer,
        announcement: phaseAnnouncement(clickedCard.label, "clear"),
      });
    });

    // Skip-forward fix \u2014 hold at clear long enough for the card to actually
    // reach the high "above the pocket" pose before transitioning to present.
    // Previous 0.9 ratio cut clear off mid-spring (the visual high point was
    // never displayed). 1.05 lets clear physically settle, so the user sees
    // the card sitting plainly above the wallet for a beat before it tilts
    // forward into present.
    scheduleAfter(TAP_MS + Math.round(LIFT_MS * 0.88) + Math.round(CLEAR_MS * 1.05), () => {
      applyActorStep({
        phase: "present",
        spring: springFor(clickedCard, "present"),
        pose: CARD_MOTION_PROFILE[clickedCard.id].present,
        layer: "front",
        announcement: phaseAnnouncement(clickedCard.label, "present"),
      });
    });

    scheduleAfter(
      TAP_MS + Math.round(LIFT_MS * 0.88) + Math.round(CLEAR_MS * 1.05) + Math.round(PRESENT_MS * 0.9),
      () => {
        applyActorStep({
          phase: "open",
          spring: springFor(clickedCard, "open"),
          pose: CARD_MOTION_PROFILE[clickedCard.id].open,
          layer: "front",
          announcement: phaseAnnouncement(clickedCard.label, "open"),
        });
      },
    );
  }

  return (
    <div
      data-name="Wallet Canvas"
      className="flex items-center justify-center min-h-screen"
      onMouseMove={handleMove}
      style={{
        backgroundColor: "#a8a8a8",
        backgroundImage: cardFocused
          ? "radial-gradient(circle at top, rgba(255,255,255,0.45), rgba(255,255,255,0) 30%)"
          : "none",
        backgroundSize: "140% 140%",
        backgroundPosition: cardFocused ? "52% 46%" : "50% 50%",
        position: "relative",
        overflow: "hidden",
        transition: "background-position 900ms cubic-bezier(0.22, 1, 0.36, 1)",
      }}
    >
      <div
        aria-live="polite"
        aria-atomic="true"
        style={{
          position: "absolute",
          width: 1,
          height: 1,
          margin: -1,
          padding: 0,
          overflow: "hidden",
          clip: "rect(0, 0, 0, 0)",
          whiteSpace: "nowrap",
          border: 0,
        }}
      >
        {announcement}
      </div>

      <div
        aria-hidden
        style={{
          position: "absolute",
          inset: 0,
          pointerEvents: "none",
          background:
            "radial-gradient(circle at 22% 18%, rgba(255,255,255,0.12), rgba(255,255,255,0) 28%), radial-gradient(circle at 78% 74%, rgba(255,255,255,0.08), rgba(255,255,255,0) 24%)",
          mixBlendMode: "soft-light",
          opacity: 0.85,
          animation: "wallet-ambient-drift 7.4s ease-in-out infinite",
        }}
      />

      <button
        type="button"
        aria-label="Close focused card"
        onClick={closeActiveCard}
        style={{
          position: "absolute",
          inset: 0,
          border: 0,
          background: cardFocused ? "rgba(17,20,28,0.28)" : "rgba(17,20,28,0)",
          backdropFilter: cardFocused ? "blur(14px)" : "blur(0px)",
          WebkitBackdropFilter: cardFocused ? "blur(14px)" : "blur(0px)",
          opacity: cardFocused ? 1 : 0,
          pointerEvents: cardActive ? "auto" : "none",
          transition:
            "opacity 520ms cubic-bezier(0.22, 1, 0.36, 1), backdrop-filter 520ms cubic-bezier(0.22, 1, 0.36, 1), background-color 520ms cubic-bezier(0.22, 1, 0.36, 1)",
        }}
      />

      <div
        style={{
          perspective: 1600,
          position: "relative",
        }}
      >
        <div
          data-name="Wallet Stack"
          ref={stackRef}
          onMouseEnter={() => setHovered(true)}
          onMouseLeave={() => {
            setHovered(false);
            if (pointerRafRef.current !== null) {
              window.cancelAnimationFrame(pointerRafRef.current);
              pointerRafRef.current = null;
            }
            pointerPendingRef.current = { ...REST_POINTER };
            setPointer({ ...REST_POINTER });
            tiltTargetRef.current = { x: 0, y: 0 };
          }}
          style={{
            position: "relative",
            width: 542,
            height: 412,
            perspective: 1600,
            transformStyle: "preserve-3d",
            transform: cardFocused
              ? "translate3d(0, 0, 0) rotateX(1.2deg) scale(0.982)"
              : "translate3d(0, 0, 0) rotateX(0deg) scale(1)",
            filter: cardFocused
              ? `brightness(${0.92 + pulse * 0.04}) contrast(${1.03 + pulse * 0.03})`
              : `brightness(${1 + pulse * 0.06}) contrast(${1 + pulse * 0.03})`,
            transition:
              "transform 560ms cubic-bezier(0.22, 1, 0.36, 1), filter 520ms cubic-bezier(0.22, 1, 0.36, 1)",
            zIndex: 2,
          }}
        >
          <div
            data-name={BASE_CARD_NAME}
            style={{
              position: "absolute",
              inset: 0,
              background: "#13141B",
              borderRadius: 36,
              boxShadow: cardFocused
                ? "0 24px 44px rgba(0,0,0,0.32), 0 8px 20px rgba(0,0,0,0.2)"
                : "0 32px 80px rgba(0,0,0,0.72), 0 12px 32px rgba(0,0,0,0.5)",
              filter: cardFocused ? "blur(2px) saturate(0.85)" : "none",
              transition:
                "box-shadow 700ms cubic-bezier(0.22, 1, 0.36, 1), filter 500ms cubic-bezier(0.22, 1, 0.36, 1)",
            }}
          />

          <div
            data-name="Card Stage"
            ref={stageRef}
            style={{
              position: "absolute",
              top: 12 - CARD_STAGE_HEADROOM,
              left: 12,
              right: 12,
              bottom: 12,
              overflow: "visible",
              borderTopLeftRadius: 24,
              borderTopRightRadius: 24,
              transformStyle: "preserve-3d",
              zIndex: 1,
            }}
          >
            {CARD_CONFIG.map((card, index) => {
              const isActive = activeCardId === card.id;
              if (isActive && activeCard) return null;
              // Fix 2 — Bottom card disappears during return.
              // The dormant pose is recessed (z:-46, scale 0.985); we only want
              // it while the actor is OPENING (lift → clear → present → open).
              // Once we switch into return phases (unyaw → descend → seat) the
              // sibling should glide back to its natural stack/hover pose so the
              // returning actor lands cleanly on top of a stationary stack.
              const isOpening =
                focusPhase === "lift" ||
                focusPhase === "clear" ||
                focusPhase === "present" ||
                focusPhase === "open";
              const useDormant = !!activeCardId && !isActive && isOpening;
              // Sibling reaction (only while opening): when TOP (trading) is
              // extracted the BOTTOM card subtly RISES to fill the freed space.
              // When BOTTOM (investing) is extracted, the TOP card stays put —
              // pulling the under-card shouldn't depress the resting card.
              const passiveReactY = useDormant
                ? (activeCardId === "trading" ? -1.6 : 0)
                : 0;
              const passiveReactScale = useDormant && activeCardId === "trading" ? 1.002 : 1;
              const transform = useDormant
                ? transformFromPose({
                    ...CARD_MOTION_PROFILE[card.id].dormant,
                    y: CARD_MOTION_PROFILE[card.id].dormant.y + passiveReactY,
                    scale: CARD_MOTION_PROFILE[card.id].dormant.scale * passiveReactScale,
                  })
                : getStackTransform(card, hovered);
              // Top card stays above bottom card while stacked.
              const stackZ = card.id === "trading" ? 3 : 2;
              // Cast a soft contact shadow from the lifted actor onto the
              // remaining card — only while the actor is genuinely above it.
              const dormantShadow = useDormant
                ? `${card.shadow}, 0 14px 38px rgba(0,0,0,0.36), 0 4px 12px rgba(0,0,0,0.28)`
                : undefined;

              return (
                <WalletSurfaceCard
                  key={card.id}
                  card={card}
                  pointer={stackPointer}
                  pointerActive={hovered && !activeCardId}
                  transform={transform}
                  opacity={1}
                  opacityDuration={240}
                  filter={useDormant ? "blur(1.8px) saturate(0.82) brightness(0.93)" : "none"}
                  zIndex={activeCardId ? stackZ : card.zIndex}
                  onClick={() => handleCardClick(card.id)}
                  delay={index * 32}
                  spring={PHASE_SPRING.idle}
                  boxShadow={dormantShadow}
                  elementRef={(el) => {
                    if (el) stackCardElsRef.current.set(card.id, el);
                    else stackCardElsRef.current.delete(card.id);
                  }}
                />
              );
            })}

            {/*
              Investing click extender \u2014 the bottom card peeks only ~64px above
              trading and that strip blends into the dark wallet shell, making
              it a hard target. This invisible button covers the upper region
              of the card stage (where only investing exists) and routes its
              clicks to investing. Capped at height:96 so it never overlaps
              trading's hover-lifted top edge (trading at hover sits at
              top:98 within Card Stage). translateZ(8px) ensures it wins
              hit-testing under Card Stage's preserve-3d. Disabled while a
              card is active so it never interferes with the focused-card
              flow or the close action.
            */}
            {!activeCardId && (
              <button
                type="button"
                aria-hidden="true"
                tabIndex={-1}
                onClick={() => handleCardClick("investing")}
                style={{
                  position: "absolute",
                  top: 0,
                  left: 18,
                  width: CARD_W,
                  height: 96,
                  background: "transparent",
                  border: 0,
                  padding: 0,
                  margin: 0,
                  cursor: "pointer",
                  pointerEvents: "auto",
                  transform: "translateZ(8px)",
                }}
              />
            )}
          </div>

          <div
            data-name="Inner Clip Frame"
            style={{
              position: "absolute",
              top: 12,
              left: 12,
              right: 12,
              bottom: 12,
              borderRadius: 24,
              filter: cardFocused ? "blur(4px) saturate(0.8)" : "none",
              transition: "filter 480ms cubic-bezier(0.22, 1, 0.36, 1)",
              zIndex: 3,
              overflow: "hidden",
              pointerEvents: "none",
            }}
          >
            <div
              data-name={BACK_POCKET_NAME}
              style={{
                position: "absolute",
                top: 123,
                left: 0,
                right: 0,
                height: 265,
                filter: "drop-shadow(0px -4px 24px rgba(0,0,0,0.56))",
                zIndex: 3,
              }}
            >
              <div
                data-name="Back Pocket Fill"
                style={{
                  width: "100%",
                  height: "100%",
                  background: "#1A191A",
                  clipPath: ARCH_562,
                }}
              />
            </div>

            <div
              data-name={FRONT_POCKET_NAME}
              style={{
                position: "absolute",
                top: 123,
                left: 16,
                right: 16,
                height: 249,
                zIndex: 4,
                isolation: "isolate",
              }}
            >
              <div
                data-name="Front Pocket Fill"
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
              <svg
                aria-hidden
                width="100%"
                height="100%"
                viewBox="0 0 486 249"
                preserveAspectRatio="none"
                style={{
                  position: "absolute",
                  inset: 0,
                  pointerEvents: "none",
                  zIndex: 5,
                  overflow: "visible",
                }}
              >
                <defs>
                  <linearGradient id="pocketLipShadow" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="rgba(0,0,0,0.55)" />
                    <stop offset="40%" stopColor="rgba(0,0,0,0.18)" />
                    <stop offset="100%" stopColor="rgba(0,0,0,0)" />
                  </linearGradient>
                  <linearGradient id="pocketLipHighlight" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="rgba(255,255,255,0)" />
                    <stop offset="55%" stopColor="rgba(255,255,255,0.06)" />
                    <stop offset="100%" stopColor="rgba(255,255,255,0)" />
                  </linearGradient>
                  <clipPath id="pocketArchClip">
                    <path d={FRONT_POCKET_PATH} />
                  </clipPath>
                </defs>
                <g clipPath="url(#pocketArchClip)">
                  <path
                    d="M 0 56.29 Q 243 0 486 56.29 L 486 100 Q 243 44 0 100 Z"
                    fill="url(#pocketLipShadow)"
                  />
                  <path
                    d="M 0 78 Q 243 22 486 78 L 486 96 Q 243 40 0 96 Z"
                    fill="url(#pocketLipHighlight)"
                  />
                </g>
                <path
                  d="M 0 56.29 Q 243 0 486 56.29"
                  stroke="rgba(0,0,0,0.7)"
                  strokeWidth="1"
                  fill="none"
                  vectorEffect="non-scaling-stroke"
                />
                <path
                  d="M 0 58 Q 243 1.7 486 58"
                  stroke="rgba(255,255,255,0.10)"
                  strokeWidth="0.6"
                  fill="none"
                  vectorEffect="non-scaling-stroke"
                />
              </svg>
              <div
                data-name="Front Pocket Leather Texture"
                style={{
                  position: "absolute",
                  inset: 0,
                  clipPath: ARCH_563,
                  backgroundImage: "url('/leather.png')",
                  backgroundSize: "cover",
                  backgroundPosition: "center",
                  backgroundRepeat: "no-repeat",
                  mixBlendMode: "multiply",
                  opacity: 1,
                  pointerEvents: "none",
                  zIndex: 4,
                }}
              />
              <div
                data-name="Front Pocket Stitching"
                style={{
                  position: "absolute",
                  left: 0,
                  right: 0,
                  top: 56.29,
                  bottom: 0,
                  borderLeft: "2.5px dashed rgba(255,255,255,0.08)",
                  borderRight: "2.5px dashed rgba(255,255,255,0.08)",
                  borderBottom: "2.5px dashed rgba(255,255,255,0.08)",
                  borderBottomLeftRadius: 8,
                  borderBottomRightRadius: 8,
                  pointerEvents: "none",
                  zIndex: 6,
                }}
              />

              {/*
                Brand engraving \u2014 wordmark pressed into the leather. Renders
                the ACME SVG asset directly; the file already has Figma's
                inner-shadow + drop-shadow baked in via SVG filters, so no
                extra effects are needed at the React layer.
              */}
              <div
                data-name="Front Pocket Brand"
                aria-hidden
                style={{
                  position: "absolute",
                  inset: 0,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  pointerEvents: "none",
                  zIndex: 7,
                }}
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={BRAND_LOGO_SRC}
                  alt=""
                  width={BRAND_LOGO_WIDTH}
                  style={{
                    width: BRAND_LOGO_WIDTH,
                    height: "auto",
                    display: "block",
                    userSelect: "none",
                  }}
                  draggable={false}
                />
              </div>
            </div>
          </div>

          <div
            data-name="Inner Overlay Frame"
            style={{
              position: "absolute",
              top: 12,
              left: 12,
              right: 12,
              bottom: 12,
              borderRadius: 24,
              // Soft inner bezel hint without the heavy black outline.
              border: "none",
              boxShadow: "inset 0 0 0 1px rgba(255,255,255,0.02)",
              pointerEvents: "none",
              zIndex: 10,
              // Hide the bezel any time a card is animating so the 1px line
              // never gets traversed by the actor. It only shows at full rest.
              opacity: focusPhase === "idle" ? 1 : 0,
              transition: "opacity 520ms cubic-bezier(0.22, 1, 0.36, 1)",
              willChange: "opacity",
            }}
          />

          <AnimatePresence>
            {activeCard ? (
              <div
                data-name="Actor Layer"
                style={{
                  position: "absolute",
                  top: 12 - CARD_STAGE_HEADROOM,
                  left: 12,
                  right: 12,
                  bottom: 12,
                  overflow: "visible",
                  borderTopLeftRadius: 24,
                  borderTopRightRadius: 24,
                  transformStyle: "preserve-3d",
                  zIndex: actorLayerZIndex(actorLayer),
                  pointerEvents: actorLayer === "hidden" ? "none" : "auto",
                }}
              >
                <div
                  ref={actorWrapperRef}
                  style={{
                    position: "absolute",
                    top: activeCard.top + CARD_STAGE_HEADROOM,
                    left: activeCard.left,
                    width: CARD_W,
                    height: CARD_H,
                    transformStyle: "preserve-3d",
                    transformOrigin: "center 85%",
                    transform: tiltActive
                      ? `rotateX(${tilt.x.toFixed(2)}deg) rotateY(${tilt.y.toFixed(2)}deg) rotateZ(${Math.max(
                          Math.min((tilt.y * tilt.x) / 56, MAX_ROLL),
                          -MAX_ROLL,
                        ).toFixed(2)}deg)`
                      : "rotateX(0deg) rotateY(0deg) rotateZ(0deg)",
                    transition: tiltActive ? "none" : "transform 320ms cubic-bezier(0.22, 1, 0.36, 1)",
                    pointerEvents: "none",
                  }}
                >
                  <div
                    style={{
                      width: "100%",
                      height: "100%",
                      transformStyle: "preserve-3d",
                      animation:
                        focusPhase === "open"
                          ? `wallet-card-idle ${idleDuration.toFixed(2)}s ease-in-out 240ms infinite`
                          : "none",
                    }}
                  >
                    <WalletSurfaceCard
                      card={activeCard}
                      pointer={pointer}
                      pointerActive={focusPhase === "open" || focusPhase === "present"}
                      transform={transformFromPose(actorPose)}
                      zIndex={1}
                      opacity={1}
                      pointerEvents="auto"
                      onClick={closeActiveCard}
                      positionAbsolute={false}
                      active={focusPhase === "open" || focusPhase === "present"}
                      filter={pulse > 0 ? "brightness(1.06) contrast(1.04)" : "none"}
                      boxShadow={(() => {
                        const dx = pointer.x - 0.5;
                        const dy = pointer.y - 0.5;
                        if (focusPhase === "present" || focusPhase === "open") {
                          return `${activeCard.shadow}, ${dx * 24}px ${52 + dy * 12}px 92px rgba(0,0,0,0.2), ${dx * 28}px ${34 + dy * 14}px 132px rgba(0,0,0,0.26)`;
                        }
                        if (focusPhase === "clear" || focusPhase === "unyaw") {
                          return `${activeCard.shadow}, ${dx * 12}px ${28 + dy * 8}px 68px rgba(0,0,0,0.28)`;
                        }
                        return `${activeCard.shadow}, ${dx * 5}px ${14 + dy * 4}px 28px rgba(0,0,0,0.24)`;
                      })()}
                      ariaLabel={
                        focusPhase === "open" || focusPhase === "present"
                          ? `${activeCard.label} card focused`
                          : `${activeCard.label} card`
                      }
                      spring={actorSpring}
                    />
                  </div>
                </div>
              </div>
            ) : null}
          </AnimatePresence>
        </div>
      </div>
    </div>
  );
}
