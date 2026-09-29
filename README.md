Yes. Let’s make this the **single final change** so you don't end up chasing five different versions of the same fix like a React bug-themed scavenger hunt.

The goal is:

1. AMPS messages are still batched.
2. `scheduleFlush` still exists because you need it to batch frequent updates.
3. `setWindowRows` only produces a new array when a **visible row actually changed**.
4. AMPS updates for rows outside the current viewport do **nothing to React state**.
5. `MessageRow` stays a `MessageRow`. We do **not** shove a `BasketOrder` into it.
6. Multiple AMPS updates for the same row are collapsed into one update.

---

# 1. Replace your `scheduleFlush` section with this

Replace your current:

```tsx
const FLUSH_THROTTLE_MS = 500;
const pendingPatchesRef = ...
const flushTimerRef = ...
const scheduleFlush = ...
```

with:

```tsx
const FLUSH_THROTTLE_MS = 500;

const pendingPatchesRef = useRef<Map<string, BasketOrder | null>>(
  new Map(),
);

const flushTimerRef = useRef<ReturnType<typeof setTimeout> | null>(
  null,
);

const scheduleFlush = useCallback(() => {
  // Only allow one flush timer to exist at a time.
  if (flushTimerRef.current !== null) {
    return;
  }

  flushTimerRef.current = setTimeout(() => {
    flushTimerRef.current = null;

    const pending = pendingPatchesRef.current;

    if (pending.size === 0) {
      return;
    }

    // Detach this batch immediately.
    // New AMPS messages can now be collected independently.
    pendingPatchesRef.current = new Map();

    setWindowRows((rows) => {
      let next = rows;

      pending.forEach((record, key) => {
        if (record === null) {
          next = dropRowByKey(next, key);
          return;
        }

        next = applyRowUpdate(next, key, record);
      });

      /*
       * IMPORTANT:
       *
       * If none of the AMPS messages affected a currently
       * loaded row, next === rows.
       *
       * React can therefore bail out without another render.
       */
      return next;
    });
  }, FLUSH_THROTTLE_MS);
}, []);
```

---

# 2. Add/replace `applyRowUpdate`

Put this outside the component if your other helper functions are outside the component. Otherwise put it wherever your existing `applyRowUpdate` is.

```tsx
function applyRowUpdate(
  rows: MessageRow[],
  key: string,
  record: BasketOrder,
): MessageRow[] {
  const index = rows.findIndex((row) => row.key === key);

  /*
   * This AMPS update is for a row that isn't currently loaded
   * in the viewport.
   *
   * Do NOT create a new array.
   */
  if (index === -1) {
    return rows;
  }

  const current = rows[index];

  /*
   * If the visible row already contains the same values,
   * don't create a new row object or array.
   */
  if (areSameBasketOrder(current, record)) {
    return rows;
  }

  const next = [...rows];

  /*
   * Preserve MessageRow.key.
   *
   * Do NOT do:
   *
   *     next[index] = record;
   *
   * because BasketOrder !== MessageRow.
   */
  next[index] = {
    ...current,
    ...record,
    key: current.key,
  };

  return next;
}
```

---

# 3. Add/replace `dropRowByKey`

```tsx
function dropRowByKey(
  rows: MessageRow[],
  key: string,
): MessageRow[] {
  const index = rows.findIndex((row) => row.key === key);

  /*
   * Row isn't currently loaded.
   * Nothing visible needs to change.
   */
  if (index === -1) {
    return rows;
  }

  const next = [...rows];

  next.splice(index, 1);

  return next;
}
```

---

# 4. Add/replace `areSameBasketOrder`

Use this version because your `MessageRow` and `BasketOrder` are different types.

```tsx
function areSameBasketOrder(
  current: MessageRow,
  next: BasketOrder,
): boolean {
  const currentRecord =
    current as unknown as Record<string, unknown>;

  const nextRecord =
    next as unknown as Record<string, unknown>;

  for (const key of Object.keys(nextRecord)) {
    if (!Object.is(currentRecord[key], nextRecord[key])) {
      return false;
    }
  }

  return true;
}
```

This avoids the TypeScript error you just got.

---

# 5. Keep your AMPS message handling like this

Where you currently process the AMPS message, keep the important part as:

```tsx
const record: BasketOrder | undefined = message.data;

if (!record) {
  return;
}

const key: string | undefined =
  message.sowKey?.() || record.listId;

if (!key) {
  return;
}

if (command === "oof") {
  pendingPatchesRef.current.set(key, null);
  scheduleFlush();
  return;
}

// Normal live update
pendingPatchesRef.current.set(key, record);

scheduleFlush();
```

The important thing here is:

```tsx
pendingPatchesRef.current.set(key, record);
scheduleFlush();
```

**Do not call `setWindowRows()` directly from the AMPS callback.**

---

# 6. Your data flow should now be exactly this

```text
AMPS message
     │
     ▼
extract key
     │
     ▼
pendingPatchesRef
     │
     │   multiple messages
     │   can accumulate here
     ▼
scheduleFlush()
     │
     │ 500 ms
     ▼
ONE setWindowRows()
     │
     ▼
for each pending update
     │
     ├── row not visible?
     │       │
     │       └── return SAME rows array
     │
     ├── row unchanged?
     │       │
     │       └── return SAME rows array
     │
     └── row actually changed?
             │
             └── create new array
                     │
                     ▼
                   render
```

That is the behavior you want.

---

## One important correction

**Do not remove `scheduleFlush`.**

You already proved why it exists. Without it, a busy AMPS stream can cause:

```text
message 1 → setState → render
message 2 → setState → render
message 3 → setState → render
message 4 → setState → render
...
```

The problem was **not that `scheduleFlush` existed**.

The problem was that the flush was doing:

```tsx
setWindowRows(...)
```

and producing a new state value even when the update didn't actually require a visible change.

The corrected version makes this distinction:

```tsx
// Nothing visible changed
return rows;
```

versus:

```tsx
// Something visible actually changed
return next;
```

That is the key fix.

### Also make sure your keys line up

Your initial `windowRows` must have:

```tsx
{
  key: someStableRowIdentifier,
  ...
}
```

and the AMPS update must calculate the **same identifier**:

```tsx
const key = message.sowKey?.() || record.listId;
```

So this must be true:

```tsx
windowRows[index].key === key
```

If those identifiers don't match, every AMPS update will simply be treated as "not currently loaded," and the live row won't update. That's a data-key problem, not a rendering problem.

Finally, keep your existing cleanup:

```tsx
if (flushTimerRef.current !== null) {
  clearTimeout(flushTimerRef.current);
  flushTimerRef.current = null;
}
```

inside the component's unmount cleanup. Otherwise React will eventually get a timer callback arriving after the component has packed its bags and left the building.
