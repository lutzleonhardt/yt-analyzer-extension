// =============================================
// YT Analyzer — Options Page Logic
// =============================================

(function() {
  'use strict';

  // ── Debug helper ────────────────────────────
  var debugEl = document.getElementById('debug');
  // debugEl.style.display = 'block';  // Auskommentiert für Produktion

  function dbg(msg) {
    console.log('[YT Analyzer Options]', msg);
    debugEl.textContent += msg + '\n';
  }

  dbg('Script loaded (external file)');
  dbg('chrome defined: ' + (typeof chrome !== 'undefined'));
  dbg('chrome.storage defined: ' + (typeof chrome !== 'undefined' && !!chrome.storage));
  dbg('chrome.storage.local defined: ' + (typeof chrome !== 'undefined' && !!chrome.storage && !!chrome.storage.local));

  var storageAvailable = (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local);

  if (!storageAvailable) {
    dbg('ERROR: chrome.storage.local is NOT available!');
    var statusEl = document.getElementById('save-status');
    statusEl.textContent = 'chrome.storage nicht verfügbar';
    statusEl.classList.add('error-status', 'visible');
    statusEl.classList.remove('hidden');
  }

  // ── Provider toggle ─────────────────────────
  var providerRadios = document.querySelectorAll('input[name="provider"]');
  var providerSections = document.querySelectorAll('.provider-section');

  function switchProvider(provider) {
    dbg('Switching provider to: ' + provider);
    providerSections.forEach(function(s) { s.classList.remove('active'); });
    var target = document.getElementById('section-' + provider);
    if (target) {
      target.classList.add('active');
    } else {
      dbg('ERROR: section-' + provider + ' not found!');
    }
  }

  providerRadios.forEach(function(radio) {
    radio.addEventListener('change', function() {
      dbg('Radio changed to: ' + radio.value);
      switchProvider(radio.value);
    });
  });

  // ── Load saved settings ─────────────────────
  if (storageAvailable) {
    dbg('Loading settings...');
    chrome.storage.local.get(
      ['provider', 'openaiKey', 'anthropicKey', 'openaiModel', 'anthropicModel'],
      function(data) {
        if (chrome.runtime.lastError) {
          dbg('Load error: ' + chrome.runtime.lastError.message);
          return;
        }
        dbg('Loaded: provider=' + (data.provider || '(none)') +
            ', openaiKey=' + (data.openaiKey ? 'SET' : 'EMPTY') +
            ', anthropicKey=' + (data.anthropicKey ? 'SET' : 'EMPTY'));

        if (data.provider) {
          var radio = document.getElementById('provider-' + data.provider);
          if (radio) {
            radio.checked = true;
            switchProvider(data.provider);
          }
        }
        if (data.openaiKey) document.getElementById('openai-key').value = data.openaiKey;
        if (data.anthropicKey) document.getElementById('anthropic-key').value = data.anthropicKey;
        if (data.openaiModel) document.getElementById('openai-model').value = data.openaiModel;
        if (data.anthropicModel) document.getElementById('anthropic-model').value = data.anthropicModel;
      }
    );
  }

  // ── Save settings ───────────────────────────
  var saveBtn = document.getElementById('save-btn');
  dbg('Save button found: ' + !!saveBtn);

  saveBtn.addEventListener('click', function() {
    dbg('Save button clicked!');

    if (!storageAvailable) {
      dbg('Cannot save: storage not available');
      return;
    }

    var checkedRadio = document.querySelector('input[name="provider"]:checked');
    var selectedProvider = checkedRadio ? checkedRadio.value : 'openai';

    var settings = {
      provider: selectedProvider,
      openaiKey: document.getElementById('openai-key').value.trim(),
      anthropicKey: document.getElementById('anthropic-key').value.trim(),
      openaiModel: document.getElementById('openai-model').value,
      anthropicModel: document.getElementById('anthropic-model').value
    };

    dbg('Saving: provider=' + settings.provider +
        ', openaiKey=' + (settings.openaiKey ? 'SET' : 'EMPTY') +
        ', anthropicKey=' + (settings.anthropicKey ? 'SET' : 'EMPTY'));

    try {
      chrome.storage.local.set(settings, function() {
        if (chrome.runtime.lastError) {
          dbg('Save FAILED: ' + chrome.runtime.lastError.message);
          return;
        }

        dbg('Save SUCCESS!');
        var statusEl = document.getElementById('save-status');
        statusEl.textContent = '✓ Gespeichert';
        statusEl.classList.remove('error-status', 'hidden');
        statusEl.classList.add('visible');
        setTimeout(function() {
          statusEl.classList.remove('visible');
          statusEl.classList.add('hidden');
        }, 3000);

        // Verify
        chrome.storage.local.get(null, function(allData) {
          dbg('Verify ALL storage keys: ' + JSON.stringify(Object.keys(allData)));
          dbg('  provider: ' + allData.provider);
          dbg('  openaiKey: ' + (allData.openaiKey ? 'SET' : 'EMPTY'));
          dbg('  anthropicKey: ' + (allData.anthropicKey ? 'SET' : 'EMPTY'));
        });
      });
    } catch(e) {
      dbg('Save EXCEPTION: ' + e.message);
    }
  });

  dbg('Init complete');
})();
