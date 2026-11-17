const { JSDOM } = require('jsdom');
const fs = require('fs');
const path = require('path');
const assert = require('assert');

const rawHtml = fs.readFileSync(path.resolve(__dirname, '../index.html'), 'utf8');
const cleanHtml = rawHtml.replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '');
const sheetJs = fs.readFileSync(path.resolve(__dirname, '../sheet.js'), 'utf8');
const js = fs.readFileSync(path.resolve(__dirname, '../app.js'), 'utf8');

function createDom(initialStorage = {}) {
  const dom = new JSDOM(cleanHtml, {
    url: 'https://appassets.androidplatform.net/assets/www/index.html',
    runScripts: 'dangerously'
  });

  const { window } = dom;

  // Set initial storage items in standard localStorage before executing app.js
  if (initialStorage) {
    Object.entries(initialStorage).forEach(([k, v]) => {
      window.localStorage.setItem(k, String(v));
    });
  }

  // Mock scroll methods
  window.HTMLElement.prototype.scrollIntoView = function() {};
  window.scrollTo = function() {};
  window.requestAnimationFrame = function(cb) { return setTimeout(cb, 0); };
  window.cancelAnimationFrame = function(id) { clearTimeout(id); };

  // Mock history navigation for JSDOM
  const historyStack = [];
  const origPushState = window.history.pushState.bind(window.history);
  window.history.pushState = function(state, unused, url) {
    historyStack.push(state);
    origPushState(state, unused, url);
  };
  window.history.back = function() {
    historyStack.pop();
    const prevState = historyStack[historyStack.length - 1] || null;
    origPushState(prevState, '', '');
    window.dispatchEvent(new window.PopStateEvent('popstate', { state: prevState }));
  };

  // Evaluate scripts in order
  window.eval(sheetJs);
  window.eval(js);
  return { dom, window };
}

