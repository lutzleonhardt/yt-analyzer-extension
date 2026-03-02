/* =============================================
   YT Analyzer — Background Service Worker
   Handles: transcript fetching, LLM calls,
   storage, side panel coordination
   ============================================= */

// ── Scoring Prompt ──────────────────────────────────

const SYSTEM_PROMPT = `Du bist ein kritischer Medienanalyst, spezialisiert auf die Erkennung von Clickbait, Hype und manipulativer Rhetorik in YouTube-Videos.

Analysiere das folgende YouTube-Video und bewerte es nach diesen Dimensionen:

1. **Hype-Score (0-100)**: Emotionalisierung, Superlative ("das BESTE", "UNGLAUBLICH"), künstliche Dringlichkeit ("du MUSST das JETZT sehen"), FOMO-Rhetorik, übertriebene Versprechen. 0 = sachlich und nüchtern, 100 = maximaler Hype.

2. **Substanz-Score (0-100)**: Konkrete Zahlen und Daten, nachprüfbare Beispiele, Nennung von Trade-offs und Nachteilen, Gegenargumente, differenzierte Betrachtung, Quellenangaben. 0 = reine Meinung ohne Substanz, 100 = tiefgehend, faktenbasiert, differenziert.

3. **Manipulations-Score (0-100)**: Autoritätsargumente ohne Beleg ("Experten sagen"), Reichtumsversprechen ("damit verdienst du X"), Verlust-Framing ("wenn du das nicht machst, verpasst du..."), künstliche Verknappung, emotionale Erpressung, Tribal-Signaling ("wir vs. die"). 0 = keine Manipulation, 100 = hochgradig manipulativ.

4. **Gesamt-Score (0-100)**: Gesamtbewertung der Inhaltsqualität. Berechne: (Substanz-Score) - (Hype-Score * 0.3) - (Manipulations-Score * 0.4). Clamp auf 0-100. Ein hoher Score bedeutet hohe Qualität.

Antworte NUR mit einem JSON-Objekt in diesem exakten Format, ohne zusätzlichen Text:
{
  "hype_score": <number>,
  "substance_score": <number>,
  "manipulation_score": <number>,
  "overall_score": <number>,
  "explanation": "<2-3 Sätze auf Deutsch, die die Bewertung kurz begründen>",
  "red_flags": ["<liste spezifischer problematischer Formulierungen aus dem Video>"],
  "green_flags": ["<liste positiver Qualitätsindikatoren>"]
}`;

// ── State ───────────────────────────────────────────

const analysisCache = new Map(); // videoId -> result
let analysisQueue = [];
let isProcessing = false;

// ── Extension Icon Click → Open Side Panel ──────────

chrome.action.onClicked.addListener((tab) => {
  chrome.sidePanel.open({ tabId: tab.id });
});

// ── Message Router ──────────────────────────────────

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === 'ANALYZE_VIDEOS') {
    handleAnalyzeVideos(msg.videos, sender.tab?.id).then(sendResponse);
    return true; // async response
  }
  if (msg.type === 'ANALYZE_SINGLE') {
    handleAnalyzeSingle(msg.video, sender.tab?.id).then(sendResponse);
    return true;
  }
  if (msg.type === 'GET_CACHE') {
    sendResponse({ cache: Object.fromEntries(analysisCache) });
    return false;
  }
  if (msg.type === 'CLEAR_CACHE') {
    analysisCache.clear();
    sendResponse({ ok: true });
    return false;
  }
  if (msg.type === 'GET_SETTINGS') {
    getSettings().then(sendResponse);
    return true;
  }
});

// ── Settings ────────────────────────────────────────

async function getSettings() {
  return new Promise((resolve) => {
    chrome.storage.local.get(
      ['provider', 'openaiKey', 'anthropicKey', 'openaiModel', 'anthropicModel'],
      (data) => {
        resolve({
          provider: data.provider || 'openai',
          openaiKey: data.openaiKey || '',
          anthropicKey: data.anthropicKey || '',
          openaiModel: data.openaiModel || 'gpt-4o-mini',
          anthropicModel: data.anthropicModel || 'claude-sonnet-4-20250514'
        });
      }
    );
  });
}

// ── Analyze multiple videos ─────────────────────────

