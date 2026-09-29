Yes. Let's make this **copy-pasteable against the code in your screenshots**, without inventing a `getRowKey()` function.

Your screenshot shows that the AMPS key is:

```tsx
const key: string | undefined = message.sowKey?.() || record.listId;
```

So we'll use `record.listId` for the loaded rows.

## 1. Replace your current `scheduleFlush` block

Replace this entire section:

```tsx
const FLUSH_THROTTLE_MS = 500;
const pendingPatchesRef = useRef<Map<string, BasketOrder | null>>(new Map());
const flushTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

const scheduleFlush = useCallback(() => {
   ...
}, []);
```

with:

```tsx
const FLUSH_THROTTLE_MS = 500;

const pendingPatchesRef = useRef<Map<string, BasketOrder | null>>(
  new Map(),
);

const flushTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

const scheduleFlush = useCallback(() => {
  // Do not schedule another timer if one is already waiting.
  // AMPS messages can arrive continuously, so they should all
  // be collected into the same batch.
  if (flushTimerRef.current !== null) {
    return;
  }

  flushTimerRef.current = setTimeout(() => {
    flushTimerRef.current = null;

    const pending = pendingPatchesRef.current;

    if (pending.size === 0) {
      return;
    }

    // Detach the current batch immediately.
    // New AMPS messages can now be collected independently.
    pendingPatchesRef.current = new Map();

    setWindowRows((rows) => {
      let next = rows;

      pending.forEach((record, key) => {
        if (record === null) {
          const updated = dropRowByKey(next, key);

          // If the row isn't currently loaded, preserve the
          // existing array reference.
          if (updated !== next) {
            next = updated;
          }

          return;
        }

        const updated = applyRowUpdate(next, key, record);

        // applyRowUpdate returns the same array when the visible
        // row has not actually changed.
        if (updated !== next) {
          next = updated;
        }
      });

      // If none of the pending AMPS updates affected the currently
      // loaded rows, this returns the exact same array reference.
      // React can therefore bail out of the state update.
      return next;
    });
  }, FLUSH_THROTTLE_MS);
}, []);
```

---

# 2. Replace `applyRowUpdate`

Use this:

```tsx
function applyRowUpdate(
  rows: BasketOrder[],
  key: string,
  record: BasketOrder,
): BasketOrder[] {
  const index = rows.findIndex(
    (row) => row.listId === key,
  );

  // This row is not currently present in the loaded window.
  // Nothing visible needs to change.
  if (index === -1) {
    return rows;
  }

  const current = rows[index];

  // Same object reference.
  if (current === record) {
    return rows;
  }

  // AMPS may create a new object containing the exact same data.
  // Don't create a new rows array in that case.
  if (areSameBasketOrder(current, record)) {
    return rows;
  }

  // The row really changed.
  const next = [...rows];

  next[index] = record;

  return next;
}
```

---

# 3. Replace `dropRowByKey`

Use:

```tsx
function dropRowByKey(
  rows: BasketOrder[],
  key: string,
): BasketOrder[] {
  const index = rows.findIndex(
    (row) => row.listId === key,
  );

  // Nothing to remove from the currently loaded window.
  if (index === -1) {
    return rows;
  }

  const next = [...rows];

  next.splice(index, 1);

  return next;
}
```

---

# 4. Add this equality helper

Put this outside `TradingTableViewport`, preferably near the other helper functions.

```tsx
function areSameBasketOrder(
  current: BasketOrder,
  next: BasketOrder,
): boolean {
  const currentKeys = Object.keys(current) as Array<keyof BasketOrder>;
  const nextKeys = Object.keys(next) as Array<keyof BasketOrder>;

  if (currentKeys.length !== nextKeys.length) {
    return false;
  }

  for (const key of currentKeys) {
    if (!Object.is(current[key], next[key])) {
      return false;
    }
  }

  return true;
}
```

This is a **shallow comparison**. That's intentional. Don't immediately reach for `JSON.stringify`, lodash deep equality, or some other computationally expensive hammer. We're fixing a high-frequency rendering path here.

---

# 5. Change the AMPS message handling

From your screenshot, you have something like:

```tsx
pendingPatchesRef.current.set(key, record);
scheduleFlush();
```

Replace that with:

```tsx
const pending = pendingPatchesRef.current;

const previous = pending.get(key);

if (
  previous !== undefined &&
  previous !== null &&
  record !== null &&
  areSameBasketOrder(previous, record)
) {
  return;
}

pending.set(key, record);

scheduleFlush();
```

If your existing code has:

```tsx
if (command === "oof") {
  pendingPatchesRef.current.set(key, null);
  scheduleFlush();
  return;
}

pendingPatchesRef.current.set(key, record);
scheduleFlush();
```

then use this instead:

```tsx
if (command === "oof") {
  pendingPatchesRef.current.set(key, null);
  scheduleFlush();
  return;
}

const pending = pendingPatchesRef.current;
const previous = pending.get(key);

if (
  previous !== undefined &&
  previous !== null &&
  record !== null &&
  areSameBasketOrder(previous, record)
) {
  return;
}

pending.set(key, record);

scheduleFlush();
```

---

## What this fixes

Your current code effectively does this:

```text
AMPS update
      ↓
scheduleFlush
      ↓
500ms
      ↓
setWindowRows
      ↓
new array
      ↓
RENDER
```

even when:

```text
AMPS says:

row 123 = exactly the same data
```

The new code does:

```text
AMPS update
      ↓
pending Map
      ↓
scheduleFlush
      ↓
500ms
      ↓
apply update
      ↓
is visible data actually different?
       ↙              ↘
     NO                YES
      ↓                 ↓
same array          new array
      ↓                 ↓
React bailout       React render
```

### One important assumption

I'm using:

```tsx
row.listId === key
```

because your screenshot explicitly shows:

```tsx
message.sowKey?.() || record.listId
```

If `sowKey()` can return something **different from `record.listId`**, then this lookup needs to use the actual row identifier instead. That's the one part I would verify before blindly pasting it into production, because a beautifully optimized lookup against the wrong key is still just a beautifully optimized bug.

Also, **do not remove `scheduleFlush()`**. The fix is to make its state update conditional, not to remove the batching mechanism.
