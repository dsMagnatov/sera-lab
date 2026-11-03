const clamp = (value) => Math.max(0, Math.min(1, value));
export const CAMERA_START_DEPTH = 16;
export const COMPACT_HERO_QUERY = '(max-width: 767px), (pointer: coarse) and (max-height: 480px)';
const smooth = (start, end, value) => {
  const t = clamp((value - start) / (end - start));
  return t * t * (3 - 2 * t);
};

export function getScrollState(progress) {
  const p = clamp(progress);
  return {
    progress: p,
    centering: smooth(0.1, 0.38, p),
    retreat: smooth(0.4, 0.72, p) * 2.8,
    framing: smooth(0.74, 1, p),
    onScreen: true,
  };
}

export function getContentScale(retreat) {
  return CAMERA_START_DEPTH / (CAMERA_START_DEPTH + retreat);
}

export class ScrollTransition {
  constructor(onUpdate) {
    this.track = document.querySelector('.hero-story');
    this.frame = document.querySelector('.hero-frame');
    this.scene = document.querySelector('#scene');
    this.mobileLayout = matchMedia(COMPACT_HERO_QUERY);
    this.onUpdate = onUpdate;
    this.abort = new AbortController();
    this.frameId = 0;
    this.lastTime = 0;
    this.measure();
    this.progress = this.target;
    this.apply();
    const options = { passive: true, signal: this.abort.signal };
    addEventListener('scroll', () => { this.readPosition(); this.requestFrame(); }, options);
    addEventListener('resize', () => { this.measure(); this.requestFrame(); }, options);
    addEventListener('pageshow', () => { this.measure(); this.requestFrame(); }, options);
  }

  measure() {
    this.top = this.track.getBoundingClientRect().top + scrollY;
    const mobile = this.mobileLayout.matches;
    this.height = mobile ? this.scene.offsetHeight : this.track.offsetHeight;
    this.distance = Math.max(1, mobile ? this.height * 0.72 : this.height - innerHeight);
    this.readPosition();
  }

  readPosition() {
    this.target = clamp((scrollY - this.top) / this.distance);
    this.onScreen = scrollY < this.top + this.height && scrollY + innerHeight > this.top;
  }

  requestFrame() {
    if (this.frameId) return;
    this.lastTime = performance.now();
    this.frameId = requestAnimationFrame((now) => this.tick(now));
  }

  tick(now) {
    const delta = Math.min((now - this.lastTime) / 1000, 0.05);
    this.lastTime = now;
    this.progress += (this.target - this.progress) * (1 - Math.exp(-delta * 11));
    if (Math.abs(this.target - this.progress) < 0.0001) this.progress = this.target;
    this.apply();
    this.frameId = this.progress === this.target ? 0 : requestAnimationFrame((time) => this.tick(time));
  }

  apply() {
    this.state = { ...getScrollState(this.progress), onScreen: this.onScreen };
    const { framing, retreat } = this.state;
    const inset = framing * 24;
    // Cover the inset rectangle uniformly, keeping the 3D canvas undistorted.
    const sceneScale = Math.max(1 - inset * 2 / innerWidth, 1 - inset * 2 / innerHeight);
    this.frame.style.setProperty('--frame-inset', `${inset.toFixed(3)}px`);
    this.frame.style.setProperty('--scene-scale', sceneScale.toFixed(6));
    this.frame.style.setProperty('--hero-content-scale', getContentScale(retreat).toFixed(6));
    this.onUpdate(this.state);
  }

  dispose() {
    this.abort.abort();
    cancelAnimationFrame(this.frameId);
    this.frame.style.removeProperty('--frame-inset');
    this.frame.style.removeProperty('--scene-scale');
    this.frame.style.removeProperty('--hero-content-scale');
  }
}
