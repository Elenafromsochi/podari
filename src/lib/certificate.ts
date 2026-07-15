// Рендер подарочного сертификата в картинку (PNG) прямо на устройстве —
// один источник и для превью, и для сохранения. Рисуем на <canvas>, потому что
// так надёжно отрисовываются эмодзи-листочки и переносы строк.

export type CertTemplateId =
  | "light-bot"
  | "light-bright"
  | "dark-bot"
  | "dark-min"
  | "light-min"
  | "custom";

export interface CertTemplateMeta {
  id: CertTemplateId;
  label: string;
  dark: boolean;
  needsBg?: boolean;
}

export const CERT_TEMPLATES: CertTemplateMeta[] = [
  { id: "light-bot", label: "Светлая ботаника", dark: false },
  { id: "light-bright", label: "Яркая рамка", dark: false },
  { id: "dark-bot", label: "Тёмная ботаника", dark: true },
  { id: "dark-min", label: "Тёмный минимал", dark: true },
  { id: "light-min", label: "Светлый минимал", dark: false },
  { id: "custom", label: "Своё фото", dark: true, needsBg: true },
];

export interface CertFields {
  template: CertTemplateId;
  toName: string;
  message: string;
  fromName: string;
  giftTitle: string;
  /** Строка срока: «до 31.12.2026» или пусто. */
  term?: string | null;
  /** dataURL своего фона (для шаблона «custom»). */
  bgImage?: string | null;
}

const C = {
  kraft: "#ECE5D3",
  cream: "#F7F3E8",
  olive: "#5E6E33",
  olive2: "#6E7D3F",
  lolive: "#94A662",
  sand: "#CDB47A",
  gold: "#D8C48A",
  ink: "#33321C",
  deep: "#3A2E0A",
  clight: "#F4EFDF",
  cmuted: "#CFD3B2",
  msgLight: "#55523F",
  msgDark: "#E7E6CF",
  mutedLight: "#7D7A63",
};

type Palette = {
  bg: (ctx: CanvasRenderingContext2D, w: number, h: number) => void;
  frame1: { color: string; width: number };
  frame2: { color: string; width: number };
  kicker: string;
  to: string;
  name: string;
  msg: string;
  gift: string;
  from: string;
  rule: string;
  leaves: boolean;
  seal: { bg: string; fg: string } | null;
  overlayCard: boolean; // светлая карточка поверх фона (для custom)
};

function solid(color: string) {
  return (ctx: CanvasRenderingContext2D, w: number, h: number) => {
    ctx.fillStyle = color;
    ctx.fillRect(0, 0, w, h);
  };
}
function gradient(a: string, b: string) {
  return (ctx: CanvasRenderingContext2D, w: number, h: number) => {
    const g = ctx.createLinearGradient(0, 0, w, h);
    g.addColorStop(0, a);
    g.addColorStop(1, b);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
  };
}

