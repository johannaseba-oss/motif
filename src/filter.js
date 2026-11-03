// Filter für Sucher und Aufnahme. Beide laufen durch denselben Shader, damit die Marke so aussieht wie die Vorschau.
import { STAMP_ASPECT } from './stamp.js';

export const FILTERS = [
  { id: 'original', label: 'Original' },
  { id: 'retro', label: 'Retro' },
  { id: 'sw', label: 'S/W' },
];

// Gemerkte Auswahl aus älteren Versionen auf die heutigen Filter abbilden
export const knownFilter = id => (id === 'retro2' ? 'retro' : FILTERS.some(f => f.id === id) ? id : 'original');

const VERTEX = `
attribute vec2 p;
uniform vec4 crop;
uniform float mirror;
varying vec2 uv;
void main() {
  vec2 t = p * 0.5 + 0.5;
  float x = mirror > 0.5 ? 1.0 - t.x : t.x;
  uv = vec2(crop.x + x * crop.z, crop.y + (1.0 - t.y) * crop.w);
  gl_Position = vec4(p, 0.0, 1.0);
}`;

const FRAGMENT = `
precision highp float;
varying vec2 uv;
uniform sampler2D tex;
uniform int mode;
uniform float seed;
const vec3 LUMA = vec3(0.2126, 0.7152, 0.0722);

float hash(vec2 q) {
  return fract(sin(dot(q, vec2(12.9898, 78.233)) + seed) * 43758.5453);
}

// Retro: wärmer, mehr Kontrast, tiefe Schatten mit einem Hauch Grün, gedämpfte Lichter, feines Korn
vec3 retro(vec3 c) {
  c = c * vec3(1.04, 1.0, 0.92) + vec3(0.012, 0.005, 0.0);
  c = (c - 0.5) * 1.12 + 0.5;
  float l = dot(clamp(c, 0.0, 1.0), LUMA);
  float shadow = 1.0 - smoothstep(0.0, 0.5, l);
  c *= mix(0.74, 1.0, smoothstep(0.0, 0.55, l));
  c *= mix(1.0, 0.93, smoothstep(0.6, 1.0, l));
  c += vec3(-0.004, 0.012, 0.0) * shadow;
  return c + (hash(gl_FragCoord.xy) - 0.5) * 0.035;
}

void main() {
  vec3 c = texture2D(tex, uv).rgb;
  if (mode == 1) {
    c = retro(c);
  } else if (mode == 2) {
    // Schwarzweiß: mehr Kontrast, hellere Lichter
    float l = dot(c, LUMA);
    l = (l - 0.5) * 1.28 + 0.5;
    l = mix(l, 1.0, 0.24 * smoothstep(0.45, 1.0, l));
    c = vec3(l);
  }
  gl_FragColor = vec4(clamp(c, 0.0, 1.0), 1.0);
}`;

function compile(gl, type, src) {
  const s = gl.createShader(type);
  gl.shaderSource(s, src);
  gl.compileShader(s);
  if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s));
  return s;
}

export class FilterRenderer {
  // Liefert null, wenn das Gerät kein WebGL kann
  static create(canvas) {
    try {
      return new FilterRenderer(canvas);
    } catch {
      return null;
    }
  }

  constructor(canvas) {
    this.canvas = canvas;
    const gl = canvas.getContext('webgl', { preserveDrawingBuffer: true, premultipliedAlpha: false, antialias: false });
    if (!gl) throw new Error('no webgl');
    this.gl = gl;
    const prog = gl.createProgram();
    gl.attachShader(prog, compile(gl, gl.VERTEX_SHADER, VERTEX));
    gl.attachShader(prog, compile(gl, gl.FRAGMENT_SHADER, FRAGMENT));
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(prog));
    gl.useProgram(prog);
    gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    const p = gl.getAttribLocation(prog, 'p');
    gl.enableVertexAttribArray(p);
    gl.vertexAttribPointer(p, 2, gl.FLOAT, false, 0, 0);
    gl.bindTexture(gl.TEXTURE_2D, gl.createTexture());
    for (const [k, v] of [[gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE], [gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE],
      [gl.TEXTURE_MIN_FILTER, gl.LINEAR], [gl.TEXTURE_MAG_FILTER, gl.LINEAR]]) gl.texParameteri(gl.TEXTURE_2D, k, v);
    this.u = Object.fromEntries(['crop', 'mirror', 'mode', 'seed'].map(n => [n, gl.getUniformLocation(prog, n)]));
  }

  // Zeichnet die Quelle mittig im Markenformat mit Zoom, Spiegelung und Filter
  draw(source, srcW, srcH, { width, height, filter = 'original', mirror = false, zoom = 1, seed = 0 }) {
    const { gl, canvas, u } = this;
    if (canvas.width !== width || canvas.height !== height) { canvas.width = width; canvas.height = height; }
    let sw = srcW, sh = srcH;
    if (srcW / srcH > STAMP_ASPECT) sw = srcH * STAMP_ASPECT; else sh = srcW / STAMP_ASPECT;
    const cw = sw / zoom / srcW, ch = sh / zoom / srcH;
    gl.viewport(0, 0, width, height);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGB, gl.RGB, gl.UNSIGNED_BYTE, source);
    gl.uniform4f(u.crop, (1 - cw) / 2, (1 - ch) / 2, cw, ch);
    gl.uniform1f(u.mirror, mirror ? 1 : 0);
    gl.uniform1i(u.mode, Math.max(0, FILTERS.findIndex(f => f.id === filter)));
    gl.uniform1f(u.seed, seed);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    return canvas;
  }
}
