/* Objets low-poly : chaque objet est fait de facettes à 2-3 tons (style 3D stylisé, tendance 2026).
   window.OBJ_SVG(id) renvoie le SVG d'un objet. Les ids sont définis côté serveur. */
(() => {
  const hex = h => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16));
  const toHex = a => '#' + a.map(v => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, '0')).join('');
  const mix = (a, b, t) => { const A = hex(a), B = hex(b); return toHex(A.map((v, i) => v + (B[i] - v) * t)); };
  const shades = base => ({ light: mix(base, '#ffffff', 0.38), base, dark: mix(base, '#1d2b28', 0.28) });
  const f1 = v => v.toFixed(1);
  const P = pts => pts.map(p => f1(p[0]) + ',' + f1(p[1])).join(' ');

  // Éventail de triangles autour d'un centre : facette par segment du contour
  function fan(pts, c, colorOf) {
    return pts.map((p, k) => {
      const q = pts[(k + 1) % pts.length];
      return `<polygon points="${P([c, p, q])}" fill="${colorOf(k, p, q)}"/>`;
    }).join('');
  }
  // Sphère facettée : trois zones d'ombre (haut-gauche clair, droite moyen, bas-gauche sombre)
  function sphere(cx, cy, r, base) {
    const s = shades(base);
    const at = a => [cx + r * Math.cos(a), cy + r * Math.sin(a)];
    const arc = (a0, a1, n = 6) => Array.from({ length: n + 1 }, (_, i) => at(a0 + (a1 - a0) * i / n));
    const poly = (pts, fill) => `<polygon points="${P([[cx, cy], ...pts])}" fill="${fill}"/>`;
    const PI = Math.PI;
    return poly(arc(PI, 1.5 * PI), s.light) + poly(arc(1.5 * PI, 2 * PI + 0.1), s.base) + poly(arc(0.1, PI), s.dark);
  }
  const shadow = (cx = 32, rx = 18) => `<ellipse cx="${cx}" cy="60" rx="${rx}" ry="3.5" fill="rgba(47,59,56,.14)"/>`;
  const svg = inner => `<svg viewBox="0 0 64 64" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">${shadow()}${inner}</svg>`;

  const T = '#2a9d8f', TERRA = '#d1785a', SAGE = '#b7c9b1', SAND = '#e6d8c3', SKY = '#a9c9d6', PAPER = '#fffdf9', INK = '#2f3b38';

  const OBJ = {
    cherry: () => svg(
      `<path d="M22 32 Q30 20 34 10 M44 28 Q38 18 34 10" stroke="#6f8a68" stroke-width="3" fill="none" stroke-linecap="round"/>` +
      `<ellipse cx="41" cy="12" rx="9" ry="4.5" transform="rotate(-22 41 12)" fill="${SAGE}"/>` +
      sphere(22, 44, 12, TERRA) + sphere(44, 40, 12, TERRA)),

    star: () => {
      const c = [32, 34], pts = [];
      for (let i = 0; i < 10; i++) {
        const r = i % 2 ? 11 : 26, a = -Math.PI / 2 + i * Math.PI / 5;
        pts.push([c[0] + r * Math.cos(a), c[1] + r * Math.sin(a)]);
      }
      const S = shades('#f2c14e');
      return svg(fan(pts, c, (k) => (k % 2 ? S.dark : k % 4 === 0 ? S.light : S.base)));
    },

    heart: () => {
      const c = [32, 34], pts = [];
      for (let i = 0; i < 24; i++) {
        const t = i / 24 * 2 * Math.PI;
        const x = 16 * Math.pow(Math.sin(t), 3);
        const y = -(13 * Math.cos(t) - 5 * Math.cos(2 * t) - 2 * Math.cos(3 * t) - Math.cos(4 * t));
        pts.push([c[0] + x * 1.3, c[1] + y * 1.3 + 2]);
      }
      const s = shades(TERRA);
      return svg(fan(pts, c, (k, p) => (p[0] < c[0] ? s.light : s.dark)));
    },

    moon: () => svg(sphere(32, 32, 24, SKY) + `<circle cx="44" cy="25" r="20" fill="${PAPER}"/>`),

    mushroom: () => svg(
      `<rect x="26" y="34" width="12" height="20" rx="4" fill="${SAND}"/><rect x="33" y="34" width="5" height="20" rx="2" fill="${shades(SAND).dark}"/>` +
      `<path d="M8 34 A24 22 0 0 1 56 34 Z" fill="${TERRA}"/><path d="M8 34 A24 22 0 0 1 32 12 L32 34 Z" fill="${shades(TERRA).light}"/>` +
      `<circle cx="24" cy="24" r="3.5" fill="${PAPER}"/><circle cx="41" cy="22" r="2.6" fill="${PAPER}"/>`),

    cactus: () => svg(
      `<rect x="12" y="26" width="14" height="8" rx="4" fill="${SAGE}"/><rect x="12" y="18" width="8" height="18" rx="4" fill="${SAGE}"/>` +
      `<rect x="40" y="30" width="12" height="8" rx="4" fill="${SAGE}"/><rect x="44" y="20" width="8" height="18" rx="4" fill="${SAGE}"/>` +
      `<rect x="24" y="8" width="16" height="48" rx="8" fill="${shades(SAGE).base}"/><rect x="33" y="8" width="7" height="48" rx="4" fill="${shades(SAGE).dark}" opacity=".7"/>` +
      `<rect x="28" y="16" width="5" height="3" rx="1.5" fill="${PAPER}" opacity=".7"/>`),

    diamond: () => {
      const c = [32, 26], pts = [[32, 6], [54, 24], [32, 58], [10, 24]];
      const s = shades(SKY);
      return svg(fan(pts, c, (k) => [s.light, s.dark, s.base, s.light][k]));
    },

    drop: () => svg(
      `<path d="M32 6 C20 24 12 34 12 42 A20 20 0 0 0 32 62 Z" fill="${SKY}"/>` +
      `<path d="M32 6 C44 24 52 34 52 42 A20 20 0 0 1 32 62 Z" fill="${shades(SKY).dark}"/>` +
      `<path d="M20 40 A12 12 0 0 0 26 48" stroke="${PAPER}" stroke-width="3" fill="none" stroke-linecap="round" opacity=".8"/>`),

    leaf: () => svg(
      `<path d="M10 54 Q10 14 54 10 Z" fill="${shades(SAGE).light}"/><path d="M10 54 Q54 50 54 10 Z" fill="${shades(SAGE).dark}"/>` +
      `<path d="M12 52 L52 12" stroke="${PAPER}" stroke-width="2" opacity=".7"/>`),

    planet: () => svg(
      sphere(32, 33, 18, SAND) +
      `<ellipse cx="32" cy="33" rx="28" ry="8" transform="rotate(-18 32 33)" fill="none" stroke="${TERRA}" stroke-width="4"/>`),

    house: () => svg(
      `<rect x="14" y="30" width="36" height="28" rx="2" fill="${SAND}"/><rect x="40" y="30" width="10" height="28" fill="${shades(SAND).dark}"/>` +
      `<polygon points="${P([[8, 32], [32, 10], [56, 32]])}" fill="${T}"/>` +
      `<polygon points="${P([[8, 32], [32, 10], [32, 32]])}" fill="${shades(T).light}"/>` +
      `<rect x="28" y="42" width="8" height="16" rx="2" fill="${T}"/>`),

    flower: () => {
      let petals = '';
      for (let k = 0; k < 5; k++) {
        const a = -Math.PI / 2 + k * 2 * Math.PI / 5;
        petals += sphere(32 + 15 * Math.cos(a), 32 + 15 * Math.sin(a), 10, TERRA);
      }
      return svg(petals + sphere(32, 32, 9, SAND));
    },

    bear: () => svg(
      sphere(16, 18, 8, SAND) + sphere(48, 18, 8, SAND) + sphere(32, 36, 22, SAND) +
      sphere(32, 44, 9, PAPER) +
      `<circle cx="24" cy="34" r="2.6" fill="${INK}"/><circle cx="40" cy="34" r="2.6" fill="${INK}"/><ellipse cx="32" cy="41" rx="2.6" ry="2" fill="${INK}"/>`),

    cat: () => svg(
      `<polygon points="${P([[12, 30], [16, 8], [30, 22]])}" fill="${shades(SAGE).dark}"/>` +
      `<polygon points="${P([[52, 30], [48, 8], [34, 22]])}" fill="${shades(SAGE).dark}"/>` +
      sphere(32, 38, 22, SAGE) +
      `<circle cx="24" cy="36" r="2.6" fill="${INK}"/><circle cx="40" cy="36" r="2.6" fill="${INK}"/><path d="M29 42 L32 45 L35 42" stroke="${INK}" stroke-width="2" fill="none" stroke-linecap="round"/>`),

    egg: () => {
      const c = [32, 34], pts = [];
      for (let i = 0; i < 24; i++) {
        const a = i / 24 * 2 * Math.PI;
        pts.push([c[0] + 18 * Math.cos(a), c[1] + 24 * Math.sin(a)]);
      }
      const s = shades(SAND);
      return svg(fan(pts, c, (k, p) => (p[0] < c[0] ? s.light : s.dark)));
    },

    cloud: () => svg(sphere(22, 38, 14, SKY) + sphere(42, 30, 18, SKY) + sphere(48, 44, 12, SKY)),
  };

  window.OBJ_SVG = id => (OBJ[id] ? OBJ[id]() : '');
  window.OBJ_IDS = Object.keys(OBJ);
})();
