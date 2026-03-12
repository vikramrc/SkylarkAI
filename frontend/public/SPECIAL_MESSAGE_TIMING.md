# Special Message Timing Implementation

## Overview
Implemented frontend-only timing control for special status messages to improve user experience. Certain messages now have minimum display durations to prevent them from flashing away too quickly.

---

## Requirements

### Issue 1: "Re-analyzing" disappears too quickly
- **Problem:** When retry happens, "Re-analyzing" message flashes and disappears immediately
- **Solution:** Enforce 1-second minimum display duration in the frontend
- **User sees:** "Re-analyzing" → (displays for 1 second) → "Assembling query" ⚙️

### Issue 2: "Finalizing results" appears in wrong place
- **Problem:** "Finalizing results" appeared in time-based fallback between other stages
- **Solution:** Inject it synthetically after "Executing query" with 1-second display
- **User sees:** "Executing query" → (1 second) → "Finalizing results" → Results

### Issue 3: Ambiguity messages disappear too quickly
- **Problem:** Ambiguity detection messages (no_ambiguity, identifying_interpretations, etc.) flash by too fast
- **Solution:** Add all ambiguity-related messages to special durations with 1-second minimum
- **User sees:** Each ambiguity message displays for full 1 second before next message

---

## Implementation

### Backend Changes: NONE ✅

**No backend changes were made!**
- Backend continues to send messages immediately without delays
- "finalizing_results" was never sent from backend (only in fallback)
- All timing is handled purely in the frontend

---

### Frontend Changes

**File:** `PhoenixAI/FE_TSX/src/components/StreamingProgress.tsx`

#### **1. Added Special Message Configuration (Lines 25-35)**

```typescript
// Special messages with minimum display duration (milliseconds)
const SPECIAL_MESSAGE_DURATIONS: Record<string, number> = {
  'status.re_analyzing': 1000,              // 1 second
  'status.finalizing_results': 1000,        // 1 second
  'status.no_ambiguity': 1000,              // 1 second
  'status.intent_identified': 1000,         // 1 second
  'status.identifying_interpretations': 1000, // 1 second
  'status.preparing_questions': 1000,       // 1 second
  'status.preparing_suggestions': 1000,     // 1 second
  'status.detected_ambiguity': 1000,        // 1 second
};
```

**Why these messages:**
- **Ambiguity detection messages** arrive very quickly as LLM streams JSON
- Without minimum display, they flash by too fast to read
- Most important: `no_ambiguity` - users need to see this confirmation

#### **2. Added State Management (Lines 45-48)**

```typescript
const [displayedMessageKey, setDisplayedMessageKey] = useState<string | undefined>(statusMessageKey);
const [displayedMessage, setDisplayedMessage] = useState<string | undefined>(statusMessage);
const messageTimerRef = useRef<NodeJS.Timeout | null>(null);
const lastExecuteTimeRef = useRef<number>(0);
```

**Purpose:**
- `displayedMessageKey/displayedMessage`: What's currently shown (may differ from incoming message)
- `messageTimerRef`: Timer to enforce minimum display duration
- `lastExecuteTimeRef`: Track when "executing_query" appeared to inject "finalizing_results"

#### **3. Added Message Timing Logic (Lines 60-123)**

**Key Features:**

**A. Special Message Handling:**
```typescript
if (minDuration) {
  // Special message - enforce minimum display duration
  setDisplayedMessageKey(statusMessageKey);
  setDisplayedMessage(statusMessage);

  // Set timer to allow next message after minimum duration
  messageTimerRef.current = setTimeout(() => {
    messageTimerRef.current = null;
  }, minDuration);
}
```

**B. Message Queuing:**
```typescript
if (messageTimerRef.current) {
  // Special message is still displaying, queue this message
  // (Timer will clear itself, then this effect will re-run)
  return;
}
```

**C. Synthetic "Finalizing Results" Injection:**
```typescript
if (
  lastExecuteTimeRef.current > 0 &&
  statusMessageKey !== 'status.executing_query' &&
  statusMessageKey !== 'status.finalizing_results' &&
  !isLoading // Results are about to be shown
) {
  // Inject "finalizing_results" for 1 second before showing results
  setDisplayedMessageKey('status.finalizing_results');
  setDisplayedMessage(undefined);

  messageTimerRef.current = setTimeout(() => {
    messageTimerRef.current = null;
    setDisplayedMessageKey(statusMessageKey);
    setDisplayedMessage(statusMessage);
    lastExecuteTimeRef.current = 0; // Reset
  }, SPECIAL_MESSAGE_DURATIONS['status.finalizing_results']);
}
```

#### **4. Updated Display Logic (Lines 132-145)**

```typescript
const getDisplayMessage = () => {
  // Use displayed message (which may be delayed for special messages)
  if (displayedMessageKey) return t(displayedMessageKey);
  if (displayedMessage) return displayedMessage;

  // Time-based fallback messages
  if (!isLoading) return '';

  if (elapsedSeconds < 2) {
    return t('status.accepting_request');
  } else {
    return t('status.analyzing_response');
  }
};
```

**Changes:**
- Now uses `displayedMessageKey` instead of `statusMessageKey`
- Removed "processing_query" from fallback (was never used)
- **Removed "finalizing_results" from fallback** - it should ONLY appear as synthetic injection after "executing_query"
- Simplified fallback to just two states: "accepting_request" → "analyzing_response"

