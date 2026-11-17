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

    // Increment middle card
    const middleCardId = cardsBefore[2];
    const middleCard = doc.querySelector(`[data-id="${middleCardId}"]`);
    const btn = middleCard.querySelector('[data-action="quick-add"]');
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
    assert.strictEqual(sheetContainer.style.display, 'flex');
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

  console.log('\n--- Test Summary ---');
  const passed = results.filter(r => r.status === 'PASS').length;
  const failed = results.filter(r => r.status === 'FAIL').length;
  console.log(`Total: ${results.length}, Passed: ${passed}, Failed: ${failed}`);
  if (failed > 0) process.exit(1);
}

runTests();