async function handleAnalyzeVideos(videos, tabId) {
  const settings = await getSettings();

  const key = settings.provider === 'openai' ? settings.openaiKey : settings.anthropicKey;
  if (!key) {
    return { error: 'NO_API_KEY', message: 'Bitte API-Key in den Einstellungen konfigurieren.' };
  }

  const results = {};
  const toAnalyze = [];

  for (const video of videos) {
    if (analysisCache.has(video.id)) {
      results[video.id] = analysisCache.get(video.id);
    } else {
      toAnalyze.push(video);
    }
  }

  // Send cached results immediately
  if (Object.keys(results).length > 0 && tabId) {
    chrome.tabs.sendMessage(tabId, { type: 'PARTIAL_RESULTS', results });
    notifySidePanel({ type: 'PARTIAL_RESULTS', results });
  }

  // Process uncached videos sequentially (to respect rate limits)
  for (let i = 0; i < toAnalyze.length; i++) {
    const video = toAnalyze[i];

    // Notify progress
    if (tabId) {
      chrome.tabs.sendMessage(tabId, {
        type: 'ANALYSIS_PROGRESS',
        videoId: video.id,
        status: 'loading',
        current: i + 1,
        total: toAnalyze.length
      });
    }
    notifySidePanel({
      type: 'ANALYSIS_PROGRESS',
      videoId: video.id,
      status: 'loading',
      current: i + 1,
      total: toAnalyze.length
    });

    try {
      const result = await analyzeSingleVideo(video, settings);
      results[video.id] = result;
      analysisCache.set(video.id, result);

      // Send each result as it completes
      if (tabId) {
        chrome.tabs.sendMessage(tabId, { type: 'PARTIAL_RESULTS', results: { [video.id]: result } });
      }
      notifySidePanel({ type: 'PARTIAL_RESULTS', results: { [video.id]: result } });
    } catch (err) {
      const errorResult = { error: true, message: err.message, video };
      results[video.id] = errorResult;
      if (tabId) {
        chrome.tabs.sendMessage(tabId, { type: 'PARTIAL_RESULTS', results: { [video.id]: errorResult } });
      }
      notifySidePanel({ type: 'PARTIAL_RESULTS', results: { [video.id]: errorResult } });
    }
  }

  notifySidePanel({ type: 'ANALYSIS_COMPLETE', results });
  return { results };
}

async function handleAnalyzeSingle(video, tabId) {
  const settings = await getSettings();

  const key = settings.provider === 'openai' ? settings.openaiKey : settings.anthropicKey;
  if (!key) {
    return { error: 'NO_API_KEY', message: 'Bitte API-Key in den Einstellungen konfigurieren.' };
  }

  if (analysisCache.has(video.id)) {
    return { result: analysisCache.get(video.id) };
  }

  try {
    const result = await analyzeSingleVideo(video, settings);
    analysisCache.set(video.id, result);
    return { result };
  } catch (err) {
    return { error: true, message: err.message };
  }
}

// ── Core analysis pipeline ──────────────────────────

async function analyzeSingleVideo(video, settings) {
  // Step 1: Fetch transcript
  let transcript = null;
  let transcriptStatus = 'unavailable';

  try {
    transcript = await fetchTranscript(video.id);
    if (transcript && transcript.trim().length > 0) {
      transcriptStatus = 'available';
    }
  } catch (e) {
    console.log(`[YT Analyzer] Transcript unavailable for ${video.id}:`, e.message);
    transcriptStatus = 'error';
  }

  // Step 2: Build prompt
  const userMessage = buildUserMessage(video, transcript);

  // Step 3: Call LLM
  const llmResponse = await callLLM(userMessage, settings);

  // Step 4: Parse response
  let scores;
  try {
    // Try to extract JSON from the response
    const jsonMatch = llmResponse.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      scores = JSON.parse(jsonMatch[0]);
    } else {
      throw new Error('No JSON found in LLM response');
    }
  } catch (e) {
    throw new Error(`LLM-Antwort konnte nicht geparst werden: ${e.message}`);
  }

  return {
    ...scores,
    video,
    transcriptStatus,
    timestamp: Date.now(),
    provider: settings.provider,
    model: settings.provider === 'openai' ? settings.openaiModel : settings.anthropicModel
  };
}

// ── Transcript Fetching ─────────────────────────────