#### **5. Updated Spinner Logic (Line 202)**

```typescript
{subtleStatus === 'generation' && displayedMessageKey === 'status.assembling_query' && (
  <span className="text-sm inline-flex items-center"
        style={{ color: '#8b5cf6', lineHeight: 'inherit' }}
        aria-hidden="true">
    {SPINNER_FRAMES[spinnerFrame]}
  </span>
)}
```

**Change:** Uses `displayedMessageKey` instead of `statusMessageKey`

---

## User Experience Flow

### Scenario 1: Normal Query (No Retry)

```
User submits query
  ↓
"Resolving ambiguity"
  ↓
"Assembling query" ⚙️
  ↓
"Executing query"
  ↓
(1 second delay - automatic)
  ↓
"Finalizing results" (injected synthetically)
  ↓
(1 second display)
  ↓
Results displayed
```

### Scenario 2: Query with Retry (Exception)

```
User submits query
  ↓
"Assembling query" ⚙️
  ↓
MongoDB exception
  ↓
"Re-analyzing" (displays for 1 second minimum)
  ↓
(Even if "Assembling query" arrives immediately, waits 1 second)
  ↓
"Assembling query" ⚙️
  ↓
"Executing query"
  ↓
"Finalizing results" (1 second)
  ↓
Results displayed
```

### Scenario 3: Query with Retry (Empty Results)

```
User submits query
  ↓
"Assembling query" ⚙️
  ↓
"Executing query"
  ↓
MongoDB returns []
  ↓
"Re-analyzing" (displays for 1 second minimum)
  ↓
"Assembling query" ⚙️
  ↓
"Executing query"
  ↓
"Finalizing results" (1 second)
  ↓
Results displayed (or empty state)
```

---

## Technical Details

### How Special Message Timing Works

1. **Message arrives from backend** (via `statusMessageKey` prop)

2. **Check if it's a special message:**
   - If yes → Display it and start timer
   - If no → Check if timer is active

3. **If timer is active:**
   - Queue the new message (don't display yet)
   - Wait for timer to expire
   - Then display queued message

4. **If timer is not active:**
   - Check if we should inject "finalizing_results"
   - Otherwise display message immediately

### Synthetic Message Injection

**Trigger:** When `isLoading` changes from `true` to `false` after "executing_query"

**Logic:**
1. Track when "executing_query" appears (`lastExecuteTimeRef`)
2. When loading completes, inject "finalizing_results"
3. Display for 1 second
4. Then show actual results

**Why it works:**
- Backend sends "executing_query" → Frontend displays it
- Query completes → `isLoading` becomes `false`
- Frontend detects this and injects "finalizing_results"
- After 1 second, results are shown

---

## Benefits

✅ **No backend changes:** All timing handled in frontend  
✅ **Better UX:** Messages don't flash away too quickly  
✅ **Smooth transitions:** 1-second minimum display for special messages  
✅ **Synthetic injection:** "Finalizing results" appears at the right time  
✅ **Message queuing:** Subsequent messages wait for special messages to complete  
✅ **Clean separation:** Backend sends messages, frontend controls timing  

---

## Configuration

### Adjusting Display Durations

Edit `SPECIAL_MESSAGE_DURATIONS` in `StreamingProgress.tsx`:

```typescript
const SPECIAL_MESSAGE_DURATIONS: Record<string, number> = {
  'status.re_analyzing': 2000,              // Change to 2 seconds
  'status.finalizing_results': 500,         // Change to 0.5 seconds
  'status.no_ambiguity': 1500,              // Change to 1.5 seconds
  // ... etc
};
```

### Adding New Special Messages

```typescript
const SPECIAL_MESSAGE_DURATIONS: Record<string, number> = {
  'status.re_analyzing': 1000,
  'status.finalizing_results': 1000,
  'status.no_ambiguity': 1000,
  // ... existing messages
  'status.your_new_message': 1500  // Add new message with duration
};
```

---

## Testing

### Test 1: Re-analyzing Display Duration
1. Trigger a retry (exception or empty results)
2. Observe "Re-analyzing" message
3. Verify it displays for at least 1 second
4. Verify next message appears after 1 second

### Test 2: Finalizing Results Injection
1. Submit a normal query
2. Observe "Executing query" message
3. When results are ready, verify "Finalizing results" appears
4. Verify it displays for 1 second
5. Verify results appear after 1 second

### Test 3: Message Queuing
1. Trigger a retry
2. Verify "Re-analyzing" displays for 1 second
3. Verify subsequent messages don't interrupt it
4. Verify queued message appears after timer expires

---

## Files Modified

1. ✅ `PhoenixAI/FE_TSX/src/components/StreamingProgress.tsx` - All changes
2. ❌ No backend changes
3. ❌ No translation changes (keys already exist)

---

## Summary

**What changed:**
- Added special message timing logic in `StreamingProgress.tsx`
- "Re-analyzing" now displays for 1 second minimum
- "Finalizing results" is injected synthetically after "Executing query"
- Both special messages display for 1 second each

**What didn't change:**
- Backend sends messages immediately (no delays)
- Translation files (keys already existed)
- Message content or wording

**Result:**
- Better user experience with smooth message transitions
- No backend performance impact
- Clean frontend-only implementation

