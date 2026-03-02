/* =============================================
   YT Analyzer — Content Script
   Runs on youtube.com pages.
   Detects videos, injects score badges,
   communicates with background worker.
   ============================================= */

(() => {
  'use strict';

  // ── State ─────────────────────────────────────

  const badgeMap = new Map();  // videoId -> badge element
  let isAnalyzing = false;
  let floatingButton = null;

  // ── Video ID extraction ───────────────────────

  function extractVideoId(href) {
    if (!href) return null;
    try {
      const url = new URL(href, 'https://www.youtube.com');
      if (url.pathname === '/watch') {
        return url.searchParams.get('v');
      }
      if (url.pathname.startsWith('/shorts/')) {
        return url.pathname.split('/shorts/')[1]?.split(/[/?#]/)[0];
      }
      if (url.hostname === 'youtu.be') {
        return url.pathname.slice(1).split(/[/?#]/)[0];
      }
    } catch {
      // Try regex fallback
      const match = href.match(/[?&]v=([a-zA-Z0-9_-]{11})/);
      if (match) return match[1];
      const shortsMatch = href.match(/\/shorts\/([a-zA-Z0-9_-]{11})/);
      if (shortsMatch) return shortsMatch[1];
    }
    return null;
  }

  // ── Find all video elements on page ───────────

  function findVideos() {
    const videos = [];
    const seen = new Set();

    // Homepage: ytd-rich-item-renderer
    // Search/subscriptions: ytd-video-renderer
    // Sidebar suggestions: ytd-compact-video-renderer
    const selectors = [
      'ytd-rich-item-renderer',
      'ytd-video-renderer',
      'ytd-compact-video-renderer',
      'ytd-grid-video-renderer'
    ];

    for (const selector of selectors) {
      const elements = document.querySelectorAll(selector);
      for (const el of elements) {
        const link = el.querySelector('a#video-title-link, a#video-title, a.ytd-thumbnail[href*="watch"], a[href*="/shorts/"]');
        if (!link) continue;

        const videoId = extractVideoId(link.getAttribute('href'));
        if (!videoId || seen.has(videoId)) continue;
        seen.add(videoId);

        const titleEl = el.querySelector('#video-title');
        const channelEl = el.querySelector('#channel-name a, ytd-channel-name a, .ytd-channel-name a');
        const thumbnailContainer = el.querySelector('ytd-thumbnail, #thumbnail');

        const title = getVideoTitle(el, link, titleEl);
        const channel = getChannelName(el, channelEl);

        videos.push({
          id: videoId,
          title,
          channel,
          element: el,
          thumbnailContainer
        });
      }
    }

    return videos;
  }

  function getVideoTitle(container, link, titleEl) {
    const candidates = [
      titleEl?.textContent,
      link?.getAttribute('title'),
      link?.getAttribute('aria-label'),
      container?.querySelector('h3')?.textContent,
      container?.querySelector('[title]')?.getAttribute('title')
    ];

    for (const candidate of candidates) {
      const cleaned = cleanVideoText(candidate);
      if (cleaned) return cleaned;
    }

    return '';
  }

  function getChannelName(container, channelEl) {
    const candidates = [
      channelEl?.textContent,
      container?.querySelector('#channel-info #text')?.textContent,
      container?.querySelector('ytd-channel-name #text')?.textContent
    ];

    for (const candidate of candidates) {
      const cleaned = cleanVideoText(candidate);
      if (cleaned) return cleaned;
    }

    return '';
  }

  function cleanVideoText(text) {
    if (!text) return '';
    return text
      .replace(/\s+/g, ' ')
      .replace(/\s+·\s+\d+\s+(views?|Aufrufe).*/i, '')
      .trim();
  }

  // ── Badge Injection ───────────────────────────

  function injectBadge(video, result) {
    if (!video.thumbnailContainer) return;

    // Remove existing badge if any
    removeBadge(video.id);

    const badge = document.createElement('div');
    badge.className = 'yta-badge';
    badge.dataset.videoId = video.id;

    const score = result.overall_score;
    const color = getScoreColor(score);
    const label = getScoreLabel(score);

    badge.innerHTML = `
      <div class="yta-badge-inner" style="background: ${color}">
        <span class="yta-badge-score">${Math.round(score)}</span>
        <span class="yta-badge-label">${label}</span>
      </div>
    `;

    badge.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      // Open side panel with this video's details
      chrome.runtime.sendMessage({
        type: 'SHOW_VIDEO_DETAIL',
        videoId: video.id,
        result
      });
      chrome.runtime.sendMessage({ type: 'OPEN_SIDEPANEL' });
    });

    // Position badge on the thumbnail
    const container = video.thumbnailContainer;
    container.style.position = 'relative';
    badge.style.position = 'absolute';
    badge.style.bottom = '8px';
    badge.style.left = '8px';
    badge.style.zIndex = '1000';

    container.appendChild(badge);
    badgeMap.set(video.id, badge);
  }

  function injectLoadingBadge(video) {
    if (!video.thumbnailContainer) return;
    removeBadge(video.id);

    const badge = document.createElement('div');
    badge.className = 'yta-badge yta-badge-loading';
    badge.dataset.videoId = video.id;
    badge.innerHTML = `
      <div class="yta-badge-inner yta-loading">
        <span class="yta-badge-spinner"></span>
      </div>
    `;

    const container = video.thumbnailContainer;
    container.style.position = 'relative';
    badge.style.position = 'absolute';
    badge.style.bottom = '8px';
    badge.style.left = '8px';
    badge.style.zIndex = '1000';

    container.appendChild(badge);
    badgeMap.set(video.id, badge);
  }

  function removeBadge(videoId) {
    const existing = badgeMap.get(videoId);
    if (existing) {
      existing.remove();
      badgeMap.delete(videoId);
    }
  }

  function getScoreColor(score) {
    if (score >= 70) return 'rgba(34, 120, 60, 0.92)';
    if (score >= 40) return 'rgba(180, 130, 20, 0.92)';
    return 'rgba(170, 40, 40, 0.92)';
  }

  function getScoreLabel(score) {
    if (score >= 70) return 'Substanz';
    if (score >= 40) return 'Gemischt';
    return 'Clickbait';
  }

  // ── Floating Analyze Button ───────────────────

  function createFloatingButton() {
    if (floatingButton) return;

    floatingButton = document.createElement('div');
    floatingButton.className = 'yta-floating-button';
    floatingButton.innerHTML = `
      <button class="yta-fab" id="yta-analyze-btn" title="Videos analysieren">
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z"/>
          <circle cx="12" cy="12" r="3"/>
        </svg>
        <span class="yta-fab-text">Analysieren</span>
      </button>
      <div class="yta-fab-status" id="yta-status" style="display: none;"></div>
    `;

    document.body.appendChild(floatingButton);

    document.getElementById('yta-analyze-btn').addEventListener('click', startAnalysis);
  }

  function updateStatus(text, show = true) {
    const statusEl = document.getElementById('yta-status');
    if (statusEl) {
      statusEl.textContent = text;
      statusEl.style.display = show ? 'block' : 'none';
    }
  }

  function setButtonLoading(loading) {
    const btn = document.getElementById('yta-analyze-btn');
    if (btn) {
      btn.classList.toggle('yta-fab-loading', loading);
      btn.disabled = loading;
    }
    isAnalyzing = loading;
  }

  // ── Analysis Trigger ──────────────────────────

  async function startAnalysis() {
    if (isAnalyzing) return;

    const videos = findVideos();
    if (videos.length === 0) {
      updateStatus('Keine Videos gefunden', true);
      setTimeout(() => updateStatus('', false), 3000);
      return;
    }

    setButtonLoading(true);
    updateStatus(`${videos.length} Videos gefunden, analysiere...`);

    // Show loading badges on all videos
    for (const video of videos) {
      injectLoadingBadge(video);
    }

    // Send to background for analysis
    const videoData = videos.map(v => ({
      id: v.id,
      title: v.title,
      channel: v.channel
    }));

    try {
      const response = await chrome.runtime.sendMessage({
        type: 'ANALYZE_VIDEOS',
        videos: videoData
      });

      if (response?.error === 'NO_API_KEY') {
        updateStatus('⚙ API-Key fehlt — Einstellungen öffnen');
        setButtonLoading(false);
        // Remove loading badges
        for (const video of videos) {
          removeBadge(video.id);
        }
        // Open options page
        chrome.runtime.openOptionsPage?.();
        return;
      }
    } catch (err) {
      console.error('[YT Analyzer] Analysis error:', err);
      updateStatus('Fehler: ' + err.message);
    }

    // Note: results come in via PARTIAL_RESULTS messages
  }

  // ── Message handling from background ──────────

  chrome.runtime.onMessage.addListener((msg) => {
    if (msg.type === 'PARTIAL_RESULTS') {
      const videos = findVideos();
      const videoMap = new Map(videos.map(v => [v.id, v]));

      for (const [videoId, result] of Object.entries(msg.results)) {
        const video = videoMap.get(videoId);
        if (video && !result.error) {
          injectBadge(video, result);
        } else if (video && result.error) {
          removeBadge(videoId);
        }
      }
    }

    if (msg.type === 'ANALYSIS_PROGRESS') {
      updateStatus(`Analysiere ${msg.current}/${msg.total}: ${msg.videoId}`);
    }

    if (msg.type === 'ANALYSIS_COMPLETE') {
      setButtonLoading(false);
      const total = Object.keys(msg.results).length;
      const errors = Object.values(msg.results).filter(r => r.error).length;
      if (errors > 0) {
        updateStatus(`Fertig: ${total - errors}/${total} analysiert`);
      } else {
        updateStatus(`${total} Videos analysiert`);
      }
      setTimeout(() => updateStatus('', false), 5000);
    }
  });

  // ── Initialize ────────────────────────────────

  function init() {
    // Only inject on YouTube pages with video content
    if (!window.location.hostname.includes('youtube.com')) return;

    createFloatingButton();

    // Re-check for videos when YouTube's SPA navigates
    const observer = new MutationObserver(() => {
      // If we previously analyzed and new videos appear, we could re-inject badges from cache
      // For now, just ensure floating button exists
      if (!document.querySelector('.yta-floating-button')) {
        createFloatingButton();
      }
    });

    observer.observe(document.body, {
      childList: true,
      subtree: true
    });
  }

  // Wait for page to be ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