function palette(id: CertTemplateId): Palette {
  switch (id) {
    case "light-bright":
      return {
        bg: solid(C.cream),
        frame1: { color: C.lolive, width: 10 },
        frame2: { color: C.sand, width: 3 },
        kicker: C.olive, to: C.mutedLight, name: C.deep, msg: C.msgLight,
        gift: C.olive2, from: C.mutedLight, rule: C.lolive,
        leaves: false, seal: null, overlayCard: false,
      };
    case "dark-bot":
      return {
        bg: gradient("#4C5A2E", "#39451E"),
        frame1: { color: "rgba(244,239,223,0.85)", width: 3 },
        frame2: { color: "rgba(244,239,223,0.4)", width: 2 },
        kicker: C.gold, to: C.cmuted, name: C.clight, msg: C.msgDark,
        gift: C.gold, from: C.cmuted, rule: C.gold,
        leaves: true, seal: { bg: "rgba(244,239,223,0.15)", fg: "#fff" }, overlayCard: false,
      };
    case "dark-min":
      return {
        bg: solid("#3C4820"),
        frame1: { color: C.gold, width: 2 },
        frame2: { color: "rgba(216,196,138,0.4)", width: 2 },
        kicker: C.gold, to: C.cmuted, name: C.clight, msg: C.msgDark,
        gift: C.gold, from: C.cmuted, rule: C.gold,
        leaves: false, seal: null, overlayCard: false,
      };
    case "light-min":
      return {
        bg: solid(C.kraft),
        frame1: { color: C.olive, width: 2 },
        frame2: { color: "rgba(94,110,51,0.35)", width: 2 },
        kicker: C.olive, to: C.mutedLight, name: C.deep, msg: C.msgLight,
        gift: C.olive, from: C.mutedLight, rule: C.sand,
        leaves: false, seal: null, overlayCard: false,
      };
    case "custom":
      return {
        bg: solid("#3a3a2a"),
        frame1: { color: "rgba(255,255,255,0)", width: 0 },
        frame2: { color: "rgba(255,255,255,0)", width: 0 },
        kicker: C.olive, to: C.mutedLight, name: C.deep, msg: C.msgLight,
        gift: C.olive, from: C.mutedLight, rule: C.sand,
        leaves: false, seal: null, overlayCard: true,
      };
    case "light-bot":
    default:
      return {
        bg: solid(C.kraft),
        frame1: { color: C.olive, width: 3 },
        frame2: { color: "rgba(94,110,51,0.35)", width: 2 },
        kicker: C.olive, to: C.mutedLight, name: C.deep, msg: C.msgLight,
        gift: C.olive, from: C.mutedLight, rule: C.sand,
        leaves: true, seal: { bg: C.lolive, fg: "#22270F" }, overlayCard: false,
      };
  }
}

function roundRectPath(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });
}

function wrap(ctx: CanvasRenderingContext2D, text: string, maxW: number, maxLines = 3): string[] {
  const words = (text || "").trim().split(/\s+/).filter(Boolean);
  if (!words.length) return [];
  const lines: string[] = [];
  let line = "";
  for (const w of words) {
    const test = line ? `${line} ${w}` : w;
    if (ctx.measureText(test).width > maxW && line) {
      lines.push(line);
      line = w;
      if (lines.length === maxLines - 1) break;
    } else {
      line = test;
    }
  }
  if (line) lines.push(line);
  // остаток, что не влез, приклеиваем к последней строке с …
  return lines.slice(0, maxLines);
}

const SERIF = "Georgia, 'Times New Roman', serif";
const SANS = "'Segoe UI', system-ui, -apple-system, sans-serif";

