/**
 * NovelShelf Motion & Haptics System (ColorOS 17 "Living Flow")
 * Loaded before app.js. Pure vanilla JS with no external dependencies.
 */
(function (global) {
  'use strict';

  // --- Reduce Effects State ---
  function effectsReduced() {
    if (typeof global._effectsReducedOverride === 'boolean') {
      return global._effectsReducedOverride;
    }
    const root = document.documentElement;
    return root.classList.contains('reduced-effects') ||
      root.getAttribute('data-reduced-motion') === 'true';
  }
  global.effectsReduced = effectsReduced;

  // --- Haptics Bridge ---
  function haptic(kind = 'tick') {
    if (effectsReduced()) return;
    try {
      if (global.Android && typeof global.Android.haptic === 'function') {
        global.Android.haptic(kind);
      } else if (navigator && typeof navigator.vibrate === 'function') {
        navigator.vibrate(kind === 'confirm' ? 25 : 10);
      }
    } catch (e) {
      // Ignore vibration errors
    }
  }
  global.haptic = haptic;

  // --- CSS Motion Tokens Reader ---
  function getMotionTokens() {
    const style = getComputedStyle(document.documentElement);
    return {
      easeSpring: style.getPropertyValue('--ease-spring').trim() || 'cubic-bezier(0.34, 1.56, 0.64, 1)',
      easeSheet: style.getPropertyValue('--ease-sheet').trim() || 'cubic-bezier(0.32, 0.72, 0, 1)',
      easeOutSoft: style.getPropertyValue('--ease-out-soft').trim() || 'cubic-bezier(0.22, 1, 0.36, 1)',
      durPress: parseInt(style.getPropertyValue('--dur-press'), 10) || 150,
      durMove: parseInt(style.getPropertyValue('--dur-move'), 10) || 320
    };
  }

  // --- Physics-based Spring Helper ---
  // Analytical damped harmonic oscillator (stiffness, damping, mass)
  // Highly performant, interruptible, and clean cancellation for 120Hz screens.
  function createSpring({
    stiffness = 280,
    damping = 24,
    mass = 1,
    initialVelocity = 0,
    from = 0,
    to = 1,
    precision = 0.001,
    onUpdate = null,
    onComplete = null
  } = {}) {
    if (effectsReduced()) {
      if (onUpdate) onUpdate(to);
      if (onComplete) onComplete();
      return { cancel: () => {} };
    }

    const w0 = Math.sqrt(stiffness / mass);
    const zeta = damping / (2 * Math.sqrt(stiffness * mass));
    const delta = to - from;

    let startTime = null;
    let animId = null;
    let cancelled = false;

    function solve(tSec) {
      if (zeta < 1) {
        // Underdamped (standard spring with natural overshoot)
        const wd = w0 * Math.sqrt(1 - zeta * zeta);
        const envelope = Math.exp(-zeta * w0 * tSec);
        const cosTerm = Math.cos(wd * tSec);
        const sinTerm = Math.sin(wd * tSec);
        const b = (initialVelocity + zeta * w0 * delta) / wd;
        return to - envelope * (delta * cosTerm + b * sinTerm);
      } else {
        // Critically damped or overdamped
        const envelope = Math.exp(-w0 * tSec);
        return to - envelope * (delta + (initialVelocity + w0 * delta) * tSec);
      }
    }

    function tick(timestamp) {
      if (cancelled) return;
      if (!startTime) startTime = timestamp;
      const tSec = Math.max(0, (timestamp - startTime) / 1000);

      const val = solve(tSec);
      if (onUpdate) onUpdate(val);

      const envelope = Math.exp(-zeta * w0 * tSec);
      if (tSec > 0.04 && envelope < precision) {
        if (onUpdate) onUpdate(to);
        if (onComplete) onComplete();
        return;
      }

      animId = requestAnimationFrame(tick);
    }

    animId = requestAnimationFrame(tick);

    return {
      cancel() {
        cancelled = true;
        if (animId) cancelAnimationFrame(animId);
      }
    };
  }

  // --- Delegated Squish / Spring Press System ---
  let activeTarget = null;
  let activePointerId = null;
  let startX = 0;
  let startY = 0;
  let cardTimer = null;
  let isCard = false;
  let currentSpring = null;
  let currentScaleX = 1;
  let currentScaleY = 1;
  let currentTransX = 0;
  let currentTransY = 0;

  function isSquishable(element) {
    if (!element || element.nodeType !== 1) return null;
    return element.closest(
      '[data-squish], .btn, .icon-btn, .status-tab, .time-pill-btn, .pill-btn, .toggle-btn, .btn-quick-chapter, .novel-card, .btn-back, .nav-item'
    );
  }

  function cancelActivePress(returnToRest = true) {
    if (cardTimer) {
      clearTimeout(cardTimer);
      cardTimer = null;
    }
    if (!activeTarget) return;

    const el = activeTarget;
    activeTarget = null;
    activePointerId = null;

    if (currentSpring) {
      currentSpring.cancel();
      currentSpring = null;
    }

    if (returnToRest && !effectsReduced()) {
      const fromSx = currentScaleX;
      const fromSy = currentScaleY;
      const fromTx = currentTransX;
      const fromTy = currentTransY;

      currentSpring = createSpring({
        stiffness: isCard ? 300 : 360,
        damping: isCard ? 20 : 18,
        mass: 1,
        from: 0,
        to: 1,
        onUpdate(progress) {
          currentScaleX = fromSx + (1 - fromSx) * progress;
          currentScaleY = fromSy + (1 - fromSy) * progress;
          currentTransX = fromTx * (1 - progress);
          currentTransY = fromTy * (1 - progress);

          el.style.transform = `translate3d(${currentTransX.toFixed(2)}px, ${currentTransY.toFixed(2)}px, 0) scale(${currentScaleX.toFixed(4)}, ${currentScaleY.toFixed(4)})`;
        },
        onComplete() {
          el.style.transform = '';
          el.style.willChange = '';
          currentScaleX = 1;
          currentScaleY = 1;
          currentTransX = 0;
          currentTransY = 0;
          currentSpring = null;
        }
      });
    } else {
      el.style.transform = '';
      el.style.willChange = '';
      currentScaleX = 1;
      currentScaleY = 1;
      currentTransX = 0;
      currentTransY = 0;
    }
  }

  function startPress(el, pointerId, clientX, clientY) {
    if (effectsReduced()) return;

    if (activeTarget && activeTarget !== el) {
      cancelActivePress(true);
    }

    activeTarget = el;
    activePointerId = pointerId;
    startX = clientX;
    startY = clientY;
    isCard = el.matches('.novel-card') || el.dataset.squish === 'card';

    const rect = el.getBoundingClientRect();
    const aspect = rect.width / (rect.height || 1);

    let targetScaleX = 0.94;
    let targetScaleY = 0.94;

    if (isCard) {
      targetScaleX = 0.97;
      targetScaleY = 0.97;
    } else if (aspect >= 1.5) {
      // Wider element (e.g. pill or button): compresses vertically more
      targetScaleX = 0.96;
      targetScaleY = 0.92;
    }

    function applyCompression() {
      if (!activeTarget || activeTarget !== el) return;
      el.style.willChange = 'transform';

      if (currentSpring) {
        currentSpring.cancel();
        currentSpring = null;
      }

      const fromSx = currentScaleX;
      const fromSy = currentScaleY;

      currentSpring = createSpring({
        stiffness: 420,
        damping: 26,
        mass: 1,
        from: 0,
        to: 1,
        onUpdate(progress) {
          currentScaleX = fromSx + (targetScaleX - fromSx) * progress;
          currentScaleY = fromSy + (targetScaleY - fromSy) * progress;
          el.style.transform = `translate3d(${currentTransX.toFixed(2)}px, ${currentTransY.toFixed(2)}px, 0) scale(${currentScaleX.toFixed(4)}, ${currentScaleY.toFixed(4)})`;
        },
        onComplete() {
          currentSpring = null;
        }
      });
    }

    if (isCard) {
      cardTimer = setTimeout(applyCompression, 60);
    } else {
      applyCompression();
    }
  }

  function handlePointerDown(e) {
    if (e.button !== 0 && e.pointerType === 'mouse') return;
    const target = isSquishable(e.target);
    if (!target) return;
    startPress(target, e.pointerId, e.clientX, e.clientY);
  }

  function handlePointerMove(e) {
    if (!activeTarget || e.pointerId !== activePointerId) return;
    const dx = e.clientX - startX;
    const dy = e.clientY - startY;
    const dist = Math.hypot(dx, dy);

    if (dist > 8) {
      cancelActivePress(true);
      return;
    }

    if (!isCard) {
      currentTransX = dx * 0.15;
      currentTransY = dy * 0.15;
      activeTarget.style.transform = `translate3d(${currentTransX.toFixed(2)}px, ${currentTransY.toFixed(2)}px, 0) scale(${currentScaleX.toFixed(4)}, ${currentScaleY.toFixed(4)})`;
    }
  }

  function handlePointerUp(e) {
    if (!activeTarget || e.pointerId !== activePointerId) return;
    cancelActivePress(true);
  }

  function handlePointerCancel(e) {
    if (!activeTarget || e.pointerId !== activePointerId) return;
    cancelActivePress(true);
  }

  function handleScroll() {
    if (activeTarget) {
      cancelActivePress(true);
    }
  }

  function initSquish() {
    document.addEventListener('pointerdown', handlePointerDown, { passive: true });
    document.addEventListener('pointermove', handlePointerMove, { passive: true });
    document.addEventListener('pointerup', handlePointerUp, { passive: true });
    document.addEventListener('pointercancel', handlePointerCancel, { passive: true });
    window.addEventListener('scroll', handleScroll, { passive: true, capture: true });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initSquish);
  } else {
    initSquish();
  }

  // Global namespace export
  global.Motion = {
    effectsReduced,
    haptic,
    getTokens: getMotionTokens,
    spring: createSpring
  };
})(typeof window !== 'undefined' ? window : globalThis);
