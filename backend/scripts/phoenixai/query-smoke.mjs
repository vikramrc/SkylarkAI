import 'dotenv/config';

const defaultQueries = [
  'show me all expired certificates',
  'show me all maintenance tasks due next month',
];

const queryFromArgs = process.argv.slice(2).join(' ').trim();
const queries = queryFromArgs ? [queryFromArgs] : defaultQueries;
const rootUrl = (process.env.SKYLARK_BACKEND_URL || `http://127.0.0.1:${process.env.PORT || '4000'}`).replace(/\/$/, '');
const endpoint = rootUrl.endsWith('/api/phoenix-openai')
  ? `${rootUrl}/query/stream`
  : `${rootUrl}/api/phoenix-openai/query/stream`;

function parseEventData(dataText) {
  try {
    return JSON.parse(dataText);
  } catch {
    return dataText;
  }
}

async function processSseFrame(frame, onEvent) {
  if (!frame.trim()) return;

  let eventName = 'message';
  const dataLines = [];
  for (const rawLine of frame.split(/\r?\n/)) {
    const line = rawLine.trimEnd();
    if (!line || line.startsWith(':')) continue;
    if (line.startsWith('event:')) {
      eventName = line.slice('event:'.length).trim();
      continue;
    }
    if (line.startsWith('data:')) {
      dataLines.push(line.slice('data:'.length).trimStart());
    }
  }

  if (dataLines.length === 0) return;
  await onEvent(eventName, dataLines.join('\n'));
}

async function consumeSseStream(stream, onEvent) {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  while (true) {
    const { done, value } = await reader.read();
    buffer += decoder.decode(value ?? new Uint8Array(), { stream: !done });

    let boundaryMatch = buffer.match(/\r?\n\r?\n/);
    while (boundaryMatch?.index !== undefined) {
      const frame = buffer.slice(0, boundaryMatch.index);
      buffer = buffer.slice(boundaryMatch.index + boundaryMatch[0].length);
      await processSseFrame(frame, onEvent);
      boundaryMatch = buffer.match(/\r?\n\r?\n/);
    }

    if (done) break;
  }

  if (buffer.trim()) {
    await processSseFrame(buffer, onEvent);
  }
}

function formatStageLabel(payload) {
  const stage = typeof payload?.stage === 'string' ? payload.stage : 'unknown';
  const attempt = typeof payload?.attempt === 'number' ? `#${payload.attempt}` : '';
  return `${stage}${attempt}`;
}

function summarizePayload(payload) {
  const clarifyingQuestions = Array.isArray(payload?.clarifyingQuestions) ? payload.clarifyingQuestions : [];
  const results = Array.isArray(payload?.results) ? payload.results : [];

  if (payload?.status === 'ambiguous' || clarifyingQuestions.length > 0) {
    return {
      outcome: 'ambiguous',
      conversationId: payload?.conversationId ?? null,
      clarifyingQuestions,
    };
  }

  if (results.length > 0) {
    return {
      outcome: 'results',
      conversationId: payload?.conversationId ?? null,
      resultCount: results.length,
      firstResultKeys: typeof results[0] === 'object' && results[0] !== null ? Object.keys(results[0]).slice(0, 8) : [],
    };
  }

  return {
    outcome: 'neither',
    conversationId: payload?.conversationId ?? null,
    status: payload?.status ?? null,
  };
}

let hadFailure = false;
let openLlmLine = false;

function closeOpenLlmLine() {
  if (!openLlmLine) return;
  process.stdout.write('\n');
  openLlmLine = false;
}

for (const userQuery of queries) {
  const url = new URL(endpoint);
  url.searchParams.set('userQuery', userQuery);

  console.log(`\n--- Phoenix API streaming smoke query: ${userQuery}`);
  console.log(`[stream] ${url.toString()}`);

  const response = await fetch(url, {
    method: 'GET',
    headers: { Accept: 'text/event-stream' },
  });

  if (!response.ok) {
    hadFailure = true;
    const payload = await response.text();
    console.error(JSON.stringify({ endpoint: url.toString(), status: response.status, payload }, null, 2));
    continue;
  }

  if (!response.body) {
    hadFailure = true;
    console.error('[stream] response body was empty');
    continue;
  }

  let finalPayload = null;
  let endPayload = null;
  let streamError = null;
  let sawLlmEvent = false;

  await consumeSseStream(response.body, async (eventName, dataText) => {
    const payload = parseEventData(dataText);

    switch (eventName) {
      case 'status': {
        closeOpenLlmLine();
        const stage = typeof payload?.stage === 'string' ? payload.stage : 'unknown';
        const message = typeof payload?.message === 'string' ? payload.message : '';
        const attempt = typeof payload?.attempt === 'number' ? ` attempt=${payload.attempt}` : '';
        console.log(`[status][${stage}]${attempt} ${message}`.trim());
        break;
      }
      case 'llm': {
        sawLlmEvent = true;
        const label = formatStageLabel(payload);
        if (payload?.kind === 'start') {
          closeOpenLlmLine();
          console.log(`[llm][${label}] start provider=${payload?.provider ?? 'unknown'} model=${payload?.model ?? 'unknown'} purpose=${payload?.purpose ?? 'unknown'}`);
          break;
        }

        if (payload?.kind === 'delta') {
          const delta = typeof payload?.delta === 'string' ? payload.delta : '';
          if (!delta) break;
          if (!openLlmLine) {
            process.stdout.write(`[llm][${label}] `);
            openLlmLine = true;
          }
          process.stdout.write(delta);
          break;
        }

        if (payload?.kind === 'complete') {
          closeOpenLlmLine();
          const chars = typeof payload?.text === 'string' ? payload.text.length : 0;
          console.log(`[llm][${label}] complete responseId=${payload?.responseId ?? 'n/a'} chars=${chars}`);
        }
        break;
      }
      case 'result':
      case 'disambiguation': {
        closeOpenLlmLine();
        finalPayload = payload;
        console.log(`[${eventName}] final payload received`);
        break;
      }
      case 'error': {
        closeOpenLlmLine();
        streamError = payload;
        console.error(`[error] ${typeof payload?.message === 'string' ? payload.message : JSON.stringify(payload)}`);
        break;
      }
      case 'end': {
        closeOpenLlmLine();
        endPayload = payload;
        console.log(`[end] ${JSON.stringify(payload)}`);
        break;
      }
      default:
        closeOpenLlmLine();
        console.log(`[${eventName}] ${typeof payload === 'string' ? payload : JSON.stringify(payload)}`);
    }
  });

  closeOpenLlmLine();

  if (!sawLlmEvent) {
    hadFailure = true;
    console.error('[proof] No llm stream events were observed');
  }

  if (streamError || endPayload?.ok === false || !finalPayload) {
    hadFailure = true;
    console.error(JSON.stringify({ streamError, endPayload, finalPayload }, null, 2));
    continue;
  }

  const summary = summarizePayload(finalPayload);
  console.log('[summary]');
  console.log(JSON.stringify(summary, null, 2));

  if (summary.outcome === 'neither') {
    hadFailure = true;
  }
}

if (hadFailure) {
  process.exitCode = 1;
}