async function runTests() {
  const results = [];

  async function test(id, desc, fn) {
    try {
      await fn();
      results.push({ id, desc, status: 'PASS' });
      console.log(`[PASS] ${id}: ${desc}`);
    } catch (e) {
      results.push({ id, desc, status: 'FAIL', error: e.message });
      console.error(`[FAIL] ${id}: ${desc}\n  ${e.stack || e.message}`);
    }
  }

  console.log('--- Running Tests ---');

  // A1: Edit-from-details navigation desync
  await test('A1', 'Edit-from-details returns to details showing updated data and restores navigation', () => {
    const { window } = createDom();
    const doc = window.document;

    // Load sample data first
    doc.getElementById('btn-load-sample').click();
    assert.strictEqual(doc.querySelectorAll('.novel-card').length, 5);

    // Click first card to view details
    const firstCard = doc.querySelector('.novel-card');
    firstCard.click();
    assert.strictEqual(doc.getElementById('view-novel-details').style.display, 'flex');
    assert.strictEqual(doc.getElementById('view-shelf').style.display, 'none');

    // Click Edit from details
    doc.getElementById('btn-detail-edit').click();
    assert.strictEqual(doc.getElementById('modal-novel-form').style.display, 'flex');
    assert.strictEqual(doc.getElementById('view-novel-details').style.display, 'none');

    // Change title and save
    doc.getElementById('form-title').value = 'Updated Novel Title';
    doc.getElementById('novel-form').dispatchEvent(new window.Event('submit', { cancelable: true }));

    // Should return to details (display 'flex'), shelf remains hidden
    assert.strictEqual(doc.getElementById('modal-novel-form').style.display, 'none');
    assert.strictEqual(doc.getElementById('view-novel-details').style.display, 'flex');
    assert.strictEqual(doc.getElementById('view-shelf').style.display, 'none');
    assert.strictEqual(doc.getElementById('detail-header-title').textContent, 'Updated Novel Title');

    // Close details returns to shelf
    doc.getElementById('btn-back-shelf').click();
    assert.strictEqual(doc.getElementById('view-novel-details').style.display, 'none');
    assert.strictEqual(doc.getElementById('view-shelf').style.display, '');
  });

  // A3: HTML injection via imported dates
  await test('A3', 'normalizeImportedNovel strips HTML injection in dates and renderNovelDetailsContent escapes dates', () => {
    const badNovel = {
      id: 'bad_1',
      title: 'XSS Test',
      started: '<img src=x onerror=alert(1)>',
      finished: '"><script>alert(2)</script>',
      status: 'Reading'
    };
    const { window } = createDom({ 'novelshelf_library_v1': JSON.stringify([badNovel]) });
    const doc = window.document;

    // Click card
    const card = doc.querySelector('.novel-card');
    assert.ok(card, 'Card should render');
    card.click();

    // Verify dates container does not contain injected tags
    const datesEl = doc.querySelector('.meta-item:nth-child(2) .meta-item-value');
    assert.ok(datesEl, 'Dates element should exist');
    assert.ok(!datesEl.innerHTML.includes('<img'), 'Should not contain <img> tag');
    assert.ok(!datesEl.innerHTML.includes('<script>'), 'Should not contain <script> tag');
  });

  // A4: Failed saves must not report success & rollback
  await test('A4', 'Failed save rolls back mutation and shows error toast', () => {
    const { window } = createDom();
    const doc = window.document;

    doc.getElementById('btn-load-sample').click();

    // Force Storage.prototype.setItem to throw
    const origSetItem = window.Storage.prototype.setItem;
    window.Storage.prototype.setItem = function() { throw new Error('QuotaExceeded'); };

    // Try to add a novel
    doc.getElementById('btn-add-novel-top').click();
    doc.getElementById('form-title').value = 'Should Fail Novel';
    doc.getElementById('novel-form').dispatchEvent(new window.Event('submit', { cancelable: true }));

    // Must have rolled back in memory and not rendered new novel
    const toasts = Array.from(doc.querySelectorAll('.toast'));
    const hasStorageToast = toasts.some(t => t.textContent.includes('Storage limit'));
    assert.ok(hasStorageToast, 'Must display storage error toast');

    const hasSuccessToast = toasts.some(t => t.textContent.includes('Added "Should Fail Novel"'));
    assert.ok(!hasSuccessToast, 'Must NOT show success toast on save failure');

    // Restore setItem
    window.Storage.prototype.setItem = origSetItem;
  });

  // A5: Corrupt storage bricks the app
  await test('A5', 'Corrupt localStorage loads safely into empty shelf', () => {
    ['null', '{}', '"abc"', '42', '{"broken":true}'].forEach(badVal => {
      const { window } = createDom({
        'novelshelf_library_v1': badVal,
        'novelshelf_view_mode': 'invalid_mode'
      });
      const doc = window.document;
      assert.strictEqual(doc.getElementById('empty-state').style.display, 'flex');
      assert.strictEqual(doc.querySelectorAll('.novel-card').length, 0);
    });
  });

  // A6: Merge import local progress wins & deduplication
  await test('A6', 'Merge import preserves local progress on id collision and reports accurate added count', async () => {
    const { window } = createDom();
    const doc = window.document;

    // Load sample data
    doc.getElementById('btn-load-sample').click();
    const firstNovelId = 'novel_sample_1';

    // Increment progress locally on sample 1
    const firstCard = doc.querySelector(`[data-id="${firstNovelId}"]`);
    const quickAddBtn = firstCard.querySelector('[data-action="quick-add"]');
    quickAddBtn.click(); // read = 561

    // Simulate import containing novel_sample_1 with old chaptersRead=560 and a new novel
    const fileData = {
      novels: [
        { id: firstNovelId, title: 'Lord of the Mysteries', chaptersRead: 100, status: 'Reading' },
        { id: 'new_novel_99', title: 'New Imported Novel', chaptersRead: 10, status: 'Reading' }
      ]
    };

    const input = doc.getElementById('import-json-file');
    // Mock FileReader to execute onload synchronously
    window.FileReader = class {
      readAsText() {
        this.onload({ target: { result: JSON.stringify(fileData) } });
      }
    };

    const file = new window.File([JSON.stringify(fileData)], 'backup.json');
    Object.defineProperty(input, 'files', { value: [file], configurable: true });
    input.dispatchEvent(new window.Event('change'));

    // Wait microtask for showImportChoiceDialog promise
    await new Promise(r => setTimeout(r, 20));

    // Choice dialog pops up - click Merge
    const mergeBtn = doc.querySelector('.confirm-buttons button.btn-secondary:nth-child(2)');
    assert.ok(mergeBtn && mergeBtn.textContent === 'Merge', 'Merge button should exist');
    mergeBtn.click();

    await new Promise(r => setTimeout(r, 20));

    // Verify local progress won on first novel: chaptersRead should remain 561 (not 100)
    const card1 = doc.querySelector(`[data-id="${firstNovelId}"]`);
    assert.ok(card1.querySelector('.progress-info').textContent.includes('Ch. 561'), 'Local chaptersRead must win');

    // Verify new novel was added
    assert.ok(doc.querySelector('[data-id="new_novel_99"]'), 'New novel should be added');

    // Verify toast message "Merged: 1 new novels added"
    const toasts = Array.from(doc.querySelectorAll('.toast'));
    assert.ok(toasts.some(t => t.textContent.includes('Merged: 1 new novels added')), 'Toast should report 1 new novel added');
  });

  // A7: Quick +1 in-place DOM update (suppress resort)
  await test('A7', 'Quick +1 updates DOM in-place without re-sorting list under finger', () => {
    const { window } = createDom();
    const doc = window.document;

    doc.getElementById('btn-load-sample').click();
    const cardsBefore = Array.from(doc.querySelectorAll('.novel-card')).map(c => c.dataset.id);

    // Increment an active card
    const cardWithBtn = Array.from(doc.querySelectorAll('.novel-card')).find(c => c.querySelector('[data-action="quick-add"]'));
    assert.ok(cardWithBtn, 'Active card with quick-add button should exist');
    const btn = cardWithBtn.querySelector('[data-action="quick-add"]');
    btn.click();

    const cardsAfter = Array.from(doc.querySelectorAll('.novel-card')).map(c => c.dataset.id);
    assert.deepStrictEqual(cardsBefore, cardsAfter, 'Card order must not change after quick +1');
  });

  // A8: Genre filter goes stale
  await test('A8', 'Genre dropdown de-duplicates case-insensitively and resets to ALL if genre removed', async () => {
    const { window } = createDom();
    const doc = window.document;

    doc.getElementById('btn-load-sample').click();
    const genreFilter = doc.getElementById('genre-filter');

    // Select 'LitRPG'
    genreFilter.value = 'LitRPG';
    genreFilter.dispatchEvent(new window.Event('change'));
    assert.strictEqual(genreFilter.value, 'LitRPG');

    // Delete the only LitRPG novel ('Omniscient Reader\'s Viewpoint')
    const orvCard = doc.querySelector('[data-id="novel_sample_2"]');
    orvCard.click();
    doc.getElementById('btn-detail-delete').click();

    // Wait for showConfirm promise
    await new Promise(r => setTimeout(r, 20));

    // Confirm delete
    doc.getElementById('btn-confirm-yes').click();

    await new Promise(r => setTimeout(r, 20));

    // After deletion, genreFilter should reset to ALL
    assert.strictEqual(genreFilter.value, 'ALL', 'Genre filter must reset to ALL when genre disappears');
  });

  // A10: Chapter validation
  await test('A10', 'Chapter validation clamps read <= total and auto-fills completion date', () => {
    const { window } = createDom();
    const doc = window.document;

    doc.getElementById('btn-add-novel-top').click();
    doc.getElementById('form-title').value = 'Validation Test Novel';
    doc.getElementById('form-chapters-read').value = '150';
    doc.getElementById('form-chapters-total').value = '100';
    doc.getElementById('novel-form').dispatchEvent(new window.Event('submit', { cancelable: true }));

    // Click created novel
    const card = doc.querySelector('.novel-card');
    assert.ok(card.textContent.includes('Ch. 100 / 100'), 'Chapters read must be clamped to total');
  });

  // A11: Keyboard Enter on +1 Ch button
  await test('A11', 'Enter key on child button does not trigger card click details open', () => {
    const { window } = createDom();
    const doc = window.document;

    doc.getElementById('btn-load-sample').click();
    const firstCard = doc.querySelector('.novel-card');
    const quickAddBtn = firstCard.querySelector('[data-action="quick-add"]');

    // Dispatch Enter on the button
    const enterEvent = new window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true });
    quickAddBtn.dispatchEvent(enterEvent);

    // Detail view should NOT open
    assert.strictEqual(doc.getElementById('view-novel-details').style.display, 'none');
  });

  // A12: Link and Cover URL normalization
  await test('A12', 'normalizeUrl prepends https:// and rejects invalid schemes', () => {
    const { window } = createDom();
    const doc = window.document;

    doc.getElementById('btn-add-novel-top').click();
    doc.getElementById('form-title').value = 'URL Test Novel';
    doc.getElementById('form-link').value = 'example.com/novel';
    doc.getElementById('novel-form').dispatchEvent(new window.Event('submit', { cancelable: true }));

    const card = doc.querySelector('.novel-card');
    card.click();

    const readBtn = doc.querySelector('.detail-read-btn');
    assert.ok(readBtn, 'Read button should be present for normalized URL');
    assert.strictEqual(readBtn.getAttribute('href'), 'https://example.com/novel');
  });

  // A13: Already at last chapter guard & On Hold -> Reading
  await test('A13', 'incrementChapter guards against incrementing past total and switches On Hold to Reading', () => {
    const { window } = createDom();
    const doc = window.document;

    // Load sample data (novel_sample_5 is On Hold, 420/500)
    doc.getElementById('btn-load-sample').click();
    const card5 = doc.querySelector('[data-id="novel_sample_5"]');
    assert.ok(card5.textContent.includes('On Hold'));

    // Increment 1 ch
    card5.querySelector('[data-action="quick-add"]').click();
    assert.ok(card5.textContent.includes('Reading'), 'Status must switch from On Hold to Reading');
    assert.ok(card5.textContent.includes('Ch. 421 / 500'));
  });

  // A14: Dialog Accessibility (inert background, aria-modal, role="dialog", focus restore)
  await test('A14', 'Dialogs set role="dialog", aria-modal, inert background, and restore focus on close', async () => {
    const { window } = createDom();
    const doc = window.document;

    // Load sample to have cards
    doc.getElementById('btn-load-sample').click();
    const appEl = doc.getElementById('app');
    const navEl = doc.getElementById('floating-bottom-nav');
    const formModal = doc.getElementById('modal-novel-form');
    const confirmModal = doc.getElementById('confirm-dialog');

    // 1. Verify attributes on dialogs
    assert.strictEqual(formModal.getAttribute('role'), 'dialog');
    assert.strictEqual(formModal.getAttribute('aria-modal'), 'true');
    assert.strictEqual(confirmModal.getAttribute('role'), 'dialog');
    assert.strictEqual(confirmModal.getAttribute('aria-modal'), 'true');

    // 2. Open form from shelf Add button
    const addBtn = doc.getElementById('btn-add-novel-top');
    addBtn.focus();
    addBtn.click();

    // Check background view screens & nav are inert and aria-hidden
    assert.strictEqual(doc.getElementById('view-shelf').inert, true);
    assert.strictEqual(doc.getElementById('view-shelf').getAttribute('aria-hidden'), 'true');
    assert.strictEqual(navEl.inert, true);
    assert.strictEqual(navEl.getAttribute('aria-hidden'), 'true');
    assert.strictEqual(formModal.inert, false);

    // Close form
    doc.getElementById('btn-close-form').click();
    assert.strictEqual(doc.getElementById('view-shelf').inert, false);
    assert.strictEqual(doc.getElementById('view-shelf').getAttribute('aria-hidden'), null);
    assert.strictEqual(navEl.inert, false);
    assert.strictEqual(doc.activeElement, addBtn, 'Focus should be restored to add button');

    // 3. Confirm dialog
    const card = doc.querySelector('.novel-card');
    card.click();
    const deleteBtn = doc.getElementById('btn-detail-delete');
    deleteBtn.focus();
    deleteBtn.click(); // Triggers showConfirm()

    await new Promise(r => setTimeout(r, 20));

    // Confirm dialog is open
    assert.strictEqual(confirmModal.style.display, 'flex');
    assert.strictEqual(appEl.inert, true);
    assert.strictEqual(appEl.getAttribute('aria-hidden'), 'true');
    assert.strictEqual(navEl.inert, true);
    assert.strictEqual(doc.activeElement, doc.getElementById('btn-confirm-no'), 'Focus should move inside dialog to Cancel button');

    // Cancel confirm
    doc.getElementById('btn-confirm-no').click();
    await new Promise(r => setTimeout(r, 20));

    assert.strictEqual(confirmModal.style.display, 'none');
    assert.strictEqual(appEl.inert, false);
    assert.strictEqual(appEl.getAttribute('aria-hidden'), null);
    assert.strictEqual(doc.activeElement, deleteBtn, 'Focus should be restored to delete button');
  });

  // A15: Glass Bottom-Sheet & Custom Select
  await test('A15', 'Custom select opens glass bottom sheet, shows options, updates native select on choice, and closes via back handler with focus restored', async () => {
    const { window } = createDom();
    const doc = window.document;

    // Load sample library to populate genres
    doc.getElementById('btn-load-sample').click();

    const sortSelect = doc.getElementById('sort-filter');
    const genreSelect = doc.getElementById('genre-filter');
    const sortBtn = doc.querySelector('.custom-select-btn[data-target="sort-filter"]');
    const genreBtn = doc.querySelector('.custom-select-btn[data-target="genre-filter"]');

    assert.ok(sortBtn, 'Custom select button for sort-filter should exist');
    assert.ok(genreBtn, 'Custom select button for genre-filter should exist');
    assert.ok(sortSelect.classList.contains('sr-only-select'), 'Native sort-filter should have sr-only-select class');
    assert.ok(genreSelect.classList.contains('sr-only-select'), 'Native genre-filter should have sr-only-select class');

    // 1. Open sort sheet via custom button
    sortBtn.focus();
    sortBtn.click();

    const sheetContainer = doc.getElementById('glass-sheet-container');
    const sheetEl = doc.getElementById('glass-sheet');
    const appEl = doc.getElementById('app');
    const navEl = doc.getElementById('floating-bottom-nav');

    assert.ok(window.BottomSheet.isOpen(), 'BottomSheet should be open');
    assert.strictEqual(sheetContainer.style.display, 'grid');
    assert.ok(sheetContainer.classList.contains('glass-popup-container'));
    assert.ok(sheetEl.classList.contains('glass-popup-card'));
    assert.strictEqual(sheetEl.getAttribute('role'), 'dialog');
    assert.strictEqual(sheetEl.getAttribute('aria-modal'), 'true');
    assert.strictEqual(appEl.inert, true, 'App should be inert while sheet is open');
    assert.strictEqual(appEl.getAttribute('aria-hidden'), 'true');
    assert.strictEqual(navEl.inert, true, 'Nav should be inert while sheet is open');

    // Verify all 5 sort options are rendered and 'updated-desc' is selected
    const optionRows = doc.querySelectorAll('.sheet-option-row');
    assert.strictEqual(optionRows.length, 5, 'Should render 5 sort option rows');
    const selectedRow = doc.querySelector('.sheet-option-row.selected');
    assert.ok(selectedRow, 'Should have a selected row');
    assert.strictEqual(selectedRow.dataset.value, 'updated-desc');
    assert.strictEqual(selectedRow.getAttribute('aria-selected'), 'true');

    // 2. Choose 'Highest Rated' (rating-desc)
    let changeFired = false;
    sortSelect.addEventListener('change', () => { changeFired = true; });

    const ratingRow = doc.querySelector('.sheet-option-row[data-value="rating-desc"]');
    ratingRow.click();

    assert.strictEqual(sortSelect.value, 'rating-desc', 'Native select value should be updated');
    assert.ok(changeFired, 'Native change event should fire on selection');
    assert.strictEqual(sortBtn.querySelector('.custom-select-label').textContent, 'Highest Rated');

    // Wait for auto-close timeout (120ms + 260ms animation)
    await new Promise(r => setTimeout(r, 450));

    assert.strictEqual(window.BottomSheet.isOpen(), false, 'BottomSheet should close after selection');
    assert.strictEqual(appEl.inert, false, 'App should no longer be inert');
    assert.strictEqual(doc.activeElement, sortBtn, 'Focus should be restored to sort button');

    // 3. Test closing via Back handler
    genreBtn.focus();
    genreBtn.click();
    assert.ok(window.BottomSheet.isOpen(), 'BottomSheet should open for genre-filter');
    assert.strictEqual(appEl.inert, true);

    // Call window.handleAppBack()
    const handled = window.handleAppBack();
    assert.strictEqual(handled, true, 'handleAppBack should handle and close sheet');

    // Wait for close animation
    await new Promise(r => setTimeout(r, 350));
    assert.strictEqual(window.BottomSheet.isOpen(), false, 'Sheet should be closed by back handler');
    assert.strictEqual(appEl.inert, false, 'App inert should be cleared');
    assert.strictEqual(doc.activeElement, genreBtn, 'Focus should return to genre button');
  });

  // A16: Glass Date Picker — Selection and Clear
  await test('A16', 'Glass date picker selects date, updates hidden input, fires change event, and clear button empties it', async () => {
    const { window } = createDom();
    const doc = window.document;

    // Open novel form
    doc.getElementById('btn-add-novel-top').click();

    const startedInput = doc.getElementById('form-started');
    const startedBtn = doc.querySelector('.custom-date-btn[data-target="form-started"]');
    assert.ok(startedBtn, 'Custom date button for form-started should exist');
    assert.ok(startedInput.classList.contains('sr-only-input'), 'Native input should have sr-only-input');

    // Click custom date button to open calendar bottom sheet
    startedBtn.click();
    assert.ok(window.BottomSheet.isOpen(), 'BottomSheet should open for date picker');

    const calWrap = doc.querySelector('.glass-calendar-wrap');
    assert.ok(calWrap, 'Calendar container should exist in sheet');

    // Pick a day cell from current month
    const dayBtn = calWrap.querySelector('.calendar-day:not(.outside-month)');
    assert.ok(dayBtn, 'Day cell should exist');
    dayBtn.click();

    // Find selected day and confirm Set button
    const setBtn = calWrap.querySelector('.btn-set');
    assert.strictEqual(setBtn.disabled, false, 'Set button should be enabled');

    let changeFired = false;
    startedInput.addEventListener('change', () => { changeFired = true; });

    setBtn.click();
    await new Promise(r => setTimeout(r, 450)); // wait for sheet close

    assert.ok(startedInput.value.length > 0, 'Started input value should be set');
    assert.ok(changeFired, 'Change event should have fired');
    assert.notStrictEqual(startedBtn.querySelector('.custom-date-label').textContent, 'Select date');
    assert.strictEqual(window.BottomSheet.isOpen(), false, 'BottomSheet should be closed');

    // Now test Clear button
    startedBtn.click();
    assert.ok(window.BottomSheet.isOpen(), 'Sheet reopens');

    let clearChangeFired = false;
    startedInput.addEventListener('change', () => { clearChangeFired = true; });

    const clearBtn = doc.querySelector('.calendar-action-btn.btn-clear');
    clearBtn.click();
    await new Promise(r => setTimeout(r, 450));

    assert.strictEqual(startedInput.value, '', 'Input should be empty after clear');
    assert.ok(clearChangeFired, 'Change event should fire after clear');
    assert.strictEqual(startedBtn.querySelector('.custom-date-label').textContent, 'Select date');
    assert.strictEqual(window.BottomSheet.isOpen(), false, 'Sheet closes after clear');
  });

  // A17: Glass Date Picker — Leap year February 29 and Month-end navigation
  await test('A17', 'Glass date picker correctly handles leap year Feb 29 and month-end transitions', async () => {
    const { window } = createDom();
    const doc = window.document;

    doc.getElementById('btn-add-novel-top').click();
    const startedBtn = doc.querySelector('.custom-date-btn[data-target="form-started"]');
    startedBtn.click();

    // Leap year date helper verification
    assert.strictEqual(new Date(2028, 2, 0).getDate(), 29, '2028 Feb has 29 days');
    assert.strictEqual(new Date(2027, 2, 0).getDate(), 28, '2027 Feb has 28 days');

    // Click month-year button to enter jump mode
    const monthYearBtn = doc.querySelector('.calendar-month-year-btn');
    monthYearBtn.click();

    const jumpGrid = doc.querySelector('.calendar-jump-grid');
    assert.ok(jumpGrid, 'Jump grid should appear');

    // Navigate to 2028
    const curYear = new Date().getFullYear();
    const yearDiff = 2028 - curYear;
    const prevBtn = doc.querySelector('.calendar-nav-btn[aria-label="Previous year"]');
    const nextBtn = doc.querySelector('.calendar-nav-btn[aria-label="Next year"]');
    for (let i = 0; i < Math.abs(yearDiff); i++) {
      if (yearDiff > 0) nextBtn.click();
      else prevBtn.click();
    }

    // Click February in 2028
    jumpGrid.querySelector('.calendar-month-card[data-month="2"]').click();

    // Verify 29th exists and is inside current month
    const day29 = doc.querySelector('.calendar-day[data-date="2028-02-29"]');
    assert.ok(day29, 'Feb 29 should exist in 2028');
    assert.strictEqual(day29.classList.contains('outside-month'), false, 'Feb 29 should be inside current month');

    // Also verify April has 30 days and no day 31
    monthYearBtn.click();
    doc.querySelector('.calendar-jump-grid .calendar-month-card[data-month="4"]').click();
    const apr30 = doc.querySelector('.calendar-day[data-date="2028-04-30"]');
    assert.ok(apr30, 'Apr 30 should exist');
    assert.strictEqual(apr30.classList.contains('outside-month'), false);
    const apr31 = doc.querySelector('.calendar-day[data-date="2028-04-31"]');
    assert.strictEqual(apr31, null, 'Apr 31 must not exist');

    window.BottomSheet.close();
    await new Promise(r => setTimeout(r, 450));
  });

  // A18: Glass Date Picker — Started after finished validation
  await test('A18', 'Glass date picker validates that finished date cannot be earlier than started date', async () => {
    const { window } = createDom();
    const doc = window.document;

    doc.getElementById('btn-add-novel-top').click();
    const startedInput = doc.getElementById('form-started');
    const finishedInput = doc.getElementById('form-finished');
    const finishedBtn = doc.querySelector('.custom-date-btn[data-target="form-finished"]');

    // Set started to 2026-10-15
    startedInput.value = '2026-10-15';
    window.updateCustomDate(startedInput);

    // Open finished date picker
    finishedBtn.click();

    // Check that "Same as started" chip is present
    const chips = Array.from(doc.querySelectorAll('.calendar-chip'));
    const sameChip = chips.find(c => c.textContent.includes('Same as started'));
    assert.ok(sameChip, 'Same as started chip should exist when started is filled');

    // Jump to 2026-10
    const monthYearBtn = doc.querySelector('.calendar-month-year-btn');
    monthYearBtn.click();
    const curYear = new Date().getFullYear();
    const yearDiff = 2026 - curYear;
    const prevBtn = doc.querySelector('.calendar-nav-btn[aria-label="Previous year"]');
    const nextBtn = doc.querySelector('.calendar-nav-btn[aria-label="Next year"]');
    for (let i = 0; i < Math.abs(yearDiff); i++) {
      if (yearDiff > 0) nextBtn.click();
      else prevBtn.click();
    }
    const jumpGrid = doc.querySelector('.calendar-jump-grid');
    jumpGrid.querySelector('.calendar-month-card[data-month="10"]').click();

    // Verify 2026-10-10 (earlier than started date 2026-10-15) is disabled
    const day10 = doc.querySelector('.calendar-day[data-date="2026-10-10"]');
    assert.ok(day10, 'Day 10 should exist');
    assert.ok(day10.classList.contains('disabled'), 'Day 10 should be disabled since it is earlier than started date');
    assert.strictEqual(day10.getAttribute('aria-disabled'), 'true');

    // Click 'Same as started' chip
    const sameChipNow = Array.from(doc.querySelectorAll('.calendar-chip')).find(c => c.textContent.includes('Same as started'));
    assert.ok(sameChipNow, 'Same as started chip should be present in DOM');
    sameChipNow.click();

    const setBtnAfterSame = doc.querySelector('.calendar-action-btn.btn-set');
    assert.strictEqual(setBtnAfterSame.disabled, false, 'Set button should be enabled after picking same as started');

    // Pick 2026-10-20 (after started date) — should NOT be disabled
    const day20 = doc.querySelector('.calendar-day[data-date="2026-10-20"]');
    assert.ok(day20, 'Day 20 should exist');
    assert.strictEqual(day20.classList.contains('disabled'), false, 'Day 20 should be enabled');
    day20.click();
    const setBtnFinal = doc.querySelector('.calendar-action-btn.btn-set');
    assert.strictEqual(setBtnFinal.disabled, false);

    setBtnFinal.click();
    await new Promise(r => setTimeout(r, 450));
    assert.strictEqual(finishedInput.value, '2026-10-20');
  });

  // A19: Date format helper: parses and formats correctly across months/years
  await test('A19', 'formatDisplayDate parses and formats correctly across months, years, leap days', () => {
    const { window } = createDom();
    assert.strictEqual(window.formatDisplayDate('2026-11-17'), '17 Nov 2026');
    assert.strictEqual(window.formatDisplayDate('2028-02-29'), '29 Feb 2028');
    assert.strictEqual(window.formatDisplayDate('2024-01-01'), '1 Jan 2024');
    assert.strictEqual(window.formatDisplayDate('2025-12-31'), '31 Dec 2025');
    assert.strictEqual(window.formatDisplayDate(''), '');
    assert.strictEqual(window.formatDisplayDate(null), '');
  });

  // A20: Empty title validation shows error and does not save
  await test('A20', 'Empty title validation shows inline error, shakes input, and prevents saving', () => {
    const { window } = createDom();
    const doc = window.document;

    // Open novel form
    doc.getElementById('btn-add-novel-top').click();

    const form = doc.getElementById('novel-form');
    const titleInput = doc.getElementById('form-title');
    const titleError = doc.getElementById('form-title-error');

    titleInput.value = '   '; // empty/whitespace
    form.dispatchEvent(new window.Event('submit', { cancelable: true, bubbles: true }));

    // Verify inline error is visible
    assert.strictEqual(titleError.style.display, 'block');
    assert.strictEqual(titleError.textContent, 'Title is required');
    assert.ok(titleInput.classList.contains('input-error'), 'Title input should have input-error class');
    assert.ok(titleInput.classList.contains('input-shake'), 'Title input should have input-shake class');

    // Verify no novel was saved to shelf
    const novelCards = doc.querySelectorAll('.novel-card');
    assert.strictEqual(novelCards.length, 0, 'No novel should be added on validation error');

    // Type a title and verify error disappears
    titleInput.value = 'Lord of the Mysteries';
    titleInput.dispatchEvent(new window.Event('input', { bubbles: true }));
    assert.strictEqual(titleError.style.display, 'none');
    assert.strictEqual(titleInput.classList.contains('input-error'), false);
  });

  // A21: Form layout — action bar in normal flow, scroll body separation, auto-grow notes
  await test('A21', 'Form layout places actions in normal flow and auto-grows notes textarea', async () => {
    const { window } = createDom();
    const doc = window.document;

    doc.getElementById('btn-add-novel-top').click();

    const form = doc.getElementById('novel-form');
    const scrollBody = form.querySelector('.form-scroll-body');
    const actionsBottom = form.querySelector('.form-actions-bottom');

    assert.ok(scrollBody, 'Form must contain a .form-scroll-body container');
    assert.ok(actionsBottom, 'Form must contain a .form-actions-bottom container');
    assert.strictEqual(scrollBody.nextElementSibling, actionsBottom, 'Actions bar must be in normal flow directly following the scroll body');

    // Verify notes textarea auto-grow
    const notesArea = doc.getElementById('form-notes');
    assert.ok(notesArea, 'Notes textarea should exist');
    notesArea.value = 'A long note\nwith multiple\nlines of text\nthat should trigger\nauto-growing.';
    notesArea.dispatchEvent(new window.Event('input', { bubbles: true }));
    assert.ok(notesArea.style.height, 'Notes textarea height should be set on input');
  });

  // A22: Date picker — Future dates allowed, out-of-order resilience
  await test('A22', 'Date picker allows choosing future dates and handles existing out-of-order dates safely', async () => {
    const { window } = createDom();
    const doc = window.document;

    doc.getElementById('btn-add-novel-top').click();
    const startedInput = doc.getElementById('form-started');
    const startedBtn = doc.querySelector('.custom-date-btn[data-target="form-started"]');

    // Future year selection (e.g. 2030-05-15)
    startedBtn.click();
    const monthYearBtn = doc.querySelector('.calendar-month-year-btn');
    monthYearBtn.click();
    const curYear = new Date().getFullYear();
    const nextBtn = doc.querySelector('.calendar-nav-btn[aria-label="Next year"]');
    for (let i = 0; i < (2030 - curYear); i++) nextBtn.click();
    doc.querySelector('.calendar-jump-grid .calendar-month-card[data-month="5"]').click();

    const futureDay = doc.querySelector('.calendar-day[data-date="2030-05-15"]');
    assert.ok(futureDay, '2030-05-15 should exist');
    assert.strictEqual(futureDay.classList.contains('disabled'), false, 'Future date should NOT be disabled by default');
    futureDay.click();

    const setBtn = doc.querySelector('.calendar-action-btn.btn-set');
    assert.strictEqual(setBtn.disabled, false, 'Set button should be enabled for future date');
    setBtn.click();
    await new Promise(r => setTimeout(r, 450));
    assert.strictEqual(startedInput.value, '2030-05-15');

    // Out-of-order pre-existing values: Started 2030-05-15, set Finished to 2029-01-01
    const finishedInput = doc.getElementById('form-finished');
    const finishedBtn = doc.querySelector('.custom-date-btn[data-target="form-finished"]');
    finishedInput.value = '2029-01-01';
    window.updateCustomDate(finishedInput);

    // Open Finished picker with out-of-order date: should not throw, should show Set enabled
    finishedBtn.click();
    assert.ok(window.BottomSheet.isOpen(), 'Picker should open safely even with out-of-order dates');
    const setBtn2 = doc.querySelector('.calendar-action-btn.btn-set');
    assert.strictEqual(setBtn2.disabled, false, 'Set button should remain enabled');
    window.BottomSheet.close();
    await new Promise(r => setTimeout(r, 450));
  });

  // A23: Labels, dialogs, toasts and undo for deletes
  await test('A23', 'Labels, confirm dialog structure, and delete undo restore original state', async () => {
    const { window } = createDom();
    const doc = window.document;

    // Add a novel without rating
    doc.getElementById('btn-add-novel-top').click();
    doc.getElementById('form-title').value = 'Reverend Insanity';
    doc.getElementById('novel-form').dispatchEvent(new window.Event('submit', { cancelable: true, bubbles: true }));

    // Check shelf card unrated badge
    const card = doc.querySelector('.novel-card');
    assert.ok(card, 'Novel card should exist');
    const unratedShelf = card.querySelector('.rating-unrated');
    assert.ok(unratedShelf, 'Unrated shelf badge should have rating-unrated class');
    assert.strictEqual(unratedShelf.textContent, 'Not rated');

    // Click card to open details
    card.click();
    const unratedDetail = doc.querySelector('.detail-unrated');
    assert.ok(unratedDetail, 'Detail screen should have detail-unrated class');
    assert.strictEqual(unratedDetail.textContent, 'Not rated');

    // Trigger delete
    doc.getElementById('btn-detail-delete').click();
    const confirmDialog = doc.getElementById('confirm-dialog');
    assert.strictEqual(confirmDialog.style.display, 'flex');
    assert.strictEqual(doc.getElementById('confirm-title').textContent, 'Delete novel?');
    assert.ok(doc.getElementById('confirm-message').textContent.includes('Reverend Insanity'));

    // Confirm deletion
    doc.getElementById('btn-confirm-yes').click();
    await new Promise(r => setTimeout(r, 50));

    // Verify novel removed from shelf
    assert.strictEqual(doc.querySelectorAll('.novel-card').length, 0, 'Novel should be deleted from shelf');

    // Check toast with Undo button
    const toast = doc.querySelector('.toast-undo') || doc.querySelector('.toast:last-child');
    assert.ok(toast, 'Toast notification should be displayed');
    const undoBtn = toast.querySelector('.toast-action-btn');
    assert.ok(undoBtn, 'Toast should contain an Undo button');
    assert.strictEqual(undoBtn.textContent, 'Undo');

    // Click Undo
    undoBtn.click();
    await new Promise(r => setTimeout(r, 50));

    // Verify novel is restored
    const restoredCards = doc.querySelectorAll('.novel-card');
    assert.strictEqual(restoredCards.length, 1, 'Novel should be restored by Undo');
    assert.ok(restoredCards[0].textContent.includes('Reverend Insanity'));
  });

  // A24: Shelf quick-action "+1 Ch" hidden on completed novels
  await test('A24', 'Quick +1 Ch action is hidden on Completed novels and visible on active ones', async () => {
    const { window } = createDom();
    const doc = window.document;

    // Add a Reading novel
    doc.getElementById('btn-add-novel-top').click();
    doc.getElementById('form-title').value = 'Active Reading Novel';
    doc.getElementById('novel-form').dispatchEvent(new window.Event('submit', { cancelable: true, bubbles: true }));

    // Add a Completed novel
    doc.getElementById('btn-add-novel-top').click();
    doc.getElementById('form-title').value = 'Finished Story';
    doc.querySelector('.status-pill-btn[data-status="Completed"]').click();
    doc.getElementById('novel-form').dispatchEvent(new window.Event('submit', { cancelable: true, bubbles: true }));

    const cards = Array.from(doc.querySelectorAll('.novel-card'));
    const readingCard = cards.find(c => c.textContent.includes('Active Reading Novel'));
    const completedCard = cards.find(c => c.textContent.includes('Finished Story'));

    assert.ok(readingCard, 'Reading card should exist');
    assert.ok(completedCard, 'Completed card should exist');

    const readingPlusBtn = readingCard.querySelector('[data-action="quick-add"]');
    const completedPlusBtn = completedCard.querySelector('[data-action="quick-add"]');

    assert.ok(readingPlusBtn, 'Reading novel should have +1 Ch button');
    assert.strictEqual(completedPlusBtn, null, 'Completed novel must NOT have +1 Ch button');
  });

  console.log('\n--- Test Summary ---');
  const passed = results.filter(r => r.status === 'PASS').length;
  const failed = results.filter(r => r.status === 'FAIL').length;
  console.log(`Total: ${results.length}, Passed: ${passed}, Failed: ${failed}`);
  if (failed > 0) process.exit(1);
}

runTests();
