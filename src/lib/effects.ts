/**
 * Picture effects for the live examples (09 and later): each is a plain ffmpeg video filter.
 */

export const EFFECTS: Record<string, { label: string; vf: string }> = {
  gray: { label: 'Grayscale', vf: 'hue=s=0' },
  negate: { label: 'Negative', vf: 'negate' },
  edges: { label: 'Edge detection', vf: 'edgedetect=low=0.1:high=0.3' },
  mirror: { label: 'Mirror', vf: 'hflip' },
  blur: { label: 'Blur', vf: 'boxblur=8' },
  none: { label: 'None', vf: 'null' },
};

/**
 * Filter graph from input 0 (the piped file) to `out`.
 * `split` = left half original, right half processed — handy to see what the effect does.
 */
export function effectGraph(fx: string, split: boolean, out: string): string {
  const f = (EFFECTS[fx] ?? EFFECTS.gray).vf;
  const even = 'scale=trunc(iw/2)*2:trunc(ih/2)*2';   // H.264 / 4:2:0 need even width and height
  if (!split) return `[0:v]${even},${f},format=yuv420p${out}`;
  const half = 'trunc(iw/4)*2';
  return `[0:v]${even},split[o][p];[o]crop=${half}:ih:0:0[l];[p]${f},crop=iw-${half}:ih:${half}:0[r];[l][r]hstack,format=yuv420p${out}`;
}

/** Page controls for startLiveServer(): sends ?fx=…&split=1|0 */
export function effectControls(defaultFx = 'gray', split = true): string {
  const options = Object.entries(EFFECTS)
    .map(([k, e]) => `<option value="${k}"${k === defaultFx ? ' selected' : ''}>${e.label}</option>`).join('');
  return `
  <label>Effect <select data-param="fx">${options}</select></label>
  <label>&nbsp;<span class="check"><input type="checkbox" data-param="split"${split ? ' checked' : ''}> before / after</span></label>`;
}
