// Turns trackpad / mouse-wheel motion into single page turns.
// One gesture = one turn: after a turn we wait for the trackpad's momentum to die out
// (a pause between events) before another turn is allowed.
export function wheelPager(flip, { threshold = 50, axis = 'both' } = {}) {
  let acc = 0;
  let last = 0;
  let locked = false;
  let flippedAt = 0;
  return function onWheel(e) {
    const k = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? 400 : 1;
    const dx = e.deltaX * k;
    const dy = e.deltaY * k;
    let d;
    if (axis === 'x') { if (Math.abs(dx) <= Math.abs(dy) * 1.2) return false; d = dx; }
    else d = Math.abs(dx) > Math.abs(dy) ? dx : dy;
    const now = Date.now();
    const gap = now - last;
    last = now;
    if (locked) {
      if (gap < 220 || now - flippedAt < 450) return true;
      locked = false;
      acc = 0;
    }
    if (gap > 350) acc = 0;
    acc += d;
    if (Math.abs(acc) >= threshold) {
      flip(acc > 0 ? 1 : -1);
      acc = 0;
      locked = true;
      flippedAt = now;
    }
    return true;
  };
}

const dist = (t) => Math.hypot(t[0].clientX - t[1].clientX, t[0].clientY - t[1].clientY);

// Touch: one-finger horizontal swipe turns pages, two-finger pinch reports a scale.
export function touchGestures(target, { onSwipe, onPinchMove, onPinchEnd, canSwipe = () => true }) {
  let sx = 0;
  let sy = 0;
  let st = 0;
  let multi = false;
  let startD = 0;
  let ratio = 1;
  let mid = { x: 0, y: 0 };
  target.addEventListener('touchstart', (e) => {
    if (e.touches.length === 1) {
      sx = e.touches[0].clientX; sy = e.touches[0].clientY; st = Date.now(); multi = false;
    } else if (e.touches.length === 2) {
      multi = true;
      startD = dist(e.touches);
      ratio = 1;
    }
  }, { passive: true });
  target.addEventListener('touchmove', (e) => {
    if (e.touches.length === 2 && startD) {
      if (e.cancelable) e.preventDefault();
      ratio = dist(e.touches) / startD;
      mid = { x: (e.touches[0].clientX + e.touches[1].clientX) / 2, y: (e.touches[0].clientY + e.touches[1].clientY) / 2 };
      onPinchMove?.(ratio, mid);
    }
  }, { passive: false });
  target.addEventListener('touchend', (e) => {
    if (startD && e.touches.length < 2) {
      const r = ratio;
      startD = 0;
      ratio = 1;
      onPinchEnd?.(r, mid);
      return;
    }
    if (multi || e.touches.length || e.changedTouches.length !== 1) return;
    const t = e.changedTouches[0];
    const dx = t.clientX - sx;
    const dy = t.clientY - sy;
    if (Date.now() - st > 800) return;
    if (Math.abs(dx) < 50 || Math.abs(dx) < Math.abs(dy) * 1.4) return;
    if (!canSwipe()) return;
    onSwipe?.(dx < 0 ? 1 : -1);
  }, { passive: true });
  // iOS Safari: stop the browser's own page zoom while we handle the pinch.
  target.addEventListener('gesturestart', (e) => e.preventDefault(), { passive: false });
}
