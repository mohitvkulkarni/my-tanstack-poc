"use no memo";

import { useState, useRef } from "react";
import {
  createColumnHelper,
  flexRender,
  getCoreRowModel,
  getFilteredRowModel,
  getSortedRowModel,
  useReactTable,
  type SortingState,
  type ColumnFiltersState,
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

type TradeOrder = {
  orderNumber: string;
  trading: string;
  orderPrice: number;
  status: string;
};

// 1. Generate 10,000 rows to test virtualization
const generateData = (count: number): TradeOrder[] => {
  const statuses = ["Executed", "Pending", "Cancelled"];
  const pairs = ["BTC/USD", "ETH/USD", "SOL/USD", "AAPL", "TSLA"];
  return Array.from({ length: count }, (_, i) => ({
    orderNumber: `ORD-${1000 + i}`,
    trading: pairs[Math.floor(Math.random() * pairs.length)],
    orderPrice: Math.random() * 50000 + 100,
    status: statuses[Math.floor(Math.random() * statuses.length)],
  }));
};

const fallbackData = generateData(10000);
const columnHelper = createColumnHelper<TradeOrder>();

const columns = [
  columnHelper.display({
    id: "select",
    enableSorting: false,
    enableColumnFilter: false,
    header: ({ table }) => (
      <Checkbox
        checked={
          table.getIsAllPageRowsSelected() ||
          (table.getIsSomePageRowsSelected() && "indeterminate")
        }
        onCheckedChange={(value) => table.toggleAllPageRowsSelected(!!value)}
        aria-label="Select all"
      />
    ),
    cell: ({ row }) => (
      <Checkbox
        checked={row.getIsSelected()}
        onCheckedChange={(value) => row.toggleSelected(!!value)}
        aria-label="Select row"
      />
    ),
  }),
  columnHelper.accessor("orderNumber", {
    header: "Order Number",
    cell: (info) => <span className="font-medium">{info.getValue()}</span>,
  }),
  columnHelper.accessor("trading", {
    header: "Trading",
    cell: (info) => info.getValue(),
  }),
  columnHelper.accessor("orderPrice", {
    header: "Order Price",
    cell: (info) => {
      const amount = info.getValue();
      return new Intl.NumberFormat("en-US", {
        style: "currency",
        currency: "USD",
      }).format(amount);
    },
  }),
  columnHelper.accessor("status", {
    header: "Status",
    cell: (info) => {
      const status = info.getValue();
      return (
        <span
          className={`px-2 py-1 rounded-full text-xs font-medium ${
            status === "Executed"
              ? "bg-green-100 text-green-700"
              : status === "Pending"
                ? "bg-yellow-100 text-yellow-700"
                : "bg-red-100 text-red-700"
          }`}
        >
          {status}
        </span>
      );
    },
  }),
];

export function TradingTable() {
  const [data] = useState(() => fallbackData);

  const [rowSelection, setRowSelection] = useState({});
  const [sorting, setSorting] = useState<SortingState>([]);
  const [columnFilters, setColumnFilters] = useState<ColumnFiltersState>([]);

  // 2. Ref for the scrollable container
  const tableContainerRef = useRef<HTMLDivElement>(null);

  const table = useReactTable({
    data,
    columns,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    onSortingChange: setSorting,
    onColumnFiltersChange: setColumnFilters,
    enableRowSelection: true,
    onRowSelectionChange: setRowSelection,
    getRowId: (row) => row.orderNumber,
    state: {
      rowSelection,
      sorting,
      columnFilters,
    },
  });

  // Extract the flattened rows after filtering/sorting
  const { rows } = table.getRowModel();

  // 3. Initialize the Virtualizer
  const rowVirtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => tableContainerRef.current,
    estimateSize: () => 50, // Approximate row height in pixels
    overscan: 5, // Render 5 extra rows off-screen for smooth scrolling
  });

  const virtualRows = rowVirtualizer.getVirtualItems();

  // Calculate top and bottom padding to mimic the height of unrendered rows
  const paddingTop = virtualRows.length > 0 ? virtualRows[0]?.start || 0 : 0;
  const paddingBottom =
    virtualRows.length > 0
      ? rowVirtualizer.getTotalSize() -
        (virtualRows[virtualRows.length - 1]?.end || 0)
      : 0;

  return (
    <div className="p-8 max-w-5xl mx-auto">
      <h1 className="text-2xl font-bold mb-4">Trading Orders Dashboard</h1>

      {/* 4. The Scrollable Container with Fixed Max Height */}
      <div
        ref={tableContainerRef}
        className="rounded-md border bg-card max-h-[600px] overflow-auto relative shadow-sm"
      >
        <Table>
          {/* Sticky Header so it doesn't scroll away */}
          <TableHeader className="sticky top-0 bg-card z-10 shadow-[0_1px_0_0_hsl(var(--border))]">
            {table.getHeaderGroups().map((headerGroup) => (
              <TableRow key={headerGroup.id}>
                {headerGroup.headers.map((header) => {
                  return (
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
                                header.column.setFilterValue(event.target.value)
                              }
                              className="h-8 w-full min-w-[120px] text-xs font-normal"
                            />
                          ) : null}
                        </div>
                      )}
                    </TableHead>
                  );
                })}
              </TableRow>
            ))}
          </TableHeader>
          <TableBody>
            {/* Top Padding Row */}
            {paddingTop > 0 && (
              <tr>
                <td style={{ height: `${paddingTop}px` }} />
              </tr>
            )}

            {/* 5. Render Only the Virtual Items */}
            {virtualRows.length > 0 ? (
              virtualRows.map((virtualRow) => {
                const row = rows[virtualRow.index]; // Retrieve the actual row data via the virtual index
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
                  colSpan={columns.length}
                  className="h-24 text-center text-muted-foreground"
                >
                  No orders match your filters.
                </TableCell>
              </TableRow>
            )}

            {/* Bottom Padding Row */}
            {paddingBottom > 0 && (
              <tr>
                <td style={{ height: `${paddingBottom}px` }} />
              </tr>
            )}
          </TableBody>
        </Table>
      </div>

      <div className="mt-4 flex justify-between text-sm text-muted-foreground">
        <div>
          Total Rows: {rows.length} | Currently Rendered: {virtualRows.length}
        </div>
        <div>Selected Rows: {Object.keys(rowSelection).length}</div>
      </div>
    </div>
  );
}
