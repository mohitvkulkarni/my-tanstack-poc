import { useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import {
  flexRender,
  getCoreRowModel,
  getFilteredRowModel,
  getSortedRowModel,
  useReactTable,
  type CellContext,
  type ColumnDef,
  type ColumnFiltersState,
  type HeaderContext,
  type RowSelectionState,
  type SortingState,
  type Table as TanStackTable,
} from "@tanstack/react-table";
import { useVirtualizer } from "@tanstack/react-virtual";
import { ArrowUpDown } from "lucide-react";

import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";

// The select-all checkbox tri-state, extracted to avoid a nested ternary.
function getSelectAllChecked<TData>(
  table: TanStackTable<TData>,
): boolean | "indeterminate" {
  if (table.getIsAllRowsSelected()) return true;
  if (table.getIsSomeRowsSelected()) return "indeterminate";
  return false;
}

// Selection checkboxes defined at module scope so they are not nested inside
// the column definition / parent component (SonarQube S6478).
function SelectAllCheckbox<TData>({
  table,
}: HeaderContext<TData, unknown>) {
  return (
    <Checkbox
      checked={getSelectAllChecked(table)}
      onCheckedChange={(value) => table.toggleAllRowsSelected(value === true)}
      aria-label="Select all"
    />
  );
}

function RowSelectCheckbox<TData>({
  row,
}: CellContext<TData, unknown>) {
  return (
    <Checkbox
      checked={row.getIsSelected()}
      disabled={!row.getCanSelect()}
      onCheckedChange={(value) => row.toggleSelected(value === true)}
      aria-label="Select row"
    />
  );
}

export interface DataTableProps<TData> {
  /** Row data. Pass a new array reference whenever rows change (e.g. a live feed). */
  data: TData[];

  /** Column definitions, e.g. built with @tanstack/react-table's `createColumnHelper`. */
  columns: ColumnDef<TData, any>[];

  /** Derive a stable unique id per row. Strongly recommended for live/streaming data. */
  getRowId?: (row: TData, index: number) => string;

  /** Enable row selection state tracking. Default true. */
  enableRowSelection?: boolean;

  /** Render a built-in checkbox column (select-all header + per-row checkbox). Default false. */
  showSelectionColumn?: boolean;

  /** Content shown in place of rows when data is empty. */
  emptyMessage?: ReactNode;

  /** Max height of the scrollable table body (CSS value), e.g. "600px". Default "600px". */
  maxHeight?: string;

  /** Enable viewport fill mode. */
  fillViewport?: boolean;

  /** Extra bottom gap in px when calculating the available viewport height. */
  viewportBottomGap?: number;

  /** Estimated row height in px, used by the row virtualizer. Default 50. */
  estimateRowHeight?: number;

  /** Extra rows rendered outside the visible viewport. Default 5. */
  overscan?: number;

  /** Extra class names applied to the outer wrapper. */
  className?: string;

  /** Called whenever row selection changes. */
  onRowSelectionChange?: (selection: RowSelectionState) => void;

  /** Called whenever the visible row range changes. */
  onRangeChange?: (range: { startIndex: number; endIndex: number }) => void;

  /** Enable manual/server-side sorting. */
  manualSorting?: boolean;

  /**
   * Called whenever the user toggles a column sort (header click). Combine
   * with `manualSorting` to drive a server-side sort instead of a client one.
   */
  onSortingChange?: (sorting: SortingState) => void;

  /** Initial sorting state. */
  initialSorting?: SortingState;

  /** Enable manual/server-side filtering. */
  manualFiltering?: boolean;

  /** Called whenever column filters change. */
  onColumnFiltersChange?: (filters: ColumnFiltersState) => void;

  /** Render a footer below the table, given live row/selection counts. */
  renderFooter?: (info: {
    totalRows: number;
    renderedRows: number;
    selectedCount: number;
  }) => ReactNode;
}

export function DataTable<TData>({
  data,
  columns,
  getRowId,
  enableRowSelection = true,
  showSelectionColumn = false,
  emptyMessage = "No data.",
  maxHeight = "600px",
  fillViewport = false,
  viewportBottomGap = 24,
  estimateRowHeight = 50,
  overscan = 5,
  className,
  onRowSelectionChange: onRowSelectionChangeProp,
  onRangeChange,
  manualSorting = false,
  onSortingChange: onSortingChangeProp,
  initialSorting,
  manualFiltering = false,
  onColumnFiltersChange: onColumnFiltersChangeProp,
  renderFooter,
}: DataTableProps<TData>) {
  const [rowSelection, setRowSelection] = useState<RowSelectionState>({});
  const [sorting, setSorting] = useState<SortingState>(initialSorting ?? []);
  const [columnFilters, setColumnFilters] = useState<ColumnFiltersState>([]);

  const tableContainerRef = useRef<HTMLDivElement>(null);

  // When `fillViewport` is on, measure the distance from the top of the scroll
  // container to the bottom of the browser viewport.
  const [viewportHeight, setViewportHeight] = useState<number | null>(null);

  useEffect(() => {
    if (!fillViewport) {
      setViewportHeight(null);
      return;
    }

    const measure = () => {
      const el = tableContainerRef.current;
      if (!el) return;

      const top = el.getBoundingClientRect().top;
      const available = window.innerHeight - top - viewportBottomGap;
      setViewportHeight(Math.max(available, 120));
    };

    measure();
    window.addEventListener("resize", measure);

    return () => window.removeEventListener("resize", measure);
  }, [fillViewport, viewportBottomGap]);

  const resolvedHeight =
    fillViewport && viewportHeight != null ? `${viewportHeight}px` : maxHeight;

  // Optionally prepend a checkbox column so selection is usable straight from
  // the UI without callers having to define their own select column.
  const resolvedColumns = useMemo<ColumnDef<TData, any>[]>(() => {
    if (!showSelectionColumn) return columns;

    const selectionColumn: ColumnDef<TData, any> = {
      id: "__select__",
      enableSorting: false,
      enableColumnFilter: false,
      size: 40,
      header: SelectAllCheckbox,
      cell: RowSelectCheckbox,
    };

    return [selectionColumn, ...columns];
  }, [columns, showSelectionColumn]);

  const table = useReactTable({
    data,
    columns: resolvedColumns,
    getRowId,
    getSortedRowModel: manualSorting ? undefined : getSortedRowModel(),
    manualSorting,
    getFilteredRowModel: manualFiltering ? undefined : getFilteredRowModel(),
    manualFiltering,
    onSortingChange: setSorting,
    onColumnFiltersChange: setColumnFilters,
    enableRowSelection,
    onRowSelectionChange: setRowSelection,
    state: {
      rowSelection,
      sorting,
      columnFilters,
    },
    getCoreRowModel: getCoreRowModel(),
  });

  // Notify callers of sorting/selection changes from a passive effect rather
  // than from render.
  useEffect(() => {
    onSortingChangeProp?.(sorting);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sorting]);

  useEffect(() => {
    onRowSelectionChangeProp?.(rowSelection);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rowSelection]);

  useEffect(() => {
    onColumnFiltersChangeProp?.(columnFilters);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [columnFilters]);

  const { rows } = table.getRowModel();

  // Virtualization keeps rendering cheap for high-frequency / large row counts.
  const rowVirtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => tableContainerRef.current,
    estimateSize: () => estimateRowHeight,
    overscan,
  });

  const virtualRows = rowVirtualizer.getVirtualItems();
  const paddingTop =
    virtualRows.length > 0 ? virtualRows[0]?.start || 0 : 0;
  const paddingBottom =
    virtualRows.length > 0
      ? rowVirtualizer.getTotalSize() -
        (virtualRows[virtualRows.length - 1]?.end || 0)
      : 0;

  const firstVisibleIndex = virtualRows[0]?.index;
  const lastVisibleIndex =
    virtualRows[virtualRows.length - 1]?.index;

  // Notify the caller of the currently visible row window. Keyed on the
  // virtualizer's computed indexes.
  useEffect(() => {
    if (!onRangeChange) return;
    if (firstVisibleIndex === undefined || lastVisibleIndex === undefined) {
      return;
    }

    onRangeChange({
      startIndex: firstVisibleIndex,
      endIndex: lastVisibleIndex,
    });
  }, [firstVisibleIndex, lastVisibleIndex, onRangeChange]);

  return (
    <div className={className}>
      <div
        ref={tableContainerRef}
        className="rounded-md border bg-card overflow-auto relative shadow-sm"
        // minHeight matches maxHeight so the container reserves its full
        // height while the virtualized rows are being rendered.
        style={{ maxHeight: resolvedHeight, minHeight: resolvedHeight }}
      >
        <Table>
          <TableHeader className="sticky top-0 bg-card z-10 shadow-[0_1px_0_0_hsl(var(--border))]">
            {table.getHeaderGroups().map((headerGroup) => (
              <TableRow key={headerGroup.id}>
                {headerGroup.headers.map((header) => (
                  <TableHead key={header.id} className="align-top py-3">
                    {header.isPlaceholder ? null : (
                      <div className="flex flex-col gap-2">
                        <div className="flex items-center min-h-[32px]">
                          {header.column.getCanSort() ? (
                            <Button
                              variant="ghost"
                              size="sm"
                              className="-ml-3 h-8 data-[state=open]:bg-accent hover:bg-muted"
                              onClick={header.column.getToggleSortingHandler()}
                            >
                              {flexRender(
                                header.column.columnDef.header,
                                header.getContext(),
                              )}
                              <ArrowUpDown className="ml-2 h-4 w-4 text-muted-foreground" />
                            </Button>
                          ) : (
                            flexRender(
                              header.column.columnDef.header,
                              header.getContext(),
                            )
                          )}
                        </div>

                        {header.column.getCanFilter() ? (
                          <Input
                            placeholder="Filter..."
                            value={
                              (header.column.getFilterValue() ?? "") as string
                            }
                            onChange={(event) =>
                              header.column.setFilterValue(
                                event.target.value,
                              )
                            }
                            className="h-8 w-full min-w-[120px] text-xs font-normal"
                          />
                        ) : null}
                      </div>
                    )}
                  </TableHead>
                ))}
              </TableRow>
            ))}
          </TableHeader>

          <TableBody>
            {paddingTop > 0 && (
              <tr>
                <td style={{ height: `${paddingTop}px` }} />
              </tr>
            )}

            {virtualRows.length > 0 ? (
              virtualRows.map((virtualRow) => {
                const row = rows[virtualRow.index];

                return (
                  <TableRow
                    key={row.id}
                    data-state={row.getIsSelected() && "selected"}
                  >
                    {row.getVisibleCells().map((cell) => (
                      <TableCell key={cell.id} className="py-3">
                        {flexRender(
                          cell.column.columnDef.cell,
                          cell.getContext(),
                        )}
                      </TableCell>
                    ))}
                  </TableRow>
                );
              })
            ) : (
              <TableRow>
                <TableCell
                  colSpan={resolvedColumns.length}
                  className="h-24 text-center text-muted-foreground"
                >
                  {emptyMessage}
                </TableCell>
              </TableRow>
            )}

            {paddingBottom > 0 && (
              <tr>
                <td style={{ height: `${paddingBottom}px` }} />
              </tr>
            )}
          </TableBody>
        </Table>
      </div>

      {renderFooter?.({
        totalRows: rows.length,
        renderedRows: virtualRows.length,
        selectedCount: table.getSelectedRowModel().rows.length,
      })}
    </div>
  );
}
