import { useCallback, useEffect, useRef, useState } from "react";
import { Client, Command } from "amps";
import type { ColumnFiltersState, SortingState } from "@tanstack/react-table";

import { DataTable } from "@/components/ui/data-table";
import {
  AMPS_TOPIC,
  AMPS_URL,
  columns,
  type BasketOrder,
  type MessageRow,
} from "@/components/tradingColumns";
import {
  connectionBadgeClass,
  connectionLabel,
  type ConnectionStatus,
} from "@/components/connectionStatus";

interface AmpsMessageHeader {
  command?: () => string;
  status?: () => string;
  reason?: () => string;
  sowKey?: () => string;
}

interface AmpsMessage<TData> {
  header?: AmpsMessageHeader;
  data?: TData;
}

interface RowCountData {
  total?: number;
}

interface RangeChangeArgs {
  startIndex: number;
  endIndex: number;
}

interface FooterRenderProps {
  selectedCount: number;
}

// Number of rows AG-Grid's OneTouchGridViewport keeps loaded around the visible area.
const VIEWPORT_BUFFER = 25;

// How long to wait after the visible range stops changing before re-querying AMPS.
// Mirrors AG-Grid viewport's BLOCK_LOAD_DEBOUNCE_MILLIS.
const RANGE_DEBOUNCE_MS = 150;

// Stable sort key used for skip_n/top_n paging when the user hasn't chosen a
// column sort. Matches the reference AG-Grid dashboard's default column sort
// (transactTime, desc) so the initial window shows the newest/most active
// baskets first -- the same rows most likely to be ticking live -- instead
// of an arbitrary alphabetical-by-listID slice that can land on dormant rows.
const DEFAULT_ORDER_BY = "/transactTime desc";

// AMPS server-side conflation window for the viewport subscription: rapid
// updates to the same row within this interval are collapsed into a single
// delivery. This is what makes the on-screen ticking cadence *feel* slower
// than a raw/unconflated subscription to the exact same topic -- lower this
// (or remove the "conflation" option entirely below) if the demo needs to
// look as live as the reference dashboard, at the cost of more messages/
// re-renders per second.
const CONFLATION_MS = 250;

// Converts TanStack's column sort state into an AMPS orderBy expression, the
// same way AG-Grid's OneTouchViewportDataSource builds "/field asc|desc"
// pairs from the grid's sort columns (joined by ", " for multi-column sort).
function buildOrderBy(sorting: SortingState): string {
  if (sorting.length === 0) return DEFAULT_ORDER_BY;

  return sorting
    .map((sort) => `/${sort.id} ${sort.desc ? "desc" : "asc"}`)
    .join(", ");
}

