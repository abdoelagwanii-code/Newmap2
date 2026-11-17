(function (g) {
'use strict';
const a = 6378137, f = 1 / 298.257223563, k0 = 0.9996, e2 = f * (2 - f), ep2 = e2 / (1 - e2), D2R = Math.PI / 180, R = 6371008.8;
function zoneOf(lng) { return Math.min(60, Math.max(1, Math.floor((lng + 180) / 6) + 1)); }
function toUTM(lat, lng, zone) {
  zone = zone || zoneOf(lng);
  const lam0 = ((zone - 1) * 6 - 180 + 3) * D2R, phi = lat * D2R, lam = lng * D2R;
  const s = Math.sin(phi), c = Math.cos(phi), t = Math.tan(phi);
  const N = a / Math.sqrt(1 - e2 * s * s), T = t * t, C = ep2 * c * c, A = c * (lam - lam0);
  const M = a * ((1 - e2 / 4 - 3 * e2 * e2 / 64 - 5 * Math.pow(e2, 3) / 256) * phi - (3 * e2 / 8 + 3 * e2 * e2 / 32 + 45 * Math.pow(e2, 3) / 1024) * Math.sin(2 * phi) +
    (15 * e2 * e2 / 256 + 45 * Math.pow(e2, 3) / 1024) * Math.sin(4 * phi) - (35 * Math.pow(e2, 3) / 3072) * Math.sin(6 * phi));
  const E = k0 * N * (A + (1 - T + C) * Math.pow(A, 3) / 6 + (5 - 18 * T + T * T + 72 * C - 58 * ep2) * Math.pow(A, 5) / 120) + 500000;
  let Nn = k0 * (M + N * t * (A * A / 2 + (5 - T + 9 * C + 4 * C * C) * Math.pow(A, 4) / 24 + (61 - 58 * T + T * T + 600 * C - 330 * ep2) * Math.pow(A, 6) / 720));
  if (lat < 0) Nn += 10000000;
  return { zone: zone, hemi: lat < 0 ? 'S' : 'N', e: E, n: Nn };
}
function fromUTM(zone, hemi, E, Nn) {
  const e1 = (1 - Math.sqrt(1 - e2)) / (1 + Math.sqrt(1 - e2));
  const x = E - 500000, y = hemi === 'S' ? Nn - 10000000 : Nn;
  const M = y / k0, mu = M / (a * (1 - e2 / 4 - 3 * e2 * e2 / 64 - 5 * Math.pow(e2, 3) / 256));
  const p1 = mu + (3 * e1 / 2 - 27 * Math.pow(e1, 3) / 32) * Math.sin(2 * mu) + (21 * e1 * e1 / 16 - 55 * Math.pow(e1, 4) / 32) * Math.sin(4 * mu) +
    (151 * Math.pow(e1, 3) / 96) * Math.sin(6 * mu) + (1097 * Math.pow(e1, 4) / 512) * Math.sin(8 * mu);
  const s = Math.sin(p1), c = Math.cos(p1), t = Math.tan(p1);
  const N1 = a / Math.sqrt(1 - e2 * s * s), T1 = t * t, C1 = ep2 * c * c, R1 = a * (1 - e2) / Math.pow(1 - e2 * s * s, 1.5), d = x / (N1 * k0);
  const lat = p1 - (N1 * t / R1) * (d * d / 2 - (5 + 3 * T1 + 10 * C1 - 4 * C1 * C1 - 9 * ep2) * Math.pow(d, 4) / 24 + (61 + 90 * T1 + 298 * C1 + 45 * T1 * T1 - 252 * ep2 - 3 * C1 * C1) * Math.pow(d, 6) / 720);
  const lon = (d - (1 + 2 * T1 + C1) * Math.pow(d, 3) / 6 + (5 - 2 * C1 + 28 * T1 - 3 * C1 * C1 + 8 * ep2 + 24 * T1 * T1) * Math.pow(d, 5) / 120) / c;
  return { lat: lat / D2R, lng: ((zone - 1) * 6 - 180 + 3) + lon / D2R };
}
function dist(p, q) {
  const dLa = (q[0] - p[0]) * D2R, dLo = (q[1] - p[1]) * D2R;
  const h = Math.pow(Math.sin(dLa / 2), 2) + Math.cos(p[0] * D2R) * Math.cos(q[0] * D2R) * Math.pow(Math.sin(dLo / 2), 2);
  return 2 * R * Math.asin(Math.sqrt(h));
}
function length(c, closed) {
  let s = 0; for (let i = 1; i < c.length; i++) s += dist(c[i - 1], c[i]);
  if (closed && c.length > 2) s += dist(c[c.length - 1], c[0]);
  return s;
}
function area(c) {
  if (c.length < 3) return 0; let s = 0;
  for (let i = 0; i < c.length; i++) { const p = c[i], q = c[(i + 1) % c.length]; s += (q[1] - p[1]) * D2R * (2 + Math.sin(p[0] * D2R) + Math.sin(q[0] * D2R)); }
  return Math.abs(s * R * R / 2);
}
g.Geo = { toUTM: toUTM, fromUTM: fromUTM, dist: dist, length: length, area: area, zoneOf: zoneOf };
})(typeof window !== 'undefined' ? window : globalThis);