/** Рисует сертификат и возвращает dataURL (PNG). */
export async function renderCertificate(fields: CertFields): Promise<string> {
  const W = 1080;
  const H = 1350;
  const canvas = document.createElement("canvas");
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext("2d")!;
  const p = palette(fields.template);

  // Фон
  if (fields.template === "custom" && fields.bgImage) {
    try {
      const img = await loadImage(fields.bgImage);
      const scale = Math.max(W / img.width, H / img.height);
      const dw = img.width * scale;
      const dh = img.height * scale;
      ctx.drawImage(img, (W - dw) / 2, (H - dh) / 2, dw, dh);
      ctx.fillStyle = "rgba(0,0,0,0.18)";
      ctx.fillRect(0, 0, W, H);
    } catch {
      p.bg(ctx, W, H);
    }
  } else {
    p.bg(ctx, W, H);
  }

  // Листочки по углам
  if (p.leaves) {
    ctx.save();
    ctx.globalAlpha = fields.template === "dark-bot" ? 0.22 : 0.13;
    ctx.font = `250px ${SANS}`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.translate(70, 70);
    ctx.rotate((-15 * Math.PI) / 180);
    ctx.fillText("🌿", 0, 0);
    ctx.restore();
    ctx.save();
    ctx.globalAlpha = fields.template === "dark-bot" ? 0.22 : 0.13;
    ctx.font = `250px ${SANS}`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.translate(W - 70, H - 70);
    ctx.rotate((165 * Math.PI) / 180);
    ctx.fillText("🌿", 0, 0);
    ctx.restore();
  }

  // Рамки
  if (p.frame1.width > 0) {
    ctx.strokeStyle = p.frame1.color;
    ctx.lineWidth = p.frame1.width;
    roundRectPath(ctx, 40, 40, W - 80, H - 80, 28);
    ctx.stroke();
  }
  if (p.frame2.width > 0) {
    ctx.strokeStyle = p.frame2.color;
    ctx.lineWidth = p.frame2.width;
    roundRectPath(ctx, 56, 56, W - 112, H - 112, 22);
    ctx.stroke();
  }

  // Светлая карточка поверх фото (custom)
  let cardPad = 90;
  if (p.overlayCard) {
    const cx = 70, cw = W - 140;
    // высоту прикинем позже — рисуем фон карточки на всю центральную зону
    ctx.fillStyle = "rgba(247,243,232,0.94)";
    roundRectPath(ctx, cx, 300, cw, H - 600, 26);
    ctx.fill();
    cardPad = 120;
  }

  // Контентный блок — считаем высоты и центрируем по вертикали
  ctx.textAlign = "center";
  ctx.textBaseline = "alphabetic";
  const msgFont = `34px ${SANS}`;
  ctx.font = msgFont;
  const msgLines = wrap(ctx, fields.message || "", W - cardPad * 2, 3);

  type El = { h: number; gap: number; draw: (y: number) => void };
  const els: El[] = [];
  const cxc = W / 2;

  if (p.seal) {
    els.push({
      h: 116, gap: 26,
      draw: (y) => {
        ctx.save();
        ctx.fillStyle = (p.seal as { bg: string }).bg;
        ctx.beginPath();
        ctx.arc(cxc, y + 58, 58, 0, Math.PI * 2);
        ctx.fill();
        ctx.font = `52px ${SANS}`;
        ctx.textBaseline = "middle";
        ctx.fillText("🌿", cxc, y + 60);
        ctx.restore();
      },
    });
  }
  els.push({
    h: 30, gap: 20,
    draw: (y) => {
      ctx.save();
      ctx.font = `26px ${SERIF}`;
      ctx.fillStyle = p.kicker;
      try { ctx.letterSpacing = "6px"; } catch { /* старый браузер */ }
      ctx.textBaseline = "alphabetic";
      ctx.fillText("ПОДАРОЧНЫЙ СЕРТИФИКАТ", cxc + 3, y + 26);
      try { ctx.letterSpacing = "0px"; } catch { /* noop */ }
      ctx.restore();
    },
  });
  els.push({
    h: 30, gap: 6,
    draw: (y) => {
      ctx.font = `28px ${SANS}`;
      ctx.fillStyle = p.to;
      ctx.textBaseline = "alphabetic";
      ctx.fillText("Для", cxc, y + 26);
    },
  });
  els.push({
    h: 88, gap: 18,
    draw: (y) => {
      ctx.font = `74px ${SERIF}`;
      ctx.fillStyle = p.name;
      ctx.textBaseline = "alphabetic";
      ctx.fillText(fields.toName || "…", cxc, y + 72);
    },
  });
  if (msgLines.length) {
    els.push({
      h: msgLines.length * 44, gap: 24,
      draw: (y) => {
        ctx.font = msgFont;
        ctx.fillStyle = p.msg;
        ctx.textBaseline = "alphabetic";
        msgLines.forEach((ln, i) => ctx.fillText(ln, cxc, y + 34 + i * 44));
      },
    });
  }
  els.push({
    h: 50, gap: 20,
    draw: (y) => {
      ctx.font = `bold 46px ${SERIF}`;
      ctx.fillStyle = p.gift;
      ctx.textBaseline = "alphabetic";
      const t = fields.giftTitle || "Подарок";
      // укоротим слишком длинное название
      let s = t;
      while (ctx.measureText(s).width > W - cardPad * 2 && s.length > 4) s = s.slice(0, -2);
      ctx.fillText(s === t ? t : s + "…", cxc, y + 44);
    },
  });
  els.push({
    h: 26, gap: 0,
    draw: (y) => {
      ctx.font = `24px ${SANS}`;
      ctx.fillStyle = p.from;
      ctx.textBaseline = "alphabetic";
      const term = fields.term ? ` · ${fields.term}` : "";
      ctx.fillText(`от ${fields.fromName || "…"}${term}`, cxc, y + 22);
    },
  });

  const totalH = els.reduce((s, e) => s + e.h + e.gap, 0);
  let y = (H - totalH) / 2;
  for (const e of els) {
    e.draw(y);
    y += e.h + e.gap;
  }

  return canvas.toDataURL("image/png");
}
