"use no memo";

import { useState } from "react";
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

const fallbackData: TradeOrder[] = [
  {
    orderNumber: "ORD-1001",
    trading: "BTC/USD",
    orderPrice: 64250.0,
    status: "Executed",
  },
  {
    orderNumber: "ORD-1002",
    trading: "ETH/USD",
    orderPrice: 3450.75,
    status: "Pending",
  },
  {
    orderNumber: "ORD-1003",
    trading: "SOL/USD",
    orderPrice: 145.2,
    status: "Cancelled",
  },
  {
    orderNumber: "ORD-1004",
    trading: "AAPL",
    orderPrice: 175.5,
    status: "Executed",
  },
  {
    orderNumber: "ORD-1005",
    trading: "TSLA",
    orderPrice: 210.0,
    status: "Pending",
  },
];

const columnHelper = createColumnHelper<TradeOrder>();

const columns = [
  // 1. Checkbox Column (Sorting and Filtering Disabled)
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

  // 2. Add state for Sorting and Filtering
  const [rowSelection, setRowSelection] = useState({});
  const [sorting, setSorting] = useState<SortingState>([]);
  const [columnFilters, setColumnFilters] = useState<ColumnFiltersState>([]);

  const table = useReactTable({
    data,
    columns,
    getCoreRowModel: getCoreRowModel(),

    // 3. Inject the Sorting and Filtering Models
    getSortedRowModel: getSortedRowModel(),
    getFilteredRowModel: getFilteredRowModel(),

    // 4. Bind the state
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

  return (
    <div className="p-8 max-w-5xl mx-auto">
      <h1 className="text-2xl font-bold mb-4">Trading Orders Dashboard</h1>

      <div className="rounded-md border bg-card text-card-foreground shadow-sm">
        <Table>
          <TableHeader>
            {table.getHeaderGroups().map((headerGroup) => (
              <TableRow key={headerGroup.id}>
                {headerGroup.headers.map((header) => {
                  return (
                    <TableHead key={header.id} className="align-top py-3">
                      {header.isPlaceholder ? null : (
                        <div className="flex flex-col gap-2">
                          {/* 5. Sortable Column Header Button */}
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

                          {/* 6. Per-Column Filter Input */}
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
            {table.getRowModel().rows?.length ? (
              table.getRowModel().rows.map((row) => (
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
              ))
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
          </TableBody>
        </Table>
      </div>

      <div className="mt-4 text-sm text-muted-foreground">
        Selected Row IDs: {JSON.stringify(rowSelection)}
      </div>
    </div>
  );
}
