/* =============================================
   YT Analyzer — Side Panel Logic
   Displays analysis results in detail
   ============================================= */

(() => {
  'use strict';

  let results = {};
  let sortMode = 'overall'; // 'overall', 'hype', 'substance', 'manipulation'

  const contentEl = document.getElementById('content');
  const emptyState = document.getElementById('empty-state');

  // ── Settings button → open options page ───────

  document.getElementById('settings-btn').addEventListener('click', () => {
    chrome.runtime.openOptionsPage();
  });

  // ── Load cached results on open ───────────────

  chrome.runtime.sendMessage({ type: 'GET_CACHE' }, (response) => {
    if (response?.cache && Object.keys(response.cache).length > 0) {
      results = response.cache;
      renderResults();
    }
  });

  // ── Listen for updates from background ────────

  chrome.runtime.onMessage.addListener((msg) => {
    if (msg.type === 'PARTIAL_RESULTS') {
      Object.assign(results, msg.results);
      renderResults();
    }

    if (msg.type === 'ANALYSIS_PROGRESS') {
      showProgress(msg);
    }

    if (msg.type === 'ANALYSIS_COMPLETE') {
      hideProgress();
    }

    if (msg.type === 'SHOW_VIDEO_DETAIL') {
      // Expand this specific video card
      setTimeout(() => {
        const card = document.querySelector(`[data-video-id="${msg.videoId}"]`);
        if (card) {
          card.classList.add('expanded');
          card.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }
      }, 100);
    }
  });

  // ── Render results ────────────────────────────

  function renderResults() {
    const validResults = Object.entries(results).filter(([_, r]) => !r.error && r.overall_score !== undefined);

    if (validResults.length === 0) {
      emptyState.style.display = '';
      return;
    }

    emptyState.style.display = 'none';

    // Sort results
    const sorted = [...validResults].sort((a, b) => {
      switch (sortMode) {
        case 'hype': return b[1].hype_score - a[1].hype_score;
        case 'substance': return b[1].substance_score - a[1].substance_score;
        case 'manipulation': return b[1].manipulation_score - a[1].manipulation_score;
        case 'overall':
        default: return b[1].overall_score - a[1].overall_score;
      }
    });

    // Build HTML
    let html = '';

    // Stats bar
    const avgOverall = Math.round(validResults.reduce((s, [_, r]) => s + r.overall_score, 0) / validResults.length);
    const clickbaitCount = validResults.filter(([_, r]) => r.overall_score < 30).length;

    html += `
      <div class="stats-bar">
        <span><span class="stats-count">${validResults.length}</span> Videos analysiert · ⌀ Score: <span class="stats-count">${avgOverall}</span> · Clickbait: <span class="stats-count">${clickbaitCount}</span></span>
        <button class="clear-btn" id="clear-btn">Löschen</button>
      </div>
    `;

    // Sort bar
    html += `
      <div class="sort-bar">
        <button class="sort-btn ${sortMode === 'overall' ? 'active' : ''}" data-sort="overall">Gesamt</button>
        <button class="sort-btn ${sortMode === 'hype' ? 'active' : ''}" data-sort="hype">Hype</button>
        <button class="sort-btn ${sortMode === 'substance' ? 'active' : ''}" data-sort="substance">Substanz</button>
        <button class="sort-btn ${sortMode === 'manipulation' ? 'active' : ''}" data-sort="manipulation">Manip.</button>
      </div>
    `;

    // Video cards
    for (const [videoId, result] of sorted) {
      html += renderVideoCard(videoId, result);
    }

    contentEl.innerHTML = html;

    // Bind events
    document.getElementById('clear-btn')?.addEventListener('click', () => {
      chrome.runtime.sendMessage({ type: 'CLEAR_CACHE' });
      results = {};
      renderResults();
      emptyState.style.display = '';
    });

    document.querySelectorAll('.sort-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        sortMode = btn.dataset.sort;
        renderResults();
      });
    });

    document.querySelectorAll('.card-header').forEach(header => {
      header.addEventListener('click', () => {
        header.closest('.video-card').classList.toggle('expanded');
      });
    });
  }

  function renderVideoCard(videoId, result) {
    const score = Math.round(result.overall_score);
    const verdictClass = score >= 70 ? 'verdict-high' : score >= 40 ? 'verdict-mid' : 'verdict-low';
    const title = result.video?.title || videoId;
    const channel = result.video?.channel || '';

    return `
      <div class="video-card" data-video-id="${videoId}">
        <div class="card-header">
          <div class="card-verdict ${verdictClass}">${score}</div>
          <div class="card-info">
            <div class="card-title">${escapeHtml(title)}</div>
            ${channel ? `<div class="card-channel">${escapeHtml(channel)}</div>` : ''}
          </div>
          <svg class="card-expand-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <polyline points="6 9 12 15 18 9"/>
          </svg>
        </div>

        <div class="card-detail">
          ${renderScoreBar('Hype', result.hype_score, 'inverted')}
          ${renderScoreBar('Substanz', result.substance_score, 'normal')}
          ${renderScoreBar('Manipulation', result.manipulation_score, 'inverted')}
          ${renderScoreBar('Gesamt', result.overall_score, 'normal')}

          ${result.explanation ? `<div class="explanation">${escapeHtml(result.explanation)}</div>` : ''}

          ${renderFlags(result.red_flags, 'red', 'Red Flags')}
          ${renderFlags(result.green_flags, 'green', 'Green Flags')}

          <div class="card-meta">
            <span>${result.transcriptStatus === 'available' ? '📝 Transkript' : '⚠ Nur Metadaten'}</span>
            <span>${result.model || ''}</span>
            <span>${result.timestamp ? new Date(result.timestamp).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' }) : ''}</span>
          </div>
        </div>
      </div>
    `;
  }

  function renderScoreBar(label, value, mode) {
    const v = Math.round(value || 0);
    // 'inverted' means high value = bad (red), 'normal' means high = good (green)
    let color;
    if (mode === 'inverted') {
      color = v >= 60 ? 'var(--red)' : v >= 30 ? 'var(--yellow)' : 'var(--green)';
    } else {
      color = v >= 70 ? 'var(--green)' : v >= 40 ? 'var(--yellow)' : 'var(--red)';
    }

    return `
      <div class="score-row">
        <span class="score-label">${label}</span>
        <div class="score-bar-track">
          <div class="score-bar-fill" style="width: ${v}%; background: ${color}"></div>
        </div>
        <span class="score-value" style="color: ${color}">${v}</span>
      </div>
    `;
  }

  function renderFlags(flags, type, label) {
    if (!flags || flags.length === 0) return '';
    return `
      <div class="flags-section">
        <div class="flags-label ${type}">${type === 'red' ? '⚑' : '✓'} ${label}</div>
        <div class="flags-list">
          ${flags.map(f => `<span class="flag-pill ${type}">${escapeHtml(f)}</span>`).join('')}
        </div>
      </div>
    `;
  }

  // ── Progress ──────────────────────────────────

  function showProgress(msg) {
    let progressEl = document.querySelector('.progress-bar');
    if (!progressEl) {
      progressEl = document.createElement('div');
      progressEl.className = 'progress-bar';
      contentEl.insertBefore(progressEl, contentEl.firstChild);
    }
    progressEl.innerHTML = `
      <div class="progress-spinner"></div>
      <span>Analysiere ${msg.current}/${msg.total}...</span>
    `;
  }

  function hideProgress() {
    document.querySelector('.progress-bar')?.remove();
  }

  // ── Utilities ─────────────────────────────────

  function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }
})();