// IMPORTANT: AMPS's LIKE operator matches a *regular expression*, NOT SQL
// "%" "*" wildcards -- so "%value%" would look for literal percent signs
// and match nothing. Each non-empty filter therefore becomes a regex that
// matches the (regex-escaped) value anywhere in the field, case-insensitively
// via the "(?i)" flag. Multiple active filters are AND-ed together. Single
// quotes in the user's text are escaped ("''") so a value containing a quote
// can't break out of the string literal / inject filter syntax. Returns "" when
// no filters are active (AMPS then matches all rows).
function buildFilter(columnFilters: ColumnFiltersState): string {
  const clauses = columnFilters
    .filter(
      (filter) =>
        filter.value !== undefined &&
        filter.value !== null &&
        String(filter.value).trim() !== "",
    )
    .map((filter) => {
      // Escape regex metacharacters so the user's text is matched literally,
      // then escape single quotes for the AMPS string literal.
      const escaped = String(filter.value)
        .trim()
        .replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
        .replace(/'/g, "''");

      return `/${filter.id} LIKE '(?i).*${escaped}.*'`;
    });

  return clauses.join(" AND ");
}

// Connection-status presentation helpers, extracted so the JSX below avoids
// nested ternaries (SonarQube S3358). Badge class + label are shared with
// TradingTable via src/components/connectionStatus.ts; this file's empty
// message text differs slightly, so it stays local.
function connectionEmptyMessage(status: ConnectionStatus): string {
  if (status === "connected") return "No orders found in this SOW topic.";
  if (status === "connecting") return "Connecting and fetching SOW row count...";
  return "Unable to connect to AMPS WebSocket.";
}

// Row-window updaters kept at module scope so the AMPS message handler doesn't
// nest functions more than 4 levels deep (SonarQube S2004).
function dropRowByKey(rows: MessageRow[], key: string): MessageRow[] {
  return rows.filter((row) => row.key !== key);
}

function applyRowUpdate(
  rows: MessageRow[],
  key: string,
  record: BasketOrder,
): MessageRow[] {
  const index = rows.findIndex((row) => row.key === key);
  if (index === -1) return rows; // not in the visible window, ignore

  const next = rows.slice();
  next[index] = { ...next[index], ...record, key };
  return next;
}

export function TradingTableViewport() {
  // --- Performance measurement: Time To First Row (TTFR) ---
  // TTFR = time from this component mounting to the first real server row
  // being loaded into state. This is the most fundamental grid performance
  // metric to compare against AG-Grid's viewport (and equivalent tests in
  // OneTouchViewportDataSource: one at construction, one at the first
  // getRows()/init callback resolving with real rows).
  const mountMarkRef = useRef<number | null>(null);
  if (mountMarkRef.current === null) {
    mountMarkRef.current = performance.now();
    performance.mark("viewport:mount");
  }

  const ttfrLoggedRef = useRef(false);

  const [connectionStatus, setConnectionStatus] =
    useState<ConnectionStatus>("connecting");

  // Total number of rows matching the SOW query (from header.matches() on the
  // group_begin message) -- this sizes the virtualizer/scrollbar without ever
  // loading all rows into the browser.
  const [totalRowCount, setTotalRowCount] = useState(0);

  // Only the currently loaded window is kept in state.
  const [windowStart, setWindowStart] = useState(0);
  const [windowRows, setWindowRows] = useState<MessageRow[]>([]);
  const [isFetchingRange, setIsFetchingRange] = useState(false);

  const clientRef = useRef<Client | null>(null);
  const activeSubIdRef = useRef<string | null>(null);
  const generationRef = useRef(0);
  const debounceTimerRef =
    useRef<ReturnType<typeof setTimeout> | null>(null);

  // Instead we buffer patches here (null = drop/oof) into a plain Map --
  // cheap, no render -- and flush those into state on a trailing throttle,
  // mirroring AG-Grid's OneTouchViewportDataSource updatedRows/flush approach.
  // That datasource used lodash.throttle(() => this.flushRowData(), 500,
  // { leading: false }), so the grid could only ever repaint at most once/sec.
  // For FLUSH_THROTTLE_MS, no matter how many messages arrive in between.
  const FLUSH_THROTTLE_MS = 500;

  const pendingPatchesRef = useRef<Map<string, BasketOrder | null>>(
    new Map(),
  );
  const flushTimerRef =
    useRef<ReturnType<typeof setTimeout> | null>(null);

  const scheduleFlush = useCallback(() => {
    if (flushTimerRef.current) return; // a trailing flush is already queued

    flushTimerRef.current = setTimeout(() => {
      flushTimerRef.current = null;

      const pending = pendingPatchesRef.current;
      if (pending.size === 0) return;

      pendingPatchesRef.current = new Map();

      setWindowRows((rows) => {
        let next = rows;

        pending.forEach((record, key) => {
          next =
            record === null
              ? dropRowByKey(next, key)
              : applyRowUpdate(next, key, record);
        });

        return next;
      });
    }, FLUSH_THROTTLE_MS);
  }, []);

  // Current AMPS orderBy expression, driven by column header sort clicks.
  // Kept in a ref (not state) so fetchRange always reads the latest value
  // without needing to be re-created every time the sort changes.
  const orderByRef = useRef(DEFAULT_ORDER_BY);

  // Current AMPS content-filter expression, driven by the column filter
  // boxes. Also a ref so fetchRange always sees the latest filter without
  // being re-created on every keystroke.
  const filterRef = useRef("");

  // Separate debounce timer for filter typing so we don't fire an AMPS
  // round-trip on every keystroke (mirrors AG-Grid's filter debounce).
  const filterDebounceTimerRef =
    useRef<ReturnType<typeof setTimeout> | null>(null);

  // Standalone AMPS row-count subscription -- separate from the windowed
  // skip_n/top_n data subscription above. Mirrors AG-Grid's
  // OneTouchViewPortDataSource.getRowCount(): rather than reading
  // header.topicmatches()/matches() off the *windowed* query's ack (which
  // only refreshes whenever we happen to scroll/sort/filter and refetch),
  // this opens its own permanently-live sow_and_subscribe using a
  // server-side COUNT(1) aggregate ("projection=[COUNT(1) AS /total],
  // grouping=[/*]"). AMPS keeps that single aggregate row updated in real
  // time as matching rows are added/removed anywhere in the topic -- e.g. a
  // basket order created by another trader updates the total immediately,
  // even while this client is sitting still and not re-fetching a window.
  const countSubIdRef = useRef<string | null>(null);

  const subscribeRowCount = useCallback(async () => {
    const client = clientRef.current;
    if (!client) return;

    // Only one live count subscription at a time -- drop the previous one
    // (e.g. from before a filter change) the same way fetchRange replaces
    // its windowed subscription.
    if (countSubIdRef.current) {
      const previousCountSubId = countSubIdRef.current;
      countSubIdRef.current = null;
      client.unsubscribe(previousCountSubId).catch(() => {});
    }

    const command = new Command("sow_and_subscribe")
      .topic(AMPS_TOPIC)
      .options(
        `projection=[COUNT(1) AS /total], grouping=[/*], conflation=${CONFLATION_MS}ms`,
      );

    if (filterRef.current) {
      command.filter(filterRef.current);
    }

    // Accumulates the aggregate row's value until group_end delivers the
    // first count -- same pattern as OneTouchViewportDataSource.getRowCount.
    let latestTotal = 0;

    try {
      const subId = await client.execute(
        command,
        (message: AmpsMessage<RowCountData>) => {
          const cmd = message.header?.command?.();

          if (cmd === "sow") {
            latestTotal = message.data?.total ?? latestTotal;
            return;
          }

          if (cmd === "group_end") {
            setTotalRowCount(latestTotal);
            return;
          }

          if (cmd === "p") {
            latestTotal = message.data?.total ?? latestTotal;
            setTotalRowCount(latestTotal);
          }
        },
      );

      countSubIdRef.current = subId;
    } catch (err) {
      console.error("AMPS row-count subscription failed:", err);
    }
  }, []);

  // Kept in refs so the debounced range-change handler always reads the
  // latest loaded window without needing to be re-created on every fetch.
  const totalRowCountRef = useRef(0);
  const windowStartRef = useRef(0);
  const windowRowsRef = useRef<MessageRow[]>([]);

  useEffect(() => {
    totalRowCountRef.current = totalRowCount;
  }, [totalRowCount]);

  useEffect(() => {
    windowStartRef.current = windowStart;
  }, [windowStart]);

  useEffect(() => {
    windowRowsRef.current = windowRows;
  }, [windowRows]);

  const fetchRange = useCallback(
    async (
      start: number,
      end: number,
      reason: "initial" | "scroll" | "sort" | "filter" = "scroll",
    ) => {
      const client = clientRef.current;
      if (!client) return;

      const myGeneration = ++generationRef.current;

      // Discard any not-yet-flushed patches (and cancel their pending trailing
      // flush) from the previous window/generation -- applying them after this
      // fetch resets "windowRows" would reintroduce stale rows.
      if (flushTimerRef.current) {
        clearTimeout(flushTimerRef.current);
        flushTimerRef.current = null;
      }

      pendingPatchesRef.current = new Map();

      const skipN = Math.max(0, start);
      const topN = Math.max(1, end - start + 1);

      // Start of this fetch's round trip -- stopped when its group_end lands,
      // giving the pure AMPS request/response latency (debounce time is a
      // known fixed 150ms and isn't included here).
      const fetchStartedAt = performance.now();

      // Quick visual proof a new server round-trip actually happened -- look
      // for this in the console every time you scroll past the loaded window.
      console.log(
        `[viewport] fetchRange(${reason}) -> skip_n=${skipN}, top_n=${topN}, orderBy=${orderByRef.current}, filter=${filterRef.current || "(none)"}`,
      );

      // Drop the previous windowed subscription -- we only ever want one
      // active AMPS subscription for the visible range at a time.
      if (activeSubIdRef.current) {
        const previousSubId = activeSubIdRef.current;
        activeSubIdRef.current = null;
        client.unsubscribe(previousSubId).catch(() => {});
      }

      setIsFetchingRange(true);

      // Rows accumulated for this fetch's initial "sow" batch, in server order.
      const batch: MessageRow[] = [];

      try {
        const command = new Command("sow_and_subscribe")
          .topic(AMPS_TOPIC)
          .orderBy(orderByRef.current)
          .options(
            `skip_n=${skipN}, top_n=${topN}, oof, conflation=${CONFLATION_MS}ms`,
          );

        // Only attach a content filter when the user has actually typed one --
        // an empty filter expression would restrict the query to nothing.
        if (filterRef.current) {
          command.filter(filterRef.current);
        }

        const subId = await client.execute(
          command,
          (message: AmpsMessage<BasketOrder>) => {
            // Ignore messages from a subscription we've since replaced.
            if (myGeneration !== generationRef.current) return;

            const commandName = message.header?.command?.();
            const status = message.header?.status?.();

            // Surface AMPS-side rejections instead of silently dropping them.
            // A failed sow_and_subscribe (e.g. an invalid orderBy field, or a
            // topic that doesn't support skip_n/top_n paging) arrives as an ack
            // message with no "data", so without this check it would just fall
            // through the "if (!record) return;" below with zero visible sign
            // of failure.
            if (status === "failure") {
              console.error(
                "AMPS rejected the viewport sow_and_subscribe command:",
                message.header?.reason?.() ?? "(no reason provided)",
                {
                  skipN,
                  topN,
                  orderBy: orderByRef.current,
                  options: message.header,
                },
              );
              setIsFetchingRange(false);
              return;
            }

            if (commandName === "group_end") {
              setWindowStart(skipN);
              setWindowRows(batch.slice());
              setIsFetchingRange(false);

              // Safety net: if the "stats" ack never arrives (or reports a
              // stale/zero count), never let a missing total hide rows we've
              // actually loaded -- always show at least what's in the window.
              setTotalRowCount((prev) =>
                Math.max(prev, skipN + batch.length),
              );

              // Metric #2: re-fetch latency -- pure AMPS round trip for this
              // window, logged for every fetch (initial/scroll/sort) so you
              // can compare against AG-Grid's viewport block-load timing.
              const latencyMs = performance.now() - fetchStartedAt;
              console.log(
                `[perf] ${reason} fetch latency = ${latencyMs.toFixed(1)}ms (skip_n=${skipN}, top_n=${topN}, rows=${batch.length})`,
              );

              // Log TTFR exactly once -- the first time any window (normally
              // the initial 0..50 load) finishes loading for this mount.
              if (!ttfrLoggedRef.current) {
                ttfrLoggedRef.current = true;
                performance.mark("viewport:first-data");
                const measure = performance.measure(
                  "viewport:TTFR",
                  "viewport:mount",
                  "viewport:first-data",
                );
                console.log(
                  `[perf] TTFR (Time To First Row) = ${measure.duration.toFixed(1)}ms (${batch.length} rows)`,
                );
              }

              return;
            }

            const record: BasketOrder | undefined = message.data;
            if (!record) return;

            const key: string | undefined =
              message.header?.sowKey?.() || record.listID;
            if (!key) return;

            if (commandName === "sow") {
              // Initial snapshot row for this window -- server order maps
              // directly to on-screen row order.
              batch.push({ ...record, key });
              return;
            }

            if (commandName === "oof") {
              // Out-of-focus: record no longer matches -- drop it if it's
              // currently part of the loaded window. Buffered, not applied
              // immediately -- see pendingPatchesRef/scheduleFlush above.
              pendingPatchesRef.current.set(key, null);
              scheduleFlush();
              return;
            }

            // Live update for a row that's part of the currently loaded window.
            pendingPatchesRef.current.set(key, record);
            scheduleFlush();
          },
        );

        activeSubIdRef.current = subId;
      } catch (err) {
        console.error("AMPS viewport range query failed:", err);
        setIsFetchingRange(false);
      }
    },
    [scheduleFlush],
  );

  // Debounced handler: only re-query AMPS once scrolling settles and the
  // visible range actually moves outside the currently loaded window.
  const handleRangeChange = useCallback(
    ({ startIndex, endIndex }: RangeChangeArgs) => {
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
      }

      debounceTimerRef.current = setTimeout(() => {
        const total = totalRowCountRef.current;

        const desiredStart = Math.max(
          0,
          startIndex - VIEWPORT_BUFFER,
        );
        const desiredEnd = Math.min(
          Math.max(total - 1, 0),
          endIndex + VIEWPORT_BUFFER,
        );

        const loadedStart = windowStartRef.current;
        const loadedEnd =
          loadedStart + windowRowsRef.current.length - 1;

        const needsFetch =
          windowRowsRef.current.length === 0 ||
          desiredStart < loadedStart ||
          desiredEnd > loadedEnd;

        if (needsFetch) {
          fetchRange(desiredStart, desiredEnd);
        }
      }, RANGE_DEBOUNCE_MS);
    },
    [fetchRange],
  );

  // Column header sort clicks change the *server-side* ordering (AMPS
  // orderBy) instead of re-sorting whatever's already loaded client-side --
  // reordering the sparse loaded window locally would only reorder the
  // handful of rows we happen to have, not the true dataset, and would break
  // the skip_n/top_n <-> row index mapping. So a sort change discards the
  // current window and re-fetches from row 0 under the new order.
  const handleSortingChange = useCallback(
    (sorting: SortingState) => {
      const nextOrderBy = buildOrderBy(sorting);
      if (nextOrderBy === orderByRef.current) return;

      orderByRef.current = nextOrderBy;

      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
      }

      setWindowStart(0);
      setWindowRows([]);
      setTotalRowCount(0);

      if (clientRef.current) {
        fetchRange(0, VIEWPORT_BUFFER * 2, "sort");
      }
    },
    [fetchRange],
  );

  // Column filter boxes drive a *server-side* AMPS content filter instead of
  // filtering the sparse loaded window client-side -- the loaded window only
  // holds ~50 of potentially thousands of rows, so a client filter would only
  // ever search those and miss every matching row outside the window. A filter
  // change therefore discards the current window and re-fetches from row 0
  // under the new filter (debounced so we don't hit AMPS on every keystroke).
  const handleColumnFiltersChange = useCallback(
    (columnFilters: ColumnFiltersState) => {
      const nextFilter = buildFilter(columnFilters);
      if (nextFilter === filterRef.current) return;

      filterRef.current = nextFilter;

      if (filterDebounceTimerRef.current) {
        clearTimeout(filterDebounceTimerRef.current);
      }

      filterDebounceTimerRef.current = setTimeout(() => {
        if (debounceTimerRef.current) {
          clearTimeout(debounceTimerRef.current);
        }

        setWindowStart(0);
        setWindowRows([]);
        setTotalRowCount(0);

        if (clientRef.current) {
          fetchRange(0, VIEWPORT_BUFFER * 2, "filter");

          // The live count subscription was opened against the *previous*
          // filter -- re-subscribe so the total reflects the new filter too.
          subscribeRowCount();
        }
      }, RANGE_DEBOUNCE_MS);
    },
    [fetchRange, subscribeRowCount],
  );

  useEffect(() => {
    let cancelled = false;
    let client: Client | null = null;

    async function initAmps() {
      try {
        setConnectionStatus("connecting");

        const clientId = `otgrid-viewport-${Date.now()}`;
        const newClient = new Client(clientId);
        client = newClient;

        await newClient.connect(AMPS_URL);

        if (cancelled) {
          newClient.disconnect().catch(() => {});
          return;
        }

        clientRef.current = newClient;
        setConnectionStatus("connected");

        // Load the first page immediately (rows 0..PAGE, no need to wait for scroll).
        fetchRange(0, VIEWPORT_BUFFER * 2, "initial");

        // Independent, permanently-live total-row-count subscription -- see
        // subscribeRowCount above.
        subscribeRowCount();
      } catch (err) {
        if (cancelled) return; // stale attempt -- ignore its failure too
        console.error("AMPS Connection Error:", err);
        setConnectionStatus("failed");
      }
    }

    initAmps();

    return () => {
      cancelled = true;
      generationRef.current++; // invalidate any in-flight handlers

      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
      }

      if (filterDebounceTimerRef.current) {
        clearTimeout(filterDebounceTimerRef.current);
      }

      if (flushTimerRef.current) {
        clearTimeout(flushTimerRef.current);
      }

      pendingPatchesRef.current = new Map();
      countSubIdRef.current = null;

      if (client) {
        try {
          client.disconnect();
        } catch (e) {
          console.error("AMPS Disconnect Error:", e);
        }
      }

      clientRef.current = null;
    };
  }, [fetchRange, subscribeRowCount]);

  const ViewportDataTable = DataTable as any;

  return (
    <div className="p-8 w-full">
      <div className="flex justify-between items-center mb-4">
        <div>
          <h2 className="text-2xl font-bold">
            Basket Orders Dashboard (Server Viewport)
          </h2>
          <p className="text-xs text-muted-foreground mt-1">
            Endpoint: {AMPS_URL} | Topic: {AMPS_TOPIC}
            {/* | skip_n/top_n windowed */}
            {/* like AG-Grid's Viewport Row Model */}
          </p>
        </div>

        <span
          className={`px-3 py-1 rounded-full text-xs font-semibold ${connectionBadgeClass(
            connectionStatus,
          )}`}
        >
          {connectionLabel(connectionStatus)}
        </span>
      </div>

      <ViewportDataTable
        // Only the loaded window is ever handed to TanStack -- "rowCount" /
        // "rowOffset" size the virtualizer/scrollbar off the true server
        // total instead. This is what makes a live update (windowRows
        // changing) cost O(loaded window) instead of O(totalRowCount): with
        // a multi-thousand-row SOW topic, feeding a full-length sparse array
        // here made getCoreRowModel() rebuild thousands of row objects on
        // every 500ms flush even though only ~50-100 rows are ever loaded --
        // exactly the AG-Grid Viewport Row Model's approach (it only ever
        // touches nodes for the loaded window, never the whole logical
        // dataset).
        data={windowRows}
        rowCount={totalRowCount}
        rowOffset={windowStart}
        columns={columns}
        getRowId={(row: MessageRow) => row.key}
        showSelectionColumn
        fillViewport
        viewportBottomGap={96}
        onRangeChange={handleRangeChange}
        manualSorting
        onSortingChange={handleSortingChange}
        initialSorting={[{ id: "transactTime", desc: true }]}
        manualFiltering
        onColumnFiltersChange={handleColumnFiltersChange}
        emptyMessage={connectionEmptyMessage(connectionStatus)}
        renderFooter={({ selectedCount }: FooterRenderProps) => (
          <div className="mt-4 flex justify-between text-sm text-muted-foreground">
            <div>
              Total Rows: {totalRowCount} | Loaded Window:{" "}
              {windowRows.length} rows @ offset {windowStart}
              {isFetchingRange ? " (fetching...)" : ""}
            </div>
            <div>Selected Orders: {selectedCount}</div>
          </div>
        )}
      />
    </div>
  );
}
