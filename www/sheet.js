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

  function ensureSheetDOM() {
    if (sheetContainer) return;

    sheetContainer = document.createElement('div');
    sheetContainer.id = 'glass-sheet-container';
    sheetContainer.className = 'glass-sheet-container glass-popup-container';
    sheetContainer.style.display = 'none';

    sheetScrim = document.createElement('div');
    sheetScrim.id = 'glass-sheet-scrim';
    sheetScrim.className = 'glass-sheet-scrim';
    sheetContainer.appendChild(sheetScrim);

    sheetEl = document.createElement('div');
    sheetEl.id = 'glass-sheet';
    sheetEl.className = 'glass-sheet glass-popup-card glass-ring';
    sheetEl.setAttribute('role', 'dialog');
    sheetEl.setAttribute('aria-modal', 'true');
    sheetEl.setAttribute('aria-labelledby', 'glass-sheet-title');

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

      // Blur active input/textarea to dismiss software keyboard before popup opens
      if (document.activeElement && typeof document.activeElement.blur === 'function') {
        try { document.activeElement.blur(); } catch (e) {}
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
        if (content.includes('glass-calendar-wrap')) {
          sheetEl.classList.add('calendar-popup');
        } else {
          sheetEl.classList.remove('calendar-popup');
        }
      } else if (content instanceof window.HTMLElement) {
        sheetContentEl.appendChild(content);
        if (content.classList.contains('glass-calendar-wrap') || content.querySelector('.glass-calendar-wrap')) {
          sheetEl.classList.add('calendar-popup');
        } else {
          sheetEl.classList.remove('calendar-popup');
        }
      }

      // Title
      const title = options.title || '';
      sheetTitleEl.textContent = title;
      if (!title) {
        sheetTitleEl.style.display = 'none';
      } else {
        sheetTitleEl.style.display = '';
      }

      // Show container centered
      sheetContainer.style.display = 'grid';
      sheetEl.style.transform = '';

      const reduced = typeof window.effectsReduced === 'function' ? window.effectsReduced() : false;
      if (reduced) {
        sheetContainer.classList.add('open');
      } else {
        // Trigger smooth scale/fade-in
        requestAnimationFrame(() => {
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
          sheetEl.classList.remove('calendar-popup');
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
        setTimeout(finishClose, 160);
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
        requestAnimationFrame(() => {
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

  /**
   * --- Glass Date Picker Component ---
   * Replaces native <input type="date"> with a liquid-glass bottom sheet calendar.
   * Native input stays in DOM as source of truth for value and change events.
   */
  const MONTH_NAMES_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const MONTH_NAMES_FULL = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  const WEEKDAYS = ['M', 'T', 'W', 'T', 'F', 'S', 'S'];

  function parseYMD(str) {
    if (!str || typeof str !== 'string') return null;
    const parts = str.trim().split('-');
    if (parts.length !== 3) return null;
    const y = parseInt(parts[0], 10);
    const m = parseInt(parts[1], 10);
    const d = parseInt(parts[2], 10);
    if (isNaN(y) || isNaN(m) || isNaN(d)) return null;
    return { year: y, month: m, day: d };
  }

  function toYMD(y, m, d) {
    const sy = String(y).padStart(4, '0');
    const sm = String(m).padStart(2, '0');
    const sd = String(d).padStart(2, '0');
    return `${sy}-${sm}-${sd}`;
  }

  function getLocalTodayYMD() {
    const now = new Date();
    return toYMD(now.getFullYear(), now.getMonth() + 1, now.getDate());
  }

  function formatDisplayDate(dateStr) {
    const p = parseYMD(dateStr);
    if (!p) return '';
    const mStr = MONTH_NAMES_SHORT[p.month - 1] || '';
    return `${p.day} ${mStr} ${p.year}`;
  }

  function getDaysInMonth(year, month) {
    return new Date(year, month, 0).getDate();
  }

  function getFirstWeekday(year, month) {
    const day = new Date(year, month - 1, 1).getDay();
    return (day + 6) % 7;
  }

  function initDatePicker(inputEl, options = {}) {
    if (!inputEl || inputEl._customDate) return inputEl._customDate;

    // Hide native input visually while keeping it accessible and form-linked
    inputEl.classList.add('sr-only-input');

    const defaultTitle = inputEl.id === 'form-started'
      ? 'Select Started Date'
      : (inputEl.id === 'form-finished' ? 'Select Finished Date' : 'Select Date');
    const title = options.title || inputEl.getAttribute('aria-label') || defaultTitle;

    // Create custom glass date button
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'custom-date-btn glass-ring';
    btn.setAttribute('aria-haspopup', 'dialog');
    btn.setAttribute('aria-expanded', 'false');
    btn.setAttribute('aria-label', title);
    if (inputEl.id) {
      btn.dataset.target = inputEl.id;
    }

    const labelSpan = document.createElement('span');
    labelSpan.className = 'custom-date-label';
    btn.appendChild(labelSpan);

    const iconSpan = document.createElement('span');
    iconSpan.className = 'custom-date-icon';
    iconSpan.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"></rect><line x1="16" y1="2" x2="16" y2="6"></line><line x1="8" y1="2" x2="8" y2="6"></line><line x1="3" y1="10" x2="21" y2="10"></line></svg>';
    btn.appendChild(iconSpan);

    // Insert button right after input
    if (inputEl.nextSibling) {
      inputEl.parentNode.insertBefore(btn, inputEl.nextSibling);
    } else {
      inputEl.parentNode.appendChild(btn);
    }

    const updateLabel = () => {
      const val = inputEl.value;
      if (val) {
        labelSpan.textContent = formatDisplayDate(val) || val;
        btn.classList.remove('is-empty');
      } else {
        labelSpan.textContent = 'Select date';
        btn.classList.add('is-empty');
      }
    };
    updateLabel();

    inputEl.addEventListener('change', updateLabel);
    inputEl.addEventListener('input', updateLabel);

    const openSheet = () => {
      btn.setAttribute('aria-expanded', 'true');
      const todayYMD = getLocalTodayYMD();
      const todayParts = parseYMD(todayYMD) || { year: new Date().getFullYear(), month: new Date().getMonth() + 1, day: new Date().getDate() };

      let currentVal = inputEl.value || '';
      let currentParts = parseYMD(currentVal) || todayParts;

      let viewYear = currentParts.year;
      let viewMonth = currentParts.month;
      let pendingDate = currentVal || '';
      let isJumpMode = false;

      const calWrap = document.createElement('div');
      calWrap.className = 'glass-calendar-wrap';

      function renderCalendar() {
        calWrap.innerHTML = '';

        // Validation against opposite date field
        let validationError = '';
        if (inputEl.id === 'form-finished') {
          const startedEl = document.getElementById('form-started');
          if (startedEl && startedEl.value && pendingDate) {
            if (pendingDate < startedEl.value) {
              validationError = `Finished date cannot be before Started date (${formatDisplayDate(startedEl.value)})`;
            }
          }
        } else if (inputEl.id === 'form-started') {
          const finishedEl = document.getElementById('form-finished');
          if (finishedEl && finishedEl.value && pendingDate) {
            if (pendingDate > finishedEl.value) {
              validationError = `Started date cannot be after Finished date (${formatDisplayDate(finishedEl.value)})`;
            }
          }
        }

        // Quick helper chips (only in normal calendar day view)
        if (!isJumpMode) {
          const chipsRow = document.createElement('div');
          chipsRow.className = 'calendar-quick-chips';

          const todayChip = document.createElement('button');
          todayChip.type = 'button';
          todayChip.className = 'calendar-chip';
          todayChip.textContent = 'Today';
          todayChip.dataset.squish = 'true';
          todayChip.addEventListener('click', () => {
            pendingDate = todayYMD;
            viewYear = todayParts.year;
            viewMonth = todayParts.month;
            if (window.Motion && typeof window.Motion.haptic === 'function') window.Motion.haptic('tick');
            renderCalendar();
          });
          chipsRow.appendChild(todayChip);

          if (inputEl.id === 'form-finished') {
            const startedEl = document.getElementById('form-started');
            if (startedEl && startedEl.value) {
              const sameChip = document.createElement('button');
              sameChip.type = 'button';
              sameChip.className = 'calendar-chip';
              sameChip.textContent = 'Same as started';
              sameChip.dataset.squish = 'true';
              sameChip.addEventListener('click', () => {
                pendingDate = startedEl.value;
                const sp = parseYMD(startedEl.value);
                if (sp) {
                  viewYear = sp.year;
                  viewMonth = sp.month;
                }
                if (window.Motion && typeof window.Motion.haptic === 'function') window.Motion.haptic('tick');
                renderCalendar();
              });
              chipsRow.appendChild(sameChip);
            }
          }

          calWrap.appendChild(chipsRow);
        }

        // Header Navigation Row
        const navRow = document.createElement('div');
        navRow.className = 'calendar-nav';

        const prevBtn = document.createElement('button');
        prevBtn.type = 'button';
        prevBtn.className = 'calendar-nav-btn';
        prevBtn.setAttribute('aria-label', isJumpMode ? 'Previous year' : 'Previous month');
        prevBtn.innerHTML = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="15 18 9 12 15 6"></polyline></svg>';
        prevBtn.addEventListener('click', () => {
          if (isJumpMode) {
            viewYear -= 1;
          } else {
            if (viewMonth === 1) { viewMonth = 12; viewYear -= 1; }
            else { viewMonth -= 1; }
          }
          renderCalendar();
        });
        navRow.appendChild(prevBtn);

        const monthYearBtn = document.createElement('button');
        monthYearBtn.type = 'button';
        monthYearBtn.className = 'calendar-month-year-btn';
        monthYearBtn.setAttribute('aria-label', isJumpMode ? 'Return to days view' : 'Jump to month or year');
        const chevronRot = isJumpMode ? 'style="transform: rotate(180deg); transition: transform 0.2s;"' : 'style="transition: transform 0.2s;"';
        monthYearBtn.innerHTML = `<span>${MONTH_NAMES_FULL[viewMonth - 1]} ${viewYear}</span><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" ${chevronRot}><polyline points="6 9 12 15 18 9"></polyline></svg>`;
        monthYearBtn.addEventListener('click', () => {
          isJumpMode = !isJumpMode;
          renderCalendar();
        });
        navRow.appendChild(monthYearBtn);

        const nextBtn = document.createElement('button');
        nextBtn.type = 'button';
        nextBtn.className = 'calendar-nav-btn';
        nextBtn.setAttribute('aria-label', isJumpMode ? 'Next year' : 'Next month');
        nextBtn.innerHTML = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="9 18 15 12 9 6"></polyline></svg>';
        nextBtn.addEventListener('click', () => {
          if (isJumpMode) {
            viewYear += 1;
          } else {
            if (viewMonth === 12) { viewMonth = 1; viewYear += 1; }
            else { viewMonth += 1; }
          }
          renderCalendar();
        });
        navRow.appendChild(nextBtn);

        calWrap.appendChild(navRow);

        if (isJumpMode) {
          // 12-Month Jump Grid
          const jumpGrid = document.createElement('div');
          jumpGrid.className = 'calendar-jump-grid';
          MONTH_NAMES_SHORT.forEach((mName, idx) => {
            const mNum = idx + 1;
            const mBtn = document.createElement('button');
            mBtn.type = 'button';
            mBtn.className = 'calendar-month-card' + (mNum === viewMonth ? ' selected' : '');
            mBtn.textContent = mName;
            mBtn.dataset.month = String(mNum);
            mBtn.addEventListener('click', () => {
              viewMonth = mNum;
              isJumpMode = false;
              renderCalendar();
            });
            jumpGrid.appendChild(mBtn);
          });
          calWrap.appendChild(jumpGrid);
        } else {
          // Weekdays Row
          const weekdaysRow = document.createElement('div');
          weekdaysRow.className = 'calendar-weekdays';
          weekdaysRow.setAttribute('aria-hidden', 'true');
          WEEKDAYS.forEach(w => {
            const wSpan = document.createElement('span');
            wSpan.textContent = w;
            weekdaysRow.appendChild(wSpan);
          });
          calWrap.appendChild(weekdaysRow);

          // 6x7 Calendar Grid
          const grid = document.createElement('div');
          grid.className = 'calendar-grid';
          grid.setAttribute('role', 'grid');
          grid.setAttribute('aria-label', `${MONTH_NAMES_FULL[viewMonth - 1]} ${viewYear}`);

          // Swipe gesture to switch month
          let touchStartX = 0;
          let touchStartY = 0;
          grid.addEventListener('touchstart', (e) => {
            if (e.touches && e.touches[0]) {
              touchStartX = e.touches[0].clientX;
              touchStartY = e.touches[0].clientY;
            }
          }, { passive: true });
          grid.addEventListener('touchend', (e) => {
            if (e.changedTouches && e.changedTouches[0]) {
              const dx = e.changedTouches[0].clientX - touchStartX;
              const dy = e.changedTouches[0].clientY - touchStartY;
              if (Math.abs(dx) > 40 && Math.abs(dx) > Math.abs(dy)) {
                if (dx < 0) {
                  // Swipe left -> next month
                  if (viewMonth === 12) { viewMonth = 1; viewYear += 1; }
                  else { viewMonth += 1; }
                } else {
                  // Swipe right -> prev month
                  if (viewMonth === 1) { viewMonth = 12; viewYear -= 1; }
                  else { viewMonth -= 1; }
                }
                renderCalendar();
              }
            }
          }, { passive: true });

          const fw = getFirstWeekday(viewYear, viewMonth);
          const daysInCur = getDaysInMonth(viewYear, viewMonth);
          const prevY = viewMonth === 1 ? viewYear - 1 : viewYear;
          const prevM = viewMonth === 1 ? 12 : viewMonth - 1;
          const daysInPrev = getDaysInMonth(prevY, prevM);
          const nextY = viewMonth === 12 ? viewYear + 1 : viewYear;
          const nextM = viewMonth === 12 ? 1 : viewMonth + 1;

          function createDayCell(dayNum, dateStr, isOutside, y, m) {
            const dayBtn = document.createElement('button');
            dayBtn.type = 'button';
            dayBtn.className = 'calendar-day';
            dayBtn.textContent = String(dayNum);
            dayBtn.dataset.date = dateStr;
            dayBtn.dataset.squish = 'true';
            dayBtn.setAttribute('role', 'gridcell');

            if (isOutside) dayBtn.classList.add('outside-month');
            if (dateStr === todayYMD) dayBtn.classList.add('is-today');
            if (dateStr === pendingDate) {
              dayBtn.classList.add('is-selected');
              dayBtn.setAttribute('aria-selected', 'true');
            } else {
              dayBtn.setAttribute('aria-selected', 'false');
            }

            // Max date: today (cannot pick future dates)
            if (dateStr > todayYMD) {
              dayBtn.classList.add('disabled');
              dayBtn.setAttribute('aria-disabled', 'true');
            } else {
              dayBtn.addEventListener('click', () => {
                pendingDate = dateStr;
                viewYear = y;
                viewMonth = m;
                if (window.Motion && typeof window.Motion.haptic === 'function') {
                  window.Motion.haptic('tick');
                }
                renderCalendar();
              });
            }
            return dayBtn;
          }

          // Previous month leading cells
          for (let i = fw - 1; i >= 0; i--) {
            const d = daysInPrev - i;
            const dStr = toYMD(prevY, prevM, d);
            grid.appendChild(createDayCell(d, dStr, true, prevY, prevM));
          }
          // Current month cells
          for (let d = 1; d <= daysInCur; d++) {
            const dStr = toYMD(viewYear, viewMonth, d);
            grid.appendChild(createDayCell(d, dStr, false, viewYear, viewMonth));
          }
          // Next month trailing cells up to 42 (6 rows x 7 cols)
          const remaining = 42 - (fw + daysInCur);
          for (let d = 1; d <= remaining; d++) {
            const dStr = toYMD(nextY, nextM, d);
            grid.appendChild(createDayCell(d, dStr, true, nextY, nextM));
          }

          calWrap.appendChild(grid);
        }

        // Inline validation error hint
        if (validationError) {
          const hint = document.createElement('div');
          hint.className = 'calendar-validation-hint';
          hint.setAttribute('role', 'alert');
          hint.textContent = validationError;
          calWrap.appendChild(hint);
        }

        // Actions Row
        const actions = document.createElement('div');
        actions.className = 'calendar-actions';

        const clearBtn = document.createElement('button');
        clearBtn.type = 'button';
        clearBtn.className = 'calendar-action-btn btn-clear';
        clearBtn.textContent = 'Clear';
        clearBtn.addEventListener('click', () => {
          inputEl.value = '';
          inputEl.dispatchEvent(new Event('change', { bubbles: true }));
          inputEl.dispatchEvent(new Event('input', { bubbles: true }));
          updateLabel();
          BottomSheet.close();
        });
        actions.appendChild(clearBtn);

        const rightActions = document.createElement('div');
        rightActions.className = 'calendar-actions-right';

        const cancelBtn = document.createElement('button');
        cancelBtn.type = 'button';
        cancelBtn.className = 'calendar-action-btn btn-cancel';
        cancelBtn.textContent = 'Cancel';
        cancelBtn.addEventListener('click', () => BottomSheet.close());
        rightActions.appendChild(cancelBtn);

        const setBtn = document.createElement('button');
        setBtn.type = 'button';
        setBtn.className = 'calendar-action-btn btn-set primary';
        setBtn.textContent = 'Set';
        if (validationError || !pendingDate) {
          setBtn.disabled = true;
        }
        setBtn.addEventListener('click', () => {
          if (pendingDate && !validationError) {
            inputEl.value = pendingDate;
            inputEl.dispatchEvent(new Event('change', { bubbles: true }));
            inputEl.dispatchEvent(new Event('input', { bubbles: true }));
            updateLabel();
          }
          BottomSheet.close();
        });
        rightActions.appendChild(setBtn);
        actions.appendChild(rightActions);

        calWrap.appendChild(actions);
      }

      renderCalendar();

      BottomSheet.open(calWrap, {
        title,
        triggerEl: btn,
        onClose: () => {
          btn.setAttribute('aria-expanded', 'false');
        }
      });
    };

    btn.addEventListener('click', openSheet);
    btn.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        openSheet();
      }
    });

    const controller = {
      button: btn,
      input: inputEl,
      update: updateLabel
    };

    inputEl._customDate = controller;
    return controller;
  }

  function updateCustomDate(inputEl) {
    if (inputEl && inputEl._customDate) {
      inputEl._customDate.update();
    }
  }

  // Export globally
  window.BottomSheet = BottomSheet;
  window.GlassPopup = BottomSheet;
  window.initCustomSelect = initCustomSelect;
  window.updateCustomSelect = updateCustomSelect;
  window.initDatePicker = initDatePicker;
  window.updateCustomDate = updateCustomDate;
  window.formatDisplayDate = formatDisplayDate;

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
      BottomSheet,
      GlassPopup: BottomSheet,
      initCustomSelect,
      updateCustomSelect,
      initDatePicker,
      updateCustomDate,
      formatDisplayDate
    };
  }
})();

