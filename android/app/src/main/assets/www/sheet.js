/**
 * NovelShelf Glass Bottom Sheet & Custom Select Component (ColorOS 17 Living Flow)
 *
 * Reusable modal bottom sheet with:
 * - Scrim dimming (no backdrop-filter on scrim for 120Hz performance)
 * - Translucent frosted glass sheet surface with contour ring
 * - Spring-assisted drag-down-to-dismiss gesture
 * - Hardware Back / popstate / Escape priority integration
 * - Accessible focus trap, aria-modal, and background inerting
 * - Custom select component driven by native <select> as source of truth
 */

(function () {
  'use strict';

  let sheetContainer = null;
  let sheetScrim = null;
  let sheetEl = null;
  let sheetHandleArea = null;
  let sheetTitleEl = null;
  let sheetCloseBtn = null;
  let sheetContentEl = null;

  let isOpen = false;
  let activeTriggerEl = null;
  let activeCloseCallback = null;

  // Drag-to-dismiss state
  let isDragging = false;
  let dragStartY = 0;
  let dragCurrentY = 0;
  let dragStartTime = 0;

  const safeRAF = (typeof requestAnimationFrame === 'function')
    ? requestAnimationFrame
    : (cb) => setTimeout(cb, 16);

  function ensureSheetDOM() {
    if (sheetContainer) return;

    sheetContainer = document.createElement('div');
    sheetContainer.id = 'glass-sheet-container';
    sheetContainer.className = 'glass-sheet-container';
    sheetContainer.style.display = 'none';

    sheetScrim = document.createElement('div');
    sheetScrim.id = 'glass-sheet-scrim';
    sheetScrim.className = 'glass-sheet-scrim';
    sheetContainer.appendChild(sheetScrim);

    sheetEl = document.createElement('div');
    sheetEl.id = 'glass-sheet';
    sheetEl.className = 'glass-sheet glass-ring';
    sheetEl.setAttribute('role', 'dialog');
    sheetEl.setAttribute('aria-modal', 'true');
    sheetEl.setAttribute('aria-labelledby', 'glass-sheet-title');

    sheetHandleArea = document.createElement('div');
    sheetHandleArea.className = 'glass-sheet-handle-area';
    sheetHandleArea.innerHTML = '<div class="glass-sheet-handle"></div>';
    sheetEl.appendChild(sheetHandleArea);

    const header = document.createElement('div');
    header.className = 'glass-sheet-header';

    sheetTitleEl = document.createElement('h3');
    sheetTitleEl.id = 'glass-sheet-title';
    sheetTitleEl.className = 'glass-sheet-title';
    header.appendChild(sheetTitleEl);

    sheetCloseBtn = document.createElement('button');
    sheetCloseBtn.type = 'button';
    sheetCloseBtn.className = 'glass-sheet-close-btn';
    sheetCloseBtn.setAttribute('aria-label', 'Close dialog');
    sheetCloseBtn.innerHTML = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>';
    header.appendChild(sheetCloseBtn);

    sheetEl.appendChild(header);

    sheetContentEl = document.createElement('div');
    sheetContentEl.id = 'glass-sheet-content';
    sheetContentEl.className = 'glass-sheet-content';
    sheetEl.appendChild(sheetContentEl);

    sheetContainer.appendChild(sheetEl);
    document.body.appendChild(sheetContainer);

    // Event bindings
    sheetScrim.addEventListener('click', () => BottomSheet.close());
    sheetCloseBtn.addEventListener('click', () => BottomSheet.close());
    setupDragGestures();
  }

  function setupDragGestures() {
    if (!sheetHandleArea) return;

    const onPointerDown = (e) => {
      // Only drag with primary pointer
      if (e.button && e.button !== 0) return;
      isDragging = true;
      dragStartY = e.clientY;
      dragCurrentY = e.clientY;
      dragStartTime = performance.now();
      sheetEl.style.transition = 'none';
      if (typeof sheetHandleArea.setPointerCapture === 'function') {
        try { sheetHandleArea.setPointerCapture(e.pointerId); } catch (err) {}
      }
    };

    const onPointerMove = (e) => {
      if (!isDragging) return;
      dragCurrentY = e.clientY;
      const dy = dragCurrentY - dragStartY;
      if (dy > 0) {
        // Direct tracking downward
        sheetEl.style.transform = `translateY(${dy}px)`;
      } else {
        // Rubber-band resistance upward
        const rubber = dy * 0.22;
        sheetEl.style.transform = `translateY(${rubber}px)`;
      }
    };

    const onPointerEnd = (e) => {
      if (!isDragging) return;
      isDragging = false;
      const dy = dragCurrentY - dragStartY;
      const dt = Math.max(1, performance.now() - dragStartTime);
      const velocity = dy / dt; // px/ms
      const height = sheetEl.offsetHeight || 300;
      const threshold = height * 0.25;

      sheetEl.style.transition = '';

      if (dy > threshold || (velocity > 0.45 && dy > 24)) {
        BottomSheet.close();
      } else {
        // Spring back to 0
        const reduced = typeof window.effectsReduced === 'function' ? window.effectsReduced() : false;
        if (reduced || !window.Motion || typeof window.Motion.createSpring !== 'function') {
          sheetEl.style.transform = 'translateY(0)';
        } else {
          window.Motion.createSpring({
            stiffness: 260,
            damping: 24,
            mass: 1,
            from: Math.max(0, dy),
            to: 0,
            onUpdate: (v) => {
              if (sheetEl) sheetEl.style.transform = `translateY(${v}px)`;
            }
          });
        }
      }
    };

    sheetHandleArea.addEventListener('pointerdown', onPointerDown);
    sheetHandleArea.addEventListener('pointermove', onPointerMove);
    sheetHandleArea.addEventListener('pointerup', onPointerEnd);
    sheetHandleArea.addEventListener('pointercancel', onPointerEnd);
  }

  function setBackgroundInert(inert) {
    const appEl = document.getElementById('app');
    if (appEl) {
      appEl.inert = inert;
      if (inert) {
        appEl.setAttribute('aria-hidden', 'true');
      } else {
        appEl.removeAttribute('aria-hidden');
      }
    }
    const navEl = document.getElementById('floating-bottom-nav');
    if (navEl) {
      if (inert) {
        navEl.inert = true;
        navEl.setAttribute('aria-hidden', 'true');
      } else {
        // Only un-inert nav if currently on a root tab
        if (typeof window.isRootTab === 'function' && typeof window.currentScreen !== 'undefined') {
          if (window.isRootTab(window.currentScreen)) {
            navEl.inert = false;
            navEl.removeAttribute('aria-hidden');
          }
        } else {
          navEl.inert = false;
          navEl.removeAttribute('aria-hidden');
        }
      }
    }
  }

  const BottomSheet = {
    ensureDOM: ensureSheetDOM,

    isOpen() {
      return isOpen;
    },

    open(content, options = {}) {
      ensureSheetDOM();
      if (isOpen) {
        BottomSheet.close();
      }

      isOpen = true;
      activeTriggerEl = options.triggerEl || document.activeElement;
      activeCloseCallback = options.onClose || null;

      // Inert background
      setBackgroundInert(true);

      // Populate content
      sheetContentEl.innerHTML = '';
      if (typeof content === 'string') {
        sheetContentEl.innerHTML = content;
      } else if (content instanceof window.HTMLElement) {
        sheetContentEl.appendChild(content);
      }

      // Title
      const title = options.title || '';
      sheetTitleEl.textContent = title;
      if (!title) {
        sheetTitleEl.style.display = 'none';
      } else {
        sheetTitleEl.style.display = '';
      }

      // Show container
      sheetContainer.style.display = 'flex';
      sheetEl.style.transform = '';

      const reduced = typeof window.effectsReduced === 'function' ? window.effectsReduced() : false;
      if (reduced) {
        sheetContainer.classList.add('open');
      } else {
        // Trigger smooth slide-in
        safeRAF(() => {
          if (sheetContainer) sheetContainer.classList.add('open');
        });
      }

      // Focus management
      setTimeout(() => {
        if (!isOpen) return;
        const focusable = sheetContentEl.querySelector('[aria-selected="true"], [tabindex="0"], button, input, [role="option"]');
        if (focusable && typeof focusable.focus === 'function') {
          try { focusable.focus(); } catch (e) {}
        } else if (sheetCloseBtn && typeof sheetCloseBtn.focus === 'function') {
          try { sheetCloseBtn.focus(); } catch (e) {}
        }
      }, 50);

      if (typeof window.updateNativeBackState === 'function') {
        window.updateNativeBackState();
      }
    },

    close() {
      if (!isOpen) return;
      isOpen = false;

      if (!sheetContainer) return;
      sheetContainer.classList.remove('open');

      const reduced = typeof window.effectsReduced === 'function' ? window.effectsReduced() : false;
      const finishClose = () => {
        if (!isOpen && sheetContainer) {
          sheetContainer.style.display = 'none';
          sheetContentEl.innerHTML = '';
        }
        setBackgroundInert(false);

        if (activeTriggerEl && typeof activeTriggerEl.focus === 'function') {
          try { activeTriggerEl.focus(); } catch (e) {}
        }
        activeTriggerEl = null;

        if (typeof activeCloseCallback === 'function') {
          const cb = activeCloseCallback;
          activeCloseCallback = null;
          try { cb(); } catch (e) {}
        }

        if (typeof window.updateNativeBackState === 'function') {
          window.updateNativeBackState();
        }
      };

      if (reduced) {
        finishClose();
      } else {
        setTimeout(finishClose, 260);
      }
    }
  };

  /**
   * Builds and binds a custom glass select component for a native <select>.
   * Native <select> remains in the DOM as source of truth for value and change events.
   */
  function initCustomSelect(selectEl, options = {}) {
    if (!selectEl || selectEl._customSelect) return selectEl._customSelect;

    const title = options.title || selectEl.getAttribute('aria-label') || 'Select option';

    // Hide native select visually while keeping it in accessibility tree & tests
    selectEl.classList.add('sr-only-select');

    // Create visible glass pill button
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'custom-select-btn glass-ring';
    btn.setAttribute('aria-haspopup', 'listbox');
    btn.setAttribute('aria-expanded', 'false');
    btn.setAttribute('aria-label', title);
    if (selectEl.id) {
      btn.dataset.target = selectEl.id;
    }

    const labelSpan = document.createElement('span');
    labelSpan.className = 'custom-select-label';
    btn.appendChild(labelSpan);

    const chevronSvg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    chevronSvg.setAttribute('class', 'custom-select-chevron');
    chevronSvg.setAttribute('width', '12');
    chevronSvg.setAttribute('height', '12');
    chevronSvg.setAttribute('viewBox', '0 0 24 24');
    chevronSvg.setAttribute('fill', 'none');
    chevronSvg.setAttribute('stroke', 'currentColor');
    chevronSvg.setAttribute('stroke-width', '2.5');
    chevronSvg.innerHTML = '<polyline points="6 9 12 15 18 9"></polyline>';
    btn.appendChild(chevronSvg);

    // Insert button right after native select
    if (selectEl.nextSibling) {
      selectEl.parentNode.insertBefore(btn, selectEl.nextSibling);
    } else {
      selectEl.parentNode.appendChild(btn);
    }

    const updateLabel = () => {
      const idx = selectEl.selectedIndex;
      const text = (idx >= 0 && selectEl.options[idx]) ? selectEl.options[idx].textContent : '';
      labelSpan.textContent = text || title;
    };

    updateLabel();

    const openSheet = () => {
      btn.setAttribute('aria-expanded', 'true');
      const listContainer = document.createElement('div');
      listContainer.className = 'sheet-options-list';
      listContainer.setAttribute('role', 'listbox');
      listContainer.setAttribute('aria-label', title);

      const opts = Array.from(selectEl.options);
      let selectedRow = null;

      opts.forEach((opt) => {
        const isSelected = opt.value === selectEl.value;
        const row = document.createElement('div');
        row.className = 'sheet-option-row' + (isSelected ? ' selected' : '');
        row.setAttribute('role', 'option');
        row.setAttribute('aria-selected', isSelected ? 'true' : 'false');
        row.setAttribute('tabindex', '0');
        row.dataset.value = opt.value;
        row.dataset.squish = 'true';

        const rowLabel = document.createElement('span');
        rowLabel.className = 'sheet-option-label';
        rowLabel.textContent = opt.textContent;
        row.appendChild(rowLabel);

        const checkIcon = document.createElement('span');
        checkIcon.className = 'sheet-option-check';
        if (isSelected) {
          checkIcon.innerHTML = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="20 6 9 17 4 12"></polyline></svg>';
        }
        row.appendChild(checkIcon);

        if (isSelected) selectedRow = row;

        const selectThis = () => {
          if (selectEl.value !== opt.value) {
            selectEl.value = opt.value;
            selectEl.dispatchEvent(new Event('change', { bubbles: true }));
          }
          if (window.Motion && typeof window.Motion.haptic === 'function') {
            window.Motion.haptic('tick');
          }
          // Visual feedback
          listContainer.querySelectorAll('.sheet-option-row').forEach(r => {
            const sel = r === row;
            r.classList.toggle('selected', sel);
            r.setAttribute('aria-selected', sel ? 'true' : 'false');
            const chk = r.querySelector('.sheet-option-check');
            if (chk) {
              chk.innerHTML = sel
                ? '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="20 6 9 17 4 12"></polyline></svg>'
                : '';
            }
          });
          updateLabel();
          setTimeout(() => BottomSheet.close(), 120);
        };

        row.addEventListener('click', selectThis);
        row.addEventListener('keydown', (e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            selectThis();
          }
        });

        listContainer.appendChild(row);
      });

      BottomSheet.open(listContainer, {
        title,
        triggerEl: btn,
        onClose: () => {
          btn.setAttribute('aria-expanded', 'false');
        }
      });

      // Scroll selected item into view
      if (selectedRow) {
        safeRAF(() => {
          try { selectedRow.scrollIntoView({ block: 'nearest' }); } catch (e) {}
        });
      }
    };

    btn.addEventListener('click', openSheet);
    btn.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ' || e.key === 'ArrowDown') {
        e.preventDefault();
        openSheet();
      }
    });

    // Native change listener keeps custom button label in sync
    selectEl.addEventListener('change', updateLabel);

    const controller = {
      button: btn,
      select: selectEl,
      update: updateLabel
    };

    selectEl._customSelect = controller;
    return controller;
  }

  function updateCustomSelect(selectEl) {
    if (selectEl && selectEl._customSelect) {
      selectEl._customSelect.update();
    }
  }

  // Export globally
  window.BottomSheet = BottomSheet;
  window.initCustomSelect = initCustomSelect;
  window.updateCustomSelect = updateCustomSelect;

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = { BottomSheet, initCustomSelect, updateCustomSelect };
  }
})();