async function fetchTranscript(videoId) {
  // Fetch the YouTube watch page to extract caption track info
  const watchUrl = `https://www.youtube.com/watch?v=${videoId}`;
  const response = await fetch(watchUrl);

  if (!response.ok) {
    throw new Error(`Failed to fetch YouTube page: ${response.status}`);
  }

  const html = await response.text();

  // Extract ytInitialPlayerResponse
  const playerResponseMatch = html.match(
    /var\s+ytInitialPlayerResponse\s*=\s*(\{.+?\});/s
  ) || html.match(
    /ytInitialPlayerResponse\s*=\s*(\{.+?\});/s
  );

  if (!playerResponseMatch) {
    throw new Error('Could not find ytInitialPlayerResponse');
  }

  let playerResponse;
  try {
    playerResponse = JSON.parse(playerResponseMatch[1]);
  } catch (e) {
    throw new Error('Could not parse ytInitialPlayerResponse');
  }

  // Navigate to caption tracks
  const captionTracks = playerResponse?.captions
    ?.playerCaptionsTracklistRenderer
    ?.captionTracks;

  if (!captionTracks || captionTracks.length === 0) {
    throw new Error('No caption tracks available');
  }

  // Prefer manual captions, then auto-generated
  // Prefer English, then German, then first available
  let selectedTrack = captionTracks.find(t => t.languageCode === 'en' && t.kind !== 'asr')
    || captionTracks.find(t => t.languageCode === 'de' && t.kind !== 'asr')
    || captionTracks.find(t => t.kind !== 'asr')
    || captionTracks.find(t => t.languageCode === 'en')
    || captionTracks.find(t => t.languageCode === 'de')
    || captionTracks[0];

  if (!selectedTrack?.baseUrl) {
    throw new Error('No usable caption track found');
  }

  // Fetch the caption XML
  const captionResponse = await fetch(selectedTrack.baseUrl);
  if (!captionResponse.ok) {
    throw new Error(`Failed to fetch captions: ${captionResponse.status}`);
  }

  const captionXml = await captionResponse.text();

  // Parse XML — extract text from <text> elements
  const textParts = [];
  const regex = /<text[^>]*>([\s\S]*?)<\/text>/g;
  let match;
  while ((match = regex.exec(captionXml)) !== null) {
    let text = match[1];
    // Decode HTML entities
    text = text.replace(/&amp;/g, '&')
               .replace(/&lt;/g, '<')
               .replace(/&gt;/g, '>')
               .replace(/&quot;/g, '"')
               .replace(/&#39;/g, "'")
               .replace(/\n/g, ' ')
               .trim();
    if (text) textParts.push(text);
  }

  return textParts.join(' ');
}

// ── User Message Builder ────────────────────────────

function buildUserMessage(video, transcript) {
  let msg = `Video-Titel: ${video.title || 'Unbekannt'}\nKanal: ${video.channel || 'Unbekannt'}\n`;

  if (transcript && transcript.trim().length > 0) {
    // Truncate to ~4000 chars to stay within reasonable token limits
    const truncated = transcript.length > 4000
      ? transcript.substring(0, 4000) + '\n\n[... Transkript gekürzt ...]'
      : transcript;
    msg += `\nTranskript:\n${truncated}`;
  } else {
    msg += `\nKein Transkript verfügbar. Analysiere nur basierend auf dem Titel und Kanalnamen. Gib in der explanation an, dass die Analyse nur auf Metadaten basiert.`;
  }

  return msg;
}

// ── LLM Calls ───────────────────────────────────────

async function callLLM(userMessage, settings) {
  if (settings.provider === 'openai') {
    return callOpenAI(userMessage, settings);
  }
  return callAnthropic(userMessage, settings);
}

async function callOpenAI(userMessage, settings) {
  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${settings.openaiKey}`
    },
    body: JSON.stringify({
      model: settings.openaiModel,
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: userMessage }
      ],
      temperature: 0.3,
      response_format: { type: 'json_object' }
    })
  });

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`OpenAI API Fehler (${response.status}): ${err}`);
  }

  const data = await response.json();
  return data.choices?.[0]?.message?.content || '';
}

async function callAnthropic(userMessage, settings) {
  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': settings.anthropicKey,
      'anthropic-version': '2023-06-01'
    },
    body: JSON.stringify({
      model: settings.anthropicModel,
      max_tokens: 1024,
      system: SYSTEM_PROMPT,
      messages: [
        { role: 'user', content: userMessage }
      ]
    })
  });

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`Anthropic API Fehler (${response.status}): ${err}`);
  }

  const data = await response.json();
  return data.content?.[0]?.text || '';
}


// ── Side Panel Communication ────────────────────────

function notifySidePanel(message) {
  chrome.runtime.sendMessage(message).catch(() => {
    // Side panel might not be open — that's fine
  });
}
