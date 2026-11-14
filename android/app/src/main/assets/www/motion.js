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

  // Global namespace export
  global.Motion = {
    effectsReduced,
    haptic,
    getTokens: getMotionTokens,
    spring: createSpring
  };
})(typeof window !== 'undefined' ? window : globalThis);
